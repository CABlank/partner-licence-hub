-- ¿Qué parte de las licencias que caducaron cada mes se renovó?
-- La métrica principal del portal: si sube, el portal funciona.
select
    date_trunc('month', term_end)::date                    as month,
    distributor_id,
    count(*) filter (where outcome <> 'in_progress')       as terms_ended,
    count(*) filter (where outcome = 'renewed')            as renewed,
    count(*) filter (where outcome = 'lapsed')             as lapsed,
    count(*) filter (where requested_late)                 as renewed_late,
    round(
        count(*) filter (where outcome = 'renewed')::numeric
        / nullif(count(*) filter (where outcome <> 'in_progress'), 0), 3
    )                                                      as renewal_rate
from {{ ref('int_licence_term_outcomes') }}
where term_end < date_trunc('month', current_date)  -- solo meses cerrados
group by 1, 2
