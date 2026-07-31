import { useState, useEffect, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Undo2, Lock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  useSubmissionById, useSaveItemValues, useSaveCoreRatings,
  useSubmissionAction, useCoreValues,
} from '@/lib/queries'
import { monthLabel } from '@/lib/fy'
import {
  calcKpiScore, averageCoreValueRatings, blendScores, RATING_SCALE,
  type ScoringRule, type RuleParams,
} from '@/lib/scoring'
import {
  Alert, PageLoader, Spinner, ScorePill, StatusBadge, StatTile,
} from '@/components/ui'
import type { KpiSubmissionItem } from '@/types/db'

export default function ScoreSubmission() {
  const { submissionId = '' } = useParams()
  const navigate = useNavigate()
  const { data, isLoading, refetch } = useSubmissionById(submissionId)
  const { data: coreValues } = useCoreValues()
  const saveItems = useSaveItemValues()
  const saveRatings = useSaveCoreRatings()
  const action = useSubmissionAction()

  const [achieved, setAchieved] = useState<Record<string, string>>({})
  const [ratings, setRatings] = useState<Record<string, string>>({})
  const [remarks, setRemarks] = useState('')
  const [returnReason, setReturnReason] = useState('')
  const [showReturn, setShowReturn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const submission = data?.submission ?? null
  const items = data?.items ?? []
  const editable = submission?.status === 'submitted' || submission?.status === 'scored'

  useEffect(() => {
    if (!data?.submission) return
    setAchieved(Object.fromEntries(
      // Pre-fill with the TM's figures so the manager only changes what they disagree with.
      data.items.map(i => [
        i.id,
        (i.manager_achieved ?? i.self_achieved)?.toString() ?? '',
      ]),
    ))
    setRatings(Object.fromEntries(
      data.ratings.map(r => [r.id, r.manager_rating ?? r.self_rating ?? '']),
    ))
    setRemarks(data.submission.manager_remarks ?? '')
  }, [data])

  const coreAverage = useMemo(
    () => averageCoreValueRatings((data?.ratings ?? []).map(r => ratings[r.id] || null)),
    [ratings, data],
  )

  const mgrScore = (item: KpiSubmissionItem) => {
    const raw = item.section === 'core_values'
      ? coreAverage
      : achieved[item.id] === '' || achieved[item.id] === undefined
      ? null
      : Number(achieved[item.id])
    if (raw === null) return null
    return calcKpiScore(
      item.scoring_rule as ScoringRule,
      item.weightage, item.target_value, raw, item.rule_params as RuleParams,
    )
  }

  // Same fixed order as the team member sees on their own form.
  const sortedRatings = useMemo(() => {
    const order = new Map((coreValues ?? []).map(c => [c.id, c.sort_order]))
    return [...(data?.ratings ?? [])].sort(
      (a, b) => (order.get(a.core_value_id) ?? 0) - (order.get(b.core_value_id) ?? 0),
    )
  }, [data, coreValues])

  const selfTotal = items.reduce((a, i) => a + (i.self_score ?? 0), 0)
  const mgrTotal = items.reduce((a, i) => a + (mgrScore(i) ?? 0), 0)
  const finalTotal = items.reduce(
    (a, i) => a + (blendScores(i.self_score, mgrScore(i)) ?? 0), 0,
  )

  const save = async () => {
    setError(null)
    try {
      await saveItems.mutateAsync({
        role: 'manager',
        updates: items
          .filter(i => i.section !== 'core_values')
          .map(i => ({
            id: i.id,
            achieved: achieved[i.id] === '' || achieved[i.id] === undefined
              ? null : Number(achieved[i.id]),
          })),
      })
      await saveRatings.mutateAsync({
        role: 'manager',
        updates: (data?.ratings ?? []).map(r => ({ id: r.id, rating: ratings[r.id] || null })),
      })
      if (submission && remarks !== (submission.manager_remarks ?? '')) {
        await supabase.from('kpi_submissions')
          .update({ manager_remarks: remarks }).eq('id', submission.id)
      }
      await refetch()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
      return false
    }
  }

  const onSubmitScores = async () => {
    if (!submission) return
    if (!(await save())) return
    try {
      await action.mutateAsync({ action: 'submit_manager', submissionId: submission.id })
      setNotice('Scores submitted. You can finalise the month when you are ready.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit scores.')
    }
  }

  const onFinalize = async () => {
    if (!submission) return
    try {
      await action.mutateAsync({ action: 'finalize', submissionId: submission.id })
      setNotice('Month finalised.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finalise.')
    }
  }

  const onReturn = async () => {
    if (!submission || !returnReason.trim()) return
    try {
      await action.mutateAsync({
        action: 'return', submissionId: submission.id, reason: returnReason,
      })
      navigate('/team')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not return.')
    }
  }

  if (isLoading) return <PageLoader />
  if (!submission || !data) return <Alert kind="error">Submission not found.</Alert>

  const busy = saveItems.isPending || saveRatings.isPending || action.isPending

  return (
    <div className="space-y-5">
      <div>
        <Link to="/team" className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" /> Back to my team
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-ink-900">
            {data.employee.full_name}
          </h1>
          <StatusBadge status={submission.status} />
        </div>
        <p className="mt-0.5 text-sm text-ink-500">
          {data.employee.ecode} · {monthLabel(submission.period_month)}
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {submission.status === 'finalized' && (
        <Alert kind="info" title="This month is final">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" /> Contact HR if it genuinely needs reopening.
          </span>
        </Alert>
      )}

      {submission.employee_remarks && (
        <div className="card p-4">
          <p className="text-xs font-medium text-ink-500">
            {data.employee.full_name.split(' ')[0]}'s remarks
          </p>
          <p className="mt-1 text-sm text-ink-700">{submission.employee_remarks}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Self assessment" value={selfTotal.toFixed(2)} sub="out of 100" />
        <StatTile label="My assessment" value={mgrTotal.toFixed(2)} sub="out of 100" />
        <StatTile
          label="Final"
          value={<ScorePill value={finalTotal} size="lg" />}
          sub="average of the two"
          tone="brand"
        />
      </div>

      {/* ---- job role rows, side by side ---- */}
      <div className="card overflow-hidden">
        <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">
            Job Role <span className="font-normal text-ink-500">— 80%</span>
          </h3>
        </div>
        <div className="divide-y divide-ink-100">
          {items.filter(i => i.section === 'job_role').map(item => (
            <div key={item.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{item.kra}</p>
                  {item.kpi_description && (
                    <p className="mt-0.5 text-sm text-ink-500">{item.kpi_description}</p>
                  )}
                </div>
                <span className="badge bg-ink-100 text-ink-600">{item.weightage}%</span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-5">
                <div>
                  <label className="label text-xs">Target</label>
                  <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm tabular-nums text-ink-700">
                    {item.target_value ?? '—'}
                  </p>
                </div>

                <div>
                  <label className="label text-xs">They claimed</label>
                  <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm tabular-nums text-ink-700">
                    {item.self_achieved ?? '—'}
                    <span className="ml-2 text-xs text-ink-400">
                      = {item.self_score?.toFixed(2) ?? '—'}
                    </span>
                  </p>
                </div>

                <div>
                  <label className="label text-xs" htmlFor={`mgr-${item.id}`}>
                    My figure
                  </label>
                  <input
                    id={`mgr-${item.id}`}
                    type="number" inputMode="decimal" step="any"
                    className="input"
                    disabled={!editable}
                    value={achieved[item.id] ?? ''}
                    onChange={e => setAchieved({ ...achieved, [item.id]: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label text-xs">My score</label>
                  <div className="py-1.5"><ScorePill value={mgrScore(item)} /></div>
                </div>

                <div>
                  <label className="label text-xs">Final</label>
                  <div className="py-1.5">
                    <ScorePill value={blendScores(item.self_score, mgrScore(item))} />
                  </div>
                </div>
              </div>
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
          {coreAverage !== null && (
            <span className="text-xs text-ink-500">my avg {coreAverage.toFixed(0)}/100</span>
          )}
        </div>
        <div className="divide-y divide-ink-100">
          {sortedRatings.map(rating => {
            const def = coreValues?.find(c => c.id === rating.core_value_id)
            return (
              <div key={rating.id} className="p-4 sm:flex sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{def?.name}</p>
                  {def?.description && (
                    <p className="mt-0.5 text-sm text-ink-500">{def.description}</p>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-3 sm:mt-0">
                  <div className="text-right">
                    <p className="text-xs text-ink-400">They said</p>
                    <p className="text-sm text-ink-600">{rating.self_rating ?? '—'}</p>
                  </div>
                  <select
                    className="input w-44"
                    disabled={!editable}
                    value={ratings[rating.id] ?? ''}
                    onChange={e => setRatings({ ...ratings, [rating.id]: e.target.value })}
                  >
                    <option value="">Not rated</option>
                    {RATING_SCALE.map(r => (
                      <option key={r.label} value={r.label}>{r.label} ({r.points})</option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card p-4">
        <label className="label" htmlFor="mremarks">My remarks (optional)</label>
        <textarea
          id="mremarks"
          rows={3}
          className="input"
          disabled={!editable}
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          placeholder="Feedback for this month — visible to the team member"
        />
      </div>

      {/* ---- actions ---- */}
      {editable && (
        <div className="space-y-3">
          <div className="sticky bottom-16 flex flex-wrap gap-2 md:bottom-0">
            {submission.status === 'submitted' && (
              <button onClick={onSubmitScores} disabled={busy} className="btn-primary">
                {busy ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                Submit my scores
              </button>
            )}
            {submission.status === 'scored' && (
              <>
                <button onClick={onFinalize} disabled={busy} className="btn-primary">
                  {busy ? <Spinner className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                  Finalise this month
                </button>
                <button onClick={save} disabled={busy} className="btn-secondary">
                  Save changes
                </button>
              </>
            )}
            <button
              onClick={() => setShowReturn(v => !v)}
              disabled={busy}
              className="btn-secondary"
            >
              <Undo2 className="h-4 w-4" /> Send back
            </button>
          </div>

          {showReturn && (
            <div className="card space-y-3 p-4">
              <label className="label" htmlFor="reason">
                Why are you sending this back?
              </label>
              <textarea
                id="reason"
                rows={2}
                className="input"
                value={returnReason}
                onChange={e => setReturnReason(e.target.value)}
                placeholder="e.g. The repeat-call figure does not match the service log"
              />
              <button
                onClick={onReturn}
                disabled={!returnReason.trim() || busy}
                className="btn-danger"
              >
                Send back to {data.employee.full_name.split(' ')[0]}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
