import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, MapPin, RefreshCw, Search, X } from 'lucide-react'
import { Alert, PageLoader } from '@/components/ui'
import { supabase, friendlyError } from '@/lib/supabase'

/*
  SW Admin's Watch (te_0101; the user, 3 Nov: "lets see where they manipulate", then "can you make it in sw admin? like
  new refresh new summary"): the signs worth a look, on drafts as well as sent claims, real people only, one card a
  person with the reddest first. Refreshes every minute; a sign's chip at the top keeps only that sign.
*/
type Kind = 'shared' | 'paid_time' | 'bill_low' | 'start_away' | 'too_fast' | 'short_visit' | 'long_gap' | 'day_unstarted' | 'fare_high' | 'home_unset' | 'home_map' | 'home_moved' | 'other_big' | 'km_over' | 'no_photo_near' | 'photo_late'
type Weight = 'red' | 'amber' | 'grey'
interface Sign { kind: Kind; weight: Weight; day: string; claim: string | null; status: string | null; detail: string; amount: number | null; point: { lat: number; lng: number } | null }
interface Person { ecode: string; name: string; function: string | null; manager: string | null; n: number; red: number; signs: Sign[] }
interface Watch { counts: Partial<Record<Kind, number>>; people: Person[]; at: string }

const LABEL: Record<Kind, string> = {
  shared: 'Same trip on another claim', paid_time: 'Paid at another time',
  bill_low: 'Bill under amount', km_over: 'Km over map', home_unset: 'No home saved', home_map: 'Home set on map',
  home_moved: 'Home moved', other_big: 'Big Other expense', fare_high: 'Fare over policy', start_away: 'Day not started from home', too_fast: 'Too fast between photos', short_visit: 'Short visit', long_gap: 'Long gap', day_unstarted: 'Day not started in the app', no_photo_near: 'No photo at destination', photo_late: 'Photo saved late',
}
const ORDER: Kind[] = ['shared', 'paid_time', 'bill_low', 'km_over', 'home_unset', 'home_map', 'home_moved', 'too_fast', 'fare_high', 'start_away', 'day_unstarted', 'short_visit', 'long_gap', 'other_big', 'no_photo_near', 'photo_late']
const WEIGHT: Record<Kind, Weight> = {
  shared: 'red', paid_time: 'red', bill_low: 'red', km_over: 'red', home_unset: 'red', home_map: 'amber', home_moved: 'amber', other_big: 'amber', fare_high: 'amber', start_away: 'amber', too_fast: 'red', short_visit: 'amber', long_gap: 'amber', day_unstarted: 'amber', no_photo_near: 'amber', photo_late: 'amber',
}
const TONE: Record<Weight, string> = {
  red: 'bg-cyrixRed-100 text-cyrixRed-900', amber: 'bg-amber-100 text-amber-900', grey: 'bg-ink-100 text-ink-700',
}
const DOT: Record<Weight, string> = { red: 'bg-cyrixRed-600', amber: 'bg-amber-500', grey: 'bg-ink-400' }
const STATUS: Record<string, string> = {
  draft: 'Draft', with_manager: 'With manager', with_coordinator: 'With coordinator', with_desk: 'With Travel Desk', approved: 'Approved', paid: 'Paid', returned: 'Sent back', recalled: 'Recalled',
}

const PERIODS = [['this', 'This month'], ['all', 'All time'], ['custom', 'Custom']] as const
type Period = typeof PERIODS[number][0]
const isoDay = (d: Date) => d.toLocaleDateString('en-CA')
const today = () => isoDay(new Date())
const monthStart = () => { const t = new Date(); return isoDay(new Date(t.getFullYear(), t.getMonth(), 1)) }
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()
const dayText = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const az = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/*
  Where a sign's place is, named by town and district (the user, 3 Nov: "where is that Koyilandy details?"), and opened
  on Google Maps. Named by OpenStreetMap's reverse lookup, as the Travel app names places; only signs with a point ask.
*/
// What the point is, said before its place (the user, 3 Nov: "can you mention it").
const POINT: Partial<Record<Kind, string>> = { shared: 'Starts', paid_time: 'Destination', home_unset: 'Starts', start_away: 'Starts', too_fast: 'Photo', short_visit: 'Place', long_gap: 'Place', home_map: 'Home', home_moved: 'Home now', no_photo_near: 'Destination', photo_late: 'Photo' }

function PlaceLine({ lat, lng, what }: { lat: number; lng: number; what: string }) {
  const { data } = useQuery({
    queryKey: ['osm_place', lat.toFixed(4), lng.toFixed(4)],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=en&lat=${lat}&lon=${lng}`)
      if (!res.ok) return null
      const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {}
      const near = a.village ?? a.town ?? a.suburb ?? a.city ?? a.hamlet ?? a.municipality
      const area = a.state_district ?? a.county ?? a.city ?? a.state
      return [near, area !== near ? area : null].filter(Boolean).join(', ') || null
    },
  })
  return (
    <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer"
      className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline">
      <MapPin className="h-3.5 w-3.5" />{data ? `${what} near ${data}` : `${what} at ${lat.toFixed(4)}, ${lng.toFixed(4)}`} · Map
    </a>
  )
}

/*
  What the Watch has found so far, kept (te_0137; the user, 7 Nov: "ya add the log, in that it will see what was
  corrected isnt?"): every sign the first time it was seen, and when it was corrected — no longer seen. For management:
  found, corrected, still open, sign by sign.
*/
interface Found { kind: Kind; weight: Weight; day: string; claim: string | null; status: string | null; detail: string; amount: number | null; found_at: string; corrected_at: string | null; ecode: string; name: string; function: string | null }
type FoundSort = 'found' | 'day' | 'person' | 'sign' | 'corrected'
const stamp = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function FoundLog() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['te_watch_found'],
    queryFn: async () => {
      const s = await supabase.rpc('te_watch_sync')
      if (s.error) throw new Error(friendlyError(s.error))
      const { data, error } = await supabase.rpc('te_watch_found')
      if (error) throw new Error(friendlyError(error))
      return data as Found[]
    },
  })
  const [q, setQ] = useState('')
  const [state, setState] = useState<'all' | 'open' | 'corrected'>('all')
  const [kind, setKind] = useState<Kind | ''>('')
  const [sort, setSort] = useState<{ by: FoundSort; up: boolean }>({ by: 'found', up: false })
  const rows = data ?? []
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    const key = (r: Found) => sort.by === 'found' ? r.found_at : sort.by === 'day' ? r.day : sort.by === 'person' ? r.name : sort.by === 'sign' ? LABEL[r.kind] ?? r.kind : r.corrected_at ?? ''
    return rows
      .filter(r => (state === 'all' || (state === 'open') === !r.corrected_at) && (!kind || r.kind === kind)
        && (!t || `${r.name} ${r.ecode} ${r.claim ?? ''} ${r.detail} ${LABEL[r.kind] ?? ''}`.toLowerCase().includes(t)))
      .sort((a, b) => az.compare(key(a), key(b)) * (sort.up ? 1 : -1))
  }, [rows, q, state, kind, sort])
  if (isLoading) return <PageLoader />
  if (error || !data) return <Alert kind="error">{(error as Error)?.message ?? 'Could not open.'}</Alert>
  const corrected = rows.filter(r => r.corrected_at).length
  const kinds = ORDER.filter(k => rows.some(r => r.kind === k))
  const head = (by: FoundSort, label: string) => (
    <th className="px-3 py-2 text-left">
      <button type="button" className="inline-flex items-center gap-1 font-semibold" onClick={() => setSort(x => ({ by, up: x.by === by ? !x.up : by === 'person' || by === 'sign' }))}>
        {label}{sort.by === by && (sort.up ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />)}
      </button>
    </th>
  )
  const tiles: Array<[string, number, string]> = [['Found', rows.length, 'text-ink-900'], ['Corrected', corrected, 'text-green-700'], ['Still open', rows.length - corrected, 'text-cyrixRed-700']]
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {tiles.map(([l, n, c]) => (
          <div key={l} className="card px-3 py-3 text-center">
            <p className={clsx('text-2xl font-bold tabular-nums', c)}>{n}</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{l}</p>
          </div>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-xs text-ink-600"><tr><th className="px-3 py-2 text-left">Sign</th><th className="px-3 py-2 text-right">Found</th><th className="px-3 py-2 text-right">Corrected</th><th className="px-3 py-2 text-right">Still open</th></tr></thead>
          <tbody>
            {kinds.map(k => {
              const of = rows.filter(r => r.kind === k), c = of.filter(r => r.corrected_at).length
              return (
                <tr key={k} className="border-t border-ink-100">
                  <td className="px-3 py-2"><span className={clsx('mr-2 inline-block h-2 w-2 rounded-full', DOT[WEIGHT[k]])} />{LABEL[k]}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{of.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-green-700">{c}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{of.length - c}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input className="input h-10 pl-9" value={q} placeholder="Search name, E-code, claim" onChange={e => setQ(e.target.value)} />
        </label>
        <select className="input h-10" value={state} onChange={e => setState(e.target.value as typeof state)}>
          <option value="all">Open and corrected</option><option value="open">Still open</option><option value="corrected">Corrected</option>
        </select>
        <select className="input h-10" value={kind} onChange={e => setKind(e.target.value as Kind | '')}>
          <option value="">All signs</option>{kinds.map(k => <option key={k} value={k}>{LABEL[k]}</option>)}
        </select>
        <button type="button" onClick={() => void refetch()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm text-ink-600 hover:bg-ink-100">
          <RefreshCw className={clsx('h-4 w-4', isFetching && 'animate-spin')} /> Refresh
        </button>
      </div>
      {!shown.length ? <div className="card p-8 text-center text-sm text-ink-500">Nothing found.</div> : <>
        <div className="space-y-2 sm:hidden">
          {shown.map((r, i) => (
            <div key={i} className="card px-4 py-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className={clsx('text-xs font-semibold', r.weight === 'red' ? 'text-cyrixRed-700' : 'text-amber-700')}>{LABEL[r.kind] ?? r.kind}</p>
                <span className={clsx('badge shrink-0', r.corrected_at ? 'bg-green-100 text-green-800' : 'bg-cyrixRed-100 text-cyrixRed-900')}>{r.corrected_at ? `Corrected ${stamp(r.corrected_at)}` : 'Open'}</span>
              </div>
              <p className="font-medium text-ink-900">{r.name} <span className="text-xs font-normal text-ink-500">{r.ecode}</span></p>
              <p className="break-words text-ink-800">{r.detail}</p>
              <p className="text-xs text-ink-500">{dayText(r.day)}{r.claim ? ` · ${r.claim}` : ''} · found {stamp(r.found_at)}</p>
            </div>
          ))}
        </div>
        <div className="card hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-xs text-ink-600"><tr>{head('person', 'Person')}{head('sign', 'Sign')}<th className="px-3 py-2 text-left">What</th>{head('day', 'Day')}<th className="px-3 py-2 text-left">Claim</th>{head('found', 'Found')}{head('corrected', 'Corrected')}</tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i} className="border-t border-ink-100 align-top">
                  <td className="whitespace-nowrap px-3 py-2">{r.name} ({r.ecode})</td>
                  <td className={clsx('whitespace-nowrap px-3 py-2 text-xs font-semibold', r.weight === 'red' ? 'text-cyrixRed-700' : 'text-amber-700')}>{LABEL[r.kind] ?? r.kind}</td>
                  <td className="px-3 py-2 text-ink-800">{r.detail}</td>
                  <td className="whitespace-nowrap px-3 py-2">{dayText(r.day)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.claim ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2">{stamp(r.found_at)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.corrected_at ? <span className="font-semibold text-green-700">{stamp(r.corrected_at)}</span> : <span className="text-cyrixRed-700">Open</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  )
}

export default function TravelWatch() {
  const [view, setView] = useState<'now' | 'found'>('now')
  const views: Array<['now' | 'found', string]> = [['now', 'Now'], ['found', 'Found so far']]
  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg bg-ink-100 p-1">
        {views.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)}
            className={clsx('h-9 rounded-md px-4 text-sm font-semibold', view === k ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900')}>{l}</button>
        ))}
      </div>
      {view === 'now' ? <WatchNow /> : <FoundLog />}
    </div>
  )
}

function WatchNow() {
  const [period, setPeriod] = useState<Period>('custom')
  const [custom, setCustom] = useState<[string, string]>([today(), today()])
  const [from, to] = period === 'all' ? [null, null] : period === 'this' ? [monthStart(), today()] : custom[0] <= custom[1] ? custom : [custom[1], custom[0]]
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['te_watch', from, to],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('te_watch', { p_from: from, p_to: to })
      if (error) throw new Error(friendlyError(error))
      return data as Watch
    },
  })
  const [kind, setKind] = useState<Kind | null>(null)
  const [q, setQ] = useState('')
  const [fn, setFn] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const people = data?.people ?? []
  const fns = useMemo(() => [...new Set(people.map(p => p.function ?? '—'))].sort(az.compare), [people])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return people
      .map(p => (kind ? { ...p, signs: p.signs.filter(x => x.kind === kind) } : p))
      .filter(p => p.signs.length && (!fn || (p.function ?? '—') === fn) && (!s || `${p.name} ${p.ecode} ${p.function ?? ''} ${p.manager ?? ''}`.toLowerCase().includes(s)))
  }, [people, kind, q, fn])
  const counts = data?.counts ?? {}

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPeriod(k)}
              className={clsx('h-9 rounded-full px-3.5 text-sm font-medium', period === k ? 'bg-violet-600 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200')}>{l}</button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            {(['From', 'To'] as const).map((l, i) => (
              <label key={l} className="flex min-w-0 items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">{l}</span>
                <input type="date" className="input h-9 min-w-0" value={custom[i]} max={i === 0 ? custom[1] : today()} min={i === 1 ? custom[0] : undefined}
                  onChange={e => e.target.value && setCustom(i === 0 ? [e.target.value, custom[1]] : [custom[0], e.target.value])} />
              </label>
            ))}
          </div>
        )}
        <button type="button" onClick={() => void refetch()} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm text-ink-600 hover:bg-ink-100 lg:ml-auto">
          <RefreshCw className={clsx('h-4 w-4', isFetching && 'animate-spin')} />
          {data ? `Updated ${clock(data.at)}` : 'Refresh'}
        </button>
      </div>

      {isLoading ? <PageLoader />
        : error || !data ? <Alert kind="error">{(error as Error)?.message ?? 'Could not open.'}</Alert>
        : <>
          {/* All clears a chosen sign; the chosen one also shows a cross (the user, 3 Nov: "how to clear this selection?"). */}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={!kind} onClick={() => setKind(null)}
              className={clsx('inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold', !kind ? 'bg-ink-900 text-surface' : 'bg-ink-100 text-ink-700 hover:bg-ink-200')}>
              All {Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)}
            </button>
            {ORDER.map(k => {
              const n = counts[k] ?? 0
              return (
                <button key={k} type="button" disabled={!n} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}
                  className={clsx('inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold disabled:opacity-40',
                    kind === k ? 'bg-ink-900 text-surface' : TONE[WEIGHT[k]])}>
                  <span className={clsx('h-1.5 w-1.5 rounded-full', DOT[WEIGHT[k]])} />{LABEL[k]} {n}{kind === k && <X className="h-3.5 w-3.5" aria-label="Clear" />}
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input className="input h-10 pl-9" value={q} placeholder="Search name, E-code, manager" onChange={e => setQ(e.target.value)} />
            </label>
            <select className="input h-10" value={fn} onChange={e => setFn(e.target.value)}>
              <option value="">All functions</option>
              {fns.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {!shown.length ? <div className="card p-8 text-center text-sm text-ink-500">Nothing to watch.</div> : (
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {shown.map(p => {
                const all = open.has(p.ecode)
                const list = all ? p.signs : p.signs.slice(0, 3)
                return (
                  <div key={p.ecode} className="card min-w-0 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink-900">{p.name} <span className="text-xs font-normal text-ink-500">{p.ecode}</span></p>
                        <p className="truncate text-xs text-ink-500">{p.function ?? '—'} · {p.manager ?? '—'}</p>
                      </div>
                      {p.red > 0 && <span className="badge shrink-0 bg-cyrixRed-100 text-cyrixRed-900">{p.red} red</span>}
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {list.map((s, i) => (
                        <li key={i} className="flex gap-2 text-sm">
                          <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT[s.weight])} />
                          <div className="min-w-0">
                            <p className={clsx('text-xs font-semibold', s.weight === 'red' ? 'text-cyrixRed-700' : s.weight === 'amber' ? 'text-amber-700' : 'text-ink-600')}>{LABEL[s.kind]}</p>
                            <p className="break-words text-ink-800">{s.detail}</p>
                            {s.point && <PlaceLine lat={s.point.lat} lng={s.point.lng} what={POINT[s.kind] ?? 'Place'} />}
                            <p className="text-xs text-ink-500">{dayText(s.day)}{s.status ? ` · ${s.claim ?? STATUS[s.status] ?? s.status}${s.claim && s.status ? ` (${STATUS[s.status] ?? s.status})` : ''}` : ''}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {p.signs.length > 3 && (
                      <button type="button" className="mt-2 text-xs font-semibold text-violet-700 hover:underline"
                        onClick={() => setOpen(o => { const n = new Set(o); if (n.has(p.ecode)) n.delete(p.ecode); else n.add(p.ecode); return n })}>
                        {all ? 'Show less' : `Show all ${p.signs.length}`}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>}
    </div>
  )
}
