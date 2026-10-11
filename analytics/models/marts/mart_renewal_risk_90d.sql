-- Lo que caduca en los próximos 90 días y si alguien está ya renovándolo.
-- "Sin solicitud y a menos de 30 días" es la lista de llamadas de esta semana.
-- Solo productos manuales: CARE se renueva sola y LIDAR sigue funcionando.
with licences as (
    select l.*, p.product_name
    from {{ ref('stg_licences') }} l
    join {{ ref('stg_products') }} p using (product)
    where not l.is_demo_unit
      and l.ended_at is null
      and p.renewal_mode = 'manual'
      and l.expires_on between current_date and current_date + 90
),

open_requests as (
    select distinct licence_code
    from {{ ref('stg_renewal_requests') }}
    where status in ('pending', 'approved')
)

select
    l.licence_code,
    l.product,
    l.product_name,
    l.dealer_id,
    p.distributor_id,
    l.expires_on,
    l.expires_on - current_date                             as days_left,
    case
        when l.expires_on <= current_date + 30 then '0-30'
        when l.expires_on <= current_date + 60 then '31-60'
        else '61-90'
    end                                                     as bucket,
    o.licence_code is not null                              as has_open_request,
    pr.illustrative_price_chf                               as value_chf
from licences l
join {{ ref('stg_partners') }} p on p.partner_id = l.dealer_id
join {{ ref('product_prices') }} pr on pr.product = l.product
left join open_requests o on o.licence_code = l.licence_code
