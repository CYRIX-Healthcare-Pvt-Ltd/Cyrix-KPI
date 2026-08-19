import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CalendarClock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useMyAssignment, useSetKpiStart, currentFy } from '@/lib/queries'
import { defaultStartMonth, fyMonths, monthLabel } from '@/lib/fy'
import { Alert, Spinner } from '@/components/ui'
import { StartMonthSelect } from './StartMonth'
import { needsStartMonth } from '@/lib/startMonth'

/**
 * The one question every existing KPI is missing.
 *
 * Start months arrived after everybody already had a KPI, so there is a
 * population of people whose record says April and whose April never
 * happened. Nobody would go looking for a new field to fill in, so the
 * question comes to them once, on the next screen they open, and does
 * not take no for an answer — there is no dismiss and no backdrop click,
 * because a dismissed prompt is an unanswered one and the wrong months
 * keep being counted.
 *
 * It asks nothing of people setting up a new KPI: that flow collects the
 * answer itself, so by the time an assignment exists it already has one.
 */
export default function StartMonthPrompt() {
  const { employee } = useAuth()
  const fy = currentFy()
  const { pathname } = useLocation()
  const { data } = useMyAssignment(employee?.id, fy)
  const setStart = useSetKpiStart()
  const [month, setMonth] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const assignment = data?.assignment ?? null
  if (!assignment || !needsStartMonth(assignment, pathname)) return null

  const chosen = month ?? defaultStartMonth(fy, employee?.date_of_joining)
  const skipped = Math.max(0, fyMonths(fy).indexOf(chosen))

  const save = async () => {
    setError(null)
    try {
      await setStart.mutateAsync({ assignmentId: assignment.id, month: chosen })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-month-title"
    >
      <div className="animate-pop-in max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <CalendarClock className="h-5 w-5 text-amber-700" />
          </span>
          <div className="min-w-0">
            <h2 id="start-month-title" className="text-lg font-semibold text-ink-900">
              One quick question
            </h2>
            <p className="mt-1 text-sm text-ink-600">
              Which month does your KPI start from? Until you say, every
              month of FY {fy} is counted as yours — including any before
              you joined.
            </p>
          </div>
        </div>

        {error && <div className="mt-4"><Alert kind="error">{error}</Alert></div>}

        <div className="mt-5">
          <label htmlFor="start-month-answer" className="label">
            My KPI starts from
          </label>
          <StartMonthSelect
            id="start-month-answer"
            fy={fy}
            value={chosen}
            onChange={setMonth}
          />
          <p className="mt-2 text-sm text-ink-500">
            {skipped === 0
              ? `You are assessed on all twelve months of FY ${fy}.`
              : `${monthLabel(fyMonths(fy)[0])} to ` +
                `${monthLabel(fyMonths(fy)[skipped - 1])} will not be asked ` +
                `for — ${skipped} month${skipped === 1 ? '' : 's'}.`}
          </p>
        </div>

        <button
          onClick={save}
          disabled={setStart.isPending}
          className="btn-primary mt-5 w-full justify-center"
        >
          {setStart.isPending && <Spinner className="h-4 w-4" />}
          Save and continue
        </button>

        <p className="mt-3 text-xs text-ink-400">
          Your manager can correct this later if it is wrong. Months you
          have already been assessed on are never hidden.
        </p>
      </div>
    </div>
  )
}
