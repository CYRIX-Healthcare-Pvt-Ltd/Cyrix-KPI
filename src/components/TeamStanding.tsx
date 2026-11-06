import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Trophy } from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { monthLabel } from '@/lib/fy'
import { ScorePill } from '@/components/ui'
import { TREND_MARGIN, ScoreLabel } from '@/components/ScoreTrend'
import { bandFor, BAND_SCALE } from '@/lib/bands'
import { useIsDark } from '@/lib/isDark'

/*
  Where I stand in my manager's team (KPI 0262; a director's ask). Everyone sees the people who share their reporting
  manager, ranked by total score (the user: "total % high is rank 1"), for the year or one month — ranks only, my own
  score alone (0264; the user, 6 Nov: "i think it is bad to show everyone's score, so just show the rank and that line
  graph vs me"), and my score month by month against the team average.
*/
type Row = { employee_id: string; ecode: string; full_name: string; designation: string | null; is_me: boolean
  manager_name: string; period_month: string | null; score: number | null; team_rank: number | null; team_of: number | null
  months: number | null; team_avg: number | null; band_from: number | null; prev_rank: number | null
  ytd_rank: number | null; ytd_of: number | null; shape: number | null }
type Mark = { rank: number; of: number; months: number; score: number | null; band: number | null; prev: number | null; ytd: number | null; ytdOf: number | null; shape: number | null }
type Member = { id: string; name: string; designation: string | null; me: boolean; year: Mark | null; scores: Map<string, Mark> }

const FAINT = '#9ca3af'
const MINE = '#10b981'
/* The rank circle in the person's score band: white figures in light mode as before, dark ones on every band in dark
   mode so the number reads (the user, 6 Nov: "when light keep the same as earlier"; then "why top 4 font white"). */
const circle = (band: number | null, dark: boolean) => {
  const b = band == null ? null : bandFor(band)
  if (!b) return { background: FAINT, color: '#fff' }
  return { background: b.hex.base, color: dark ? '#111' : '#fff' }
}

/* The rank against a month ago (the user, 6 Nov: "show arrows comparing last month"): up in green, down in red, a
   grey dash when it held; nothing for someone with no rank a month ago. */
function Move({ now, was }: { now: number; was: number | null }) {
  if (was == null) return <span className="w-7 shrink-0" />
  if (was === now) return <span className="w-7 shrink-0 text-center text-xs text-ink-400" aria-label="Same as last month">–</span>
  const up = was > now
  return (
    <span className={clsx('w-7 shrink-0 text-right text-xs font-semibold tabular-nums', up ? 'ts-up text-emerald-600' : 'ts-down text-cyrixRed-600')}
      aria-label={up ? `Up ${was - now} since last month` : `Down ${now - was} since last month`}>{up ? '▲' : '▼'}{Math.abs(was - now)}</span>
  )
}

/* The year tab's trend as month tiles (the user, 6 Nov: the lines "looks bad, is there any awesome way", "like i
   should feel motivated"): one tile a month in the colour of that month's score band — the colour only, never the
   score — lined up under the month letters. The latest month has an outline and a glow, its letter darker; at the end of an Excellent run it is the bar's
   D-shaped end (the user: "why are you removed the box?", "where is D box?"). Months not scored are plain grey, and a run of Excellent months joins into one bar, so a streak is something to see and to keep. The tiles pop in once, left to right. */
// Wider on a desktop, where the month names are written out (the user, 6 Nov: "in desktop you can show apr, may").
const TILE = 'h-4 w-4 sm:h-5 sm:w-5 lg:w-10'
function Tiles({ m, months }: { m: Member; months: string[] }) {
  const last = months.length - 1
  const ex = months.map(mo => bandFor(m.scores.get(mo)?.band ?? null)?.key === 'excellent')
  return (
    <span className="flex shrink-0 items-center" aria-label={`${m.name}: ${months.map(mo => `${monthLabel(mo)} ${bandFor(m.scores.get(mo)?.band ?? null)?.label ?? 'not scored'}`).join(', ')}`}>
      {months.map((mo, i) => {
        const b = bandFor(m.scores.get(mo)?.band ?? null)
        const joinL = ex[i] && ex[i - 1], joinR = ex[i] && ex[i + 1]
        return (
          <span key={mo} title={`${monthLabel(mo)} · ${b?.label ?? 'Not scored'}`}
            // A joined tile takes the 4px gap into its own width, so the columns still meet the month letters.
            className={clsx(joinL ? 'h-4 w-5 sm:h-5 sm:w-6 lg:w-11' : clsx(TILE, i && 'ml-1'), 'ts-tile',
              joinL ? 'rounded-l-none' : 'rounded-l-[5px]', joinR ? 'rounded-r-none' : 'rounded-r-[5px]',
              !b && 'bg-ink-100')}
            style={{ background: b?.hex.base, animationDelay: `${i * 45}ms`,
              boxShadow: i === last && b ? `0 0 0 2px rgb(var(--surface)), 0 0 0 3.5px ${b.hex.base}, 0 0 12px ${b.hex.base}80` : undefined }} />
        )
      })}
    </span>
  )
}

export default function TeamStanding({ fy }: { fy: string }) {
  const { data: rows } = useQuery({
    queryKey: ['kpi_team_standing', fy],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('kpi_team_standing', { p_fy: fy })
      if (error) throw error
      return (data ?? []) as Row[]
    },
  })
  const { members, months, manager, teamAvg } = useMemo(() => {
    const by = new Map<string, Member>()
    const avgs = new Map<string, number>() // 'year', or the month
    for (const r of rows ?? []) {
      if (!by.has(r.employee_id)) by.set(r.employee_id, { id: r.employee_id, name: r.full_name, designation: r.designation, me: r.is_me, year: null, scores: new Map() })
      if (r.team_rank == null) continue
      const mark = { rank: r.team_rank, of: r.team_of ?? 0, months: r.months ?? 1, score: r.score == null ? null : Number(r.score), band: r.band_from, prev: r.prev_rank, ytd: r.ytd_rank, ytdOf: r.ytd_of, shape: r.shape == null ? null : Number(r.shape) }
      const key = r.period_month ? r.period_month.slice(0, 10) : 'year'
      if (r.team_avg != null) avgs.set(key, Number(r.team_avg))
      if (r.period_month) by.get(r.employee_id)!.scores.set(key, mark)
      else by.get(r.employee_id)!.year = mark
    }
    const ms = [...new Set([...by.values()].flatMap(m => [...m.scores.keys()]))].sort()
    return { members: [...by.values()], months: ms, manager: rows?.[0]?.manager_name ?? '', teamAvg: avgs }
  }, [rows])
  const [view, setView] = useState<'year' | 'month'>('year')
  const dark = useIsDark()

  const me = members.find(m => m.me)
  if (!me || members.length < 2 || !months.length) return null
  const latest = months[months.length - 1]

  const markOf = (m: Member) => (view === 'year' ? m.year : m.scores.get(latest) ?? null)
  const list = members.flatMap(m => { const k = markOf(m); return k ? [{ m, ...k }] : [] })
    .sort((a, b) => a.rank - b.rank || a.m.name.localeCompare(b.m.name))
  const waiting = members.filter(m => !markOf(m)).map(m => m.name)
  const mine = list.find(x => x.m.me)
  // Not the whole team at once (the user, 6 Nov: "do 1"): the top three, then the two above me, me and the two below,
  // with "n more" where rows are left out — nobody opens the app onto a long run of the lowest scores. The rest stay
  // hidden; there is no opening them (the user: "dont need expand option, let it be hidden").
  const at = list.findIndex(x => x.m.me)
  const keep = (n: number) => n < 3 || (at >= 0 ? Math.abs(n - at) <= 2 : n < 5)
  const shown: Array<{ x: (typeof list)[number]; n: number; gap: number }> = []
  let skipped = 0
  list.forEach((x, n) => { if (keep(n)) { shown.push({ x, n, gap: skipped }); skipped = 0 } else skipped++ })
  const below = skipped // rows left out after the last one shown
  const avgNow = teamAvg.get(view === 'year' ? 'year' : latest)

  const chart = months.map(mo => {
    const my = me.scores.get(mo)
    return { month: monthLabel(mo).split('-')[0], full: monthLabel(mo), rank: my ? `#${my.rank} of ${my.of}` : '',
      me: my?.score ?? null, avg: teamAvg.get(mo) ?? null }
  })
  // The scale starts below the lowest point on it, in steps of 10.
  const lowest = Math.min(...chart.flatMap(c => [c.me, c.avg].filter((v): v is number => v != null)))
  const lo = Math.max(0, Math.floor((lowest - 8) / 10) * 10)
  const nameOf: Record<string, string> = { me: 'Me', avg: 'Team average' }
  // The average a shade darker in light mode, where the pale grey washed out (the user: "in light avg color is less").
  const avgInk = dark ? FAINT : '#6b7280'
  // Which line's figure goes on top at a month: the higher one; the average when I have no score that month.
  const above = (key: 'me' | 'avg', i?: number) => {
    const c = i == null ? undefined : chart[i]
    if (!c || c.me == null || c.avg == null) return true
    return key === 'me' ? c.me >= c.avg : c.avg > c.me
  }
  // My line's colour stops: each scored month's band, placed along the stretch the line covers.
  const scoredAt = chart.flatMap((c, i) => (c.me == null ? [] : [{ i, v: c.me }]))
  const span = scoredAt.length > 1 ? scoredAt[scoredAt.length - 1].i - scoredAt[0].i : 1
  const myStops = scoredAt.map(({ i, v }) => ({ at: (i - scoredAt[0].i) / span, c: bandFor(v)?.hex.base ?? MINE }))

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-800">
            <Trophy className="h-4 w-4 text-amber-500" /> My place in {manager}&rsquo;s team
          </h3>
          <p className="text-xs text-ink-500">{members.length} people</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-ink-100 p-1 text-xs font-semibold">
          {([['year', 'Year average'], ['month', monthLabel(latest)]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setView(k)}
              className={clsx('rounded-md px-3 py-1.5', view === k ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500')}>{label}</button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-ink-50 px-3 py-2">
          <p className="text-xs text-ink-500">My rank</p>
          <p className="text-xl font-semibold tabular-nums text-ink-900">{mine ? mine.rank : '—'}<span className="ml-1 text-xs font-normal text-ink-500">of {list.length}</span></p>
        </div>
        <div className="rounded-lg bg-ink-50 px-3 py-2">
          <p className="text-xs text-ink-500">My score</p>
          <p className="text-xl font-semibold tabular-nums text-ink-900">{mine?.score != null ? mine.score.toFixed(2) : '—'}</p>
        </div>
        <div className="rounded-lg bg-ink-50 px-3 py-2">
          <p className="text-xs text-ink-500">Team average</p>
          <p className="text-xl font-semibold tabular-nums text-ink-900">{avgNow?.toFixed(2) ?? '—'}</p>
        </div>
      </div>

      <style>{`@keyframes ts-pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}
        .ts-tile{animation:ts-pop .35s cubic-bezier(.2,.9,.3,1.3) both}
        @keyframes ts-draw{from{transform:scaleX(0)}to{transform:none}}.ts-line{transform-origin:left;animation:ts-draw .7s cubic-bezier(.25,.8,.25,1) both}
        @keyframes ts-up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        @keyframes ts-down{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
        .ts-up{animation:ts-up .4s ease-out both}.ts-down{animation:ts-down .4s ease-out both}
        @media (prefers-reduced-motion:reduce){.ts-tile,.ts-line,.ts-up,.ts-down{animation:none}}`}</style>
      {view === 'year' && (
        <div className="mt-3 flex items-center justify-end px-2 text-[10px] font-semibold uppercase text-ink-400" aria-hidden>
          {months.map((mo, i) => (
            <span key={mo} className={clsx(TILE, 'grid place-items-center', i && 'ml-1', i === months.length - 1 && 'text-ink-800')}>
              <span className="lg:hidden">{monthLabel(mo)[0]}</span><span className="hidden normal-case lg:inline">{monthLabel(mo).split('-')[0]}</span>
            </span>
          ))}
        </div>
      )}
      <ol className={view === 'year' ? 'mt-1' : 'mt-3'}>
        {shown.map(({ x, n, gap }) => (
          <Fragment key={x.m.id}>
          {gap > 0 && (
            <li className="flex items-center gap-3 px-2 py-1 text-xs text-ink-400" aria-label={`${gap} more`}>
              <span className="grid w-7 place-items-center tracking-widest">⋮</span>
              <span>{gap} more</span>
            </li>
          )}
          <li className={clsx('relative flex items-center gap-3 px-2 py-2', x.m.me && 'rounded-lg bg-emerald-50 ring-1 ring-inset ring-emerald-200')}>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums"
              style={circle(x.band, dark)}>{x.rank}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink-900">{x.m.name}{x.m.me && <span className="font-normal text-emerald-700"> · You</span>}</span>
              <span className="block truncate text-xs text-ink-500">{x.m.designation ?? ''}</span>
            </span>
            {x.m.me && x.score != null && <ScorePill value={x.score} size="sm" />}
            {/* Last on the row, so the arrows (and the year's trend lines) stand in one column. */}
            {view === 'month' ? <Move now={x.rank} was={x.prev} /> : <Tiles m={x.m} months={months} />}
            {/* The line under the row in the person's band colour, strong at the left under the rank circle and fading
                to the right (the user, 6 Nov: "make the lines based on their score band", then "left to right is
                better"). It draws itself in from the circle, one row after another. */}
            {!x.m.me && (
              <span aria-hidden key={view} className="ts-line pointer-events-none absolute inset-x-0 bottom-0 h-px"
                style={{ background: `linear-gradient(to right, ${bandFor(x.band)?.hex.base ?? FAINT}, transparent 85%)`, animationDelay: `${Math.min(n, 12) * 40}ms` }} />
            )}
          </li>
          </Fragment>
        ))}
        {below > 0 && (
          <li className="flex items-center gap-3 px-2 py-1 text-xs text-ink-400">
            <span className="grid w-7 place-items-center tracking-widest">⋮</span>
            <span>{below} more</span>
          </li>
        )}
      </ol>

      {waiting.length > 0 && <p className="mt-2 px-2 text-xs text-ink-400">Not scored yet: {waiting.join(', ')}</p>}

      <h4 className="mb-1 mt-4 text-sm font-semibold text-ink-800">Month by month</h4>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
        <span className="flex items-center gap-1.5 font-semibold text-ink-800"><span className="h-[3px] w-4 rounded" style={{ background: myStops.length > 1 ? `linear-gradient(to right, ${myStops.map(st => st.c).join(', ')})` : myStops[0]?.c ?? MINE }} /> Me</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-ink-400" /> Team average</span>
      </div>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          {/* With no axis the first point sits on the edge: room for its figure on the left. */}
          <LineChart data={chart} margin={{ ...TREND_MARGIN, left: 18, bottom: 14 }}>
            <CartesianGrid vertical={false} stroke="#8884" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b6e79' }} axisLine={{ stroke: '#8886' }} tickLine={false} />
            {/* No % axis (the user, 6 Nov): the points carry their own figures, on the score bands of the other charts. */}
            <YAxis hide domain={[lo, 100]} />
            {BAND_SCALE.filter(b => b.to > lo).map(({ band, from, to }) => (
              <ReferenceArea key={band.key} y1={Math.max(from, lo)} y2={to} fill={band.hex.base} fillOpacity={0.07} strokeOpacity={0} />
            ))}
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #d8d9dd', color: '#111' }}
              labelFormatter={(_, p) => (p?.[0]?.payload as { full?: string })?.full ?? ''}
              formatter={(v: unknown, id: string, item: { payload?: { rank?: string } }) =>
                typeof v !== 'number' ? ['—', nameOf[id] ?? ''] : [`${v.toFixed(1)}%${id === 'me' ? ` · ${item.payload?.rank ?? ''}` : ''}`, nameOf[id] ?? '']}
            />
            {/* Each figure goes on the far side from the other line (the user, 6 Nov: "if data labels collide, here top
                line is avg, so bring it up"): whichever line is higher that month has its figure above, the lower one
                below. */}
            <Line type="monotone" dataKey="avg" stroke={avgInk} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: avgInk, strokeWidth: 0 }} connectNulls isAnimationActive={false}
              label={(p: { x?: number; y?: number; value?: number | null; index?: number }) =>
                <ScoreLabel key={p.index} x={p.x} y={p.y} value={p.value} index={p.index} count={chart.length} fill={avgInk} dy={above('avg', p.index) ? -12 : 18} />} />
            {/* My line in the colours of my months' bands, blended from one month to the next ("why green line? for
                rajiv?"), with each point and figure in its band. */}
            <defs>
              <linearGradient id="ts-mine" x1="0" y1="0" x2="1" y2="0">
                {myStops.map(st => <stop key={st.at} offset={`${st.at * 100}%`} stopColor={st.c} />)}
              </linearGradient>
            </defs>
            <Line type="monotone" dataKey="me" stroke={myStops.length > 1 ? 'url(#ts-mine)' : myStops[0]?.c ?? MINE} strokeWidth={3} connectNulls isAnimationActive={false}
              dot={(p: { cx?: number; cy?: number; value?: number | null; index?: number }) => p.value == null || p.cx == null || p.cy == null ? <g key={p.index} /> :
                <circle key={p.index} cx={p.cx} cy={p.cy} r={5} fill={bandFor(p.value)?.hex.base ?? MINE} stroke="rgb(var(--surface))" strokeWidth={1.5} />}
              label={(p: { x?: number; y?: number; value?: number | null; index?: number }) =>
                <ScoreLabel key={p.index} x={p.x} y={p.y} value={p.value} index={p.index} count={chart.length} fill={p.value == null ? MINE : bandFor(p.value)?.hex.base ?? MINE} dy={above('me', p.index) ? -12 : 20} />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
