-- Una tasa fuera de [0, 1] es un error de denominador.
select 'monthly' as source, renewal_rate as value from {{ ref('mart_renewal_rate_monthly') }}
where renewal_rate not between 0 and 1
union all
select 'scorecard', renewal_rate_12m from {{ ref('mart_distributor_scorecard') }}
where renewal_rate_12m not between 0 and 1
union all
select 'scorecard', share_without_support from {{ ref('mart_distributor_scorecard') }}
where share_without_support not between 0 and 1
union all
select 'retention_grr', grr from {{ ref('mart_retention_12m') }}
where grr not between 0 and 1
union all
select 'retention_nrr', nrr from {{ ref('mart_retention_12m') }}
where nrr < 0
