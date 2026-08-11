import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, FileSpreadsheet, PencilRuler, Shuffle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMyAssignment, useScoringRules, useOpenRequestFor, useRequestAction, currentFy,
} from '@/lib/queries'
import {
  Alert, PageLoader, StatusBadge, EmptyState, Spinner,
} from '@/components/ui'
import { sectionsOf } from '@/lib/sections'
import { StartMonthBanner } from '@/components/StartMonth'
import type { Section } from '@/types/db'

export default function MyKpi() {
  const { employee } = useAuth()
  const fy = currentFy()
  const { data, isLoading } = useMyAssignment(employee?.id, fy)
  const { data: rules } = useScoringRules()

  const assignmentId = data?.assignment?.id
  const { data: openRevision } = useOpenRequestFor('revision', assignmentId)

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
        <>
          <Alert kind="success" title="Approved">
            This is locked for FY {fy} — it is the agreed basis for every month's
            scoring.
          </Alert>
          <ReviseKpi
            assignmentId={assignment.id}
            fy={fy}
            open={openRevision?.status ?? null}
          />
        </>
      )}

      {/* Above the rows, because it decides which months the rows are
          ever asked about. Read-only here: the manager owns this, and a
          team member quietly moving their own start month would be
          moving the months they are measured on. */}
      <StartMonthBanner fy={fy} startsFrom={assignment.starts_from} />

      {/* The bands this person actually has. ESMS is absent for anyone
          who does not carry it, rather than shown as an empty 0%. */}
      {sectionsOf(assignment).map(({ key: section, label, weight }) => (

        <div key={section} className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-ink-800">
              {label}
              <span className="font-normal text-ink-500">{' '}— {weight}%</span>
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

                {/* The other things this row can be. Indented under it and
                    marked "or", because the weightage is shared — three
                    entries at 20% that all read as separate rows would
                    look like a KPI totalling more than 100. */}
                {(item.alternates ?? []).length > 0 && (
                  <div className="mt-3 space-y-2 border-l-2 border-ink-200 pl-3">
                    <p className="text-xs text-ink-500">
                      Some months this row measures something else instead. Same{' '}
                      {item.weightage}% either way — you pick which one when you
                      fill the month in.
                    </p>
                    {item.alternates.map(alt => (
                      <div key={alt.id} className="flex flex-wrap items-baseline gap-2">
                        <span className="badge bg-ink-100 text-ink-600">
                          <Shuffle className="mr-1 h-3 w-3" /> or
                        </span>
                        <span className="text-sm font-medium text-ink-800">
                          {alt.kra || '—'}
                        </span>
                        {alt.kpi_description && (
                          <span className="text-sm text-ink-500">
                            · {alt.kpi_description}
                          </span>
                        )}
                        {alt.target_value !== null && (
                          <span className="text-xs text-ink-400">
                            target {alt.target_value}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * A KPI is locked once the manager approves it, which is right — it is the
 * contract the year is scored against. It is wrong in exactly one case:
 * somebody changes job role in September and is now being measured on work
 * they no longer do.
 *
 * So the same two gates as a deletion. The reporting manager knows whether
 * the change is genuine and HR owns the appraisal record, and unlocking a
 * signed-off KPI should not be within the gift of either alone.
 */
function ReviseKpi({
  assignmentId, fy, open,
}: {
  assignmentId: string
  fy: string
  open: string | null
}) {
  const request = useRequestAction()
  const [showForm, setShowForm] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  if (open) {
    return (
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <PencilRuler className="h-5 w-5 shrink-0 text-ink-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-900">Revision already requested</p>
          <p className="mt-0.5 text-sm text-ink-500">
            {open === 'pending_manager'
              ? 'Waiting for your manager to review it. HR decides after them.'
              : 'Your manager approved it. Waiting on HR to unlock the KPI.'}
          </p>
        </div>
        <span className="badge bg-amber-100 text-amber-800">
          {open === 'pending_manager' ? 'With manager' : 'With HR'}
        </span>
      </div>
    )
  }

  if (sent) {
    return (
      <Alert kind="success" title="Revision requested">
        Sent to your manager. HR unlocks the KPI after they approve.
      </Alert>
    )
  }

  const submit = async () => {
    setError(null)
    try {
      await request.mutateAsync({
        kind: 'revision',
        action: 'request',
        subjectId: assignmentId,
        reason,
      })
      setShowForm(false)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that request.')
    }
  }

  return (
    <div className="card p-4">
      {error && <div className="mb-3"><Alert kind="error">{error}</Alert></div>}

      {!showForm ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink-900">Changed job role?</p>
            <p className="mt-0.5 text-sm text-ink-500">
              Ask for this KPI to be reopened so it can be rewritten for the
              work you actually do now.
            </p>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-secondary">
            <PencilRuler className="h-4 w-4" /> Request a revision
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="font-medium text-ink-900">Request a revision of your FY {fy} KPI</p>
            <p className="mt-0.5 text-sm text-ink-500">
              Your manager reviews it first, then HR. Nothing unlocks until both
              approve. Months you have already been scored on are not affected —
              they keep the KPI and the scores they were given.
            </p>
          </div>
          <textarea
            rows={2}
            className="input"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. Moved from Service Engineer to Application Specialist in August"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={!reason.trim() || request.isPending}
              className="btn-primary"
            >
              {request.isPending && <Spinner className="h-4 w-4" />}
              Send to my manager
            </button>
            <button onClick={() => setShowForm(false)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
