-- El cliente queda atribuido al dealer cuyo código de invitación usó al crear
-- su cuenta en el cloud. Es la base para atribuir ARR y comisiones al partner.
select
    id                                   as customer_id,
    name                                 as customer_name,
    dealer_id
from {{ source('app', 'customers') }}
