/**
 * The Cyrix Healthcare lockup, drawn once and shared by every module.
 *
 * This is BEMMP's drawing, ported here verbatim: it is the one measured
 * against the printed artwork, and three apps each approximating it in
 * their own HTML is how the same company came to have three wordmarks that
 * are nearly but not quite alike. The coordinates are the lockup — CYRIX
 * at 52, the registered mark raised beside it, the entity line letterspaced
 * beneath — so they are not adjusted here.
 *
 * SVG text rather than an image: the dark half follows `currentColor` and
 * flips with the theme, and the red stays the brand red in both.
 */
export function Logo({
  className = '',
  height = 34,
  variant = 'dark',
  showSubtitle = true,
}: {
  className?: string
  /** Rendered height in px. The lockup scales from this. */
  height?: number
  /** `dark` = ink type for light backgrounds; `light` = white for black. */
  variant?: 'dark' | 'light'
  showSubtitle?: boolean
}) {
  // The full lockup is 78 units tall; the wordmark alone is 52.
  const box = showSubtitle ? 78 : 52
  const h = showSubtitle ? height : Math.round(height * 0.62)

  return (
    <svg
      viewBox={`0 0 300 ${box}`}
      height={h}
      className={className}
      role="img"
      aria-label="Cyrix Health Care Pvt Ltd"
      style={{ color: variant === 'light' ? '#ffffff' : 'rgb(var(--ink-900))' }}
    >
      <text
        x="0" y="44"
        fontSize="52" fontWeight="700" letterSpacing="1"
        fill="currentColor"
        fontFamily="inherit"
      >
        CYRI<tspan fill="#e30613">X</tspan>
      </text>
      <text
        x="171" y="16"
        fontSize="13" fontWeight="600"
        fill="#e30613"
        fontFamily="inherit"
      >
        ®
      </text>
      {showSubtitle && (
        <text
          x="1" y="66"
          fontSize="13.5" fontWeight="500" letterSpacing="3.4"
          fill="currentColor"
          fontFamily="inherit"
        >
          HEALTH CARE PVT LTD
        </text>
      )}
    </svg>
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
   * white X on a white square — an invisible logo, which is worse than a
   * dark square on a dark page.
   *
   * The exact pair it has always rendered: bg-white and bg-ink-950.
   */
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
