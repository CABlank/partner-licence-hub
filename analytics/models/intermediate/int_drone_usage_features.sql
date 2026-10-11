-- Las señales de uso de cada dron, tal como se conocían el día 1 de cada mes
-- (as_of). Solo usa meses cerrados ANTES de as_of: el backtest no puede mirar
-- el futuro.
--
-- La señal principal es la de tu motor de Malco: ritmo contra el año pasado.
-- Vuelos de los últimos 3 meses contra los mismos 3 meses del año anterior,
-- así el invierno no parece una baja. Sin un año de historia, contra los 6
-- meses previos (peor: confunde estacionalidad con abandono).
with usage as (
    select * from {{ ref('stg_drone_usage_monthly') }}
),

windows as (
    select
        drone_serial,
        (month + interval '1 month')::date                  as as_of,
        count(*)            over w_all                      as months_of_history,
        avg(flights)        over w_3m                       as flights_avg_3m,
        avg(flights)        over w_3m_ly                    as flights_avg_3m_last_year,
        avg(flights)        over w_prior_6m                 as flights_avg_prior_6m,
        sum(external_jobs)  over w_3m                       as external_jobs_3m,
        sum(cloud_jobs + external_jobs) over w_3m           as jobs_3m,
        sum(data_gb)        over w_12m                      as data_gb_12m
    from usage
    window
        w_all      as (partition by drone_serial order by month rows between unbounded preceding and current row),
        w_3m       as (partition by drone_serial order by month rows between 2 preceding and current row),
        w_3m_ly    as (partition by drone_serial order by month rows between 14 preceding and 12 preceding),
        w_prior_6m as (partition by drone_serial order by month rows between 8 preceding and 3 preceding),
        w_12m      as (partition by drone_serial order by month rows between 11 preceding and current row)
)

select
    drone_serial,
    as_of,
    months_of_history,
    round(flights_avg_3m, 1)                                as flights_avg_3m,
    case
        when months_of_history >= 15
            then round(flights_avg_3m / nullif(flights_avg_3m_last_year, 0), 2)
        when months_of_history >= 9
            then round(flights_avg_3m / nullif(flights_avg_prior_6m, 0), 2)
    end                                                     as usage_index,
    case
        when months_of_history >= 15 then 'vs_last_year'
        when months_of_history >= 9  then 'vs_prior_6m'
    end                                                     as usage_index_basis,
    round(external_jobs_3m::numeric / nullif(jobs_3m, 0), 2) as external_share_3m,
    round(data_gb_12m, 1)                                   as data_gb_12m
from windows
