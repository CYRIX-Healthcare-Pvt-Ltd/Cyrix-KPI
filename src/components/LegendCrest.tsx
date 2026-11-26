/*
  Team rank 1 in the KPI month now being assessed, on the Dashboard's own header (the user, 10 Nov: "we dont need
  sepearte div for this"; team only, never Cyrix).

  Gold type on the header's own green (the user, 10 Nov: "show rank 1 below band, ie excellent, then we can remove
  LOGO ... golden font in green will looks awesome"): the year average and its chip in gold, and under the chip
  "Rank 1 · Oct-26" in metallic gold with the team beneath. The background keeps its band colour all the way across;
  only a faint sheen passes now and then, with a soft gold line along the foot.

  The first time in a session the rank line arrives: it opens out from tight letters with a flash of light and a few
  sparks. Transform and opacity only; with "reduce motion" it is gold and still.

  The gold is in GOLD, so the user's own theme replaces it in one place.
*/
export const GOLD = {
  light: '#fff1b8',
  bright: '#ffcf40',
  base: '#e6a817',
  deep: '#8f5d06',
  ink: '#3d2600',
}

const SEEN = 'cyrix.kpi.legend.seen'

/**
 * Plays the arrival the first time this month's rank 1 is seen in a session. Decided once per page load and kept
 * here, so a render before the team answer lands, or React rendering twice, cannot spend it or replay it.
 */
const decided = new Map<string, number>() // when it was decided to play; 0 for not
export function useLegendArrival(month: string | null) {
  if (!month) return false
  if (!decided.has(month)) {
    let play = true
    try {
      if (sessionStorage.getItem(SEEN) === month) play = false
      else sessionStorage.setItem(SEEN, month)
    } catch { /* storage refused: it plays again, which is harmless */ }
    decided.set(month, play ? Date.now() : 0)
  }
  // A visit back to the Dashboard later in the same load shows it gold and still.
  return Date.now() - decided.get(month)! < 8000
}

/** "Rank 1 · Oct-26" and the team, under the band chip. */
export function LegendLine({ month, of, team, play }: { month: string; of: number; team: string; play: boolean }) {
  return (
    <div className={`lc ${play ? 'lc-play' : ''} relative mt-3`} role="img" aria-label={`Rank 1 of ${of} in ${team} for ${month}`}>
      {play && [[-40, -14], [-10, -20], [30, -16], [60, -8], [-60, 6], [80, 10]].map(([x, y], i) => (
        <span key={i} aria-hidden className="lc-spark pointer-events-none absolute left-1/2 top-1/2 h-1 w-1 rounded-full sm:left-auto sm:right-16"
          style={{ ['--x' as string]: `${x}px`, ['--y' as string]: `${y}px`, animationDelay: `${700 + i * 120}ms` }} />
      ))}
      <p className="lc-words lc-metal whitespace-nowrap text-lg font-extrabold uppercase leading-tight tracking-[.12em] sm:text-xl">
        Rank 1 · {month}
      </p>
      <p className="lc-words lc-sub whitespace-nowrap text-[10px] font-semibold uppercase tracking-[.18em]">
        {team} · of {of}
      </p>

      <style>{`
        .lc-metal{background:linear-gradient(100deg,${GOLD.deep} 0%,${GOLD.bright} 20%,#fff 34%,${GOLD.bright} 46%,${GOLD.base} 60%,${GOLD.light} 76%,${GOLD.deep} 100%);background-size:240% 100%;
          -webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 1px 1px rgba(0,0,0,.7));animation:lc-shine 6s linear infinite}
        .lc-sub{color:${GOLD.bright};opacity:.85;animation-delay:.2s}
        @keyframes lc-shine{from{background-position:130% 0}to{background-position:-110% 0}}
        .lc-spark{background:#fff;box-shadow:0 0 4px 1px ${GOLD.bright};opacity:0;animation:lc-spark 1.3s ease-out both}
        @keyframes lc-spark{0%{opacity:0;transform:translate(0,0)}25%{opacity:1}100%{opacity:0;transform:translate(var(--x),var(--y)) scale(.4)}}
        .lc-play .lc-words{animation:lc-word .9s cubic-bezier(.2,.8,.2,1) .5s both}
        .lc-play .lc-words.lc-metal{animation:lc-word .9s cubic-bezier(.2,.8,.2,1) .5s both,lc-flash 1.2s ease-out .9s both,lc-shine 6s linear 2.1s infinite}
        .lc-play .lc-sub{animation:lc-word .9s cubic-bezier(.2,.8,.2,1) .8s both}
        @keyframes lc-word{from{opacity:0;letter-spacing:.5em;transform:translateY(4px)}to{opacity:1}}
        @keyframes lc-flash{0%{background-position:130% 0}100%{background-position:-110% 0}}
        /* The header: its own colour all the way across, a faint sheen passing, and a soft gold line along the foot. */
        .lc-flow{position:absolute;inset:0;overflow:hidden;pointer-events:none}
        .lc-flow::after{content:'';position:absolute;inset:-60% -100%;mix-blend-mode:screen;
          background:linear-gradient(100deg,transparent 42%,${GOLD.light}12 48%,#ffffff10 50%,${GOLD.light}12 52%,transparent 58%);
          animation:lc-silk 10s ease-in-out 1.5s infinite}
        @keyframes lc-silk{0%{transform:translateX(-35%)}60%,100%{transform:translateX(35%)}}
        .lc-floor{position:absolute;left:30%;right:-5%;bottom:-20px;height:44px;mix-blend-mode:screen;
          background:radial-gradient(50% 50% at 50% 50%,${GOLD.bright}26,transparent 70%)}
        .lc-floor::after{content:'';position:absolute;left:22%;right:6%;top:50%;height:1px;background:linear-gradient(90deg,transparent,${GOLD.light}80 70%,transparent)}
        .lc-hero-play .lc-floor{animation:lc-fade 1.4s ease-out .3s both}
        /* One light, from above the score (the user, 10 Nov: "premium and elegant", not rays crossing): a warm glow
           in the top corner, gold into the band's own colour, a few soft shafts falling from it all the same way,
           and fine gold dust rising slowly near the score. */
        .lc-spot{position:absolute;inset:0;mix-blend-mode:screen;
          background:radial-gradient(50% 110% at 100% 0%,${GOLD.light}52 0%,${GOLD.light}1f 26%,color-mix(in srgb,var(--hero-accent,#22c55e) 26%,transparent) 55%,transparent 80%),
            linear-gradient(215deg,${GOLD.bright}29 0%,transparent 38%);transform-origin:100% 0;
          animation:lc-breathe 7s ease-in-out infinite}
        /* A gold wash on the same path as the header's green one, half a cycle behind it, so as the green flows one way
           the gold flows back the other (the user, 10 Nov: "green is going from left to right, so in return we need golden
           premium flow also"). */
        .lc-aurora{position:absolute;width:220%;height:300%;left:-32%;top:-135%;mix-blend-mode:screen;
          background:radial-gradient(ellipse 45% 45% at 50% 50%,${GOLD.light}24 0%,${GOLD.light}10 45%,transparent 85%);
          animation:score-drift 9s cubic-bezier(.45,0,.55,1) -4.5s infinite}
        @keyframes lc-breathe{0%,100%{opacity:.8;transform:scale(1)}50%{opacity:1;transform:scale(1.15)}}
        .lc-dust{position:absolute;bottom:18%;width:2px;height:2px;border-radius:50%;background:${GOLD.light};box-shadow:0 0 4px ${GOLD.bright};opacity:0;
          animation:lc-rise 9s ease-in-out infinite}
        .lc-dust-s{width:1.5px;height:1.5px}
        @keyframes lc-rise{0%{opacity:0;transform:translateY(0)}20%{opacity:.7}80%{opacity:.5}100%{opacity:0;transform:translateY(-110px)}}
        .lc-hero-play .lc-spot{animation-name:lc-fade;animation-duration:1.6s;animation-timing-function:ease-out;animation-iteration-count:1;animation-fill-mode:both}
        @keyframes lc-fade{from{opacity:0}to{opacity:1}}
        .lc-gold-num{background:linear-gradient(180deg,#fffaf0 0%,${GOLD.light} 32%,${GOLD.bright} 64%,${GOLD.base} 88%,${GOLD.deep});-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 10px ${GOLD.base}40) drop-shadow(0 1px 0 rgba(0,0,0,.45))}
        .lc-gold-name{background:linear-gradient(110deg,transparent 38%,rgba(255,255,255,.95) 48%,rgba(255,255,255,.95) 52%,transparent 62%) no-repeat,linear-gradient(180deg,#fffaf0 0%,${GOLD.light} 45%,${GOLD.bright} 100%);background-size:250% 100%,100% 100%;background-position:160% 0,0 0;-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 1px 0 rgba(0,0,0,.4));animation:lc-name-shine 5s ease-in-out 1.5s infinite}
        @keyframes lc-name-shine{0%{background-position:160% 0,0 0}40%,100%{background-position:-60% 0,0 0}}
        .lc-gold-still{background:linear-gradient(180deg,#fffaf0 0%,${GOLD.light} 45%,${GOLD.bright} 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 1px 0 rgba(0,0,0,.4))}
        @media (prefers-reduced-motion:reduce){.lc-gold-name{animation:none}}
        .lc-gold-chip{color:${GOLD.light};background:${GOLD.deep}26;box-shadow:inset 0 0 0 1px ${GOLD.base}b3}
        @media (prefers-reduced-motion:reduce){.lc *,.lc-flow *,.lc-flow::after,.lc-metal{animation:none!important}.lc-spark{display:none}}
      `}</style>
    </div>
  )
}
