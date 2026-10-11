import { Pool } from 'pg';
import { z } from 'zod';
import { databaseUrl } from './env';
import './db'; // registra el parser de DATE como texto antes de la primera consulta

// Lectura de los marts de dbt (analytics/). Otra base (licence_hub_sim, datos
// SIMULADOS) y otro usuario (hub_analytics): la app nunca mezcla la demo con
// el almacén de análisis.

const globalForPool = globalThis as unknown as { analyticsPool?: Pool };
export const analyticsPool =
  globalForPool.analyticsPool ??
  new Pool({ connectionString: databaseUrl('ANALYTICS_DATABASE_URL') });
globalForPool.analyticsPool = analyticsPool;

// Postgres devuelve numeric y bigint (count) como TEXTO, para no perder
// precisión. Un cast `as number` mentiría: aquí zod lo convierte y comprueba.
const Num = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);
const NumOrNull = Num.nullable();

export const ScorecardRow = z.object({
  distributor_id: z.string(),
  distributor_name: z.string(),
  arr_chf: Num,
  nrr_12m: NumOrNull,
  grr_12m: NumOrNull,
  renewal_rate_12m: NumOrNull,
  share_requested_late: NumOrNull,
  median_approval_hours: NumOrNull,
  expiring_90d: Num,
  expiring_90d_no_request: Num,
  value_at_risk_chf: Num,
  transfers_decided: Num,
  share_without_support: NumOrNull,
  median_hours_to_decide: NumOrNull,
});
export type ScorecardRow = z.infer<typeof ScorecardRow>;

export const MonthlyRateRow = z.object({
  month: z.string(),
  distributor_id: z.string(),
  terms_ended: Num,
  renewed: Num,
  renewal_rate: NumOrNull,
});
export type MonthlyRateRow = z.infer<typeof MonthlyRateRow>;

export const RiskRow = z.object({
  distributor_id: z.string(),
  bucket: z.enum(['0-30', '31-60', '61-90']),
  with_request: Num,
  without_request: Num,
});
export type RiskRow = z.infer<typeof RiskRow>;

export const TransferRoleRow = z.object({
  decided_by_role: z.enum(['pending', 'support', 'current_partner', 'distributor']),
  transfers: Num,
  median_hours: NumOrNull,
});
export type TransferRoleRow = z.infer<typeof TransferRoleRow>;

export const CallListRow = z.object({
  licence_code: z.string(),
  product: z.string(),
  product_name: z.string(),
  dealer_id: z.string(),
  distributor_id: z.string(),
  expires_on: z.string(),
  days_left: Num,
  value_chf: Num,
});
export type CallListRow = z.infer<typeof CallListRow>;

// Ingreso recurrente (software): puente de ARR, retención, cartera por dealer,
// el motor de renovaciones y los backtests que dicen si sus señales sirven.
export const BridgeRow = z.object({
  month: z.string(),
  starting_arr_chf: Num,
  new_arr_chf: Num,
  reactivated_arr_chf: Num,
  expansion_arr_chf: Num,
  contraction_arr_chf: Num,
  churned_arr_chf: Num,
  ending_arr_chf: Num,
});
export type BridgeRow = z.infer<typeof BridgeRow>;

export const RetentionRow = z.object({
  month: z.string(),
  starting_arr_chf: Num,
  current_arr_chf: Num,
  retained_arr_chf: Num,
});
export type RetentionRow = z.infer<typeof RetentionRow>;

export const DealerBookRow = z.object({
  dealer_id: z.string(),
  dealer_name: z.string(),
  distributor_id: z.string(),
  customers_with_arr: Num,
  arr_chf: Num,
  nrr_12m: NumOrNull,
  grr_12m: NumOrNull,
  arr_expiring_90d_chf: Num,
  arr_high_risk_90d_chf: Num,
  upsell_candidates: Num,
});
export type DealerBookRow = z.infer<typeof DealerBookRow>;

export const RiskBand = z.enum(['low', 'medium', 'high', 'unknown']);
export type RiskBand = z.infer<typeof RiskBand>;

export const DeskRow = z.object({
  licence_code: z.string(),
  plan: z.enum(['PRO', 'UNLIMITED']),
  dealer_id: z.string(),
  days_left: Num,
  usage_index: NumOrNull,
  external_share_3m: NumOrNull,
  storage_used_share: NumOrNull,
  risk_band: RiskBand,
  list_price_chf: Num,
  recommended_price_chf: Num,
  upsell_to_unlimited: z.boolean().nullable(),
  next_action: z.string(),
});
export type DeskRow = z.infer<typeof DeskRow>;

export const ChurnBacktestRow = z.object({
  plan: z.enum(['PRO', 'UNLIMITED']),
  risk_band: RiskBand,
  terms: Num,
  lapsed: Num,
  lapse_rate: Num,
});
export type ChurnBacktestRow = z.infer<typeof ChurnBacktestRow>;

export const UpsellBacktestRow = z.object({
  near_storage_quota: z.boolean().nullable(),
  drone_months: Num,
  upgraded_within_6m: Num,
  upgrade_rate: Num,
});
export type UpsellBacktestRow = z.infer<typeof UpsellBacktestRow>;

export type Recurring = {
  bridge: BridgeRow[];
  retention: RetentionRow | null;
  dealers: DealerBookRow[];
  desk: DeskRow[];
  churnBacktest: ChurnBacktestRow[];
  upsellBacktest: UpsellBacktestRow[];
};

async function rows<S extends z.ZodType>(schema: S, sql: string): Promise<z.infer<S>[]> {
  const result = await analyticsPool.query<Record<string, unknown>>(sql);
  return z.array(schema).parse(result.rows);
}

export type Insights = {
  scorecard: ScorecardRow[];
  monthly: MonthlyRateRow[];
  risk: RiskRow[];
  transfers: TransferRoleRow[];
  callList: CallListRow[];
  recurring: Recurring;
};

export async function getInsights(): Promise<Insights> {
  const [scorecard, monthly, risk, transfers, callList, bridge, retention, dealers, desk, churnBacktest, upsellBacktest] = await Promise.all([
    rows(ScorecardRow, 'SELECT * FROM analytics_marts.mart_distributor_scorecard ORDER BY distributor_id'),
    rows(
      MonthlyRateRow,
      `SELECT month::text, distributor_id, terms_ended, renewed, renewal_rate
         FROM analytics_marts.mart_renewal_rate_monthly
        WHERE month >= date_trunc('month', current_date) - interval '12 months'
        ORDER BY month, distributor_id`,
    ),
    rows(
      RiskRow,
      `SELECT distributor_id, bucket,
              count(*) FILTER (WHERE has_open_request)     AS with_request,
              count(*) FILTER (WHERE NOT has_open_request) AS without_request
         FROM analytics_marts.mart_renewal_risk_90d
        GROUP BY 1, 2 ORDER BY 1, 2`,
    ),
    rows(
      TransferRoleRow,
      `SELECT decided_by_role, count(*) AS transfers,
              round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours_to_decision))::numeric, 1) AS median_hours
         FROM analytics_marts.fct_transfers
        GROUP BY 1`,
    ),
    rows(
      CallListRow,
      `SELECT licence_code, product, product_name, dealer_id, distributor_id, expires_on::text, days_left, value_chf
         FROM analytics_marts.mart_renewal_risk_90d
        WHERE NOT has_open_request AND bucket = '0-30'
        ORDER BY days_left, value_chf DESC`,
    ),
    // La red entera: se suman los importes por distribuidor; nunca se promedian ratios.
    rows(
      BridgeRow,
      `SELECT month::text,
              sum(starting_arr_chf) AS starting_arr_chf, sum(new_arr_chf) AS new_arr_chf,
              sum(reactivated_arr_chf) AS reactivated_arr_chf, sum(expansion_arr_chf) AS expansion_arr_chf,
              sum(contraction_arr_chf) AS contraction_arr_chf, sum(churned_arr_chf) AS churned_arr_chf,
              sum(ending_arr_chf) AS ending_arr_chf
         FROM analytics_marts.mart_arr_bridge_monthly
        WHERE month > date_trunc('month', current_date) - interval '12 months'
        GROUP BY 1 ORDER BY 1`,
    ),
    rows(
      RetentionRow,
      `SELECT month::text, sum(starting_arr_chf) AS starting_arr_chf,
              sum(current_arr_chf) AS current_arr_chf, sum(retained_arr_chf) AS retained_arr_chf
         FROM analytics_marts.mart_retention_12m
        WHERE month = (SELECT max(month) FROM analytics_marts.mart_retention_12m)
        GROUP BY 1`,
    ),
    rows(DealerBookRow, 'SELECT * FROM analytics_marts.mart_dealer_book ORDER BY distributor_id, arr_chf DESC'),
    // Primero lo que necesita una persona: riesgo alto, luego ampliaciones, luego por fecha.
    rows(
      DeskRow,
      `SELECT licence_code, plan, dealer_id, days_left, usage_index, external_share_3m, storage_used_share,
              risk_band, list_price_chf, recommended_price_chf, upsell_to_unlimited, next_action
         FROM analytics_marts.mart_renewal_desk
        WHERE NOT has_open_request
        ORDER BY CASE risk_band WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                 upsell_to_unlimited DESC NULLS LAST, days_left
        LIMIT 12`,
    ),
    rows(ChurnBacktestRow, 'SELECT * FROM analytics_marts.mart_churn_signal_backtest ORDER BY plan, risk_band'),
    rows(UpsellBacktestRow, 'SELECT * FROM analytics_marts.mart_upsell_signal_backtest ORDER BY near_storage_quota DESC'),
  ]);
  return {
    scorecard,
    monthly,
    risk,
    transfers,
    callList,
    recurring: { bridge, retention: retention[0] ?? null, dealers, desk, churnBacktest, upsellBacktest },
  };
}
