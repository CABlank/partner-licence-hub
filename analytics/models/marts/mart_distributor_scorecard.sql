-- Una fila por distribuidor: lo que Wingtra miraría en la revisión trimestral.
with outcomes_12m as (
    select *
    from {{ ref('int_licence_term_outcomes') }}
    where term_end >= current_date - 365 and term_end < current_date
),

renewals as (
    select
        distributor_id,
        round(
            count(*) filter (where outcome = 'renewed')::numeric
            / nullif(count(*) filter (where outcome <> 'in_progress'), 0), 3
        )                                                   as renewal_rate_12m,
        round(
            count(*) filter (where requested_late)::numeric
            / nullif(count(*) filter (where outcome = 'renewed'), 0), 3
        )                                                   as share_requested_late,
        round((percentile_cont(0.5) within group (order by approval_hours))::numeric, 1) as median_approval_hours
    from outcomes_12m
    group by 1
),

risk as (
    select
        distributor_id,
        count(*)                                            as expiring_90d,
        count(*) filter (where not has_open_request)        as expiring_90d_no_request,
        sum(value_chf) filter (where not has_open_request)  as value_at_risk_chf
    from {{ ref('mart_renewal_risk_90d') }}
    group by 1
),

-- Ingreso recurrente: el último mes de mart_retention_12m.
recurring as (
    select distributor_id, current_arr_chf, nrr, grr
    from {{ ref('mart_retention_12m') }}
    where month = (select max(month) from {{ ref('mart_retention_12m') }})
),

arr as (
    select distributor_id, sum(arr_chf) as arr_chf
    from {{ ref('int_customer_arr_monthly') }}
    where as_of = (select max(as_of) from {{ ref('int_customer_arr_monthly') }})
    group by 1
),

transfers as (
    select
        owner_distributor_id                                as distributor_id,
        count(*) filter (where decided_by_role <> 'pending') as transfers_decided,
        round(
            count(*) filter (where decided_by_role in ('current_partner', 'distributor'))::numeric
            / nullif(count(*) filter (where decided_by_role <> 'pending'), 0), 3
        )                                                   as share_without_support,
        round((percentile_cont(0.5) within group (order by hours_to_decision))::numeric, 1) as median_hours_to_decide
    from {{ ref('fct_transfers') }}
    group by 1
)

select
    p.partner_id                                            as distributor_id,
    p.partner_name                                          as distributor_name,
    coalesce(a.arr_chf, 0)                                  as arr_chf,
    rc.nrr                                                  as nrr_12m,
    rc.grr                                                  as grr_12m,
    r.renewal_rate_12m,
    r.share_requested_late,
    r.median_approval_hours,
    coalesce(k.expiring_90d, 0)                             as expiring_90d,
    coalesce(k.expiring_90d_no_request, 0)                  as expiring_90d_no_request,
    coalesce(k.value_at_risk_chf, 0)                        as value_at_risk_chf,
    coalesce(t.transfers_decided, 0)                        as transfers_decided,
    t.share_without_support,
    t.median_hours_to_decide
from {{ ref('stg_partners') }} p
left join renewals r on r.distributor_id = p.partner_id
left join risk k on k.distributor_id = p.partner_id
left join transfers t on t.distributor_id = p.partner_id
left join recurring rc on rc.distributor_id = p.partner_id
left join arr a on a.distributor_id = p.partner_id
where p.partner_kind = 'distributor'
