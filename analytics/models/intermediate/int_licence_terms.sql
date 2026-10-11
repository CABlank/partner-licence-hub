-- Una fila por TÉRMINO de suscripción (PRO y UNLIMITED), pasado o en curso.
--
-- licences solo guarda el término actual. Los anteriores se reconstruyen con
-- las renovaciones 'ordered', que congelan la caducidad que cerraron:
--   término 1:   empieza en (primera caducidad renovada - plazo)
--   término k+1: empieza en max(caducidad k, día de la aprobación), la misma
--                regla que lib/dispatcher.ts. Si renovó tarde, el hueco no se cobra.
--
-- WingtraCARE no está: se renueva sola y el portal no guarda sus términos (en
-- producción saldrían de las facturas de Odoo). LIDAR es perpetua: venta única,
-- no ARR.
with subscriptions as (
    select
        l.*,
        p.term_years,
        pr.illustrative_price_chf                           as list_price_chf
    from {{ ref('stg_licences') }} l
    join {{ ref('stg_products') }} p using (product)
    join {{ ref('product_prices') }} pr using (product)
    where not l.is_demo_unit
      and p.renewal_mode = 'manual'
),

renewals as (
    select
        licence_code,
        expires_on_at_request                               as term_end,
        decided_at::date                                    as decided_on,
        row_number() over (partition by licence_code order by expires_on_at_request) as term_number
    from {{ ref('stg_renewal_requests') }}
    where status = 'ordered'
),

closed_terms as (
    select
        r.licence_code,
        r.term_number,
        -- greatest() ignora NULL: en el primer término los dos lag() son NULL
        -- y se cae al cálculo por plazo.
        coalesce(
            greatest(lag(r.term_end) over w, lag(r.decided_on) over w),
            (r.term_end - make_interval(years => s.term_years))::date
        )                                                   as term_start,
        r.term_end
    from renewals r
    join subscriptions s using (licence_code)
    window w as (partition by r.licence_code order by r.term_number)
),

renewal_counts as (
    select licence_code, max(term_number) as n
    from renewals
    group by 1
),

current_terms as (
    select
        s.licence_code,
        coalesce(c.n, 0) + 1                                as term_number,
        s.starts_on                                         as term_start,
        -- least() ignora NULL: ended_at solo cuenta si la licencia se cortó antes.
        least(s.expires_on, s.ended_at)                     as term_end
    from subscriptions s
    left join renewal_counts c using (licence_code)
)

select
    t.licence_code,
    t.term_number,
    t.term_start,
    t.term_end,
    s.product,
    case when s.product like 'unlimited%' then 'UNLIMITED' else 'PRO' end as plan,
    s.drone_serial,
    s.customer_id,
    c.dealer_id,
    p.distributor_id,
    s.list_price_chf,
    round(s.list_price_chf / s.term_years, 2)               as arr_chf
from (
    select * from closed_terms
    union all
    select * from current_terms
) t
join subscriptions s using (licence_code)
-- Atribución: el partner del cliente (el de su código de invitación).
join {{ ref('stg_customers') }} c on c.customer_id = s.customer_id
join {{ ref('stg_partners') }} p on p.partner_id = c.dealer_id
