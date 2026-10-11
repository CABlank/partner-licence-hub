{#
  La banda de riesgo de baja, en UN solo sitio. La usan el panel de
  renovaciones (hoy) y el backtest (el pasado): si la regla cambia, cambia en
  los dos, y el backtest dice si la nueva regla avisa mejor que la vieja.

  usage_index:    vuelos de los últimos 3 meses / los mismos 3 meses del año
                  anterior (o, sin un año de historia, / los 6 meses previos).
  external_share: parte de los procesados que se hicieron fuera del cloud.

  Umbrales elegidos ANTES de mirar el backtest, no ajustados a él.
#}
{% macro churn_risk_band(usage_index, external_share) -%}
    case
        when {{ usage_index }} is null                                   then 'unknown'
        when {{ usage_index }} < 0.5 or {{ external_share }} >= 0.5      then 'high'
        when {{ usage_index }} < 0.8 or {{ external_share }} >= 0.35     then 'medium'
        else 'low'
    end
{%- endmacro %}
