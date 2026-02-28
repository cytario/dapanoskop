import {
  Table,
  TableHeader,
  Column,
  TableBody,
  Row,
  Cell,
  Badge,
  DeltaIndicator,
} from "@cytario/design";
import type { UsageTypeCostRow } from "~/types/cost-data";
import { formatUsd } from "~/lib/format";
import { aggregateUsageTypes } from "~/lib/aggregate";

interface UsageTypeTableProps {
  rows: UsageTypeCostRow[];
  currentPeriod: string;
  prevPeriod: string;
  yoyPeriod: string;
}

function categoryBadgeVariant(category: string) {
  switch (category) {
    case "Compute":
      return "purple" as const;
    case "Storage":
      return "teal" as const;
    case "Support":
      return "slate" as const;
    default:
      return "neutral" as const;
  }
}

export function UsageTypeTable({
  rows,
  currentPeriod,
  prevPeriod,
  yoyPeriod,
}: UsageTypeTableProps) {
  const sorted = aggregateUsageTypes(
    rows,
    currentPeriod,
    prevPeriod,
    yoyPeriod,
  );

  return (
    <Table size="compact" aria-label="Usage type breakdown">
      <TableHeader>
        <Column isRowHeader>Usage Type</Column>
        <Column>Category</Column>
        <Column>Current</Column>
        <Column>vs Last Month</Column>
        <Column>vs Last Year</Column>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <Row key={row.usage_type}>
            <Cell>
              <span className="font-mono text-xs">{row.usage_type}</span>
            </Cell>
            <Cell>
              <Badge variant={categoryBadgeVariant(row.category)} size="sm">
                {row.category}
              </Badge>
            </Cell>
            <Cell>
              <span className="tabular-nums font-medium">
                {formatUsd(row.current)}
              </span>
            </Cell>
            <Cell>
              {row.prev > 0 ? (
                <DeltaIndicator current={row.current} previous={row.prev} />
              ) : (
                <DeltaIndicator current={0} previous={0} unavailable />
              )}
            </Cell>
            <Cell>
              {row.yoy > 0 ? (
                <DeltaIndicator current={row.current} previous={row.yoy} />
              ) : (
                <DeltaIndicator current={0} previous={0} unavailable />
              )}
            </Cell>
          </Row>
        ))}
      </TableBody>
    </Table>
  );
}
