import { useState } from 'react'
import clsx from 'clsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, Wrench } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { Alert, Spinner } from '@/components/ui'

/*
  SW Admin → Platform: settings for the portal home (app.cyrix.in). The gold "Oct-26 Rank 1s" bar can be turned off and
  on (the user, 10 Nov: "if it becomes contreversial, i need to disbale it"); off, Cyrix Digest fills the row (0277).
  Asks before changing, the answer beside the button.
*/
export default function PlatformAdmin() {
  const qc = useQueryClient()
  const { data: on, isLoading } = useQuery({
    queryKey: ['platform', 'rank-ones-on'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('portal_rank_ones_on')
      if (error) throw new Error(friendlyError(error))
      return data !== false
    },
  })
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase.rpc('portal_set_rank_ones', { p_on: next })
      if (error) throw new Error(friendlyError(error))
      return next
    },
    onSuccess: next => {
      setAsking(false); setError(null)
      setDone(next ? 'Turned on. The Rank 1s bar shows on the portal home.' : 'Turned off. Cyrix Digest fills the row.')
      void qc.invalidateQueries({ queryKey: ['platform', 'rank-ones-on'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="space-y-4">
    <MaintenanceCard />
    <div className="card max-w-2xl overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <Crown className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-ink-800">Rank 1s bar on the portal home</h3>
      </div>
      <div className="space-y-3 p-4">
        {isLoading ? <Spinner className="h-4 w-4 text-ink-400" /> : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className={clsx('rounded-full px-3 py-1 text-sm font-semibold',
                on ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-600')}>
                {on ? 'On' : 'Off'}
              </span>
              {!asking && (
                <button type="button" className={on ? 'btn-secondary' : 'btn-primary'} onClick={() => { setAsking(true); setDone(null); setError(null) }}>
                  {on ? 'Turn off' : 'Turn on'}
                </button>
              )}
            </div>
            {asking && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-ink-900">
                  {on ? 'Turn off the Rank 1s bar for everybody?' : 'Turn on the Rank 1s bar for everybody?'}
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(!on)}>
                    {save.isPending ? <Spinner className="h-4 w-4" /> : on ? 'Yes, turn off' : 'Yes, turn on'}
                  </button>
                  <button type="button" className="btn-secondary" disabled={save.isPending} onClick={() => { setAsking(false); setError(null) }}>Cancel</button>
                </div>
              </div>
            )}
            {error && <Alert kind="error">{error}</Alert>}
            {done && <Alert kind="success">{done}</Alert>}
          </>
        )}
      </div>
    </div>
    </div>
  )
}

/*
  "Cyra is under maintenance" (0303, the user, 20 Nov): on now or From a date and time, To shown as "Back by", all apps
  or chosen ones; a notice bar before From, as long before as chosen here (0304); stays on until turned off here. Every app's lib/maintenance.ts
  draws the screen. SW Admin still gets in.
*/
const APPS: { code: string; name: string }[] = [
  { code: 'portal', name: 'Portal' }, { code: 'kpi', name: 'KPI' }, { code: 'travel', name: 'Travel' },
  { code: 'bemmp', name: 'BEMMP' }, { code: 'revive', name: 'Revive Lab' }, { code: 'tasks', name: 'My Task' }, { code: 'cyra', name: 'Cyra' },
]
type Maint = { on?: boolean; from?: string | null; to?: string | null; apps?: string[]; notice_min?: number; by?: string; at?: string }
const NOTICE: { min: number; label: string }[] = [
  { min: 15, label: '15 minutes' }, { min: 30, label: '30 minutes' }, { min: 60, label: '1 hour' },
  { min: 120, label: '2 hours' }, { min: 180, label: '3 hours' }, { min: 1440, label: '1 day' },
]
const noticeLabel = (min?: number) => NOTICE.find(n => n.min === (min ?? 15))?.label ?? `${min} minutes`
const shown = (iso?: string | null) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
  : ''

function MaintenanceCard() {
  const qc = useQueryClient()
  const { data: m, isLoading } = useQuery({
    queryKey: ['platform', 'maintenance'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('platform_maintenance')
      if (error) throw new Error(friendlyError(error))
      return (data ?? {}) as Maint
    },
  })
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [apps, setApps] = useState<string[]>([])
  const [notice, setNotice] = useState(15)
  const [asking, setAsking] = useState<'on' | 'off' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const on = !!m?.on
  const appNames = (list?: string[]) => !list?.length ? 'all apps' : APPS.filter(a => list.includes(a.code)).map(a => a.name).join(', ')
  const toggle = (code: string) => setApps(a => a.includes(code) ? a.filter(x => x !== code) : [...a, code])

  const save = useMutation({
    mutationFn: async (next: boolean) => {
      if (next && from && to && new Date(to) <= new Date(from)) throw new Error('To must be after From.')
      const { error } = await supabase.rpc('platform_set_maintenance', {
        p_on: next,
        p_from: next && from ? new Date(from).toISOString() : null,
        p_to: next && to ? new Date(to).toISOString() : null,
        p_apps: next ? apps : [],
        p_notice_min: next ? notice : 15,
      })
      if (error) throw new Error(friendlyError(error))
      return next
    },
    onSuccess: next => {
      setAsking(null); setError(null)
      setDone(next ? (from && new Date(from) > new Date() ? `Planned from ${shown(new Date(from).toISOString())}.` : 'Turned on.') : 'Turned off. The apps are open again.')
      if (!next) { setFrom(''); setTo(''); setApps([]); setNotice(15) }
      void qc.invalidateQueries({ queryKey: ['platform', 'maintenance'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const planned = on && !!m?.from && new Date(m.from) > new Date()
  const chip = (active: boolean) => clsx('rounded-lg border px-3 py-1.5 text-sm',
    active ? 'border-brand-300 bg-brand-50 font-semibold text-brand-700' : 'border-ink-200 text-ink-700')
  return (
    <div className="card max-w-2xl overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <Wrench className="h-4 w-4 text-brand-600" />
        <h3 className="text-sm font-semibold text-ink-800">Maintenance</h3>
      </div>
      <div className="space-y-3 p-4">
        {isLoading ? <Spinner className="h-4 w-4 text-ink-400" /> : on ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={clsx('rounded-full px-3 py-1 text-sm font-semibold', planned ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700')}>
                {planned ? 'Planned' : 'On'}
              </span>
              <span className="text-sm text-ink-700">{m?.apps?.length ? appNames(m.apps) : "All apps"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-ink-200 p-3 text-sm">
              <div><p className="text-xs text-ink-500">From</p><p className="font-medium text-ink-900">{m?.from ? shown(m.from) : 'Now'}</p></div>
              <div><p className="text-xs text-ink-500">To</p><p className="font-medium text-ink-900">{m?.to ? shown(m.to) : '—'}</p></div>
              {m?.from && <div><p className="text-xs text-ink-500">Notice before</p><p className="font-medium text-ink-900">{noticeLabel(m.notice_min)}</p></div>}
              {m?.by && <div className="col-span-2"><p className="text-xs text-ink-500">By</p><p className="text-ink-800">{m.by}</p></div>}
            </div>
            {asking !== 'off' && (
              <button type="button" className="btn-primary" onClick={() => { setAsking('off'); setDone(null); setError(null) }}>Turn off</button>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="block min-w-0">
                <span className="text-xs font-medium text-ink-600">From</span>
                <input type="datetime-local" className="input mt-1 w-full" value={from} onChange={e => setFrom(e.target.value)} />
              </label>
              <label className="block min-w-0">
                <span className="text-xs font-medium text-ink-600">To</span>
                <input type="datetime-local" className="input mt-1 w-full" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
              </label>
            </div>
            {from && (
              <label className="block">
                <span className="text-xs font-medium text-ink-600">Notice before</span>
                <select className="input mt-1 w-full" value={notice} onChange={e => setNotice(Number(e.target.value))}>
                  {NOTICE.map(n => <option key={n.min} value={n.min}>{n.label}</option>)}
                </select>
              </label>
            )}
            <div>
              <span className="text-xs font-medium text-ink-600">Apps</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setApps([])} className={chip(!apps.length)}>All</button>
                {APPS.map(a => (
                  <button key={a.code} type="button" onClick={() => toggle(a.code)} className={chip(apps.includes(a.code))}>{a.name}</button>
                ))}
              </div>
            </div>
            {asking !== 'on' && (
              <button type="button" className="btn-primary" onClick={() => { setAsking('on'); setDone(null); setError(null) }}>Turn on</button>
            )}
          </>
        )}
        {asking && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-ink-900">
              {asking === 'off'
                ? `Turn off maintenance for ${appNames(m?.apps)}?`
                : `Turn on maintenance for ${appNames(apps)}${from ? ` from ${shown(new Date(from).toISOString())}` : ' now'}?`}
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(asking === 'on')}>
                {save.isPending ? <Spinner className="h-4 w-4" /> : asking === 'on' ? 'Yes, turn on' : 'Yes, turn off'}
              </button>
              <button type="button" className="btn-secondary" disabled={save.isPending} onClick={() => { setAsking(null); setError(null) }}>Cancel</button>
            </div>
          </div>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        {done && <Alert kind="success">{done}</Alert>}
      </div>
    </div>
  )
}
