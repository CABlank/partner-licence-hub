-- Un partner por fila, con su distribuidor ya resuelto (un distribuidor es su
-- propio distribuidor), para no repetir ese CASE en cada modelo.
select
    id                                   as partner_id,
    name                                 as partner_name,
    kind                                 as partner_kind,
    coalesce(parent_id, id)              as distributor_id
from {{ source('app', 'tenants') }}
