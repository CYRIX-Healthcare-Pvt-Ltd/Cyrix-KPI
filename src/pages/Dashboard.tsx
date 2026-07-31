import { Link } from 'react-router-dom'
import {
  ClipboardList, Users, AlertCircle, ArrowRight, CheckSquare, TrendingUp,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMyAssignment, useSubmission, useAnnualSummary, useTeamMonth,
  usePendingApprovals, currentFy,
} from '@/lib/queries'
import { currentReportingMonth, monthLabel } from '@/lib/fy'
import { Alert, PageLoader, ScorePill, StatTile, StatusBadge } from '@/components/ui'

export default function Dashboard() {
  const { employee, isManager, isHrAdmin } = useAuth()
  const fy = currentFy()
  const month = currentReportingMonth()

  const { data: assignment, isLoading: aLoading } = useMyAssignment(employee?.id, fy)
  const { data: submission } = useSubmission(employee?.id, month)
  const { data: annual } = useAnnualSummary(employee?.id, fy)
  const { data: teamData } = useTeamMonth(
    isManager || isHrAdmin ? employee?.id : undefined, month, fy,
  )
  const { data: approvals } = usePendingApprovals(
    isManager || isHrAdmin ? employee?.id : undefined, fy,
  )

  if (aLoading) return <PageLoader />

  const kpiStatus = assignment?.assignment?.status ?? null
  const sub = submission?.submission ?? null

  const awaitingMe = (teamData?.submissions ?? []).filter(
    s => s.status === 'submitted' || s.status === 'scored',
  ).length
  const notSubmitted = (teamData?.team.length ?? 0) -
    (teamData?.submissions.filter(s => s.status !== 'draft').length ?? 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Hello, {employee?.full_name.split(' ')[0]}
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">
          FY {fy} · reporting on {monthLabel(month)}
        </p>
      </div>

      {/* ---- things that need action ---- */}
      {kpiStatus === null && (
        <Alert kind="warning" title="Your KPI for this year is not set up yet">
          <p>Upload your KPI template to get started. Your manager approves it before
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

      {/* ---- my numbers ---- */}
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
          label={`FY ${fy} average`}
          value={<ScorePill value={annual?.avg_total_score} size="lg" />}
          sub={`${annual?.months_scored ?? 0} month(s) scored`}
          tone="brand"
        />
        <StatTile
          label="Job role / core values"
          value={
            <span className="text-base">
              {annual?.avg_job_role_score?.toFixed(1) ?? '—'}
              <span className="text-slate-400"> / </span>
              {annual?.avg_core_values_score?.toFixed(1) ?? '—'}
            </span>
          }
          sub="out of 80 and 20"
        />
      </div>

      {/* ---- quick actions ---- */}
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

      {/* ---- manager block ---- */}
      {(isManager || isHrAdmin) && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Users className="h-4 w-4" /> My team
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Team members" value={teamData?.team.length ?? 0} />
            <StatTile
              label="Awaiting my scoring"
              value={awaitingMe}
              sub={`for ${monthLabel(month)}`}
            />
            <StatTile
              label="KPIs to approve"
              value={approvals?.length ?? 0}
            />
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
    <>
      <div className="flex items-start gap-3">
        <div className={`rounded-lg p-2 ${highlight ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{title}</p>
          <p className="mt-0.5 text-sm text-slate-500">{body}</p>
        </div>
        {!disabled && <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />}
      </div>
    </>
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
      className={`card p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/40 ${
        highlight ? 'border-brand-200' : ''
      }`}
    >
      {inner}
    </Link>
  )
}
