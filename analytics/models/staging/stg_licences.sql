select
    code                                 as licence_code,
    product,
    drone_serial,
    tenant_id                            as dealer_id,
    customer_id,
    starts_on,
    expires_on,
    ended_at,
    customer_id is null                  as is_demo_unit
from {{ source('app', 'licences') }}
