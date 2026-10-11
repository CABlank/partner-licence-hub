-- Una fila por solicitud de transferencia: quién la decidió y cuánto tardó.
-- La pregunta: ¿cuántas resolvieron los partners sin pasar por soporte?
with transfers as (
    select * from {{ ref('stg_transfer_requests') }}
),

partners as (
    select * from {{ ref('stg_partners') }}
)

select
    t.transfer_request_id,
    t.drone_serial,
    t.from_partner_id,
    t.to_partner_id,
    owner.distributor_id                                    as owner_distributor_id,
    t.status,
    t.requested_at,
    t.decided_at,
    case
        when t.decided_by is null                           then 'pending'
        when t.decided_by = 'wingtra-support'               then 'support'
        when t.decided_by = t.from_partner_id               then 'current_partner'
        else 'distributor'
    end                                                     as decided_by_role,
    round((extract(epoch from t.decided_at - t.requested_at) / 3600.0)::numeric, 1) as hours_to_decision
from transfers t
join partners owner on owner.partner_id = t.from_partner_id
