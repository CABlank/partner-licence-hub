-- NRR y GRR a 12 meses, por distribuidor y mes.
-- Cohorte: los clientes que tenían ARR hace 12 meses. Los clientes nuevos desde
-- entonces NO cuentan: la pregunta es si la base instalada crece sola.
--   NRR = ARR de hoy de esa cohorte / su ARR de entonces (puede pasar de 100 %)
--   GRR = lo mismo, pero sin dejar que nadie cuente más de lo que tenía
--         (solo pérdidas: nunca pasa de 100 %)
-- Se guardan las sumas, no solo los ratios, para poder agregar la red entera
-- sin promediar porcentajes.
with arr as (
    select * from {{ ref('int_customer_arr_monthly') }}
),

pairs as (
    select
        now_.as_of,
        now_.distributor_id,
        then_.arr_chf                                       as arr_12m_ago_chf,
        now_.arr_chf                                        as arr_now_chf
    from arr now_
    join arr then_
      on then_.customer_id = now_.customer_id
     and then_.as_of = (now_.as_of - interval '12 months')::date
    where then_.arr_chf > 0
)

select
    as_of                                                   as month,
    distributor_id,
    count(*)                                                as cohort_customers,
    sum(arr_12m_ago_chf)                                    as starting_arr_chf,
    sum(arr_now_chf)                                        as current_arr_chf,
    sum(least(arr_now_chf, arr_12m_ago_chf))                as retained_arr_chf,
    round(sum(arr_now_chf) / sum(arr_12m_ago_chf), 3)       as nrr,
    round(sum(least(arr_now_chf, arr_12m_ago_chf)) / sum(arr_12m_ago_chf), 3) as grr
from pairs
group by 1, 2
