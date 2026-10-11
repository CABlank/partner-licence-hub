select
    id                                   as transfer_request_id,
    drone_serial,
    from_tenant_id                       as from_partner_id,
    to_tenant_id                         as to_partner_id,
    status,
    created_at                           as requested_at,
    due_at,
    decided_at,
    decided_by
from {{ source('app', 'transfer_requests') }}
