-- Una fila por TÉRMINO de licencia que ya terminó (o está terminando): ¿se
-- renovó a tiempo, tarde, o se perdió?
--
-- Renovados: cada solicitud 'ordered' cierra el término que caducaba en
--   expires_on_at_request (por eso la app guarda esa fecha al pedir).
-- Perdidos: licencias caducadas sin ninguna solicitud viva para ese término.
-- En curso: caducadas con la solicitud aún pendiente; no cuentan en la tasa.
--
-- Solo productos de renovación MANUAL. WingtraCARE se renueva sola y LIDAR es
-- perpetua: meterlas inflaría la tasa con renovaciones que nadie pidió.

with partners as (
    select * from {{ ref('stg_partners') }}
),

licences as (
    select l.*
    from {{ ref('stg_licences') }} l
    join {{ ref('stg_products') }} p using (product)
    where not l.is_demo_unit
      and l.ended_at is null
      and p.renewal_mode = 'manual'
),

requests as (
    select * from {{ ref('stg_renewal_requests') }}
),

renewed as (
    select
        r.licence_code,
        r.dealer_id,
        r.distributor_id,
        r.expires_on_at_request                                    as term_end,
        'renewed'                                                  as outcome,
        r.expires_on_at_request - r.requested_at::date             as lead_days,
        extract(epoch from r.decided_at - r.requested_at) / 3600.0 as approval_hours
    from requests r
    where r.status = 'ordered'
),

open_requests as (
    select licence_code, expires_on_at_request
    from requests
    where status in ('pending', 'approved')
),

ended_without_renewal as (
    select
        l.licence_code,
        l.dealer_id,
        p.distributor_id,
        l.expires_on                                               as term_end,
        case when o.licence_code is null then 'lapsed' else 'in_progress' end as outcome,
        null::int                                                  as lead_days,
        null::numeric                                              as approval_hours
    from licences l
    join partners p on p.partner_id = l.dealer_id
    left join open_requests o
        on o.licence_code = l.licence_code
       and o.expires_on_at_request = l.expires_on
    where l.expires_on < current_date
)

select
    t.*,
    l.product,
    t.lead_days < 0                                                as requested_late
from (
    select * from renewed
    union all
    select * from ended_without_renewal
) t
join {{ ref('stg_licences') }} l using (licence_code)
