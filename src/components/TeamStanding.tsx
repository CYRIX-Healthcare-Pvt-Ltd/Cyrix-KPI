import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Trophy } from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { monthLabel } from '@/lib/fy'
import { ScorePill } from '@/components/ui'
import { TREND_MARGIN } from '@/components/ScoreTrend'

/*
  Where I stand in my manager's team (KPI 0262; a director's ask, the user, 6 Nov: "she needs to see where shee stand
  in joys team, and she can see joys other members kpi score, and rank, ah graphical month wise stand"). Everyone
  sees the people who share their reporting manager, by name and score; the year average or one month; and their
  own rank month by month. Ranked by the total score, highest first (the user: "total % high is rank 1").
*/
type Row = { employee_id: string; ecode: string; full_name: string; designation: string | null; is_me: boolean
  manager_name: string; period_month: string | null; score: number | null; team_rank: number | null; team_of: number | null; months: number | null }
type Mark = { score: number; rank: number; of: number; months: number }
type Member = { id: string; name: string; designation: string | null; me: boolean; year: Mark | null; scores: Map<string, Mark> }

const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null)
/* Distinct, not loud; green is mine alone. At most four lit at once, so no colour repeats. */
const OTHER = ['#3b82f6', '#f59e0b', '#a855f7', '#ec4899']
const MAX_PICK = OTHER.length
const FAINT = '#9ca3af'
const MINE = '#10b981'

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
  const { members, months, manager } = useMemo(() => {
    const by = new Map<string, Member>()
    for (const r of rows ?? []) {
      if (!by.has(r.employee_id)) by.set(r.employee_id, { id: r.employee_id, name: r.full_name, designation: r.designation, me: r.is_me, year: null, scores: new Map() })
      if (r.score == null || r.team_rank == null) continue
      const mark = { score: Number(r.score), rank: r.team_rank, of: r.team_of ?? 0, months: r.months ?? 1 }
      if (r.period_month) by.get(r.employee_id)!.scores.set(r.period_month.slice(0, 10), mark)
      else by.get(r.employee_id)!.year = mark
    }
    const ms = [...new Set([...by.values()].flatMap(m => [...m.scores.keys()]))].sort()
    return { members: [...by.values()], months: ms, manager: rows?.[0]?.manager_name ?? '' }
  }, [rows])
  const [view, setView] = useState<'year' | 'month'>('year')
  // Whom my line is compared with (null = the default below).
  const [picked, setPicked] = useState<string[] | null>(null)

  const me = members.find(m => m.me)
  if (!me || members.length < 2 || !months.length) return null
  const latest = months[months.length - 1]

  const markOf = (m: Member) => (view === 'year' ? m.year : m.scores.get(latest) ?? null)
  const list = members.flatMap(m => { const k = markOf(m); return k ? [{ m, ...k }] : [] })
    .sort((a, b) => a.rank - b.rank || b.score - a.score || a.m.name.localeCompare(b.m.name))
  const waiting = members.filter(m => !markOf(m)).map(m => m.name)
  const mine = list.find(x => x.m.me)
  const teamAvg = avg(list.map(x => x.score))
  const countOf = (x: { months: number }) => (view === 'year' ? x.months : 1)

  // Month by month, everyone's score % side by side (the user, 6 Nov: "month wise, comparison with others also, so
  // graph better show scored %"). A team of 20 in 20 colours was unreadable: my line green, the team average dashed,
  // everybody else faint, and up to four people lit in colour — pressed on a name, or the top of the team to start.
  const scored = members.filter(m => m.scores.size)
  const others = scored.filter(m => !m.me)
    .sort((a, b) => (a.year?.rank ?? 99) - (b.year?.rank ?? 99) || a.name.localeCompare(b.name))
  const lit = picked ?? (others.length <= MAX_PICK ? others.map(m => m.id) : others.slice(0, 1).map(m => m.id))
  const pick = (id: string) => setPicked(lit.includes(id) ? lit.filter(x => x !== id) : [...lit, id].slice(-MAX_PICK))
  const chart = months.map(mo => {
    const my = me.scores.get(mo)
    const that = scored.flatMap(m => { const k = m.scores.get(mo); return k ? [k.score] : [] })
    return { month: monthLabel(mo).split('-')[0], full: monthLabel(mo), rank: my ? `#${my.rank} of ${my.of}` : '', avg: avg(that),
      ...Object.fromEntries(scored.map(m => [m.id, m.scores.get(mo)?.score ?? null])) }
  })
  // The scale starts 10 below the lowest score anyone had, in steps of 10.
  const lowest = Math.min(...scored.flatMap(m => [...m.scores.values()].map(k => k.score)))
  const lo = Math.max(0, Math.floor((lowest - 5) / 10) * 10)
  const colour = new Map(lit.map((id, i) => [id, OTHER[i]]))
  const nameOf = new Map<string, string>([...scored.map(m => [m.id, m.me ? 'Me' : m.name] as [string, string]), ['avg', 'Team average']])

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
          <p className="text-xl font-semibold tabular-nums text-ink-900">{mine ? mine.score.toFixed(2) : '—'}</p>
        </div>
        <div className="rounded-lg bg-ink-50 px-3 py-2">
          <p className="text-xs text-ink-500">Team average</p>
          <p className="text-xl font-semibold tabular-nums text-ink-900">{teamAvg?.toFixed(2) ?? '—'}</p>
        </div>
      </div>

      <ol className="mt-3 divide-y divide-ink-100">
        {list.map(x => (
          <li key={x.m.id} onClick={x.m.me || !x.m.scores.size ? undefined : () => pick(x.m.id)}
            className={clsx('flex items-center gap-3 px-2 py-2', x.m.me ? 'rounded-lg bg-emerald-50 ring-1 ring-inset ring-emerald-200' : 'cursor-pointer rounded-lg hover:bg-ink-50')}>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums text-white"
              style={{ background: x.m.me ? MINE : colour.get(x.m.id) ?? FAINT }}>{x.rank}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink-900">{x.m.name}{x.m.me && <span className="font-normal text-emerald-700"> · You</span>}</span>
              <span className="block truncate text-xs text-ink-500">{x.m.designation ?? ''}{view === 'year' ? ` · ${countOf(x)} ${countOf(x) === 1 ? 'month' : 'months'}` : ''}</span>
            </span>
            <ScorePill value={x.score} size="sm" />
          </li>
        ))}
      </ol>
      {waiting.length > 0 && <p className="mt-2 px-2 text-xs text-ink-400">Not scored yet: {waiting.join(', ')}</p>}

      <h4 className="mb-1 mt-4 text-sm font-semibold text-ink-800">Month by month</h4>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
        <span className="flex items-center gap-1.5 font-semibold text-ink-800"><span className="h-[3px] w-4 rounded bg-emerald-500" /> Me</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-ink-400" /> Team average</span>
      </div>
      {others.length > MAX_PICK && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {others.map(m => {
            const on = colour.get(m.id)
            return (
              <button key={m.id} type="button" onClick={() => pick(m.id)} aria-pressed={!!on}
                className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', on ? 'font-semibold text-ink-900' : 'border-ink-200 text-ink-500')}
                style={on ? { borderColor: on, background: `${on}1f` } : undefined}>
                <span className="h-2 w-2 rounded-full" style={{ background: on ?? FAINT }} /> {m.name}
              </button>
            )
          })}
        </div>
      )}
      {others.length <= MAX_PICK && (
        <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
          {others.map(m => (
            <span key={m.id} className="flex items-center gap-1.5"><span className="h-[2px] w-4 rounded" style={{ background: colour.get(m.id) ?? FAINT }} /> {m.name}</span>
          ))}
        </div>
      )}
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart} margin={TREND_MARGIN}>
            <CartesianGrid vertical={false} stroke="#8884" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b6e79' }} axisLine={{ stroke: '#8886' }} tickLine={false} />
            <YAxis domain={[lo, 100]} ticks={Array.from({ length: (100 - lo) / 10 + 1 }, (_, i) => lo + i * 10)} interval={0} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11, fill: '#6b6e79' }} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #d8d9dd', color: '#111' }}
              labelFormatter={(_, p) => (p?.[0]?.payload as { full?: string })?.full ?? ''}
              itemSorter={(i: { value?: unknown }) => -(typeof i.value === 'number' ? i.value : 0)}
              formatter={(v: unknown, id: string, item: { payload?: { rank?: string } }) =>
                typeof v !== 'number' ? ['—', nameOf.get(id) ?? ''] : [`${v.toFixed(1)}%${id === me.id ? ` · ${item.payload?.rank ?? ''}` : ''}`, nameOf.get(id) ?? '']}
            />
            {/* Everybody not lit, faint and out of the tooltip; then the average; then the lit ones on top. */}
            {others.filter(m => !colour.has(m.id)).map(m => (
              <Line key={m.id} type="monotone" dataKey={m.id} stroke={FAINT} strokeOpacity={0.25} strokeWidth={1} dot={false} activeDot={false} tooltipType="none" connectNulls isAnimationActive={false} />
            ))}
            <Line type="monotone" dataKey="avg" stroke={FAINT} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
            {others.filter(m => colour.has(m.id)).map(m => (
              <Line key={m.id} type="monotone" dataKey={m.id} stroke={colour.get(m.id)} strokeWidth={2} dot={{ r: 3, fill: colour.get(m.id), strokeWidth: 0 }} connectNulls isAnimationActive={false} />
            ))}
            <Line type="monotone" dataKey={me.id} stroke={MINE} strokeWidth={3} dot={{ r: 4.5, fill: MINE, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
