-- ¿"Cerca del límite de almacenamiento" predice el paso a UNLIMITED?
-- Cada mes, cada dron con PRO en vigor y sin UNLIMITED es una oportunidad.
-- Señal: los datos de los últimos 12 meses llegan al 80 % del cupo de PRO.
-- Resultado: compró UNLIMITED en los 6 meses siguientes.
-- Es la ocupación de flota de Malco: cuando se llena, el precio y la oferta cambian.
with terms as (
    select * from {{ ref('int_licence_terms') }}
),

pro_quota as (
    select storage_quota_gb
    from {{ ref('product_prices') }}
    where product = 'pro_1y'
),

unlimited_from as (
    select drone_serial, min(term_start) as first_unlimited_on
    from terms
    where plan = 'UNLIMITED'
    group by 1
),

opportunities as (
    select distinct f.drone_serial, f.as_of, f.data_gb_12m
    from {{ ref('int_drone_usage_features') }} f
    join terms t
      on t.drone_serial = f.drone_serial
     and t.plan = 'PRO'
     and t.term_start <= f.as_of and f.as_of < t.term_end
    left join unlimited_from u on u.drone_serial = f.drone_serial
    where (u.first_unlimited_on is null or u.first_unlimited_on > f.as_of)
      -- Solo meses con 6 meses de futuro ya observado.
      and f.as_of <= (current_date - interval '6 months')::date
)

select
    o.data_gb_12m >= 0.8 * q.storage_quota_gb               as near_storage_quota,
    count(*)                                                as drone_months,
    count(*) filter (
        where u.first_unlimited_on < (o.as_of + interval '6 months')::date) as upgraded_within_6m,
    round(count(*) filter (
        where u.first_unlimited_on < (o.as_of + interval '6 months')::date)::numeric
        / count(*), 3)                                      as upgrade_rate
from opportunities o
cross join pro_quota q
left join unlimited_from u on u.drone_serial = o.drone_serial
group by 1
