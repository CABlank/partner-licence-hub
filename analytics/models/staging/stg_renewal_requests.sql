select
    id                                   as renewal_request_id,
    licence_code,
    dealer_id,
    distributor_id,
    customer_id,
    status,
    expires_on_at_request,
    created_at                           as requested_at,
    decided_at,
    odoo_order_ref
from {{ source('app', 'renewal_requests') }}
