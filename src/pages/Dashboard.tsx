import { useMemo } from 'react'
import { Users, Target } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMyAssignment, useSubmission, useAnnualSummary, useTeamMonth,
  usePendingApprovals, useWeakAreas, useKraAttainment, useSubmissionHistory,
  currentFy,
} from '@/lib/queries'
import { currentReportingMonth, monthLabel, fyMonths } from '@/lib/fy'
import { Alert, PageLoader, ScorePill, StatTile, StatusBadge } from '@/components/ui'
import {
  ScoreHeader, TrendChip, WeakAreas, KraBars, ActionRequired,
} from '@/components/analysis'

const SCORED = new Set(['scored', 'finalized'])

export default function Dashboard() {
  const { employee, isManager, isHrAdmin } = useAuth()
  const fy = currentFy()
  const month = currentReportingMonth()
  const myIds = useMemo(() => (employee ? [employee.id] : undefined), [employee])

  const { data: assignment, isLoading: aLoading } = useMyAssignment(employee?.id, fy)
  const { data: submission } = useSubmission(employee?.id, month)
  const { data: annual } = useAnnualSummary(employee?.id, fy)
  const { data: history } = useSubmissionHistory(employee?.id, fy)
  const { data: weak } = useWeakAreas(myIds, fy)
  const { data: attainment } = useKraAttainment(myIds, fy)
  const { data: teamData } = useTeamMonth(
    isManager || isHrAdmin ? employee?.id : undefined, month, fy,
  )
  const { data: approvals } = usePendingApprovals(
    isManager || isHrAdmin ? employee?.id : undefined, fy,
  )

  const series = useMemo(() => {
    const byMonth = new Map(
      (history ?? []).filter(s => SCORED.has(s.status)).map(s => [s.period_month, s]),
    )
    return fyMonths(fy).map(m => byMonth.get(m)?.final_total_score ?? null)
  }, [history, fy])

  if (aLoading) return <PageLoader />

  const kpiStatus = assignment?.assignment?.status ?? null
  const sub = submission?.submission ?? null

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
        <StatTile
          label="Job role / core values"
          value={
            <span className="text-base">
              {annual?.avg_job_role_score?.toFixed(1) ?? '—'}
              <span className="text-ink-400"> / </span>
              {annual?.avg_core_values_score?.toFixed(1) ?? '—'}
            </span>
          }
          sub="out of 80 and 20"
        />
      </div>

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
