-- Grano del mart: una fila por mes y distribuidor. Devuelve filas = falla.
select month, distributor_id, count(*) as n
from {{ ref('mart_renewal_rate_monthly') }}
group by 1, 2
having count(*) > 1
