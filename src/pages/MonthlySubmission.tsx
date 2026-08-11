import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  ArrowLeft, Send, Save, Lock, Trash2, MessageSquare, Paperclip, CheckCircle2,
  Shuffle,
} from 'lucide-react'
import { ScoreCutNotice } from '@/components/ScoreCutReason'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  useSubmission, useOpenSubmission, useSaveItemValues, useSaveCoreRatings,
  useSubmissionAction, useCoreValues, useMyAssignment, useSaveMonthlyTarget,
  useOpenRequestFor, useRequestAction, useScoreQueryState, useRaiseScoreQuery,
  useScoreQueries, useUseAlternate, currentFy, type QueryPointInput,
} from '@/lib/queries'
import { monthLabel, isMonthOpen } from '@/lib/fy'
import {
  calcKpiScore, averageCoreValueRatings, RATING_SCALE, type ScoringRule, type RuleParams,
} from '@/lib/scoring'
import {
  Alert, PageLoader, Spinner, ScorePill, StatusBadge, StatTile, EmptyState,
} from '@/components/ui'
import type { KpiSubmissionItem, ScoreQueryState, Alternate } from '@/types/db'

export default function MonthlySubmission() {
  const { month = '' } = useParams()
  const navigate = useNavigate()
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
  const requestAction = useRequestAction()

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

  const { data: openDeletion } = useOpenRequestFor('deletion', submission?.id)
  const { data: queryState } = useScoreQueryState(submission?.id)

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
  const esmsRows = items.filter(i => i.section === 'esms')
  const coreRows = items.filter(i => i.section === 'core_values')
  const jobTotal = jobRows.reduce((a, i) => a + liveScore(i), 0)
  const esmsTotal = esmsRows.reduce((a, i) => a + liveScore(i), 0)
  const coreTotal = coreRows.reduce((a, i) => a + liveScore(i), 0)
  const hasEsms = esmsRows.length > 0
  // 20 normally, 15 for the people who also carry ESMS. Every core-value
  // figure on this page is out of it, and it was being recomputed inline
  // in five places — including none of the ones that needed it to colour
  // the score correctly.
  const coreWeight = coreRows.reduce((a, i) => a + Number(i.weightage), 0)

  // What each row could measure instead, keyed by the KPI row it came
  // from. Read off the assignment rather than the month, because the
  // choice is between things agreed for the year.
  const altsByItem = useMemo(
    () => new Map((assignmentData?.items ?? []).map(i => [i.id, i.alternates ?? []])),
    [assignmentData],
  )

  /**
   * The blocks that are filled in by hand, in reading order.
   *
   * ESMS is scored exactly like a job role row — a number against a
   * target — so it is the same editor, with the target locked because
   * it is fixed at 100 for everyone who carries it.
   */
  const measuredBlocks = [
    {
      // Summed from the rows rather than assumed to be 80. It always is
      // 80, but this number now decides the colour of the block's score,
      // and a colour derived from a constant that disagreed with the
      // rows would be wrong in exactly the case worth catching.
      key: 'job_role', label: 'Job Role', rows: jobRows,
      total: jobTotal,
      weight: jobRows.reduce((a, i) => a + Number(i.weightage), 0),
      targetFixed: false,
    },
    ...(hasEsms ? [{
      key: 'esms', label: 'ESMS', rows: esmsRows,
      total: esmsTotal, weight: esmsRows.reduce((a, i) => a + Number(i.weightage), 0),
      targetFixed: true,
    }] : []),
  ]

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
      // Back to the list rather than sitting on a month that is now
      // read-only and has nothing left to do on it. The confirmation
      // travels with the navigation so it lands where the eye does —
      // next to the row that has just changed to Submitted.
      navigate('/history', {
        replace: true,
        state: { notice: `${monthLabel(month)} has been submitted to your manager.` },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit.')
    }
  }

  const onRequestDeletion = async () => {
    if (!submission || !deleteReason.trim()) return
    setError(null)
    setNotice(null)
    try {
      await requestAction.mutateAsync({
        kind: 'deletion',
        action: 'request',
        subjectId: submission.id,
        reason: deleteReason,
      })
      setShowDelete(false)
      setDeleteReason('')
      setNotice('Sent to your manager. HR approves the removal after them.')
    } catch (err) {
      // Clearing the notice matters as much as setting the error: the
      // previous "sent to your manager" was still on screen underneath a
      // failure, which read as both things having happened.
      setNotice(null)
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
          <StatusBadge
            status={submission.status}
            queried={queryState?.existing_status === 'open'}
          />
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

      {/* ---- running totals: one tile per band this person has ---- */}
      <div className={clsx('grid gap-3', hasEsms ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
        <StatTile label="Job role" value={jobTotal.toFixed(2)} sub="out of 80" />
        {hasEsms && (
          <StatTile
            label="ESMS"
            value={esmsTotal.toFixed(2)}
            sub={`out of ${esmsRows.reduce((a, i) => a + Number(i.weightage), 0)}`}
          />
        )}
        <StatTile
          label="Core values"
          value={coreTotal.toFixed(2)}
          sub={`out of ${coreWeight}`}
        />
        <StatTile
          label={editable ? 'My total so far' : 'My total'}
          value={<ScorePill value={jobTotal + esmsTotal + coreTotal} size="lg" />}
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

      {/* Why the manager's figure is lower, next to the figure rather
          than at the bottom with the remarks. It is the answer to the
          question the number just raised, and somebody who has to scroll
          past six KRAs to find it has already decided to raise a query.

          Its own card, stacked, one column — the reason is prose and
          gets the full width to be prose in. */}
      {submission.score_cut_reason &&
       (submission.status === 'scored' || submission.status === 'finalized') && (
        <ScoreCutNotice
          reason={submission.score_cut_reason}
          canQuery={submission.status === 'scored'}
        />
      )}

      {/* ---- the rows entered by hand: job role, then ESMS ---- */}
      {measuredBlocks.map(block => (
      <div key={block.key} className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">
            {block.label} <span className="font-normal text-ink-500">— {block.weight}%</span>
          </h3>
          <ScorePill value={block.total} outOf={block.weight} size="sm" />
        </div>
        <div className="divide-y divide-ink-100">
          {block.rows.map(item => (
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

              {/* This row can measure more than one thing, and which one
                  changes by month. Only shown where a choice actually
                  exists — a picker with one option in it is a control
                  that teaches people to ignore pickers. */}
              <AlternatePicker
                item={item}
                alternates={altsByItem.get(item.assignment_item_id ?? '') ?? []}
                editable={editable}
                onError={setError}
              />

              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                {/* Targets legitimately move month to month — a call quota
                    in April is not December's. Editable while the month is
                    open; the KRA, weightage and scoring rule are not.

                    ESMS is the exception: its target is 100 every month
                    for everyone, so the field shows it and will not take
                    an edit. */}
                <div>
                  <label className="label text-xs" htmlFor={`tgt-${item.id}`}>
                    Target {block.targetFixed && (
                      <span className="font-normal normal-case tracking-normal text-ink-400">
                        · fixed
                      </span>
                    )}
                  </label>
                  <input
                    id={`tgt-${item.id}`}
                    type="number" inputMode="decimal" step="any"
                    className="input"
                    disabled={!editable || block.targetFixed}
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
                    <ScorePill value={liveScore(item)} outOf={item.weightage} />
                    <span className="ml-1.5 text-xs text-ink-400">
                      / {item.weightage}
                    </span>
                  </div>
                </div>

                {(submission.status === 'scored' || submission.status === 'finalized') && (
                  <div>
                    <label className="label text-xs">Manager</label>
                    <div className="py-1.5">
                      <ScorePill value={item.manager_score} outOf={item.weightage} />
                    </div>
                  </div>
                )}
              </div>

              <RuleHint rule={item.scoring_rule as ScoringRule} />
            </div>
          ))}
        </div>
      </div>
      ))}

      {/* ---- core values ---- */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">
            Alignment To Core Values{' '}
            <span className="font-normal text-ink-500">
              — {coreWeight}%
            </span>
          </h3>
          <div className="flex items-center gap-3 text-xs text-ink-500">
            <span>
              Mine {coreAverage === null ? '—' : `${coreAverage.toFixed(0)}/100`}
              {isScored && (
                <> · Manager {managerCoreAverage === null ? '—' : `${managerCoreAverage.toFixed(0)}/100`}</>
              )}
            </span>
            <ScorePill value={coreTotal} outOf={coreWeight} size="sm" />
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
                <ScorePill value={coreRows[0]?.self_score} outOf={coreWeight} size="sm" />
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Manager
                </span>
                <ScorePill value={coreRows[0]?.manager_score} outOf={coreWeight} size="sm" />
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Final
                </span>
                <ScorePill value={coreRows[0]?.final_score} outOf={coreWeight} size="sm" />
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
        <div className="sticky bottom-16 flex flex-wrap gap-2 lg:bottom-0">
          <button onClick={onSubmit} disabled={busy} className="btn-primary">
            {busy ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            Submit to manager
          </button>
          <button onClick={onSaveDraft} disabled={busy} className="btn-secondary">
            <Save className="h-4 w-4" /> Save draft
          </button>
        </div>
      )}

      {/* Questioning the score, once the manager has given one. Sits
          above the deletion panel deliberately: "I do not understand row
          three" is the thing somebody actually wants, and until now the
          only button on this screen was the one that destroys the whole
          month. */}
      {isScored && (
        <ScoreQueryPanel
          submissionId={submission.id}
          items={items}
          coreValueNames={(coreValues ?? []).map(c => c.name)}
          state={queryState ?? null}
        />
      )}

      {/* Once submitted a team member can no longer edit, so a month sent
          in by mistake is withdrawn rather than corrected — with their
          manager and then HR approving. Available on finalised months too:
          that is precisely when a wrong record needs removing, and HR has
          the final say either way. */}
      {!editable && (
        <div className="card p-4">
          {openDeletion ? (
            // One open request at a time, enforced by a partial unique
            // index. Showing where it has got to is more use than a button
            // that can only fail.
            <div className="flex flex-wrap items-center gap-3">
              <Trash2 className="h-5 w-5 shrink-0 text-ink-300" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">
                  Removal already requested
                </p>
                <p className="mt-0.5 text-sm text-ink-500">
                  {openDeletion.status === 'pending_manager'
                    ? 'Waiting for your manager to review it. HR decides after them.'
                    : 'Your manager approved it. Waiting on HR to remove the record.'}
                </p>
              </div>
              <span className="badge bg-amber-100 text-amber-800">
                {openDeletion.status === 'pending_manager' ? 'With manager' : 'With HR'}
              </span>
            </div>
          ) : !showDelete ? (
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
                  disabled={!deleteReason.trim() || requestAction.isPending}
                  className="btn-danger"
                >
                  {requestAction.isPending && <Spinner className="h-4 w-4" />}
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

/**
 * Questioning the score.
 *
 * "Raise a query" rather than "Object": it has to cover both the person
 * who does not understand row three and the person who thinks it is
 * wrong, and a button that makes you declare a dispute before you can
 * ask a question means the question does not get asked. Which of the two
 * it is gets said per row, where it is useful, because those need
 * different replies.
 *
 * Everything about whether the panel is offered comes from the database
 * — see score_query_state(). The rule and the sentence explaining a
 * refusal would otherwise be written twice and drift.
 */
function ScoreQueryPanel({
  submissionId, items, coreValueNames, state,
}: {
  submissionId: string
  items: KpiSubmissionItem[]
  /** The five values, for the nested tick boxes on the core-values row. */
  coreValueNames: string[]
  state: ScoreQueryState | null
}) {
  const raise = useRaiseScoreQuery()
  const { data: mine } = useScoreQueries(!!state?.existing_id)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState<Record<string, QueryPointInput>>({})
  const [error, setError] = useState<string | null>(null)

  const existing = mine?.find(r => r.query.submission_id === submissionId)

  // ---- already raised ----
  if (state?.existing_id) {
    const answered = state.existing_status === 'answered'
    return (
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <MessageSquare className="h-4 w-4 text-ink-400" />
          <h3 className="text-sm font-semibold text-ink-800">Your query</h3>
          <span className={clsx(
            'badge ml-auto',
            answered ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800',
          )}>
            {answered ? 'Answered' : 'With your manager'}
          </span>
        </div>
        <div className="space-y-3 p-4">
          {existing?.query.employee_note && (
            <p className="text-sm italic text-ink-700">“{existing.query.employee_note}”</p>
          )}
          {existing?.points.map(p => {
            const item = items.find(i => i.id === p.item_id)
            return (
              <div key={p.id} className="rounded-lg border border-ink-200 p-3">
                <p className="text-sm font-medium text-ink-900">
                  {item?.kra ?? 'A row of this month'}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {p.kind === 'disagreement' ? 'Score disputed' : 'Clarification asked'}
                  {(p.sub_items ?? []).length > 0 && ` · ${p.sub_items!.join(', ')}`}
                  {p.evidence_name && ` · ${p.evidence_name}`}
                  {p.evidence_name && !p.evidence_path && ' (removed — window closed)'}
                </p>
                {p.note && <p className="mt-1 text-sm text-ink-600">{p.note}</p>}
              </div>
            )
          })}
          {answered && existing?.query.manager_response && (
            <div className="rounded-lg bg-ink-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
                <CheckCircle2 className="h-3.5 w-3.5" /> Your manager's reply
              </p>
              <p className="mt-1 text-sm text-ink-800">{existing.query.manager_response}</p>
              <p className="mt-1.5 text-xs text-ink-500">
                {existing.query.score_changed
                  ? 'The score was changed as a result.'
                  : 'The score was left as it was.'}
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---- cannot raise one ----
  if (!state?.can_raise) {
    if (!state?.reason) return null
    return (
      <p className="px-1 text-xs text-ink-400">
        <MessageSquare className="mr-1.5 inline h-3.5 w-3.5" />
        {state.reason}.
      </p>
    )
  }

  const chosen = Object.values(picked)
  const daysLeft = state.days_left ?? 0

  const toggle = (item: KpiSubmissionItem) => {
    setPicked(prev => {
      const next = { ...prev }
      if (next[item.id]) delete next[item.id]
      else next[item.id] = { item_id: item.id, kind: 'clarification', note: '' }
      return next
    })
  }

  const patch = (id: string, p: Partial<QueryPointInput>) =>
    setPicked(prev => ({ ...prev, [id]: { ...prev[id], ...p } }))

  const submit = async () => {
    setError(null)
    try {
      await raise.mutateAsync({ submissionId, note, points: chosen })
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that.')
    }
  }

  return (
    <div className="card p-4">
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink-900">
              Something here not right?
            </p>
            <p className="mt-0.5 text-sm text-ink-500">
              Ask your manager about any row they scored — for an explanation,
              or because you think the figure is wrong.{' '}
              <span className="whitespace-nowrap">
                {daysLeft < 1
                  ? 'Less than a day left'
                  : `${Math.floor(daysLeft)} day${Math.floor(daysLeft) === 1 ? '' : 's'} left`}
                {' '}of {state.window_days}.
              </span>
            </p>
          </div>
          <button onClick={() => setOpen(true)} className="btn-secondary">
            <MessageSquare className="h-4 w-4" /> Raise a query
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="font-medium text-ink-900">Raise a query on this month</p>
            <p className="mt-0.5 text-sm text-ink-500">
              Tick the rows you want looked at — at least one. You get one
              query per month, so put everything in this one.
            </p>
          </div>

          {error && <Alert kind="error">{error}</Alert>}

          <div className="divide-y divide-ink-100 rounded-lg border border-ink-200">
            {items.map(item => {
              const on = !!picked[item.id]
              return (
                <div key={item.id} className="p-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-cyrixRed-600"
                      checked={on}
                      onChange={() => toggle(item)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-900">
                        {item.kra}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-500">
                        Worth {item.weightage} · your manager scored{' '}
                        {item.manager_score?.toFixed(2) ?? '—'}
                        {item.self_score !== null && ` · you claimed ${item.self_score.toFixed(2)}`}
                      </span>
                    </span>
                  </label>

                  {on && (
                    <div className="mt-3 space-y-2 pl-7">
                      <div className="flex flex-wrap gap-2">
                        {(['clarification', 'disagreement'] as const).map(k => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => patch(item.id, { kind: k })}
                            className={clsx(
                              'btn-press rounded-lg px-3 py-1.5 text-xs font-medium ring-1',
                              picked[item.id].kind === k
                                ? 'bg-ink-900 text-white ring-ink-900'
                                : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-50',
                            )}
                          >
                            {k === 'clarification'
                              ? 'Explain this to me'
                              : 'I think this is wrong'}
                          </button>
                        ))}
                      </div>
                      {/* Core values is one scored row carrying five
                          separate judgements, so querying "core values"
                          tells the manager nothing they can act on —
                          they cannot see whether the argument is about
                          Trust or about Speed of Response. Ticking the
                          ones you mean is the difference between a
                          complaint and a question. */}
                      {item.section === 'core_values' && coreValueNames.length > 0 && (
                        <div className="rounded-lg bg-white p-2.5 ring-1 ring-ink-200">
                          <p className="mb-1.5 text-xs font-medium text-ink-600">
                            Which ones? (optional)
                          </p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                            {coreValueNames.map(name => {
                              const on = (picked[item.id].sub_items ?? []).includes(name)
                              return (
                                <label
                                  key={name}
                                  className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-700"
                                >
                                  <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5 accent-cyrixRed-600"
                                    checked={on}
                                    onChange={() => {
                                      const cur = picked[item.id].sub_items ?? []
                                      patch(item.id, {
                                        sub_items: on
                                          ? cur.filter(n => n !== name)
                                          : [...cur, name],
                                      })
                                    }}
                                  />
                                  {name}
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      <textarea
                        rows={2}
                        className="input"
                        value={picked[item.id].note ?? ''}
                        onChange={e => patch(item.id, { note: e.target.value })}
                        placeholder={
                          picked[item.id].kind === 'disagreement'
                            ? 'e.g. The service log shows 53 repairs, not 48'
                            : 'e.g. What was counted here?'
                        }
                      />
                      <label className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                        <span className="btn-secondary !px-2.5 !py-1.5 !text-xs">
                          <Paperclip className="h-3.5 w-3.5" /> Attach proof
                        </span>
                        <input
                          type="file"
                          className="hidden"
                          accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls"
                          onChange={e =>
                            patch(item.id, { file: e.target.files?.[0] ?? null })}
                        />
                        {picked[item.id].file
                          ? <span className="text-ink-700">{picked[item.id].file!.name}</span>
                          : <span>Optional · PDF, image or spreadsheet, up to 5 MB</span>}
                      </label>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div>
            <label className="label text-xs" htmlFor="query-note">
              Anything else (optional)
            </label>
            <textarea
              id="query-note"
              rows={2}
              className="input"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Context for your manager"
            />
          </div>

          <p className="text-xs text-ink-400">
            Your manager is notified, and the month cannot be finalised until
            they reply. Anything you attach is deleted once the {state.window_days}{' '}
            days are up and the query has been answered.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={submit}
              disabled={chosen.length === 0 || raise.isPending}
              className="btn-primary"
            >
              {raise.isPending && <Spinner className="h-4 w-4" />}
              Send to my manager
              {chosen.length > 0 && ` · ${chosen.length} row${chosen.length === 1 ? '' : 's'}`}
            </button>
            <button
              onClick={() => { setOpen(false); setPicked({}); setError(null) }}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Which of this row's alternatives is being measured this month.
 *
 * Changing it clears whatever figure was entered, because that number
 * was an answer to a different question — carrying it over silently is
 * how a target of 100 ends up scored against a figure counted for
 * something else entirely.
 */
function AlternatePicker({
  item, alternates, editable, onError,
}: {
  item: KpiSubmissionItem
  alternates: Alternate[]
  editable: boolean
  onError: (msg: string) => void
}) {
  const pick = useUseAlternate()
  if (alternates.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-ink-50 p-2.5">
      <Shuffle className="h-3.5 w-3.5 shrink-0 text-ink-400" />
      <label className="text-xs font-medium text-ink-600" htmlFor={`alt-${item.id}`}>
        This month this row is
      </label>
      <select
        id={`alt-${item.id}`}
        className="input w-auto min-w-48 flex-1 bg-white py-1.5 text-sm"
        disabled={!editable || pick.isPending}
        value={item.alternate_id ?? ''}
        onChange={async e => {
          try {
            await pick.mutateAsync({
              itemId: item.id,
              alternateId: e.target.value || null,
            })
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Could not switch that row.')
          }
        }}
      >
        <option value="">{item.kra}</option>
        {alternates.map(a => (
          <option key={a.id} value={a.id}>{a.kra || 'Alternative'}</option>
        ))}
      </select>
      {editable && (
        <span className="text-xs text-ink-400">
          Changing this clears what you have entered on the row.
        </span>
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
