export interface Totals {
  current_cost_usd: number;
  prev_month_cost_usd: number;
  yoy_cost_usd: number;
  mtd_prior_partial_cost_usd?: number;
}

/** Matches SDS-DP-040002 summary.json schema */
export interface CostSummary {
  collected_at: string;
  period: string;
  periods: {
    current: string;
    prev_month: string;
    yoy: string;
  };
  is_mtd?: boolean;
  mtd_comparison?: MtdComparison;
  totals: Totals;
  storage_config: {
    include_efs: boolean;
    include_ebs: boolean;
  };
  storage_metrics: StorageMetrics;
  storage_lens?: StorageLens;
  cost_centers: CostCenter[];
  tagging_coverage: TaggingCoverage;
}

export interface MtdComparison {
  prior_partial_start: string;
  prior_partial_end_exclusive: string;
  cost_centers: MtdCostCenter[];
}

export interface MtdCostCenter {
  name: string;
  prior_partial_cost_usd: number;
  workloads: MtdWorkload[];
  is_split_charge?: boolean;
}

export interface MtdWorkload {
  name: string;
  prior_partial_cost_usd: number;
}

export interface StorageLens {
  total_bytes: number;
  object_count: number;
  storage_lens_date: string;
  config_id: string;
}

export interface StorageMetrics {
  total_cost_usd: number;
  prev_month_cost_usd: number;
  total_volume_bytes: number;
  hot_tier_percentage: number;
  cost_per_tb_usd: number;
  storage_lens_total_bytes?: number;
}

export interface CostCenter {
  name: string;
  current_cost_usd: number;
  prev_month_cost_usd: number;
  yoy_cost_usd?: number;
  workloads: Workload[];
  is_split_charge?: boolean;
}

export interface Workload {
  name: string;
  current_cost_usd: number;
  prev_month_cost_usd: number;
  yoy_cost_usd?: number;
}

export interface TaggingCoverage {
  tagged_cost_usd: number;
  untagged_cost_usd: number;
  tagged_percentage: number;
}

/** Matches SDS-DP-040003 cost-by-workload.parquet columns */
export interface WorkloadCostRow {
  cost_center: string;
  workload: string;
  period: string;
  cost_usd: number;
}

/** Matches SDS-DP-040003 cost-by-usage-type.parquet columns */
export interface UsageTypeCostRow {
  workload: string;
  usage_type: string;
  category: "Storage" | "Compute" | "Other" | "Support";
  period: string;
  cost_usd: number;
  usage_quantity: number;
}
