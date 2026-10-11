-- El puente de ARR: de dónde viene y a dónde va el ingreso recurrente cada mes.
--   inicio + nuevo + reactivado + ampliación - reducción - bajas = final
-- Es la vista que un CFO pide antes que ninguna: el ARR total sube aunque la
-- base se esté vaciando, si las ventas nuevas tapan las bajas. Aquí se ve.
-- (tests/arr_bridge_reconciles.sql comprueba que la suma cuadra.)
with arr as (
    select
        *,
        lag(arr_chf) over (partition by customer_id order by as_of) as prev_arr_chf,
        max(arr_chf) over (
            partition by customer_id order by as_of
            rows between unbounded preceding and 1 preceding
        )                                                   as max_arr_before
    from {{ ref('int_customer_arr_monthly') }}
)

select
    as_of                                                   as month,
    distributor_id,
    sum(prev_arr_chf)                                       as starting_arr_chf,
    coalesce(sum(arr_chf) filter (
        where prev_arr_chf = 0 and arr_chf > 0 and max_arr_before = 0), 0)  as new_arr_chf,
    coalesce(sum(arr_chf) filter (
        where prev_arr_chf = 0 and arr_chf > 0 and max_arr_before > 0), 0)  as reactivated_arr_chf,
    coalesce(sum(arr_chf - prev_arr_chf) filter (
        where prev_arr_chf > 0 and arr_chf > prev_arr_chf), 0)             as expansion_arr_chf,
    coalesce(sum(prev_arr_chf - arr_chf) filter (
        where arr_chf > 0 and arr_chf < prev_arr_chf), 0)                   as contraction_arr_chf,
    coalesce(sum(prev_arr_chf) filter (
        where prev_arr_chf > 0 and arr_chf = 0), 0)                         as churned_arr_chf,
    sum(arr_chf)                                            as ending_arr_chf
from arr
where prev_arr_chf is not null  -- el primer mes no tiene "antes"
group by 1, 2
