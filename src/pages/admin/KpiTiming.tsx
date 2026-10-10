import { useState, useEffect } from 'react'
import { Timer, Save, CalendarClock } from 'lucide-react'
import {
  useTatPolicy, useSaveTatPolicy, useMonthClose, useSetMonthClose,
  currentFy, type TatPolicy,
} from '@/lib/queries'
import { fyMonths, monthLabel, monthStart, isMonthOpen } from '@/lib/fy'
import { PageLoader, Alert, Spinner, StatTile } from '@/components/ui'

/** '2026-09-01' → '1 Oct': the day that month's clock starts. */
function firstOfNext(monthIso: string): string {
  const d = new Date(monthIso + 'T00:00:00')
  d.setMonth(d.getMonth() + 1)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

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
  const setClose = useSetMonthClose()

  const [tm, setTm] = useState('3')
  const [mgr, setMgr] = useState('5')
  const [from, setFrom] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    if (!policy) return
    setTm(String(policy.tm_grace_days))
    setMgr(String(policy.manager_grace_days))
    setFrom(policy.starts_from ?? '')
  }, [policy])

  // undefined = still loading, null = deliberately off.
  const closeDay = closingDay === undefined ? null : closingDay

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

  const dirty =
    !!policy && (
      tmDays !== policy.tm_grace_days ||
      mgrDays !== policy.manager_grace_days ||
      (from || null) !== policy.starts_from
    )

  const submit = async () => {
    setNotice(null); setFailed(null)
    const next: TatPolicy = {
      ...policy,
      tm_grace_days: tmDays,
      manager_grace_days: mgrDays,
      starts_from: from || null,
    }
    try {
      await save.mutateAsync(next)
      setNotice(
        `Saved. Team members submit until the ${tmDays} and managers score until the ${mgrDays} ` +
        'of the following month.',
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

        <div className="border-t border-ink-100 pt-5">
          <label className="label" htmlFor="from-month">
            <CalendarClock className="mr-1.5 inline h-3.5 w-3.5" />
            Start measuring from
          </label>
          <select
            id="from-month"
            className="input max-w-xs"
            value={from}
            onChange={e => setFrom(e.target.value)}
          >
            <option value="">Every month of the year</option>
            {/* Finished months and the one still running. The running
                month is the usual answer at go-live: in September 2026,
                508 of the 543 KPIs then active had been approved that
                month, so it was the first month most people could have
                sent in on time. The line below says what choosing it does
                until it ends. */}
            {fyMonths(fy).filter(m => m <= monthStart(new Date())).map(m => (
              <option key={m} value={m}>{monthLabel(m)} onwards</option>
            ))}
          </select>
          {from && !isMonthOpen(from) && (
            <p className="mt-2 text-xs text-amber-700">
              {monthLabel(from)} is still running, so nothing is measured until
              it ends. Until {firstOfNext(from)}, TAT and lateness stay blank on
              the HR report and on managers' profiles, and the team scoring
              rank runs on the team average band alone.
            </p>
          )}
          <p className="mt-2 text-xs text-ink-500">
            Months before this still count as owed and still count as scored —
            they simply have no clock on them. Completion&nbsp;% is unaffected:
            a month that was owed is owed whenever it was owed.
          </p>
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
          label="Counting from"
          value={
            <span className="text-base">
              {policy?.starts_from ? monthLabel(policy.starts_from) : 'Every month'}
            </span>
          }
          sub={policy?.starts_from ? 'earlier months have no clock' : 'nothing excluded'}
        />
      </div>

    </div>
  )
}
