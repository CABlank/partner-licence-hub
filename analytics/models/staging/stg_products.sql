select
    code                                 as product,
    name                                 as product_name,
    anchor,
    renewal_mode,
    term_years,
    transferable
from {{ source('app', 'products') }}
