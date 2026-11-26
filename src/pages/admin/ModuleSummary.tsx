/*
  SW Admin → Module summary (the user, 26 Nov): for each module, who has it (Assigned), who has signed in (Live),
  who did something in it from the chosen date (Used) and Used %. Cyra Assist and Pulse are left out — their use
  is recorded outside our database. Counts come from sw_module_usage (0312); test accounts are never counted.
*/
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, friendlyError } from '@/lib/supabase'
import { Alert, Spinner, StatTile } from '@/components/ui'

type Row = { code: string; name: string; assigned: number; live: number; used: number }
type Key = 'name' | 'assigned' | 'live' | 'used' | 'pct'

const NAMES: Record<string, string> = { bemmp: 'BEMMP', travel: 'Travel Expense', tasks: 'My Task' }
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const pctOf = (r: Row) => (r.assigned ? Math.round((100 * r.used) / r.assigned) : 0)
const tone = (p: number) => (p >= 60 ? 'text-emerald-600' : p >= 25 ? 'text-amber-600' : 'text-cyrixRed-600')
const n = (x: number) => x.toLocaleString('en-IN')

export default function ModuleSummary() {
  const [from, setFrom] = useState(() => `${istToday().slice(0, 7)}-01`)
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'pct', dir: -1 })
  const q = useQuery({
    queryKey: ['sw-module-usage', from],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sw_module_usage', { p_from: from || null })
      if (error) throw new Error(friendlyError(error))
      return (data ?? []) as Row[]
    },
  })
  const rows = useMemo(() => {
    const val = (r: Row) => (sort.key === 'pct' ? pctOf(r) : sort.key === 'name' ? (NAMES[r.code] ?? r.name).toLowerCase() : r[sort.key])
    return [...(q.data ?? [])].sort((a, b) => { const A = val(a), B = val(b); return (A < B ? -1 : A > B ? 1 : 0) * sort.dir })
  }, [q.data, sort])
  const by = (key: Key) => setSort(o => ({ key, dir: o.key === key ? (o.dir === 1 ? -1 : 1) : key === 'name' ? 1 : -1 }))
  const ranked = [...(q.data ?? [])].filter(r => r.assigned >= 5).sort((a, b) => pctOf(b) - pctOf(a))
  const top = ranked[0]; const low = ranked[ranked.length - 1]
  const head = (key: Key, label: string, right = true) => (
    <button type="button" onClick={() => by(key)} className={`font-semibold ${right ? 'text-right' : 'text-left'} hover:text-ink-900`}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      {label}{sort.key === key && <span aria-hidden>{sort.dir === 1 ? ' ↑' : ' ↓'}</span>}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="ms-from">Used from</label>
          <input id="ms-from" type="date" className="input w-44" value={from} max={istToday()} onChange={e => setFrom(e.target.value)} />
        </div>
        {q.isFetching && <Spinner />}
      </div>

      {q.error ? <Alert kind="error">{(q.error as Error).message}</Alert> : !q.data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile label="Modules" value={q.data.length} />
            <StatTile label="Most used" value={top ? `${NAMES[top.code] ?? top.name} · ${pctOf(top)}%` : '–'} />
            <StatTile label="Least used" value={low ? `${NAMES[low.code] ?? low.name} · ${pctOf(low)}%` : '–'} />
          </div>

          <div className="card p-4">
            <div className="mb-3 flex gap-4 text-xs text-ink-500">
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-ink-300" />Live</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Used</span>
            </div>
            <div className="hidden grid-cols-[10rem_minmax(0,1fr)_5rem_5rem_5rem_4.5rem] gap-3 border-b border-ink-100 pb-2 text-xs text-ink-500 md:grid">
              {head('name', 'Module', false)}<span />{head('assigned', 'Assigned')}{head('live', 'Live')}{head('used', 'Used')}{head('pct', 'Used %')}
            </div>
            <ul>
              {rows.map(r => {
                const p = pctOf(r)
                const bar = (
                  <div className="relative h-3 overflow-hidden rounded-full bg-ink-100">
                    <i className="absolute inset-y-0 left-0 rounded-full bg-ink-300" style={{ width: `${r.assigned ? (100 * r.live) / r.assigned : 0}%` }} />
                    <i className="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style={{ width: `${p}%` }} />
                  </div>
                )
                return (
                  <li key={r.code} className="border-b border-ink-100 py-3 last:border-0">
                    <div className="md:hidden">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-ink-900">{NAMES[r.code] ?? r.name}</span>
                        <span className={`text-lg font-semibold tabular-nums ${tone(p)}`}>{p}%</span>
                      </div>
                      <div className="my-2">{bar}</div>
                      <div className="grid grid-cols-3 text-xs text-ink-500">
                        <span>Assigned <b className="text-ink-900">{n(r.assigned)}</b></span>
                        <span>Live <b className="text-ink-900">{n(r.live)}</b></span>
                        <span>Used <b className="text-ink-900">{n(r.used)}</b></span>
                      </div>
                    </div>
                    <div className="hidden grid-cols-[10rem_minmax(0,1fr)_5rem_5rem_5rem_4.5rem] items-center gap-3 text-sm md:grid">
                      <span className="font-semibold text-ink-900">{NAMES[r.code] ?? r.name}</span>
                      {bar}
                      <span className="text-right tabular-nums">{n(r.assigned)}</span>
                      <span className="text-right tabular-nums">{n(r.live)}</span>
                      <span className="text-right tabular-nums">{n(r.used)}</span>
                      <span className={`text-right font-semibold tabular-nums ${tone(p)}`}>{p}%</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
