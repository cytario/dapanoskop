import { Link } from "react-router";
import {
  Table,
  TableHeader,
  Column,
  TableBody,
  Row,
  Cell,
  DeltaIndicator,
} from "@cytario/design";
import type { Workload, MtdCostCenter } from "~/types/cost-data";
import { formatUsd } from "~/lib/format";
import { deltaPair, grossDiffersFromNet } from "~/lib/gross";

interface WorkloadTableProps {
  workloads: Workload[];
  period: string;
  isMtd?: boolean;
  mtdCostCenter?: MtdCostCenter;
}

export function WorkloadTable({
  workloads,
  period,
  isMtd,
  mtdCostCenter,
}: WorkloadTableProps) {
  return (
    <Table size="compact" aria-label="Workload breakdown">
      <TableHeader>
        <Column isRowHeader>Workload</Column>
        <Column>Current</Column>
        <Column>{isMtd ? "vs Prior Partial" : "vs Last Month"}</Column>
        <Column>vs Last Year</Column>
      </TableHeader>
      <TableBody>
        {workloads.map((wl) => {
          // Use MTD prior partial cost if available
          const mtdWl = mtdCostCenter?.workloads.find(
            (mw) => mw.name === wl.name,
          );
          const momPrevious =
            mtdWl !== undefined
              ? mtdWl.prior_partial_cost_usd
              : wl.prev_month_cost_usd;

          const isUntagged = wl.name === "Untagged";

          const mom = deltaPair(
            wl.gross_current_cost_usd,
            wl.current_cost_usd,
            mtdWl !== undefined
              ? mtdWl.gross_prior_partial_cost_usd
              : wl.gross_prev_month_cost_usd,
            momPrevious,
          );
          const yoy =
            wl.yoy_cost_usd != null
              ? deltaPair(
                  wl.gross_current_cost_usd,
                  wl.current_cost_usd,
                  wl.gross_yoy_cost_usd,
                  wl.yoy_cost_usd,
                )
              : null;

          return (
            <Row key={wl.name}>
              <Cell>
                {isUntagged ? (
                  <span className="font-medium text-red-700">{wl.name}</span>
                ) : (
                  <Link
                    to={`/workload/${encodeURIComponent(wl.name)}?period=${period}`}
                    className="text-primary-600 hover:underline"
                  >
                    {wl.name}
                  </Link>
                )}
              </Cell>
              <Cell>
                <span className="tabular-nums font-medium">
                  {formatUsd(wl.current_cost_usd)}
                </span>
                {grossDiffersFromNet(
                  wl.gross_current_cost_usd ?? wl.current_cost_usd,
                  wl.gross_current_cost_usd != null
                    ? wl.current_cost_usd
                    : null,
                ) && (
                  <span className="block text-xs text-gray-400">
                    Gross: {formatUsd(wl.gross_current_cost_usd!)}
                  </span>
                )}
              </Cell>
              <Cell>
                <DeltaIndicator current={mom.current} previous={mom.previous} />
              </Cell>
              <Cell>
                {isMtd ? (
                  <DeltaIndicator
                    current={0}
                    previous={0}
                    unavailable
                    unavailableText="N/A (MTD)"
                  />
                ) : yoy != null ? (
                  <DeltaIndicator
                    current={yoy.current}
                    previous={yoy.previous}
                  />
                ) : (
                  <DeltaIndicator current={0} previous={0} unavailable />
                )}
              </Cell>
            </Row>
          );
        })}
      </TableBody>
    </Table>
  );
}
