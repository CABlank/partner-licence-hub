-- El motor de renovaciones: una fila por suscripción que caduca en 90 días,
-- con su riesgo, su precio recomendado y quién hace qué.
--
-- Es tu motor de Malco aplicado al software:
--   ocupación de flota   -> uso del cupo de almacenamiento
--   ritmo vs año pasado  -> vuelos de los últimos 3 meses vs el año pasado
--   recomendación + humano aprueba -> política por banda (seed
--   renewal_price_policy) y el deal desk solo para lo que se sale de ella.
--
-- Precio recomendado = tarifa x (1 + subida de la banda). Los descuentos de
-- retención no se aplican solos: se ofrecen hasta un tope y los aprueba el
-- deal desk. Una subida sin aprobación, un descuento con ella.
with expiring as (
    select *
    from {{ ref('int_licence_terms') }}
    where term_end between current_date and current_date + 90
),

open_requests as (
    select distinct licence_code
    from {{ ref('stg_renewal_requests') }}
    where status in ('pending', 'approved')
),

-- Las señales del último mes cerrado.
features as (
    select *
    from {{ ref('int_drone_usage_features') }}
    where as_of = date_trunc('month', current_date)::date
),

has_unlimited as (
    select distinct drone_serial
    from {{ ref('int_licence_terms') }}
    where plan = 'UNLIMITED'
      and term_start <= current_date and current_date < term_end
),

scored as (
    select
        e.*,
        f.usage_index,
        f.usage_index_basis,
        f.external_share_3m,
        round(f.data_gb_12m / pr.storage_quota_gb, 2)       as storage_used_share,
        {{ churn_risk_band('f.usage_index', 'f.external_share_3m') }} as risk_band
    from expiring e
    join {{ ref('product_prices') }} pr using (product)
    left join features f on f.drone_serial = e.drone_serial
)

select
    s.licence_code,
    s.product,
    s.plan,
    s.drone_serial,
    s.customer_id,
    s.dealer_id,
    s.distributor_id,
    s.term_end                                              as expires_on,
    s.term_end - current_date                               as days_left,
    o.licence_code is not null                              as has_open_request,
    s.usage_index,
    s.usage_index_basis,
    s.external_share_3m,
    s.storage_used_share,
    s.risk_band,
    s.arr_chf,
    s.list_price_chf,
    pol.uplift_pct,
    round(s.list_price_chf * (1 + pol.uplift_pct), 0)       as recommended_price_chf,
    pol.max_save_discount_pct,
    -- Cerca del cupo y sin UNLIMITED: la renovación es el momento de ofrecerlo.
    s.plan = 'PRO' and s.storage_used_share >= 0.8 and hu.drone_serial is null as upsell_to_unlimited,
    case
        when s.plan = 'PRO' and s.storage_used_share >= 0.8 and hu.drone_serial is null and s.risk_band <> 'high'
            then 'Quote UNLIMITED with the renewal (storage near the PRO quota)'
        else pol.next_action
    end                                                     as next_action
from scored s
join {{ ref('renewal_price_policy') }} pol using (risk_band)
left join open_requests o on o.licence_code = s.licence_code
left join has_unlimited hu on hu.drone_serial = s.drone_serial
