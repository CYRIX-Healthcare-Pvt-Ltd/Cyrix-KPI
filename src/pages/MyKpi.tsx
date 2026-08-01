import { Link } from 'react-router-dom'
import { Pencil, FileSpreadsheet } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useMyAssignment, useScoringRules, currentFy } from '@/lib/queries'
import { Alert, PageLoader, StatusBadge, EmptyState } from '@/components/ui'
import type { Section } from '@/types/db'

export default function MyKpi() {
  const { employee } = useAuth()
  const fy = currentFy()
  const { data, isLoading } = useMyAssignment(employee?.id, fy)
  const { data: rules } = useScoringRules()

  if (isLoading) return <PageLoader />

  const assignment = data?.assignment ?? null
  const items = data?.items ?? []
  const canEdit = !assignment || assignment.status === 'draft' || assignment.status === 'rejected'

  if (!assignment) {
    return (
      <EmptyState icon={FileSpreadsheet} title="No KPI set up for this year">
        <p>Upload your KPI template, or start from your job role's standard one.</p>
        <Link to="/my-kpi/setup" className="btn-primary mt-4">Set up my KPI</Link>
      </EmptyState>
    )
  }

  const sectionTotal = (s: Section) =>
    items.filter(i => i.section === s).reduce((a, b) => a + b.weightage, 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">My KPI</h1>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-sm text-ink-500">FY {fy}</span>
            <StatusBadge status={assignment.status} kind="assignment" />
          </div>
        </div>
        {canEdit && (
          <Link to="/my-kpi/setup" className="btn-secondary">
            <Pencil className="h-4 w-4" /> Edit
          </Link>
        )}
      </div>

      {assignment.status === 'rejected' && (
        <Alert kind="error" title="Sent back by your manager">
          <p className="italic">“{assignment.rejection_reason}”</p>
        </Alert>
      )}
      {assignment.status === 'pending_approval' && (
        <Alert kind="info" title="Waiting for your manager to approve">
          You cannot start monthly assessments until this is approved.
        </Alert>
      )}
      {assignment.status === 'active' && (
        <Alert kind="success" title="Approved">
          This is locked for FY {fy}. Contact HR if something genuinely needs to change.
        </Alert>
      )}

      {(['job_role', 'core_values'] as Section[]).map(section => (
        <div key={section} className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-ink-800">
              {section === 'job_role' ? 'Job Role' : 'Alignment To Core Values'}
              <span className="font-normal text-ink-500">
                {' '}— {section === 'job_role' ? 80 : 20}%
              </span>
            </h3>
            <span className="badge bg-ink-100 text-ink-600">
              {sectionTotal(section)}%
            </span>
          </div>

          <div className="divide-y divide-ink-100">
            {items.filter(i => i.section === section).map(item => (
              <div key={item.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink-900">{item.kra}</p>
                    {item.kpi_description && (
                      <p className="mt-0.5 text-sm text-ink-500">{item.kpi_description}</p>
                    )}
                  </div>
                  {/* No target shown here: this is the year's contract, and
                      the target is set per month on the assessment itself. */}
                  <span className="badge shrink-0 bg-ink-100 text-ink-900">
                    {item.weightage}%
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink-400">
                  {rules?.find(r => r.code === item.scoring_rule)?.label ?? item.scoring_rule}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
