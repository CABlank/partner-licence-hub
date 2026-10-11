-- La cartera de cada dealer: el ARR de los clientes que entraron con su código
-- de invitación, si crece o se vacía, y lo que tiene en juego este trimestre.
-- Es la base para pagar al partner por renovaciones y ampliaciones (también las
-- que el cliente hace desde la app), y para ver qué partner cuida su base.
with latest as (
    select max(as_of) as as_of from {{ ref('int_customer_arr_monthly') }}
),

arr_now as (
    select
        a.dealer_id,
        count(*) filter (where a.arr_chf > 0)               as customers_with_arr,
        sum(a.arr_chf)                                      as arr_chf
    from {{ ref('int_customer_arr_monthly') }} a
    join latest l using (as_of)
    group by 1
),

retention as (
    -- Misma definición que mart_retention_12m, al nivel del dealer.
    select
        now_.dealer_id,
        sum(then_.arr_chf)                                  as starting_arr_chf,
        sum(now_.arr_chf)                                   as current_arr_chf,
        sum(least(now_.arr_chf, then_.arr_chf))             as retained_arr_chf
    from {{ ref('int_customer_arr_monthly') }} now_
    join latest l on l.as_of = now_.as_of
    join {{ ref('int_customer_arr_monthly') }} then_
      on then_.customer_id = now_.customer_id
     and then_.as_of = (now_.as_of - interval '12 months')::date
    where then_.arr_chf > 0
    group by 1
),

desk as (
    select
        dealer_id,
        sum(arr_chf)                                        as arr_expiring_90d_chf,
        coalesce(sum(arr_chf) filter (where risk_band = 'high'), 0) as arr_high_risk_90d_chf,
        count(*) filter (where upsell_to_unlimited)         as upsell_candidates
    from {{ ref('mart_renewal_desk') }}
    group by 1
)

select
    p.partner_id                                            as dealer_id,
    p.partner_name                                          as dealer_name,
    p.distributor_id,
    coalesce(a.customers_with_arr, 0)                       as customers_with_arr,
    coalesce(a.arr_chf, 0)                                  as arr_chf,
    round(r.current_arr_chf / nullif(r.starting_arr_chf, 0), 3)  as nrr_12m,
    round(r.retained_arr_chf / nullif(r.starting_arr_chf, 0), 3) as grr_12m,
    coalesce(d.arr_expiring_90d_chf, 0)                     as arr_expiring_90d_chf,
    coalesce(d.arr_high_risk_90d_chf, 0)                    as arr_high_risk_90d_chf,
    coalesce(d.upsell_candidates, 0)                        as upsell_candidates
from {{ ref('stg_partners') }} p
left join arr_now a on a.dealer_id = p.partner_id
left join retention r on r.dealer_id = p.partner_id
left join desk d on d.dealer_id = p.partner_id
where p.partner_kind = 'dealer'
