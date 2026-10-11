-- Los términos reconstruidos de una licencia van en orden y no se pisan: si
-- se pisaran, el ARR contaría dos veces el mismo año.
select licence_code, term_number
from (
    select
        *,
        lag(term_end) over (partition by licence_code order by term_number) as prev_end
    from {{ ref('int_licence_terms') }}
) t
where term_start >= term_end
   or term_start < prev_end
