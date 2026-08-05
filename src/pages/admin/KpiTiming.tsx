import { useState, useEffect } from 'react'
import { Timer, Info, Save, CalendarClock } from 'lucide-react'
import {
  useTatPolicy, useSaveTatPolicy, currentFy, type TatPolicy,
} from '@/lib/queries'
import { fyMonths, monthLabel, isMonthOpen } from '@/lib/fy'
import { PageLoader, Alert, Spinner, StatTile } from '@/components/ui'

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
  const save = useSaveTatPolicy()

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

  if (isLoading) return <PageLoader label="Loading the turnaround policy…" />
  if (error) return <Alert kind="error">{(error as Error).message}</Alert>

  const tmDays = Number(tm)
  const mgrDays = Number(mgr)
  const valid =
    Number.isInteger(tmDays) && Number.isInteger(mgrDays) &&
    tmDays >= 0 && mgrDays >= 0 && tmDays <= 60 && mgrDays <= 60 &&
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
      tm_grace_days: tmDays,
      manager_grace_days: mgrDays,
      starts_from: from || null,
    }
    try {
      await save.mutateAsync(next)
      setNotice(
        `Saved. Team members get ${tmDays} day${tmDays === 1 ? '' : 's'}, managers ` +
        `get ${mgrDays}, and turnaround is measured ` +
        (next.starts_from
          ? `from ${monthLabel(next.starts_from)} onwards.`
          : 'on every month of the year.'),
      )
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Could not save that.')
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900">
          <Timer className="h-5 w-5 text-cyrixRed-600" />
          KPI timing
        </h1>
        <p className="mt-0.5 text-sm text-ink-500">
          How long each side gets before a month counts as late, and which
          month the clock starts on.
        </p>
      </div>

      <div className="flex gap-3 rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <div className="text-ink-600">
          <p className="font-medium text-ink-900">
            Both clocks start when the month ends
          </p>
          <p className="mt-1">
            July's assessment becomes due on 1 August. A team member with a{' '}
            {tmDays}-day allowance who takes {tmDays + 1} days is{' '}
            <strong>1 day late</strong>; one who takes {Math.max(0, tmDays - 1)}{' '}
            is on time, not early — finishing inside the allowance earns nothing
            to spend next month.
          </p>
          <p className="mt-1.5">
            The manager's allowance runs from the same 1 August, not from the
            moment the work arrives, so it cannot be shorter than the team
            member's.
          </p>
        </div>
      </div>

      {notice && <Alert kind="success">{notice}</Alert>}
      {failed && <Alert kind="error">{failed}</Alert>}

      <div className="card space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="tm-days">
              Team member cool-off
            </label>
            <div className="flex items-baseline gap-2">
              <input
                id="tm-days"
                type="number" inputMode="numeric" min={0} max={60} step={1}
                className="input w-28"
                value={tm}
                onChange={e => setTm(e.target.value)}
              />
              <span className="text-sm text-ink-500">days to submit</span>
            </div>
            <p className="mt-1.5 text-xs text-ink-500">
              Counted against Submit TAT — how slow the team is.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="mgr-days">
              Manager cool-off
            </label>
            <div className="flex items-baseline gap-2">
              <input
                id="mgr-days"
                type="number" inputMode="numeric" min={0} max={60} step={1}
                className="input w-28"
                value={mgr}
                onChange={e => setMgr(e.target.value)}
              />
              <span className="text-sm text-ink-500">days to score</span>
            </div>
            <p className="mt-1.5 text-xs text-ink-500">
              Counted against Completion TAT and against anything still pending.
            </p>
          </div>
        </div>

        {mgrDays < tmDays && (
          <Alert kind="warning">
            The manager's allowance ends before the team member's, so a manager
            would be late before the work could reach them. Give managers at
            least {tmDays} days.
          </Alert>
        )}

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
            {/* Only months that have finished. Choosing a month nobody
                could have submitted yet reads as a setting that did
                nothing. */}
            {fyMonths(fy).filter(m => isMonthOpen(m)).map(m => (
              <option key={m} value={m}>{monthLabel(m)} onwards</option>
            ))}
          </select>
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

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Team member allowance"
          value={policy?.tm_grace_days ?? '—'}
          sub="days after the month ends"
        />
        <StatTile
          label="Manager allowance"
          value={policy?.manager_grace_days ?? '—'}
          sub="days after the month ends"
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

      <p className="text-xs text-ink-400">
        This is one setting for the whole company. It changes what the HR
        report and every manager's profile call late — not any score, and not
        who owes what.
      </p>
    </div>
  )
}
