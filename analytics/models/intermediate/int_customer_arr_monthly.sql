-- El ARR de cada cliente el día 1 de cada mes (as_of). Rejilla completa
-- cliente x mes, con ceros: el puente de ARR necesita saber que un cliente
-- pasó de algo a nada.
--
-- Una suscripción cuenta mientras está en vigor y durante la gracia
-- (var arr_grace_days): quien renueva 10 días tarde no es una baja seguida de
-- un alta. Pero quien no renueva también cuenta 30 días de más: es el precio de
-- esa regla, y por eso es una variable visible y no un número escondido.
with terms as (
    select * from {{ ref('int_licence_terms') }}
),

months as (
    select generate_series(
        (select date_trunc('month', min(term_start)) from terms),
        date_trunc('month', current_date),
        interval '1 month'
    )::date                                                 as as_of
),

active as (
    -- Cada licencia una sola vez por mes, aunque dos términos se solapen en la gracia.
    select m.as_of, t.customer_id, t.licence_code, max(t.arr_chf) as arr_chf
    from months m
    join terms t
      on t.term_start <= m.as_of
     and m.as_of < t.term_end + {{ var('arr_grace_days') }}
    group by 1, 2, 3
)

select
    m.as_of,
    c.customer_id,
    c.dealer_id,
    p.distributor_id,
    coalesce(sum(a.arr_chf), 0)                             as arr_chf
from months m
cross join {{ ref('stg_customers') }} c
join {{ ref('stg_partners') }} p on p.partner_id = c.dealer_id
left join active a on a.as_of = m.as_of and a.customer_id = c.customer_id
group by 1, 2, 3, 4
