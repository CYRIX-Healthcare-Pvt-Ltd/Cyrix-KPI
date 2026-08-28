/**
 * Cyrix Healthcare wordmark, drawn as type rather than a bitmap so it
 * stays sharp at any size and can invert onto black.
 *
 * Faithful to the printed logo: heavy condensed caps, the X in red, the
 * registered mark raised, and the letterspaced HEALTH CARE PVT LTD rule
 * beneath it.
 */
export function Logo({
  className = 'text-2xl',
  variant = 'dark',
  showSubtitle = true,
  showTagline = false,
}: {
  className?: string
  /** `dark` = black type for light backgrounds; `light` = white for black. */
  variant?: 'dark' | 'light'
  showSubtitle?: boolean
  showTagline?: boolean
}) {
  const base = variant === 'light' ? 'text-white' : 'text-ink-900'
  const sub = variant === 'light' ? 'text-white/70' : 'text-ink-700'

  return (
    <span className={`inline-flex flex-col leading-none ${className}`}>
      <span className={`flex items-start font-black tracking-[-0.02em] ${base}`}>
        <span>CYRI</span>
        <span className="text-cyrixRed-600">X</span>
        <span className="ml-[0.12em] mt-[0.1em] text-[0.32em] font-semibold">®</span>
      </span>

      {showSubtitle && (
        <span
          className={`mt-[0.28em] text-[0.29em] font-semibold tracking-[0.34em] ${sub}`}
        >
          HEALTH CARE PVT LTD
        </span>
      )}

      {showTagline && (
        <span className={`mt-[0.3em] text-[0.26em] font-medium ${sub}`}>
          The <span className="text-cyrixRed-600">X</span>-Factor in Medical
          Technology Reliability
        </span>
      )}
    </span>
  )
}

/**
 * Square mark for the header and app icon: the X alone, one stroke black
 * and one red, as it reads in the wordmark.
 */
export function LogoMark({
  className = 'h-9 w-9',
  variant = 'dark',
}: {
  className?: string
  variant?: 'dark' | 'light'
}) {
  /*
   * Literal colours, not palette tokens, and deliberately so.
   *
   * The mark is a printed brand asset: a black square carrying a white
   * stroke and a red one. Tokens would invert it in dark mode, and since
   * both the square and its stroke would flip together the result is a
   * white X on a white square — an invisible logo, which is a worse
   * outcome than a dark square sitting on a dark page.
   *
   * The `light` variant is the inverse mark for use on black, which is a
   * different asset rather than a different theme, so it is unaffected.
   */
  /* The exact pair the mark rendered before the palette moved into
     variables: bg-white and bg-ink-950. */
  const bg = variant === 'light' ? '#ffffff' : '#000000'
  const stroke = variant === 'light' ? '#141519' : '#ffffff'

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md ${className}`}
      style={{ backgroundColor: bg }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-[60%] w-[60%]" fill="none">
        <path d="M4.5 4.5 L19.5 19.5" stroke={stroke} strokeWidth="3.6" strokeLinecap="square" />
        <path d="M19.5 4.5 L4.5 19.5" stroke="#e30613" strokeWidth="3.6" strokeLinecap="square" />
      </svg>
    </span>
  )
}

/** Product lockup for the login hero — "CYRIX KPI." with the red accents. */
export function ProductMark({ className = 'text-6xl' }: { className?: string }) {
  return (
    <span className={`inline-flex items-start font-black tracking-[-0.03em] text-white ${className}`}>
      <span>CYRI</span>
      <span className="text-cyrixRed-600">X</span>
      <span className="ml-[0.14em] font-light text-white/85">KPI</span>
      <span className="text-cyrixRed-600">.</span>
    </span>
  )
}
