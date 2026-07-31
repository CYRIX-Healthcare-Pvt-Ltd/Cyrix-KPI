/**
 * Cyrix Healthcare wordmark, drawn rather than bitmapped so it stays
 * crisp at any size and inherits the page's dark/light context.
 *
 * The X is the brand's one red element — everything else is the ink black
 * of the printed logo, with the tagline in the logo's blue.
 */
export function Logo({
  className = '',
  showTagline = false,
}: {
  className?: string
  showTagline?: boolean
}) {
  return (
    <span className={`inline-flex flex-col leading-none ${className}`}>
      <span className="flex items-baseline font-bold tracking-tight text-ink-900">
        <span>CYRI</span>
        <span className="text-cyrixRed-600">X</span>
      </span>
      {showTagline && (
        <span className="mt-0.5 text-[0.5em] font-medium tracking-[0.18em] text-ink-500">
          HEALTH CARE PVT LTD
        </span>
      )}
    </span>
  )
}

/** Compact square mark for the header and the app icon. */
export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg bg-ink-900 ${className}`}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none">
        <path
          d="M4 4 L20 20"
          stroke="#ffffff"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        <path
          d="M20 4 L4 20"
          stroke="#d21f38"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}
