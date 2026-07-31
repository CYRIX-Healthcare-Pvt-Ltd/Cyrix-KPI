import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardList, Users, AlertCircle, ArrowRight, CheckSquare, TrendingUp, Target,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMyAssignment, useSubmission, useAnnualSummary, useTeamMonth,
  usePendingApprovals, useWeakAreas, useKraAttainment, useSubmissionHistory,
  currentFy,
} from '@/lib/queries'
import { currentReportingMonth, monthLabel, fyMonths } from '@/lib/fy'
import { Alert, PageLoader, ScorePill, StatTile, StatusBadge } from '@/components/ui'
import { ScoreHeader, TrendChip, WeakAreas, KraBars } from '@/components/analysis'

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
        <Alert kind="warning" title="Your KPI for this year is not set up yet">
          <p>Define your Job Role KRAs to get started. Your manager approves them before
            monthly submissions can begin.</p>
          <Link to="/my-kpi/setup" className="btn-primary mt-3">
            Set up my KPI <ArrowRight className="h-4 w-4" />
          </Link>
        </Alert>
      )}

      {kpiStatus === 'rejected' && (
        <Alert kind="error" title="Your manager sent your KPI back">
          <p className="italic">“{assignment?.assignment?.rejection_reason}”</p>
          <Link to="/my-kpi/setup" className="btn-primary mt-3">
            Make changes <ArrowRight className="h-4 w-4" />
          </Link>
        </Alert>
      )}

      {kpiStatus === 'pending_approval' && (
        <Alert kind="info" title="Your KPI is with your manager for approval">
          You will be able to submit monthly assessments once it is approved.
        </Alert>
      )}

      {sub?.status === 'returned' && (
        <Alert kind="warning" title={`${monthLabel(month)} was returned to you`}>
          <p className="italic">“{sub.return_reason}”</p>
          <Link to={`/submission/${month}`} className="btn-primary mt-3">
            Review and resubmit <ArrowRight className="h-4 w-4" />
          </Link>
        </Alert>
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

      <div className="grid gap-3 sm:grid-cols-2">
        <ActionCard
          to={`/submission/${month}`}
          icon={ClipboardList}
          title={`${monthLabel(month)} assessment`}
          body={
            kpiStatus !== 'active'
              ? 'Available once your KPI is approved'
              : sub?.status === 'draft' || !sub
              ? 'Enter what you achieved this month'
              : 'View your submitted assessment'
          }
          disabled={kpiStatus !== 'active'}
        />
        <ActionCard
          to="/history"
          icon={TrendingUp}
          title="My history"
          body="Month-by-month scores across the year"
        />
      </div>

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

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <ActionCard
              to="/team"
              icon={Users}
              title="Score my team"
              body={
                awaitingMe > 0
                  ? `${awaitingMe} assessment(s) waiting for you`
                  : notSubmitted > 0
                  ? `${notSubmitted} member(s) have not submitted yet`
                  : 'Everyone is up to date'
              }
              highlight={awaitingMe > 0}
            />
            <ActionCard
              to="/approvals"
              icon={CheckSquare}
              title="KPI approvals"
              body={
                (approvals?.length ?? 0) > 0
                  ? `${approvals!.length} KPI(s) awaiting your approval`
                  : 'Nothing waiting'
              }
              highlight={(approvals?.length ?? 0) > 0}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function ActionCard({
  to, icon: Icon, title, body, disabled, highlight,
}: {
  to: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  body: string
  disabled?: boolean
  highlight?: boolean
}) {
  const inner = (
    <div className="flex items-start gap-3">
      <div className={`rounded-lg p-2 ${
        highlight ? 'bg-cyrixBlue-100 text-cyrixBlue-800' : 'bg-ink-100 text-ink-500'
      }`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink-900">{title}</p>
        <p className="mt-0.5 text-sm text-ink-500">{body}</p>
      </div>
      {!disabled && <ArrowRight className="h-4 w-4 shrink-0 text-ink-400" />}
    </div>
  )

  if (disabled) {
    return (
      <div className="card p-4 opacity-60">
        {inner}
        <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
          <AlertCircle className="h-3.5 w-3.5" /> Not available yet
        </p>
      </div>
    )
  }

  return (
    <Link
      to={to}
      className={`card p-4 transition-colors hover:border-cyrixBlue-300 hover:bg-cyrixBlue-50/40 ${
        highlight ? 'border-cyrixBlue-200' : ''
      }`}
    >
      {inner}
    </Link>
  )
}
