import { useMemo, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { Users, Target, LineChart, BookOpen, ArrowRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMyAssignment, useSubmission, useAnnualSummary, useTeamMonth,
  usePendingApprovals, useWeakAreas, useKraAttainment, useSubmissionHistory,
  currentFy,
} from '@/lib/queries'
import { currentReportingMonth, monthLabel, fyMonths, isMonthOpen } from '@/lib/fy'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL } from '@/lib/sections'
import { Alert, PageLoader, ScorePill, StatTile, StatusBadge } from '@/components/ui'
import {
  ScoreHeader, TrendChip, WeakAreas, KraBars, ActionRequired,
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
  // isSuccess, not just the data: without it the "new here" line below
  // flashes on for every returning person in the moment before their
  // year average lands.
  const { data: annual, isSuccess: annualLoaded } = useAnnualSummary(employee?.id, fy)
  const { data: history } = useSubmissionHistory(employee?.id, fy)
  const { data: weak } = useWeakAreas(myIds, fy)
  const { data: attainment } = useKraAttainment(myIds, fy)
  const { data: teamData } = useTeamMonth(
    isManager || isHrAdmin ? employee?.id : undefined, month, fy,
  )
  const { data: approvals } = usePendingApprovals(
    isManager || isHrAdmin ? employee?.id : undefined, fy,
  )

  // Only months that have finished: a trailing run of empty months makes
  // a three-point line look like a line that stopped.
  const points = useMemo(() => {
    const byMonth = new Map(
      (history ?? []).filter(s => SCORED.has(s.status)).map(s => [s.period_month, s]),
    )
    return fyMonths(fy)
      .filter(m => isMonthOpen(m))
      .map(m => ({ month: m, score: byMonth.get(m)?.final_total_score ?? null }))
  }, [history, fy])

  const series = useMemo(() => points.map(p => p.score), [points])

  if (aLoading) return <PageLoader />

  const kpiStatus = assignment?.assignment?.status ?? null
  const sub = submission?.submission ?? null

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
      >
        {annual?.avg_total_score !== null && annual?.avg_total_score !== undefined && (
          <TrendChip scores={series} />
        )}
      </ScoreHeader>

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

      {kpiStatus === 'active' && (!sub || sub.status === 'draft') && (
        <ActionRequired
          eyebrow="Assessment Due"
          title={`${monthLabel(month)} has not been submitted`}
          body="Enter what you achieved so your manager can score the month."
          to={`/submission/${month}`}
          cta={sub ? 'Continue' : 'Start Now'}
        />
      )}

      {/* Under whatever is shouting, not instead of it.

          The profile page is where "what is this and what do I do" gets
          answered, and clicking your own name to find that out is not
          obvious to somebody who has just been given a login. So the
          offer comes to them, in the window where they need it, and
          leaves on its own the month their first score lands — no
          dismiss button, because "have you been scored yet" is a better
          test of whether somebody is still new than asking them. */}
      {annualLoaded && (annual?.months_scored ?? 0) === 0 && (
        <Link to="/help" className="card card-interactive flex items-center gap-3 p-4">
          <BookOpen className="h-5 w-5 shrink-0 text-ink-400" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink-900">
              New here? See what you can do
            </span>
            <span className="block text-sm text-ink-500">
              A short page about your own login — what to do each month, and when.
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-ink-400" />
        </Link>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={`${monthLabel(month)} status`}
          value={<StatusBadge status={sub?.status ?? null} />}
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
              Areas averaging below Good against their own weightage.
            </p>
            <WeakAreas
              areas={weak ?? []}
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
          <div className="grid gap-3 sm:grid-cols-3">
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
