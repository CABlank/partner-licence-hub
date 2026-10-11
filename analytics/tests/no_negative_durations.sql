-- Una decisión antes de la solicitud indica relojes o datos rotos.
select 'transfer' as kind, transfer_request_id as id from {{ ref('fct_transfers') }}
where hours_to_decision < 0
union all
select 'renewal', null from {{ ref('int_licence_term_outcomes') }}
where approval_hours < 0
