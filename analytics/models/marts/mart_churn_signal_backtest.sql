-- ¿La banda de riesgo avisa de verdad, o solo lo parece?
-- Para cada término de PRO o UNLIMITED ya resuelto (renovado o perdido) se
-- calcula la banda con los datos que había 60 días antes de caducar, que es
-- cuando el dealer todavía puede hacer algo, y se compara con lo que pasó.
-- Si 'high' no pierde bastante más que 'low', la banda no sirve y no se usa.
--
-- Ojo: con datos SIMULADOS esto prueba que la tubería funciona, no que los
-- clientes reales se comporten así. Con datos reales, es lo primero que se mira.
with outcomes as (
    select
        o.licence_code,
        o.term_end,
        o.outcome,
        t.plan,
        t.drone_serial
    from {{ ref('int_licence_term_outcomes') }} o
    join {{ ref('int_licence_terms') }} t
      on t.licence_code = o.licence_code
     and t.term_end = o.term_end
    where o.outcome in ('renewed', 'lapsed')
),

scored as (
    select
        o.*,
        {{ churn_risk_band('f.usage_index', 'f.external_share_3m') }} as risk_band
    from outcomes o
    left join {{ ref('int_drone_usage_features') }} f
      on f.drone_serial = o.drone_serial
     and f.as_of = date_trunc('month', o.term_end - 60)::date
)

select
    plan,
    risk_band,
    count(*)                                                as terms,
    count(*) filter (where outcome = 'lapsed')              as lapsed,
    round(count(*) filter (where outcome = 'lapsed')::numeric / count(*), 3) as lapse_rate
from scored
group by 1, 2
