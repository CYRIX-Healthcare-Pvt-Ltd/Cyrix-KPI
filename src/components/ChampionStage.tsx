/*
  The stage behind the Dashboard header for team rank 1 in the month being assessed (the user, 10 Nov): the header
  keeps its own green, as on every other header ("make same green header same in rank 1 also, no need of darker
  layer"); a gold cloud glows along the foot, and gold dust rises out of it and fades.

  The crest, the rays turning behind it and the light streaks were tried and taken out (the user, 10 Nov:
  "ok remove the logo, in botton golden cloud is there good, dont change it so from that dust should come",
  then "remove this also" of the rays). Transform and opacity animations only; with "reduce motion" it is still.
*/
import { GOLD } from '@/components/LegendCrest'

// Dust rising out of the gold cloud along the foot: left %, size px, delay s, how far it rises px, sideways drift px.
const DUST: [number, number, number, number, number][] = [
  [30, 2, 0, 90, 8], [36, 3, 2.1, 120, -10], [42, 2, 4.3, 80, 6], [47, 2, 1.2, 140, -6], [51, 3, 3.4, 110, 12],
  [55, 2, 5.6, 95, -8], [58, 2, .7, 130, 10], [61, 3, 2.8, 150, -12], [64, 2, 4.9, 85, 6], [67, 2, 1.8, 125, -6],
  [70, 3, 3.9, 105, 8], [74, 2, .3, 140, -10], [78, 2, 2.5, 90, 6], [82, 3, 4.6, 120, -8], [86, 2, 1.5, 100, 10],
  [44, 2, 6.2, 115, 8], [53, 2, 6.8, 135, -6], [63, 2, 6.0, 110, 6], [72, 2, 5.3, 125, -8], [80, 2, 6.5, 95, 10],
]

export function ChampionStage({ play }: { play: boolean }) {
  return (
    <span className={`cs ${play ? 'cs-play' : ''}`} aria-hidden>
      {DUST.map(([x, sz, d, up, dx], i) => (
        <span key={i} className={`cs-spark ${i > 11 ? 'hidden sm:block' : ''}`}
          style={{ left: `${x}%`, width: sz, height: sz, animationDelay: `${d}s`, ['--up' as string]: `-${up}px`, ['--dx' as string]: `${dx}px` }} />
      ))}
      <span className="cs-horizon" />

      <style>{`
        .cs{position:absolute;inset:0;overflow:hidden;pointer-events:none;--cx:50%}
        @media (min-width:640px){.cs{--cx:56%}}
        @media (min-width:1024px){.cs{--cx:60%}}
        .cs-spark{position:absolute;bottom:6px;border-radius:50%;background:#fff8dc;box-shadow:0 0 6px 2px ${GOLD.bright}cc;opacity:0;animation:cs-rise 7s ease-out infinite}
        @keyframes cs-rise{0%{opacity:0;transform:translate(0,0) scale(.6)}12%{opacity:1;transform:translate(0,-8px) scale(1)}70%{opacity:.7}100%{opacity:0;transform:translate(var(--dx),var(--up)) scale(.5)}}
        /* The gold cloud along the foot (kept as the user liked it). */
        .cs-horizon{position:absolute;left:0;right:0;bottom:-26px;height:60px;mix-blend-mode:screen;
          background:radial-gradient(40% 50% at var(--cx) 50%,${GOLD.bright}aa,${GOLD.base}44 40%,transparent 75%)}
        .cs-horizon::after{content:'';position:absolute;left:8%;right:8%;top:50%;height:1.5px;background:linear-gradient(90deg,transparent,${GOLD.base}99 25%,#fff3c4 55%,${GOLD.base}99 80%,transparent)}
        .cs-play .cs-horizon{animation:cs-fade 1.4s ease-out both}
        @keyframes cs-fade{from{opacity:0}to{opacity:1}}
        @media (prefers-reduced-motion:reduce){.cs *{animation:none!important}.cs-spark{display:none}}
      `}</style>
    </span>
  )
}
