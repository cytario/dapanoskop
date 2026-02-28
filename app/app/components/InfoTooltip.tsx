import { Tooltip } from "@cytario/design";
import { Button } from "react-aria-components";

interface InfoTooltipProps {
  text: string;
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <Tooltip content={text} delay={0}>
      <Button
        aria-label={text}
        className="inline-flex items-center justify-center ml-1 w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-[10px] cursor-help outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        i
      </Button>
    </Tooltip>
  );
}
