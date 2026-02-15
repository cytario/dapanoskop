interface InfoTooltipProps {
  text: string;
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <span className="relative inline-flex items-center ml-1 group" tabIndex={0}>
      <span
        className="w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-[10px] flex items-center justify-center cursor-help"
        aria-label={text}
      >
        i
      </span>
      <span
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block group-focus:block bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-normal w-48 text-center z-10 shadow-lg"
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
}
