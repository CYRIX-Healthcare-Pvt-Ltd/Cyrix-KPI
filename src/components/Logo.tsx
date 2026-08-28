/**
 * The Cyrix Healthcare lockup, drawn once and shared by every module.
 *
 * Redrawn from the supplied artwork: heavy condensed caps, the X oversized
 * and red, the registered mark red at the top right, the entity line
 * letterspaced beneath, and the strapline in blue with its own red X.
 *
 * The black halves are `currentColor`, which is the whole reason this is
 * drawn rather than dropped in as an image: the artwork is black on white
 * and would vanish on a dark page. The red and the blue are brand colours
 * and stay put in both themes.
 *
 * This is a close redraw, not the original vector — the artwork's typeface
 * is not one we ship. Drop the real file at `public/cyrix-logo.svg` and
 * this component can become an <img>, but it will then need a light
 * variant for dark mode, which is what the redraw avoids.
 */
const RED = '#e30613'
const BLUE = '#1c3f94'

export function Logo({
  className = '',
  height = 34,
  variant = 'dark',
  showSubtitle = true,
  showTagline = false,
}: {
  className?: string
  /** Rendered height in px. The lockup scales from this. */
  height?: number
  /** `dark` = ink type for light backgrounds; `light` = white for black. */
  variant?: 'dark' | 'light'
  showSubtitle?: boolean
  showTagline?: boolean
}) {
  // Three stacked bands: wordmark, entity line, strapline. The viewBox
  // grows only as far as what is actually shown, so a wordmark on its own
  // is not padded by the space the other two would have taken.
  const box = showTagline ? 104 : showSubtitle ? 78 : 58

  return (
    <svg
      viewBox={`0 0 330 ${box}`}
      height={height}
      className={className}
      role="img"
      aria-label="Cyrix Health Care Pvt Ltd"
      style={{ color: variant === 'light' ? '#ffffff' : 'rgb(var(--ink-900))' }}
    >
      {/* The X is set larger than the rest and sits on the same baseline,
          which is what gives the mark its lift on the right. */}
      <text
        x="0" y="47"
        fontSize="56" fontWeight="800" letterSpacing="-0.5"
        fill="currentColor"
        fontFamily="inherit"
      >
        CYRI<tspan fill={RED} fontSize="66">X</tspan>
      </text>
      <text
        x="298" y="14"
        fontSize="14" fontWeight="700"
        fill={RED}
        fontFamily="inherit"
      >
        ®
      </text>

      {showSubtitle && (
        <text
          x="2" y="70"
          fontSize="13.5" fontWeight="600" letterSpacing="5.2"
          fill="currentColor"
          fontFamily="inherit"
        >
          HEALTH CARE PVT LTD
        </text>
      )}

      {showTagline && (
        <text
          x="2" y="96"
          fontSize="13" fontWeight="600"
          fill={BLUE}
          fontFamily="inherit"
        >
          The <tspan fill={RED}>X</tspan>-Factor in Medical Technology Reliability
        </text>
      )}
    </svg>
  )
}

/**
 * Square mark for the app icon: the X alone, one stroke black and one red,
 * as it reads in the wordmark.
 */
export function LogoMark({
  className = 'h-9 w-9',
  variant = 'dark',
}: {
  className?: string
  variant?: 'dark' | 'light'
}) {
  /*
   * Literal colours, not palette tokens, and deliberately so. The mark is a
   * printed brand asset: a black square carrying a white stroke and a red
   * one. Tokens would invert both together in dark mode and produce a white
   * X on a white square — an invisible logo.
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
        <path d="M19.5 4.5 L4.5 19.5" stroke={RED} strokeWidth="3.6" strokeLinecap="square" />
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
