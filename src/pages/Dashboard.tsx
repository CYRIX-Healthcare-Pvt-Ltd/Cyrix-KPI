import { useMemo, useState, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Users, Target, LineChart, BookOpen, ArrowRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMyAssignment, useSubmission, useAnnualSummary, useTeamMonth,
  usePendingApprovals, useWeakAreas, useKraAttainment, useKraBenchmark,
  useSubmissionHistory,
  currentFy,
} from '@/lib/queries'
import { currentReportingMonth, monthLabel, openFyMonthsFrom } from '@/lib/fy'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL } from '@/lib/sections'
import { hasSeenHelp, manualOffer } from '@/lib/seenHelp'
import { READY_LANGS } from '@/lib/i18n'
import { Alert, PageLoader, ScorePill, StatTile, StatusBadge } from '@/components/ui'
import {
  ScoreHeader, WeakAreas, KraBars, ActionRequired,
} from '@/components/analysis'

const SCORED = new Set(['scored', 'finalized'])

// This screen is not code-split — it is the first thing everyone loads —
// so the chart is, or recharts lands in the bundle a service engineer
// downloads on 4G just to sign in.
const ScoreTrend = lazy(() => import('@/components/ScoreTrend'))

const ChartFallback = () => (
  <div className="h-[200px] animate-pulse rounded-lg bg-ink-50" />
)

export default function Dashboard() {
  const { employee, isManager, isHrAdmin } = useAuth()
  const fy = currentFy()
  const month = currentReportingMonth()
  const myIds = useMemo(() => (employee ? [employee.id] : undefined), [employee])

  const { data: assignment, isLoading: aLoading } = useMyAssignment(employee?.id, fy)
  const { data: submission } = useSubmission(employee?.id, month)
  // The "new here" card no longer waits on this. It used to key off the
  // number of scored months, which meant waiting for the query and
  // flashing on for a moment for everybody; whether the manual has been
  // opened is known before the first render.
  const { data: annual } = useAnnualSummary(employee?.id, fy)
  const { data: history } = useSubmissionHistory(employee?.id, fy)
  const { data: weak } = useWeakAreas(myIds, fy)
  const { data: attainment } = useKraAttainment(myIds, fy)
  // Server-side: RLS will not let this client read a colleague's scores,
  // so the comparison has to be computed where they are readable and
  // come back as an average.
  const { data: benchmark } = useKraBenchmark(employee?.id, fy)
  const { data: teamData } = useTeamMonth(
    isManager || isHrAdmin ? employee?.id : undefined, month, fy,
  )
  const { data: approvals } = usePendingApprovals(
    isManager || isHrAdmin ? employee?.id : undefined, fy,
  )

  const startsFrom = assignment?.assignment?.starts_from ?? null

  // Read once per mount. Opening the manual is a navigation away from
  // here and back, so the card is gone the next time this screen loads.
  const [seenHelp] = useState(() => hasSeenHelp(employee?.id))
  // Named in their own scripts, and built from the list rather than
  // typed out, so adding a language cannot leave this sentence stale.
  const otherLangs = READY_LANGS
    .filter(l => l.code !== 'en')
    .map(l => l.label)
    .join(', ')

  // Only months that have finished: a trailing run of empty months makes
  // a three-point line look like a line that stopped. And only months
  // this KPI covers — a June joiner's line used to open with two gaps
  // that read as two months they had missed.
  const points = useMemo(
    () => {
      const byMonth = new Map(
        (history ?? []).filter(s => SCORED.has(s.status)).map(s => [s.period_month, s]),
      )
      return openFyMonthsFrom(fy, startsFrom)
        .map(m => ({ month: m, score: byMonth.get(m)?.final_total_score ?? null }))
    },
    [history, fy, startsFrom],
  )

  if (aLoading) return <PageLoader />

  const kpiStatus = assignment?.assignment?.status ?? null
  const sub = submission?.submission ?? null
  // Is the month being reported on one this KPI covers at all?
  const monthInScope = !startsFrom || month >= startsFrom
  /**
   * No working KPI yet — not written, waiting on a manager, or sent
   * back. Everything on this screen is empty in that state and none of
   * it explains itself, so the manual stays offered and stays loud until
   * there is something to be measured against. Not retired by having
   * read it once: somebody who skimmed it before their KPI existed is
   * exactly who needs it again now.
   */
  // Whether the manual is offered, and how hard. The rule and the reasons
  // it looks like that are in lib/seenHelp.ts, with tests.
  const offer = manualOffer({
    kpiActive: kpiStatus === 'active',
    monthsScored: annual?.months_scored ?? 0,
    hasRead: seenHelp,
  })
  const gettingStarted = offer === 'loud'

  const esmsWeight = Number(assignment?.assignment?.esms_weight ?? 0)
  const hasEsms = esmsWeight > 0
  const coreWeight = Number(
    assignment?.assignment?.core_values_weight ?? (REMAINDER_TOTAL - esmsWeight),
  )

  const awaitingMe = (teamData?.submissions ?? []).filter(s => s.status === 'submitted').length
  const notSubmitted = (teamData?.team.length ?? 0) -
    (teamData?.submissions.filter(s => s.status !== 'draft').length ?? 0)

  return (
    <div className="space-y-6">
      <ScoreHeader
        title={`Hello, ${employee?.full_name.split(' ')[0]}`}
        subtitle={`FY ${fy} · reporting on ${monthLabel(month)}`}
        score={annual?.avg_total_score}
        scoreLabel="My year average"
      />

      {kpiStatus === null && (
        <ActionRequired
          eyebrow="KPI Not Set Up"
          title="Your KPI for this year is not in place yet"
          body="Define your Job Role KRAs. Your manager approves them before monthly submissions can begin."
          to="/my-kpi/setup"
          cta="Set Up My KPI"
        />
      )}

      {kpiStatus === 'rejected' && (
        <ActionRequired
          eyebrow="Sent Back"
          title="Your manager returned your KPI"
          body={<span className="italic">“{assignment?.assignment?.rejection_reason}”</span>}
          to="/my-kpi/setup"
          cta="Make Changes"
        />
      )}

      {kpiStatus === 'pending_approval' && (
        <Alert kind="info" title="Your KPI is with your manager for approval">
          You will be able to submit monthly assessments once it is approved.
        </Alert>
      )}

      {sub?.status === 'returned' && (
        <ActionRequired
          eyebrow="Returned To You"
          title={`${monthLabel(month)} needs your attention`}
          body={<span className="italic">“{sub.return_reason}”</span>}
          to={`/submission/${month}`}
          cta="Review & Resubmit"
        />
      )}

      {/* Not before the KPI starts. Somebody joining in September was
          being told every month since April was overdue. */}
      {kpiStatus === 'active' && monthInScope && (!sub || sub.status === 'draft') && (
        <ActionRequired
          eyebrow="Assessment Due"
          title={`${monthLabel(month)} has not been submitted`}
          body="Enter what you achieved so your manager can score the month."
          to={`/submission/${month}`}
          cta={sub ? 'Continue' : 'Start Now'}
        />
      )}

      {/*
        No team panel here, deliberately.

        Everything above is this person's own — their KPI, their month,
        their overdue assessment — and a screen that mixes "you have not
        submitted August" with "somebody is waiting on you" makes the
        reader sort two kinds of obligation out of one stack of identical
        black panels. The team's queue belongs on the team's screen,
        which is one tap away and carries a count on the tab.
      */}

      {/* Under whatever is shouting, not instead of it.

          The profile page is where "what is this and what do I do" gets
          answered, and clicking your own name to find that out is not
          obvious to somebody who has just been given a login. So the
          offer comes to them, in the window where they need it, and
          leaves on its own the month their first score lands — no
          dismiss button, because "have you been scored yet" is a better
          test of whether somebody is still new than asking them. */}
      {offer !== 'none' && (
        <Link
          to="/help"
          className={clsx(
            'card card-interactive flex items-center gap-3 p-4',
            // Loud for as long as somebody has no working KPI. That is
            // the window where every question they have is answered on
            // that page and none of it is obvious from this screen — and
            // it is the one moment the quiet version was competing with a
            // black panel shouting SET UP MY KPI directly above it.
            gettingStarted && 'border-violet-300 bg-violet-50 sm:p-5',
          )}
        >
          <span className={clsx(
            'flex shrink-0 items-center justify-center rounded-full',
            gettingStarted ? 'h-10 w-10 bg-violet-100' : 'h-5 w-5',
          )}>
            <BookOpen className="h-5 w-5 text-violet-600" />
          </span>
          <span className="min-w-0 flex-1">
            <span className={clsx(
              'block font-medium',
              gettingStarted ? 'text-base text-violet-900' : 'text-sm text-ink-900',
            )}>
              {gettingStarted
                ? 'Not sure what any of this means? Read the manual first'
                : 'New here? See what you can do'}
            </span>
            <span className={clsx(
              'block text-sm',
              gettingStarted ? 'text-violet-800' : 'text-ink-500',
            )}>
              A short page about your own login — what to do each month, and
              when.
              {otherLangs && <> You can read it in {otherLangs} too.</>}
            </span>
          </span>
          <ArrowRight className={clsx(
            'h-4 w-4 shrink-0',
            gettingStarted ? 'text-violet-600' : 'text-ink-400',
          )} />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 grid-pairs lg:grid-cols-4">
        <StatTile
          label={`${monthLabel(month)} status`}
          value={monthInScope
            ? <StatusBadge status={sub?.status ?? null} />
            : <span className="text-sm text-ink-400">Not yours</span>}
          sub={monthInScope || !startsFrom
            ? undefined
            : `Your KPI starts in ${monthLabel(startsFrom)}`}
        />
        <StatTile
          label={`${monthLabel(month)} score`}
          value={<ScorePill value={sub?.final_total_score ?? sub?.self_total_score} size="lg" />}
          sub={sub?.final_total_score == null ? 'Self assessment only' : 'Final, out of 100'}
        />
        <StatTile
          label="Months scored"
          value={annual?.months_scored ?? 0}
          sub="of 12"
        />
        {/* One figure per band this person actually has. Read off the
            assignment, not off the scores, so the tile does not change
            shape the month a first ESMS score lands. */}
        <StatTile
          label={hasEsms ? 'Job role / ESMS / core' : 'Job role / core values'}
          value={
            <span className="text-base">
              {annual?.avg_job_role_score?.toFixed(1) ?? '—'}
              {hasEsms && (
                <>
                  <span className="text-ink-400"> / </span>
                  {annual?.avg_esms_score?.toFixed(1) ?? '—'}
                </>
              )}
              <span className="text-ink-400"> / </span>
              {annual?.avg_core_values_score?.toFixed(1) ?? '—'}
            </span>
          }
          sub={hasEsms
            ? `out of ${JOB_ROLE_TOTAL}, ${esmsWeight} and ${coreWeight}`
            : `out of ${JOB_ROLE_TOTAL} and ${coreWeight}`}
        />
      </div>

      {(kpiStatus === 'active' || (annual?.months_scored ?? 0) > 0) && (
        <div className="card p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-800">
            <LineChart className="h-4 w-4 text-ink-400" /> My score, month by month
          </h3>
          <p className="mb-3 text-xs text-ink-500">
            Final score for each finished month, on the band scale.
          </p>
          <Suspense fallback={<ChartFallback />}>
            <ScoreTrend
              points={points}
              emptyMessage="No months scored yet — the line starts with your first one."
            />
          </Suspense>
        </div>
      )}

      {/* ---- what to work on ---- */}
      {(annual?.months_scored ?? 0) > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-800">
              <Target className="h-4 w-4 text-cyrixRed-600" /> What to improve
            </h3>
            <p className="mb-3 text-xs text-ink-500">
              Areas below Good, anything heading down, and where others doing your job are ahead.
            </p>
            <WeakAreas
              areas={weak ?? []}
              attainment={attainment ?? []}
              benchmark={benchmark ?? []}
              emptyMessage="Every area is at Good or better — keep it up."
            />
          </div>

          <div className="card p-4">
            <h3 className="mb-1 text-sm font-semibold text-ink-800">
              My KRAs by attainment
            </h3>
            <p className="mb-4 text-xs text-ink-500">
              How much of each KRA's weightage you are earning on average.
            </p>
            <KraBars rows={attainment ?? []} />
          </div>
        </div>
      )}

      {/* No assessment or history cards here: the month is already the
          Action Required panel at the top, and History is a nav tab. A
          third route to the same place is noise, not navigation. */}

      {(isManager || isHrAdmin) && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-800">
            <Users className="h-4 w-4" /> My team
          </h2>
          <div className="grid grid-cols-2 gap-3 grid-pairs sm:grid-cols-3">
            <StatTile label="Team members" value={teamData?.team.length ?? 0} />
            <StatTile
              label="Awaiting my scoring"
              value={awaitingMe}
              sub={`for ${monthLabel(month)}`}
            />
            <StatTile label="KPIs to approve" value={approvals?.length ?? 0} />
          </div>

          {notSubmitted > 0 && (
            <p className="mt-2 text-xs text-ink-400">
              {notSubmitted} member{notSubmitted === 1 ? '' : 's'} have not submitted{' '}
              {monthLabel(month)} yet.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
