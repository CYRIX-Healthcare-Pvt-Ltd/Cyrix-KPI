import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { RefreshCw, Search } from 'lucide-react'
import { Alert, PageLoader, SortHeader } from '@/components/ui'
import { supabase, friendlyError } from '@/lib/supabase'

/*
  SW Admin's Live tab (te_0100; the user, 3 Nov, the demo's first day: "can we have a subtab showing live counters?,
  with date filters?"): who is using Travel Expense and what they saved, real people only — the test accounts are left
  out ("dont include test accounts"). Refreshes every minute. Opens on today, as Custom.
*/
interface Person { ecode: string; name: string; function: string | null; manager: string | null; first_at: string; last_at: string; actions: number; started: number; sent: number; approved: number; photos: number; bills: number; home: boolean; new: boolean; with_manager?: number; with_desk?: number; desk?: number; homes?: number; advances?: number; deputations?: number; vehicles?: number; skips?: number }
interface Usage {
  totals: Record<'people' | 'new' | 'started' | 'sent' | 'approved' | 'photos' | 'bills' | 'homes' | 'advances' | 'deputations' | 'vehicles' | 'desk' | 'with_desk' | 'with_manager', number>
  people_of?: Record<string, number>
  functions: Array<{ function: string; people: number; started: number; sent: number; photos: number }>
  people: Person[]
  skip_limit?: number
  at: string
}

const PERIODS = [['this', 'This month'], ['all', 'All time'], ['custom', 'Custom']] as const
type Period = typeof PERIODS[number][0]
const isoDay = (d: Date) => d.toLocaleDateString('en-CA')
const today = () => isoDay(new Date())
const monthStart = () => { const t = new Date(); return isoDay(new Date(t.getFullYear(), t.getMonth(), 1)) }
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()
const when = (iso: string) => {
  const d = new Date(iso)
  return isoDay(d) === today() ? clock(iso) : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${clock(iso)}`
}
const az = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
type SortKey = 'name' | 'function' | 'manager' | 'last' | 'started' | 'sent' | 'photos' | 'with_manager' | 'with_desk' | 'desk' | 'homes' | 'advances' | 'skips'

export default function TravelLive() {
  const [period, setPeriod] = useState<Period>('custom')
  const [custom, setCustom] = useState<[string, string]>([today(), today()])
  const [from, to] = period === 'all' ? [null, null] : period === 'this' ? [monthStart(), today()] : custom[0] <= custom[1] ? custom : [custom[1], custom[0]]
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['te_usage', from, to],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('te_usage', { p_from: from, p_to: to })
      if (error) throw new Error(friendlyError(error))
      return data as Usage
    },
  })
  const [q, setQ] = useState('')
  const [fn, setFn] = useState('')
  const [sort, setSort] = useState<SortKey>('last')
  const [asc, setAsc] = useState(false)
  const onSort = (k: SortKey) => { if (k === sort) setAsc(!asc); else { setSort(k); setAsc(k === 'name' || k === 'function' || k === 'manager') } }

  const people = data?.people ?? []
  const fns = useMemo(() => [...new Set(people.map(p => p.function ?? '—'))].sort(az.compare), [people])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = people.filter(p => (!fn || (p.function ?? '—') === fn) && (!s || `${p.name} ${p.ecode} ${p.function ?? ''} ${p.manager ?? ''}`.toLowerCase().includes(s)))
    const key = (p: Person): string | number => sort === 'name' ? p.name : sort === 'function' ? p.function ?? '' : sort === 'manager' ? p.manager ?? '' : sort === 'last' ? p.last_at : p[sort] ?? 0
    return [...list].sort((a, b) => {
      const x = key(a), y = key(b)
      return (asc ? 1 : -1) * (typeof x === 'number' && typeof y === 'number' ? x - y : az.compare(String(x), String(y)))
    })
  }, [people, q, fn, sort, asc])

  const t = data?.totals
  // People on each tile, with the total under it (the user, 4 Nov): 15 people, 11 claims started by fewer of them.
  const by = data?.people_of ?? {}
  const tiles: Array<[string, number | undefined, 'brand' | 'default', string?]> = t ? [
    ['People using', t.people, 'brand'],
    ['Started a claim', by.started ?? 0, 'default', `${t.started} claims`.replace(/^1 claims$/, '1 claim')],
    ['Sent a claim', by.sent ?? 0, 'default', `${t.sent} claims`.replace(/^1 claims$/, '1 claim')],
    ['With manager', by.with_manager ?? 0, 'default', `${(t.with_manager ?? 0)} claims`.replace(/^1 claims$/, '1 claim')],
    ['With Travel Desk', by.with_desk ?? 0, 'default', `${(t.with_desk ?? 0)} claims`.replace(/^1 claims$/, '1 claim')],
    ['Travel Desk approved', by.desk ?? 0, 'default', `${(t.desk ?? 0)} claims`.replace(/^1 claims$/, '1 claim')],
    ['Took visit photos', by.photo ?? 0, 'default', `${t.photos} photos`.replace(/^1 photos$/, '1 photo')],
    ['Set home', by.home ?? 0, 'default', `${t.homes} times`],
    ['Advances', by.advance ?? 0, 'default', `${t.advances} asked`],
    ['Deputations', by.deputation ?? 0, 'default', `${t.deputations} asked`],
    ['Vehicle requests', by.vehicle ?? 0, 'default', `${t.vehicles} asked`],
  ] : []

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
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
            {tiles.map(([l, v, tone, sub]) => (
              <div key={l} className={clsx('rounded-lg border px-2.5 py-1.5', tone === 'brand' ? 'row-span-2 flex flex-col justify-center border-ink-200 bg-surface' : 'border-ink-200 bg-surface')}>
                <p className="truncate text-[11px] font-medium text-ink-500" title={l}>{l}</p>
                <p className={clsx('font-semibold leading-tight text-ink-900', tone === 'brand' ? 'text-3xl' : 'text-lg')}>{(v ?? 0).toLocaleString('en-IN')}{sub && <span className="ml-1.5 text-xs font-normal text-ink-500">{sub}</span>}</p>
              </div>
            ))}
          </div>

          {data.functions.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs">
                  <tr>
                    <th className="px-3 py-2 font-semibold text-ink-600">Function</th>
                    <th className="px-3 py-2 text-right font-semibold text-ink-600">People</th>
                    <th className="px-3 py-2 text-right font-semibold text-ink-600">Claims started</th>
                    <th className="px-3 py-2 text-right font-semibold text-ink-600">Claims sent</th>
                    <th className="px-3 py-2 text-right font-semibold text-ink-600">Visit photos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {data.functions.map(f => (
                    <tr key={f.function}>
                      <td className="px-3 py-2 font-medium">{f.function}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.people}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.started}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.sent}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.photos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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

          {!shown.length ? <div className="card p-8 text-center text-sm text-ink-500">Nobody yet.</div> : <>
            <div className="space-y-2 sm:hidden">
              {shown.map(p => (
                <div key={p.ecode} className="card px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate font-medium text-ink-900">{p.name} <span className="text-xs font-normal text-ink-500">{p.ecode}</span></p>
                    {p.new && <span className="badge shrink-0 bg-green-100 text-green-900">New</span>}
                  </div>
                  <p className="truncate text-xs text-ink-500">{p.function ?? '—'} · {p.manager ?? '—'}</p>
                  <p className="mt-1 text-xs text-ink-700">{p.started} started · {p.sent} sent · {p.with_manager ?? 0} with manager · {p.with_desk ?? 0} with Travel Desk · {p.desk ?? 0} Desk approved · {p.homes ?? 0} home · {p.skips ?? 0}{data.skip_limit != null ? ` / ${data.skip_limit}` : ''} photo not possible · last {when(p.last_at)}</p>
                </div>
              ))}
            </div>
            <div className="card hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs">
                  <tr>
                    <SortHeader label="Person" col="name" sortKey={sort} asc={asc} onSort={onSort} />
                    <SortHeader label="Function" col="function" sortKey={sort} asc={asc} onSort={onSort} />
                    <SortHeader label="Reporting manager" col="manager" sortKey={sort} asc={asc} onSort={onSort} />
                    <SortHeader label="Claims started" col="started" align="right" sortKey={sort} asc={asc} onSort={onSort} />
                    <SortHeader label="Claims sent" col="sent" align="right" sortKey={sort} asc={asc} onSort={onSort} />
                    <SortHeader label="With manager" col="with_manager" align="right" sortKey={sort} asc={asc} onSort={onSort} />
                    <SortHeader label="With Travel Desk" col="with_desk" align="right" sortKey={sort} asc={asc} onSort={onSort} />
                    <SortHeader label="Travel Desk approved" col="desk" align="right" sortKey={sort} asc={asc} onSort={onSort} />
                    <SortHeader label="Set home" col="homes" align="right" sortKey={sort} asc={asc} onSort={onSort} />
                    <SortHeader label="Photo not possible" col="skips" align="right" sortKey={sort} asc={asc} onSort={onSort} />
                    <SortHeader label="Last used" col="last" sortKey={sort} asc={asc} onSort={onSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {shown.map(p => (
                    <tr key={p.ecode}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-ink-900">{p.name}{p.new && <span className="badge ml-2 bg-green-100 text-green-900">New</span>}</p>
                        <p className="text-xs text-ink-500">{p.ecode}</p>
                      </td>
                      <td className="px-3 py-2">{p.function ?? '—'}</td>
                      <td className="px-3 py-2">{p.manager ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.started}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.sent}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.with_manager ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.with_desk ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.desk ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.homes ?? 0}</td>
                      <td className={clsx('px-3 py-2 text-right tabular-nums', data.skip_limit != null && (p.skips ?? 0) >= data.skip_limit && 'font-semibold text-cyrixRed-700')}>{p.skips ?? 0}{data.skip_limit != null && <span className="text-ink-400"> / {data.skip_limit}</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2">{when(p.last_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>}
        </>}
    </div>
  )
}
