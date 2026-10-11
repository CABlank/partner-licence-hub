-- El puente tiene que cuadrar: inicio + entradas - salidas = final, y el final
-- de un mes es el inicio del siguiente. Si no cuadra, se está perdiendo o
-- inventando ARR en algún join.
with b as (
    select
        *,
        lead(starting_arr_chf) over (partition by distributor_id order by month) as next_starting
    from {{ ref('mart_arr_bridge_monthly') }}
)
select month, distributor_id
from b
where abs(starting_arr_chf + new_arr_chf + reactivated_arr_chf + expansion_arr_chf
          - contraction_arr_chf - churned_arr_chf - ending_arr_chf) > 0.01
   or abs(ending_arr_chf - coalesce(next_starting, ending_arr_chf)) > 0.01
