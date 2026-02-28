interface DeltaLogoProps {
  className?: string;
}

export function DeltaLogo({ className }: DeltaLogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Hardcoded hex: SVG attributes can't consume CSS custom properties */}
        <linearGradient id="delta-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5c2483" />
          {/* --color-purple-700 (brand primary) */}
          <stop offset="100%" stopColor="#35b7b8" />
          {/* --color-teal-500 (brand accent) */}
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="url(#delta-grad)" />
      <text
        x="12"
        y="18"
        textAnchor="middle"
        fill="white"
        fontSize="16"
        fontFamily="serif"
        fontWeight="bold"
      >
        &#x03B4;
      </text>
    </svg>
  );
}
