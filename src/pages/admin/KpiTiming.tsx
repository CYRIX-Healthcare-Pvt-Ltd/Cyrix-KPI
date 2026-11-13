import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { findPeople } from '@/lib/findPeople'
import { Timer, Save, CalendarClock, Plus, X } from 'lucide-react'
import {
  useTatPolicy, useSaveTatPolicy, useMonthClose, useSetMonthClose,
  currentFy, type TatPolicy,
} from '@/lib/queries'
import { fyMonths, monthLabel, monthStart } from '@/lib/fy'
import { PageLoader, Alert, Spinner, StatTile } from '@/components/ui'
import Dialog from '@/components/Dialog'

/**
 * When turnaround starts counting, and how much of it is free.
 *
 * Two rules, both of which exist because a raw clock lies. Nobody is
 * expected to submit on the 1st, so counting from the 1st reports normal
 * work as lateness; and the system went live with months already
 * outstanding, so counting those measures the rollout rather than the
 * team.
 *
 * Deliberately SW Admin's rather than HR's. Both settings are about when
 * the software started watching, which is a rollout decision — HR reads
 * the numbers, and somebody who reads a number should not also be the one
 * who moves the line it is measured from.
 */
export default function KpiTiming() {
  const fy = currentFy()
  const { data: policy, isLoading, error } = useTatPolicy()
  const { data: closingDay } = useMonthClose()
  const save = useSaveTatPolicy()
  const qc = useQueryClient()
  const setClose = useSetMonthClose()

  const [tm, setTm] = useState('3')
  const [mgr, setMgr] = useState('5')
  const [notice, setNotice] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  /*
    No last days for these people (0293; the user, 13 Nov: HR, the directors — "add a field exclude option, so we can
    type ecode and save" ... "anyone i type the ecode there"): none on their own months, none to score as the manager.
  */
  type Person = { ecode: string; full_name: string }
  const [exempt, setExempt] = useState<Person[] | null>(null)
  const [savedExempt, setSavedExempt] = useState<string>('')
  const [code, setCode] = useState('')
  const [codeErr, setCodeErr] = useState<string | null>(null)
  useEffect(() => {
    void supabase.rpc('kpi_last_days_exempt_people').then(({ data }) => {
      const list = ((data ?? []) as Person[]).map(p => ({ ecode: p.ecode, full_name: p.full_name }))
      setExempt(list); setSavedExempt(list.map(p => p.ecode).sort().join(','))
    })
  }, [])
  // A name or an ecode, with suggestions as it is typed (the user, 13 Nov: "need to type name or ecode, need to show suggestions").
  type Match = Person & { designation: string | null; is_active: boolean }
  const [matches, setMatches] = useState<Match[]>([])
  useEffect(() => {
    if (code.trim().length < 2) { setMatches([]); return }
    let live = true
    const t = window.setTimeout(async () => {
      const found = await findPeople(code)
      if (live) setMatches(found as Match[])
    }, 250)
    return () => { live = false; window.clearTimeout(t) }
  }, [code])
  const pick = (m: Person) => {
    if (exempt?.some(p => p.ecode === m.ecode)) { setCodeErr(`${m.full_name} is added already`); return }
    setExempt(l => [...(l ?? []), { ecode: m.ecode, full_name: m.full_name }]); setCode(''); setMatches([]); setCodeErr(null)
  }
  const addCode = async () => {
    const c = code.trim()
    if (!c) { setCodeErr('Type a name or ecode'); return }
    const exact = matches.find(m => m.ecode.toUpperCase() === c.toUpperCase())
    if (exact) return pick(exact)
    if (matches.length === 1) return pick(matches[0])
    setCodeErr(matches.length ? 'Choose the person from the list' : `No one called ${c}`)
  }
  const exemptDirty = exempt !== null && exempt.map(p => p.ecode).sort().join(',') !== savedExempt

  useEffect(() => {
    if (!policy) return
    setTm(String(policy.tm_grace_days))
    setMgr(String(policy.manager_grace_days))
  }, [policy])

  // undefined = still loading, null = deliberately off.
  const closeDay = closingDay === undefined ? null : closingDay

  /*
    The last-day rules on or off (the user, 15 Oct). Off empties deadlines_from, which the database
    and every screen already read as "no last days": no zero for a month not sent in, no automatic
    scoring, no countdown banners, and Send back is always offered. The month they applied from is
    kept in deadlines_from_saved and comes back when they are switched on again.
  */
  const rulesOn = !!policy?.deadlines_from
  const toggleRules = async (on: boolean) => {
    if (!policy) return
    setNotice(null); setFailed(null)
    try {
      const { error } = await supabase.rpc('set_kpi_last_days', { p_on: on })
      if (error) throw new Error(error.message)
      await qc.invalidateQueries({ queryKey: ['tat_policy'] })
      setNotice(on
        ? 'Last days are on again: a month not sent in by the team member last day counts as zero, and one not scored by the manager last day takes the team member\'s own score.'
        : 'Last days are off: nothing is scored automatically, and managers can send any submitted month back.')
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Could not save that.')
    }
  }

  /*
    The first month the last days apply to (0272; the user, 10 Nov: "where is sept 26, shown?"). It was set once and shown
    nowhere. Moving it settles or reopens months, so the change is asked first, with what it would do counted.
  */
  const [ask, setAsk] = useState<{ month: string; zero: number; self: number; reopen: number } | null>(null)
  const [moving, setMoving] = useState(false)
  const pickFrom = async (month: string) => {
    if (!policy?.deadlines_from || month === policy.deadlines_from) return
    setNotice(null); setFailed(null)
    try {
      const { data, error } = await supabase.rpc('kpi_last_days_effect', { p_from: month })
      if (error) throw new Error(error.message)
      const e = (data ?? {}) as { zero?: number; self?: number; reopen?: number }
      setAsk({ month, zero: e.zero ?? 0, self: e.self ?? 0, reopen: e.reopen ?? 0 })
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Could not check that.')
    }
  }
  const moveFrom = async () => {
    if (!ask) return
    setMoving(true)
    try {
      const { error } = await supabase.rpc('set_kpi_last_days_from', { p_from: ask.month })
      if (error) throw new Error(error.message)
      await qc.invalidateQueries()
      setNotice(`Last days now apply from ${monthLabel(ask.month)}.`)
      setAsk(null)
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Could not save that.')
      setAsk(null)
    } finally { setMoving(false) }
  }

  const saveDay = async (day: number | null) => {
    setNotice(null); setFailed(null)
    try {
      await setClose.mutateAsync(day)
      setNotice(day === null
        ? 'No month will close on its own. Managers finalise each one.'
        : `Months now close on the ${day} of the following month.`)
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Could not save that.')
    }
  }

  if (isLoading) return <PageLoader label="Loading the timing rules…" />
  if (error) return <Alert kind="error">{(error as Error).message}</Alert>

  const tmDays = Number(tm)
  const mgrDays = Number(mgr)
  const valid =
    Number.isInteger(tmDays) && Number.isInteger(mgrDays) &&
    tmDays >= 1 && mgrDays >= 1 && tmDays <= 28 && mgrDays <= 28 &&
    mgrDays >= tmDays

  const daysDirty =
    !!policy && (
      tmDays !== policy.tm_grace_days ||
      mgrDays !== policy.manager_grace_days
    )
  const dirty = daysDirty || exemptDirty

  const submit = async () => {
    setNotice(null); setFailed(null)
    const next: TatPolicy = {
      ...policy,
      tm_grace_days: tmDays,
      manager_grace_days: mgrDays,
      // Measuring starts with the last days (the user, 12 Nov: "make start measuring from and last day same").
      starts_from: policy?.deadlines_from ?? policy?.starts_from ?? null,
    }
    try {
      if (daysDirty) await save.mutateAsync(next)
      if (exemptDirty) {
        const { error } = await supabase.rpc('set_kpi_last_days_exempt', { p_ecodes: exempt!.map(p => p.ecode) })
        if (error) throw new Error(error.message)
        setSavedExempt(exempt!.map(p => p.ecode).sort().join(','))
        await qc.invalidateQueries()
      }
      setNotice(
        `Saved. Team members submit until the ${tmDays} and managers score until the ${mgrDays} ` +
        `of the following month${exempt?.length ? `; no last days for ${exempt.map(p => p.full_name).join(', ')}` : ''}.`,
      )
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Could not save that.')
    }
  }

  return (
    <div className="space-y-5">
      <div>
        {/* h2, not h1: this is a tab inside Administration now, and that
            screen owns the page heading. */}
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
          <Timer className="h-5 w-5 text-cyrixRed-600" />
          KPI timing
        </h2>
        <p className="mt-0.5 text-sm text-ink-500">
          The last day to submit and to score each month, and when a month closes.
        </p>
      </div>

      {notice && <Alert kind="success">{notice}</Alert>}
      {failed && <Alert kind="error">{failed}</Alert>}

      <div className="card space-y-5 p-5">
        <label className="flex cursor-pointer items-center gap-3">
          <input type="checkbox" className="h-5 w-5 rounded border-ink-300" checked={rulesOn}
            disabled={save.isPending} onChange={e => void toggleRules(e.target.checked)} />
          <span className="font-medium text-ink-900">Last days {rulesOn ? 'on' : 'off'}</span>
        </label>
        {rulesOn && (
          <div>
            <label className="label" htmlFor="last-days-from">Last days apply from</label>
            <select id="last-days-from" className="input max-w-xs" value={policy?.deadlines_from ?? ''}
              onChange={e => void pickFrom(e.target.value)}>
              {/* The month in force is always listed, though it be of another year. */}
              {[...new Set([policy!.deadlines_from!, ...fyMonths(fy).filter(m => m <= monthStart(new Date()))])].sort().map(m => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="tm-days">
              Team member last day
            </label>
            <div className="flex items-baseline gap-2">
              <select id="tm-days" className="input w-28" value={tm} onChange={e => setTm(e.target.value)}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <span className="text-sm text-ink-500">of the following month, to submit</span>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="mgr-days">
              Manager last day
            </label>
            <div className="flex items-baseline gap-2">
              <select id="mgr-days" className="input w-28" value={mgr} onChange={e => setMgr(e.target.value)}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <span className="text-sm text-ink-500">of the following month, to score</span>
            </div>
          </div>
        </div>

        {rulesOn && (
          <div>
            <label className="label" htmlFor="exempt-code">No last days for</label>
            <div className="relative flex max-w-md gap-2">
              <input id="exempt-code" className="input flex-1" placeholder="Name or ecode" autoComplete="off" value={code}
                onChange={e => { setCode(e.target.value); setCodeErr(null) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addCode() } }} />
              <button type="button" className="btn-secondary" onClick={() => void addCode()}><Plus className="h-4 w-4" /> Add</button>
              {matches.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-xl border border-ink-200 bg-surface shadow-lg">
                  {matches.map(m => (
                    <li key={m.ecode}>
                      <button type="button" className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-ink-100" onClick={() => pick(m)}>
                        <span className="font-medium text-ink-900">{m.full_name}</span>
                        <span className="font-mono text-xs text-ink-500">{m.ecode}</span>
                        {!m.is_active && <span className="text-xs text-cyrixRed-600">left</span>}
                        {m.designation && <span className="ml-auto truncate text-xs text-ink-400">{m.designation}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {codeErr && <p className="mt-1.5 text-sm font-medium text-cyrixRed-600">{codeErr}</p>}
            {!!exempt?.length && (
              <div className="mt-3 flex flex-wrap gap-2">
                {exempt.map(p => (
                  <span key={p.ecode} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 py-1 pl-3 pr-1 text-sm font-medium text-violet-800 ring-1 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-500/30">
                    {p.full_name} ({p.ecode})
                    <button type="button" aria-label={`Remove ${p.ecode}`} className="rounded-md p-1 hover:bg-violet-100 dark:hover:bg-violet-500/25"
                      onClick={() => setExempt(l => (l ?? []).filter(x => x.ecode !== p.ecode))}><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {mgrDays < tmDays && (
          <Alert kind="warning">
            The manager's last day comes before the team member's. Choose the {tmDays} or later.
          </Alert>
        )}

        {/* The one date the whole company shares. Everything else on this
            screen is about measuring lateness; this one actually closes
            months, so it sits on its own above the rest. */}
        <div className="border-t border-ink-100 pt-5">
          <label className="label" htmlFor="closing-day">
            <CalendarClock className="mr-1.5 inline h-3.5 w-3.5" />
            Month closes on
          </label>
          <div className="flex flex-wrap items-baseline gap-2">
            <select
              id="closing-day"
              className="input w-48"
              value={closeDay ?? ''}
              onChange={e => saveDay(e.target.value === '' ? null : Number(e.target.value))}
              disabled={setClose.isPending}
            >
              <option value="">No closing date</option>
              {/* Stops at 28: a closing day of the 30th does not exist in
                  February, and a deadline that skips a month is not one. */}
              {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            {closeDay !== null && (
              <span className="text-sm text-ink-500">of the following month</span>
            )}
          </div>
          {closeDay === null ? (
            <p className="mt-2 text-xs text-ink-500">
              Nothing closes on its own. Managers finalise each month by hand,
              and a team member can query their scores for as long as it is
              open. <strong>This is what a backlog needs</strong> — an old month
              scored today would otherwise be past its date the moment it was
              scored, and final before anybody had read it. Set a day once the
              old months are done.
            </p>
          ) : (
            <p className="mt-2 text-xs text-ink-500">
              July's assessment closes at the end of {closeDay} August. Until
              then the team member can query their manager's scores; after it
              the month becomes <strong>Final</strong> on its own and nobody has
              to press anything. A month with an open query stays open until it
              is answered.
            </p>
          )}
        </div>


        <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-5">
          <button
            onClick={submit}
            disabled={!valid || !dirty || save.isPending}
            className="btn-primary"
          >
            {save.isPending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            Save policy
          </button>
          {!dirty && !save.isPending && (
            <span className="text-xs text-ink-400">Nothing to save.</span>
          )}
        </div>
      </div>

      {ask && (
        <Dialog title={`Last days from ${monthLabel(ask.month)}?`} icon={<CalendarClock className="h-5 w-5 text-cyrixRed-600" />} onClose={() => { if (!moving) setAsk(null) }}>
          <ul className="space-y-2 text-sm text-ink-800">
            {ask.zero > 0 && <li><strong className="text-cyrixRed-700">{ask.zero.toLocaleString('en-IN')}</strong> {ask.zero === 1 ? 'month' : 'months'} not sent in · becomes 0</li>}
            {ask.self > 0 && <li><strong className="text-cyrixRed-700">{ask.self.toLocaleString('en-IN')}</strong> {ask.self === 1 ? 'month' : 'months'} not scored · takes the team member's own score</li>}
            {ask.reopen > 0 && <li><strong>{ask.reopen.toLocaleString('en-IN')}</strong> settled {ask.reopen === 1 ? 'month opens' : 'months open'} again</li>}
            {ask.zero + ask.self + ask.reopen === 0 && <li>No month changes</li>}
          </ul>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" className="btn-secondary" disabled={moving} onClick={() => setAsk(null)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={moving} onClick={() => void moveFrom()}>
              {moving ? <Spinner className="h-4 w-4" /> : null} Yes, from {monthLabel(ask.month)}
            </button>
          </div>
        </Dialog>
      )}

      <div className="grid grid-cols-2 gap-3 grid-pairs sm:grid-cols-3">
        <StatTile
          label="Team member last day"
          value={policy?.tm_grace_days ?? '—'}
          sub="of the following month"
        />
        <StatTile
          label="Manager last day"
          value={policy?.manager_grace_days ?? '—'}
          sub="of the following month"
        />
        <StatTile
          label="Month closes on"
          value={closeDay}
          sub="of the following month"
        />
        <StatTile
          label="Last days from"
          value={<span className="text-base">{policy?.deadlines_from ? monthLabel(policy.deadlines_from) : 'Off'}</span>}
          sub={policy?.deadlines_from ? 'earlier months have no last day' : 'no last days'}
        />
      </div>

    </div>
  )
}
