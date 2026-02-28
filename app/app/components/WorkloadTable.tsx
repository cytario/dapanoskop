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
              </Cell>
              <Cell>
                <DeltaIndicator
                  current={wl.current_cost_usd}
                  previous={momPrevious}
                />
              </Cell>
              <Cell>
                {isMtd ? (
                  <DeltaIndicator
                    current={0}
                    previous={0}
                    unavailable
                    unavailableText="N/A (MTD)"
                  />
                ) : wl.yoy_cost_usd > 0 ? (
                  <DeltaIndicator
                    current={wl.current_cost_usd}
                    previous={wl.yoy_cost_usd}
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
