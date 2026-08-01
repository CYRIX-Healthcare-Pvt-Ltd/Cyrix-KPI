import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Send, Save, Lock, Trash2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  useSubmission, useOpenSubmission, useSaveItemValues, useSaveCoreRatings,
  useSubmissionAction, useCoreValues, useMyAssignment, useSaveMonthlyTarget,
  currentFy,
} from '@/lib/queries'
import { monthLabel, isMonthOpen } from '@/lib/fy'
import {
  calcKpiScore, averageCoreValueRatings, RATING_SCALE, type ScoringRule, type RuleParams,
} from '@/lib/scoring'
import {
  Alert, PageLoader, Spinner, ScorePill, StatusBadge, StatTile, EmptyState,
} from '@/components/ui'
import type { KpiSubmissionItem } from '@/types/db'

export default function MonthlySubmission() {
  const { month = '' } = useParams()
  const { employee } = useAuth()
  const fy = currentFy()

  const { data, isLoading, refetch } = useSubmission(employee?.id, month)
  const { data: assignmentData } = useMyAssignment(employee?.id, fy)
  const { data: coreValues } = useCoreValues()
  const openSub = useOpenSubmission()
  const saveItems = useSaveItemValues()
  const saveRatings = useSaveCoreRatings()
  const saveTarget = useSaveMonthlyTarget()
  const action = useSubmissionAction()

  const [achieved, setAchieved] = useState<Record<string, string>>({})
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [ratings, setRatings] = useState<Record<string, string>>({})
  const [remarks, setRemarks] = useState('')
  const [showDelete, setShowDelete] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const submission = data?.submission ?? null
  const items = data?.items ?? []
  const editable = submission?.status === 'draft' || submission?.status === 'returned'

  // Seed local state once the server data lands.
  useEffect(() => {
    if (!data?.submission) return
    setAchieved(Object.fromEntries(
      data.items.map(i => [i.id, i.self_achieved?.toString() ?? '']),
    ))
    setTargets(Object.fromEntries(
      data.items.map(i => [i.id, i.target_value?.toString() ?? '']),
    ))
    setRatings(Object.fromEntries(
      data.ratings.map(r => [r.id, r.self_rating ?? '']),
    ))
    setRemarks(data.submission.employee_remarks ?? '')
  }, [data])

  // Core-value ratings roll into a 0–100 figure that scores the 20% row.
  const coreAverage = useMemo(() => {
    const list = (data?.ratings ?? []).map(r => ratings[r.id] || null)
    return averageCoreValueRatings(list)
  }, [ratings, data])

  const liveScore = (item: KpiSubmissionItem) => {
    const raw = item.section === 'core_values'
      ? coreAverage
      : achieved[item.id] === '' || achieved[item.id] === undefined
      ? null
      : Number(achieved[item.id])
    // Score against the target as currently typed, so editing it updates
    // the number immediately rather than only after a save.
    const t = targets[item.id]
    const target = t === '' || t === undefined ? item.target_value : Number(t)
    return calcKpiScore(
      item.scoring_rule as ScoringRule,
      item.weightage,
      target,
      raw,
      item.rule_params as RuleParams,
    )
  }

  // core_value_ratings has no sort column of its own, so order by the
  // definition's — otherwise the five values appear in whatever order
  // Postgres returns them, which changes between loads.
  const sortedRatings = useMemo(() => {
    const order = new Map((coreValues ?? []).map(c => [c.id, c.sort_order]))
    return [...(data?.ratings ?? [])].sort(
      (a, b) => (order.get(a.core_value_id) ?? 0) - (order.get(b.core_value_id) ?? 0),
    )
  }, [data, coreValues])

  /** The manager's own core-value average, shown once they have scored. */
  const managerCoreAverage = useMemo(
    () => averageCoreValueRatings((data?.ratings ?? []).map(r => r.manager_rating)),
    [data],
  )

  const jobRows = items.filter(i => i.section === 'job_role')
  const coreRows = items.filter(i => i.section === 'core_values')
  const jobTotal = jobRows.reduce((a, i) => a + liveScore(i), 0)
  const coreTotal = coreRows.reduce((a, i) => a + liveScore(i), 0)

  const isScored = submission?.status === 'scored' || submission?.status === 'finalized'

  const save = async () => {
    setError(null)
    try {
      // Targets first: the achieved value is scored against them, and the
      // database recomputes on each write.
      for (const i of items.filter(i => i.section !== 'core_values')) {
        const t = targets[i.id]
        const next = t === '' || t === undefined ? null : Number(t)
        if (next !== i.target_value) {
          await saveTarget.mutateAsync({ itemId: i.id, target: next })
        }
      }

      await saveItems.mutateAsync({
        role: 'self',
        updates: items
          .filter(i => i.section !== 'core_values')
          .map(i => ({
            id: i.id,
            achieved: achieved[i.id] === '' || achieved[i.id] === undefined
              ? null : Number(achieved[i.id]),
          })),
      })
      await saveRatings.mutateAsync({
        role: 'self',
        updates: (data?.ratings ?? []).map(r => ({
          id: r.id, rating: ratings[r.id] || null,
        })),
      })
      if (submission && remarks !== (submission.employee_remarks ?? '')) {
        await supabase.from('kpi_submissions')
          .update({ employee_remarks: remarks }).eq('id', submission.id)
      }
      await refetch()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
      return false
    }
  }

  const onSaveDraft = async () => {
    if (await save()) setNotice('Saved. You can come back and finish later.')
  }

  const onSubmit = async () => {
    if (!submission) return
    setNotice(null)
    if (!(await save())) return
    try {
      await action.mutateAsync({ action: 'submit_self', submissionId: submission.id })
      setNotice('Submitted to your manager.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit.')
    }
  }

  const onRequestDeletion = async () => {
    if (!submission || !deleteReason.trim()) return
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('request_record_deletion', {
        p_submission_id: submission.id,
        p_reason: deleteReason,
      })
      if (rpcError) throw new Error(rpcError.message)
      setShowDelete(false)
      setDeleteReason('')
      setNotice('Sent to your manager. HR approves the removal after them.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that request.')
    }
  }

  if (isLoading) return <PageLoader />

  // ---- month has not finished yet ----
  if (!isMonthOpen(month)) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert kind="info" title={`${monthLabel(month)} is not open yet`}>
          A month can only be assessed once it has finished. {monthLabel(month)} will
          open at the start of the following month.
        </Alert>
      </div>
    )
  }

  // ---- nothing opened yet ----
  if (!submission) {
    const kpiActive = assignmentData?.assignment?.status === 'active'
    return (
      <div className="space-y-4">
        <BackLink />
        {!kpiActive ? (
          <Alert kind="warning" title="Your KPI is not approved yet">
            You can start monthly assessments once your manager has approved your KPI
            for FY {fy}. <Link to="/my-kpi" className="font-medium underline">View my KPI</Link>
          </Alert>
        ) : (
          <EmptyState title={`${monthLabel(month)} has not been started`}>
            <p>Open the month to enter what you achieved.</p>
            <button
              className="btn-primary mt-4"
              disabled={openSub.isPending}
              onClick={() =>
                employee && openSub.mutateAsync({ employeeId: employee.id, month })
                  .catch(e => setError(e.message))
              }
            >
              {openSub.isPending && <Spinner className="h-4 w-4" />}
              Start {monthLabel(month)}
            </button>
            {error && <div className="mt-3"><Alert kind="error">{error}</Alert></div>}
          </EmptyState>
        )}
      </div>
    )
  }

  const busy = saveItems.isPending || saveRatings.isPending || action.isPending

  return (
    <div className="space-y-5">
      <div>
        <BackLink />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-ink-900">
            {monthLabel(month)} assessment
          </h1>
          <StatusBadge status={submission.status} />
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {submission.status === 'returned' && (
        <Alert kind="warning" title="Your manager sent this back">
          <p className="italic">“{submission.return_reason}”</p>
        </Alert>
      )}

      {!editable && submission.status !== 'returned' && (
        <Alert kind="info" title="This month is read-only">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            {submission.status === 'submitted'
              ? 'It is with your manager for scoring.'
              : submission.status === 'scored'
              ? 'Your manager has scored it.'
              : 'This month is final.'}
          </span>
        </Alert>
      )}

      {/* ---- running totals ---- */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Job role" value={jobTotal.toFixed(2)} sub="out of 80" />
        <StatTile label="Core values" value={coreTotal.toFixed(2)} sub="out of 20" />
        <StatTile
          label={editable ? 'My total so far' : 'My total'}
          value={<ScorePill value={jobTotal + coreTotal} size="lg" />}
          sub="out of 100"
          tone="brand"
        />
      </div>

      {submission.status === 'scored' || submission.status === 'finalized' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile
            label="Manager's total"
            value={<ScorePill value={submission.mgr_total_score} size="lg" />}
          />
          <StatTile
            label="Final score"
            value={<ScorePill value={submission.final_total_score} size="lg" />}
            sub="average of self and manager"
            tone="brand"
          />
        </div>
      ) : null}

      {/* ---- job role rows ---- */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">
            Job Role <span className="font-normal text-ink-500">— 80%</span>
          </h3>
          <ScorePill value={jobTotal} size="sm" />
        </div>
        <div className="divide-y divide-ink-100">
          {jobRows.map(item => (
            <div key={item.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{item.kra}</p>
                  {item.kpi_description && (
                    <p className="mt-0.5 text-sm text-ink-500">{item.kpi_description}</p>
                  )}
                </div>
                <span className="badge bg-ink-100 text-ink-600">
                  {item.weightage}%
                </span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                {/* Targets legitimately move month to month — a call quota
                    in April is not December's. Editable while the month is
                    open; the KRA, weightage and scoring rule are not. */}
                <div>
                  <label className="label text-xs" htmlFor={`tgt-${item.id}`}>
                    Target
                  </label>
                  <input
                    id={`tgt-${item.id}`}
                    type="number" inputMode="decimal" step="any"
                    className="input"
                    disabled={!editable}
                    value={targets[item.id] ?? ''}
                    onChange={e => setTargets({ ...targets, [item.id]: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label text-xs" htmlFor={`ach-${item.id}`}>
                    Achieved
                  </label>
                  <input
                    id={`ach-${item.id}`}
                    type="number" inputMode="decimal" step="any"
                    className="input"
                    disabled={!editable}
                    value={achieved[item.id] ?? ''}
                    onChange={e => setAchieved({ ...achieved, [item.id]: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label text-xs">My score</label>
                  <div className="py-1.5">
                    <ScorePill value={liveScore(item)} />
                    <span className="ml-1.5 text-xs text-ink-400">
                      / {item.weightage}
                    </span>
                  </div>
                </div>

                {(submission.status === 'scored' || submission.status === 'finalized') && (
                  <div>
                    <label className="label text-xs">Manager</label>
                    <div className="py-1.5">
                      <ScorePill value={item.manager_score} />
                    </div>
                  </div>
                )}
              </div>

              <RuleHint rule={item.scoring_rule as ScoringRule} />
            </div>
          ))}
        </div>
      </div>

      {/* ---- core values ---- */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">
            Alignment To Core Values <span className="font-normal text-ink-500">— 20%</span>
          </h3>
          <div className="flex items-center gap-3 text-xs text-ink-500">
            <span>
              Mine {coreAverage === null ? '—' : `${coreAverage.toFixed(0)}/100`}
              {isScored && (
                <> · Manager {managerCoreAverage === null ? '—' : `${managerCoreAverage.toFixed(0)}/100`}</>
              )}
            </span>
            <ScorePill value={coreTotal} size="sm" />
          </div>
        </div>

        {/* Header row so the two assessments read as columns once scored. */}
        {isScored && (
          <div className="hidden border-b border-ink-100 bg-ink-50/60 px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-400 sm:flex sm:gap-4">
            <span className="flex-1">Core value</span>
            <span className="w-48 text-center">My rating</span>
            <span className="w-40 text-center">Manager's rating</span>
          </div>
        )}

        <div className="divide-y divide-ink-100">
          {sortedRatings.map(rating => {
            const def = coreValues?.find(c => c.id === rating.core_value_id)
            const differs =
              isScored &&
              rating.manager_rating !== null &&
              rating.manager_rating !== rating.self_rating

            return (
              <div key={rating.id} className="p-4 sm:flex sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{def?.name ?? 'Core value'}</p>
                  {def?.description && (
                    <p className="mt-0.5 text-sm text-ink-500">{def.description}</p>
                  )}
                </div>

                <div className="mt-2 sm:mt-0 sm:w-48">
                  <select
                    className="input"
                    disabled={!editable}
                    value={ratings[rating.id] ?? ''}
                    onChange={e => setRatings({ ...ratings, [rating.id]: e.target.value })}
                  >
                    <option value="">Not rated</option>
                    {RATING_SCALE.map(r => (
                      <option key={r.label} value={r.label}>
                        {r.label} ({r.points})
                      </option>
                    ))}
                  </select>
                </div>

                {/* The manager's verdict. Highlighted when it differs from
                    the self rating, since that is the useful signal. */}
                {isScored && (
                  <div className="mt-2 sm:mt-0 sm:w-40">
                    <p className="mb-1 text-xs text-ink-400 sm:hidden">Manager's rating</p>
                    <div
                      className={`rounded-lg px-3 py-2 text-sm ${
                        differs
                          ? 'bg-cyrixRed-50 font-medium text-cyrixRed-800 ring-1 ring-cyrixRed-200'
                          : 'bg-ink-50 text-ink-700'
                      }`}
                    >
                      {rating.manager_rating ?? 'Not rated'}
                      {differs && (
                        <span className="ml-1.5 text-xs font-normal">changed</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {isScored && (
          <div className="flex items-center justify-between gap-3 border-t border-ink-100 bg-ink-50/60 px-4 py-3">
            <span className="text-sm font-medium text-ink-700">
              Core values score
            </span>
            <div className="flex items-center gap-5 text-sm">
              <span className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Mine
                </span>
                <ScorePill value={coreRows[0]?.self_score} size="sm" />
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Manager
                </span>
                <ScorePill value={coreRows[0]?.manager_score} size="sm" />
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Final
                </span>
                <ScorePill value={coreRows[0]?.final_score} size="sm" />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ---- remarks ---- */}
      <div className="card p-4">
        <label className="label" htmlFor="remarks">Anything to add? (optional)</label>
        <textarea
          id="remarks"
          rows={3}
          className="input"
          disabled={!editable}
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          placeholder="Context your manager should know when scoring this month"
        />
        {submission.manager_remarks && (
          <div className="mt-4 rounded-lg bg-ink-50 p-3">
            <p className="text-xs font-medium text-ink-500">Manager's remarks</p>
            <p className="mt-1 text-sm text-ink-700">{submission.manager_remarks}</p>
          </div>
        )}
      </div>

      {editable && (
        <div className="sticky bottom-16 flex flex-wrap gap-2 md:bottom-0">
          <button onClick={onSubmit} disabled={busy} className="btn-primary">
            {busy ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            Submit to manager
          </button>
          <button onClick={onSaveDraft} disabled={busy} className="btn-secondary">
            <Save className="h-4 w-4" /> Save draft
          </button>
        </div>
      )}

      {/* Once submitted a team member can no longer edit, so a month sent
          in by mistake is withdrawn rather than corrected — with their
          manager and then HR approving. Available on finalised months too:
          that is precisely when a wrong record needs removing, and HR has
          the final say either way. */}
      {!editable && (
        <div className="card p-4">
          {!showDelete ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink-900">
                  Submitted this by mistake?
                </p>
                <p className="mt-0.5 text-sm text-ink-500">
                  Ask for it to be removed. Your manager reviews it first, then HR.
                </p>
              </div>
              <button
                onClick={() => setShowDelete(true)}
                className="btn-secondary !text-cyrixRed-700"
              >
                <Trash2 className="h-4 w-4" /> Request deletion
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="font-medium text-ink-900">
                  Request deletion of {monthLabel(month)}
                </p>
                <p className="mt-0.5 text-sm text-ink-500">
                  This goes to your manager, then to HR. Nothing is removed until
                  both approve.
                </p>
              </div>
              <textarea
                rows={2}
                className="input"
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                placeholder="e.g. Entered against the wrong month"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={onRequestDeletion}
                  disabled={!deleteReason.trim()}
                  className="btn-danger"
                >
                  Send to my manager
                </button>
                <button onClick={() => setShowDelete(false)} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900">
      <ArrowLeft className="h-4 w-4" /> Back to dashboard
    </Link>
  )
}

/** Tells the person entering a number which direction is good. */
function RuleHint({ rule }: { rule: ScoringRule }) {
  const hint = {
    higher_capped: 'Higher is better. Hitting the target earns the full weightage; going beyond adds nothing more.',
    higher_uncapped: 'Higher is better. Exceeding the target can earn more than the weightage.',
    lower_penalty: 'Lower is better. Going over the target reduces this score.',
    lower_linear: 'Lower is better. Every unit over the target cuts into this score.',
    banded: 'Scored in bands against the target.',
    boolean: 'Enter 1 if done, 0 if not.',
    rating_scale: 'Scored from the core value ratings.',
  }[rule]

  return <p className="mt-2 text-xs text-ink-400">{hint}</p>
}
