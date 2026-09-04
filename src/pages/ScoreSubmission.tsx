import { useState, useEffect, useMemo } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import {
  ArrowLeft, ArrowDown, Check, Undo2, Lock, Trash2, MessageSquare,
} from 'lucide-react'
import { ScoreCutPrompt } from '@/components/ScoreCutReason'
import RuleTraits from '@/components/RuleTraits'
import { supabase } from '@/lib/supabase'
import {
  useSubmissionById, useSaveItemValues, useSaveCoreRatings,
  useSubmissionAction, useCoreValues, useOpenRequestFor, useRequestAction,
  useSaveMonthlyTarget, useMonthClose, useScoreQueryState,
} from '@/lib/queries'
import { monthLabel } from '@/lib/fy'
import { BANDS } from '@/lib/bands'
import {
  calcKpiScore, averageCoreValueRatings, ratingToPoints, RATING_SCALE,
  SCORE_CUT_POINTS, type ScoringRule, type RuleParams,
} from '@/lib/scoring'
import {
  Alert, PageLoader, Spinner, ScorePill, StatusBadge, StatTile,
} from '@/components/ui'
import type { KpiSubmissionItem, Section } from '@/types/db'

/**
 * The blocks a manager enters a number against, in reading order. Core
 * values are absent on purpose — those are rated, not measured, and have
 * their own panel below.
 */
const SCORED_SECTIONS: Array<{ key: Section; label: string }> = [
  { key: 'job_role', label: 'Job Role' },
  { key: 'esms', label: 'ESMS' },
]

export default function ScoreSubmission() {
  const { submissionId = '' } = useParams()
  const navigate = useNavigate()
  const { data, isLoading, refetch } = useSubmissionById(submissionId)
  const { data: coreValues } = useCoreValues()
  const saveItems = useSaveItemValues()
  const saveRatings = useSaveCoreRatings()
  const saveTarget = useSaveMonthlyTarget()
  const action = useSubmissionAction()
  const requestAction = useRequestAction()
  const { data: openDeletion } = useOpenRequestFor('deletion', submissionId)
  // Null means nothing closes months on its own, so somebody has to.
  const { data: closingDay } = useMonthClose()
  const { data: queryState } = useScoreQueryState(submissionId)
  // Set when the manager arrived from the Queries screen, so saving can
  // put them back where they were instead of leaving them on a form with
  // no way back to the question they came to answer.
  const fromQuery = (useLocation().state as { fromQuery?: string } | null)?.fromQuery
  const openQuery = queryState?.existing_status === 'open'

  const [achieved, setAchieved] = useState<Record<string, string>>({})
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [ratings, setRatings] = useState<Record<string, string>>({})
  /** Why a low core value was given, keyed by rating row. */
  const [coreWhy, setCoreWhy] = useState<Record<string, string>>({})
  const [remarks, setRemarks] = useState('')
  const [cutReason, setCutReason] = useState('')
  /** Submit asks once first — the manager's figure is now the score. */
  const [arming, setArming] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [showReturn, setShowReturn] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
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
    setTargets(Object.fromEntries(
      data.items.map(i => [i.id, i.target_value?.toString() ?? '']),
    ))
    setRatings(Object.fromEntries(
      /*
        The manager's own rating, or nothing.

        This fell back to the team member's self rating, which was
        reasonable when both of them rated core values — it opened the
        form on what the person had said about themselves. It is not any
        more: they no longer rate these at all, so the fallback can only
        fire on a month from before the change, and there it pre-fills
        the manager's box with the employee's answer. A manager who saves
        without touching it has adopted the employee's rating without
        deciding anything, which is the arrangement management moved away
        from when they made this the manager's judgement.
      */
      data.ratings.map(r => [r.id, r.manager_rating ?? '']),
    ))
    setCoreWhy(Object.fromEntries(
      data.ratings.map(r => [r.id, r.manager_remarks ?? '']),
    ))
    setRemarks(data.submission.manager_remarks ?? '')
    setCutReason(data.submission.score_cut_reason ?? '')
  }, [data])

  /** The target as currently typed, falling back to what was saved. */
  const targetOf = (item: KpiSubmissionItem) => {
    const t = targets[item.id]
    return t === '' || t === undefined ? item.target_value : Number(t)
  }

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
      item.weightage, targetOf(item), raw, item.rule_params as RuleParams,
    )
  }

  /**
   * What the team member's own figure is worth against the target as it
   * stands now.
   *
   * The target is the denominator both assessments share, so moving it
   * moves their score as well as the manager's — the database recomputes
   * both on save. Recomputing it here too means the manager sees that
   * happen while they type, rather than discovering it afterwards.
   */
  const selfScore = (item: KpiSubmissionItem) => {
    if (item.section === 'core_values' || item.self_achieved === null) {
      return item.self_score
    }
    return calcKpiScore(
      item.scoring_rule as ScoringRule,
      item.weightage, targetOf(item), item.self_achieved,
      item.rule_params as RuleParams,
    )
  }

  // Same fixed order as the team member sees on their own form.
  const sortedRatings = useMemo(() => {
    const order = new Map((coreValues ?? []).map(c => [c.id, c.sort_order]))
    return [...(data?.ratings ?? [])].sort(
      (a, b) => (order.get(a.core_value_id) ?? 0) - (order.get(b.core_value_id) ?? 0),
    )
  }, [data, coreValues])

  /**
   * Each assessment split into the parts it is actually made of.
   *
   * The team member fills the job role and nothing else, so their figure
   * belongs against the job-role weightage rather than against 100. The
   * manager fills everything, so theirs splits.
   */
  const sumOf = (
    pick: (i: KpiSubmissionItem) => number | null,
    where: (i: KpiSubmissionItem) => boolean,
  ) => items.filter(where).reduce((a, i) => a + (pick(i) ?? 0), 0)

  /**
   * A core value low enough to owe an explanation.
   *
   * Satisfactory is 40 and Poor is 20 on the rating scale, so this is
   * the bottom two of the five. Read off the scale rather than compared
   * against a literal, because the scale is data and somebody will
   * eventually reword it.
   */
  const needsWhy = (label: string | undefined) => {
    const points = ratingToPoints(label ?? null)
    return points !== null && points <= 40
  }

  const isJob = (i: KpiSubmissionItem) => i.section === 'job_role'

  const selfJob = sumOf(selfScore, isJob)
  const mgrJob = sumOf(mgrScore, isJob)
  const mgrCore = sumOf(mgrScore, i => i.section === 'core_values')
  const mgrEsms = sumOf(mgrScore, i => i.section === 'esms')
  const hasEsms = items.some(i => i.section === 'esms')
  const jobWeight = items.filter(isJob).reduce((a, i) => a + Number(i.weightage), 0)

  /**
   * What the manager's total is made of, each block named.
   *
   * This said "job role 68.59 · the rest 0.00", which is dismissive of
   * twenty per cent of somebody's appraisal and vague besides — "the
   * rest" is core values, and for anybody carrying ESMS it is two
   * different things lumped together. Each block gets its own name and
   * its own figure.
   */
  const mgrSplit = [
    `job role ${mgrJob.toFixed(2)}`,
    ...(hasEsms ? [`ESMS ${mgrEsms.toFixed(2)}`] : []),
    `core values ${mgrCore.toFixed(2)}`,
  ].join(' · ')

  const mgrTotal = items.reduce((a, i) => a + (mgrScore(i) ?? 0), 0)

  /*
    Core values the manager has not rated yet.

    submit_manager_scores refuses these since 0101, and a server refusal
    the screen never warned about arrives as a raw exception on the one
    button that matters.
  */
  const unratedCore = (data?.ratings ?? []).filter(r => !ratings[r.id]).length

  /**
   * Low ratings still owing an explanation.
   *
   * Same standing as an unrated one: the month cannot be submitted on
   * it. A Satisfactory or a Poor with no reason attached is the score a
   * person is least able to do anything about, and the reason is shown
   * to them.
   */
  const missingWhy = (data?.ratings ?? []).filter(
    r => needsWhy(ratings[r.id]) && !coreWhy[r.id]?.trim(),
  ).length

  /** Anything on the core-values block that stops this being submitted. */
  const coreIncomplete = unratedCore > 0 || missingWhy > 0

  /**
   * How far below their own assessment this lands, live as the manager
   * types rather than from the saved row — so the box appears while the
   * score is being decided, not after it has been submitted and refused.
   *
   * The job role alone, on both sides.
   *
   * It was the two whole totals, which was like for like only while the
   * team member also rated core values. Since they stopped, their total
   * is the job role and the manager's is everything, so the manager's is
   * almost always the larger and the gap comes out negative — a
   * safeguard for catching somebody being marked down that could never
   * fire. Briefly it compared job role and ESMS together, which is
   * closer but still not what the two of them are disagreeing about:
   * ESMS is scored against a fixed target of 100 and is not where a
   * manager and a team member differ. The job role is.
   */
  const cutGap = selfJob - mgrJob
  const needsCutReason = cutGap > SCORE_CUT_POINTS && !cutReason.trim()

  const save = async () => {
    setError(null)
    try {
      // Targets first, for the same reason as on the team member's own
      // form: both achieved figures are scored against them, and the
      // database recomputes the row on every write.
      for (const i of items.filter(i => i.section === 'job_role')) {
        const t = targets[i.id]
        const next = t === '' || t === undefined ? null : Number(t)
        if (next !== i.target_value) {
          await saveTarget.mutateAsync({ itemId: i.id, target: next })
        }
      }

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
        updates: (data?.ratings ?? []).map(r => ({
          id: r.id,
          rating: ratings[r.id] || null,
          // Cleared when the rating rises back out of the range that
          // asked for it, so last version's explanation is not left
          // attached to a rating it no longer describes.
          remarks: needsWhy(ratings[r.id]) ? (coreWhy[r.id]?.trim() || null) : null,
        })),
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
      await action.mutateAsync({
        action: 'submit_manager',
        submissionId: submission.id,
        reason: cutReason.trim() || undefined,
      })
      /*
        Back to the team, the way the team member's own submit goes back
        to their history.

        Staying here was deliberate once — the month can still be
        corrected until it closes — but it left the manager on a form
        whose primary button had silently become "Save changes", which
        reads as work still outstanding on a job they have just finished.
        Correcting a score is a thing you come back to do, not a thing
        you are held on the page in case of.

        The confirmation travels with the navigation so it lands beside
        the row that has just changed, and still says the month stays
        open.
      */
      const who = data?.employee.full_name.split(' ')[0] ?? 'They'
      navigate(fromQuery ? '/queries' : '/team', {
        replace: true,
        state: {
          notice:
            `Scores submitted. ${who} can see them now and can query them ` +
            'until the month closes — you can still correct anything until then.',
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit scores.')
    }
  }

  /** Only reachable while there is no closing date — see the buttons. */
  const onFinalize = async () => {
    if (!submission) return
    setError(null)
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
      setNotice('Deletion request sent. It needs HR approval before the record is removed.')
    } catch (err) {
      setNotice(null)
      setError(err instanceof Error ? err.message : 'Could not send that request.')
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

      {/* Arrived from the Queries screen. The manager came here to change
          a figure somebody asked about, so the way back has to be on the
          screen — and it carries the score with it, because "did my
          change do anything" is the question they will have next. */}
      {fromQuery && openQuery && (
        <div className="card flex flex-wrap items-center gap-3 border-amber-200 bg-amber-50 p-4">
          <MessageSquare className="h-5 w-5 shrink-0 text-amber-700" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-900">
              You are here from a query
            </p>
            <p className="mt-0.5 text-sm text-amber-800">
              Change whatever needs changing, save it, then go back and reply.
              Your total is now <strong>{mgrTotal.toFixed(2)}</strong>
              {submission.mgr_total_score !== null &&
               Math.abs(submission.mgr_total_score - mgrTotal) > 0.001 && (
                <> — it was {submission.mgr_total_score.toFixed(2)}</>
              )}.
            </p>
          </div>
          <Link to="/queries" className="btn-secondary shrink-0">
            Back to the query
          </Link>
        </div>
      )}

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

      {/*
        Three figures that were three bare numbers out of 100, which is
        the one thing they are not comparable on any more.

        The team member fills in the job role and nothing else, so their
        68.59 is 68.59 of the 80 that is theirs to fill; the manager's
        76.59 covers all 100. Put side by side with "out of 100" under
        both, the pair invited exactly the comparison it cannot support —
        and gave no way to see the thing a manager actually wants, which
        is how much of the difference is job role.

        So each says what it is made of. The split is the point of the
        row; the totals are the summary of it.
      */}
      {/*
        Two tiles, not three.

        There was a Final beside these captioned "average of the two",
        which stopped being true in 0095 and was by then simply the
        manager's figure repeated — the same number, the same width, a
        third of the row.

        What is left is the comparison a manager is actually making: what
        the person claimed for their own 80, and what this scores. The
        manager's tile carries the accent because it is the one that
        counts.
      */}
      <div className="grid grid-cols-2 gap-3 grid-pairs">
        <StatTile
          label="Self assessment"
          value={selfJob.toFixed(2)}
          sub={`job role, out of ${jobWeight}`}
        />
        <StatTile
          label="Final score"
          value={<ScorePill value={mgrTotal} size="lg" />}
          sub={mgrSplit}
          tone="brand"
        />
      </div>

      {/* A materially lower score, explained where it happens.
          Between the totals and the rows on purpose: it is about the
          number directly above it, and a manager who scrolls past the
          tiles has already seen the gap by the time they read this.

          One column, full width, generous target. The temptation is to
          put the figure and the box side by side, which on a phone gives
          a textarea about forty characters wide for the most important
          sentence on the screen. */}
      {editable && cutGap > SCORE_CUT_POINTS && (
        <ScoreCutPrompt
          gap={cutGap}
          name={data.employee.full_name.split(' ')[0]}
          value={cutReason}
          onChange={setCutReason}
        />
      )}

      {/* What was said last time, once it is no longer editable. The
          manager should be able to see their own reasoning without
          opening the team member's view of it. */}
      {!editable && submission.score_cut_reason && (
        <div className="card p-4">
          <p className="text-xs font-medium text-ink-500">
            Reason given for the lower score
          </p>
          <p className="mt-1 text-sm text-ink-700">{submission.score_cut_reason}</p>
        </div>
      )}

      {/* ---- the scored rows, side by side: job role, then ESMS ---- */}
      {SCORED_SECTIONS.map(({ key, label }) => {
        const rows = items.filter(i => i.section === key)
        // ESMS only exists for the people who carry it, and an empty card
        // headed "ESMS — 0%" tells everyone else about a thing that does
        // not apply to them.
        if (rows.length === 0) return null
        const weight = rows.reduce((a, i) => a + Number(i.weightage), 0)
        return (
      <div key={key} className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">
            {label} <span className="font-normal text-ink-500">— {weight}%</span>
          </h3>
          {/* "Correcting a target rescores both assessments for that
              row" came off. It was explaining a consequence that no
              longer has one worth mentioning — only the manager's
              assessment counts now, so there are not "both" of them to
              rescore — and it sat in the header of the block a manager
              is reading to do the actual work. */}
        </div>
        <div className="divide-y divide-ink-100">
          {rows.map(item => (
            <div key={item.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{item.kra}</p>
                  {item.kpi_description && (
                    <p className="mt-0.5 text-sm text-ink-500">{item.kpi_description}</p>
                  )}
                </div>
                {/* Beside the weightage rather than under the fields:
                    a row that can take points off the total is not the
                    same kind of row as one worth 10%, and the manager is
                    about to type the figure that decides it. */}
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  <RuleTraits
                    rule={item.scoring_rule as ScoringRule}
                    weightage={item.weightage}
                    params={item.rule_params as RuleParams}
                  />
                  <span className="badge bg-ink-100 text-ink-600">{item.weightage}%</span>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                {/* The manager sets the target, not just checks it. The
                    team member can type one while the month is theirs,
                    but the number that decides whether 42 calls is good
                    is the manager's to know — so it is editable here for
                    as long as the month is.

                    ESMS is the exception, as it is everywhere: fixed at
                    100 for everyone who carries it. */}
                <div>
                  <label className="label text-xs" htmlFor={`tgt-${item.id}`}>
                    Target {key === 'esms' && (
                      <span className="font-normal normal-case tracking-normal text-ink-400">
                        · fixed
                      </span>
                    )}
                  </label>
                  <input
                    id={`tgt-${item.id}`}
                    type="number" inputMode="decimal" step="any"
                    className="input"
                    disabled={!editable || key === 'esms'}
                    value={targets[item.id] ?? ''}
                    onChange={e => setTargets({ ...targets, [item.id]: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label text-xs">They claimed</label>
                  <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm tabular-nums text-ink-700">
                    {item.self_achieved ?? '—'}
                    <span
                      className="ml-2 text-xs text-ink-400"
                      title="Their figure against the target as it stands now"
                    >
                      = {selfScore(item)?.toFixed(2) ?? '—'}
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

                {/*
                  One pill, labelled "Score".

                  It was "My score" and "Final" stacked, printing the
                  same figure twice since the manager's number became the
                  score — two labels and two rows of a phone for one
                  value.

                  Not "Final": that word is already the status of a
                  closed month in this app, so putting it on a live
                  editable row invites "is this month final?" when it is
                  not. Not "My score" either — everything on this screen
                  is the manager's, the target and the achieved value
                  included, so "my" separates it from nothing. "Score" is
                  what it is.
                */}
                <div>
                  <label className="label text-xs">Score</label>
                  <div className="py-1.5">
                    <ScorePill value={mgrScore(item)} outOf={item.weightage} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
        )
      })}

      {/* ---- core values ---- */}
      <div id="core-values" className="card overflow-hidden scroll-mt-20">
        <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">
            Alignment To Core Values{' '}
            <span className="font-normal text-ink-500">
              — {items.filter(i => i.section === 'core_values')
                    .reduce((a, i) => a + Number(i.weightage), 0)}%
            </span>
          </h3>
          {/* How many are left, on the block itself.
              Somebody scrolling past needs to know this section is
              unfinished without having reached the button at the bottom
              to be told. */}
          {/* Only what is still to do. The "my avg 40/100" that used to
              sit here was the rolled-up rating out of 100, which is not
              a figure anybody works in — the score it produces is on the
              row beside it, out of the weightage, and saying the same
              thing twice in two scales is worse than saying it once. */}
          {editable && coreIncomplete && (
            <span className="badge bg-amber-200 text-amber-900">
              {unratedCore > 0 ? `${unratedCore} to rate` : `${missingWhy} need a reason`}
            </span>
          )}
        </div>
        <div className="divide-y divide-ink-100">
          {sortedRatings.map(rating => {
            const def = coreValues?.find(c => c.id === rating.core_value_id)
            // The ones still to do, marked where they are. A count at the
            // top says how many; this says which, so finding them is not
            // a matter of reading five dropdowns.
            const needsRating = editable && !ratings[rating.id]
            return (
              <div
                key={rating.id}
                className={clsx(
                  'p-4 sm:flex sm:items-center sm:gap-4',
                  needsRating && 'bg-amber-50/60',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{def?.name}</p>
                  {def?.description && (
                    <p className="mt-0.5 text-sm text-ink-500">{def.description}</p>
                  )}
                  {/*
                    Why, on the two lowest ratings.

                    Satisfactory or Poor on a core value is a judgement
                    about how somebody conducts themselves rather than a
                    figure they missed, and it is the hardest kind of
                    score to receive with no reason attached. It appears
                    where the value is described, so the sentence sits
                    with the thing it is about rather than in a remarks
                    box at the bottom covering all five at once.

                    Appears on the rating, not on a button, so it is
                    already open by the time the manager wonders whether
                    to explain themselves.
                  */}
                  {editable && needsWhy(ratings[rating.id]) && (() => {
                    /*
                      The prompt wears the rating's own colour: amber for
                      Satisfactory, red for Poor.

                      Taken from BANDS by label rather than picked here,
                      because the five ratings and the five bands are the
                      same five words — Excellent through Poor — so the
                      match is meaningful rather than a coincidence, and
                      the colour cannot drift from the one the rest of
                      the app uses for that word.

                      Deliberately NOT bandFor(points): the rating scale
                      puts Satisfactory at 40, and on the score slab 40
                      is Poor, so that route would paint both of these
                      red and lose the distinction being drawn.
                    */
                    const tone = BANDS.find(b => b.label === ratings[rating.id])
                    return (
                      <div className="mt-2">
                        <label
                          htmlFor={`why-${rating.id}`}
                          className={clsx(
                            'mb-1 block text-xs font-medium',
                            tone?.accent ?? 'text-ink-700',
                          )}
                        >
                          Why {ratings[rating.id]?.toLowerCase()}?{' '}
                          {data?.employee.full_name.split(' ')[0]} will see this.
                        </label>
                        <textarea
                          id={`why-${rating.id}`}
                          rows={2}
                          className="input text-sm"
                          value={coreWhy[rating.id] ?? ''}
                          onChange={e => setCoreWhy({ ...coreWhy, [rating.id]: e.target.value })}
                          placeholder="e.g. three reports went out with figures that had to be corrected"
                        />
                      </div>
                    )
                  })()}
                  {/* Once scored, the same note read back rather than typed. */}
                  {!editable && rating.manager_remarks && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      {rating.manager_remarks}
                    </p>
                  )}
                </div>
                {/*
                  No "They said" column.

                  It showed the team member's own rating beside the
                  manager's box, which was the useful half of this row
                  while both of them rated core values. They no longer
                  rate them at all, so on any new month it can only ever
                  print a dash — a column heading over nothing, in the
                  one place a manager is trying to concentrate on five
                  judgements.
                */}
                <div className="mt-2 flex items-center gap-3 sm:mt-0">
                  <select
                    id={`core-${rating.id}`}
                    className={clsx(
                      'input w-44',
                      needsRating && 'border-amber-400 ring-1 ring-amber-300',
                    )}
                    disabled={!editable}
                    value={ratings[rating.id] ?? ''}
                    onChange={e => setRatings({ ...ratings, [rating.id]: e.target.value })}
                  >
                    {/* "Not rated" reads like a choice you may leave
                        selected. It is not one — the month cannot be
                        submitted on it — so it says what it is. */}
                    <option value="">Choose a rating…</option>
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
          <div className="sticky bottom-16 flex flex-wrap gap-2 lg:bottom-0">
            {/*
              Asked once before it counts.

              The manager's figure used to be averaged with the team
              member's own; since 0095 it IS the score. That is a real
              change in what this button does, and the people pressing it
              have been pressing it for months under the old rule. So it
              arms rather than fires — the same two-step the bulk approve
              on the approvals screen uses.

              The second line matters as much as the first: this is not a
              point of no return, and saying so is what keeps the warning
              from reading as a threat. The month stays open, the scores
              stay editable, and the team member can query them.
            */}
            {submission.status === 'submitted' && (
              arming ? (
                <div className="card w-full space-y-3 border-amber-300 p-4">
                  <div>
                    <p className="text-sm font-medium text-ink-900">
                      Submit these as {data?.employee.full_name.split(' ')[0]}'s
                      score for {monthLabel(submission.period_month)}?
                    </p>
                    <p className="mt-0.5 text-sm text-ink-500">
                      Your scores are the final score — the self-assessment
                      beside them is for comparison and does not count toward
                      the total. You can still correct anything until the month
                      closes, and {data?.employee.full_name.split(' ')[0]} can
                      raise a query on it.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={onSubmitScores} disabled={busy} className="btn-primary">
                      {busy ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                      Yes, submit my scores
                    </button>
                    <button onClick={() => setArming(false)} disabled={busy} className="btn-secondary">
                      Not yet
                    </button>
                  </div>
                </div>
              ) : (
                /*
                  Unfinished work sends you to it rather than refusing.

                  A disabled Submit is the lazy version of this: it says
                  no, gives no way to fix it, and on a phone there is no
                  tooltip to explain why. This screen already argues
                  against that a few lines below — "offering a button
                  that can only fail is how somebody ends up reading a
                  database error" — and the answer there is the same,
                  which is to put the thing they should do where the
                  thing they cannot do would have been.

                  So it is a real button that scrolls to the block and
                  focuses the first rating still to be given. It says how
                  many, and why it matters, because "you cannot submit"
                  without "and here is the 20% you have not scored" is
                  half an answer.
                */
                coreIncomplete ? (
                  <div className="card w-full space-y-3 border-amber-300 bg-amber-50/50 p-4">
                    {/* One panel for both, because they are one job —
                        finishing the core values — and two stacked
                        warnings for the same block would read as two
                        separate problems. */}
                    <div>
                      <p className="text-sm font-medium text-ink-900">
                        {unratedCore > 0 && (
                          <>
                            {unratedCore} core value{unratedCore === 1 ? '' : 's'} still
                            {unratedCore === 1 ? ' needs' : ' need'} a rating
                          </>
                        )}
                        {unratedCore > 0 && missingWhy > 0 && ', and '}
                        {missingWhy > 0 && (
                          <>
                            {unratedCore > 0 ? '' : `${missingWhy} `}
                            low rating{missingWhy === 1 ? '' : 's'}
                            {unratedCore > 0 ? ` (${missingWhy})` : ''}{' '}
                            {missingWhy === 1 ? 'needs' : 'need'} a reason
                          </>
                        )}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-600">
                        {unratedCore > 0 ? (
                          <>
                            They are worth {items.filter(i => i.section === 'core_values')
                              .reduce((a, i) => a + Number(i.weightage), 0)}% of{' '}
                            {data?.employee.full_name.split(' ')[0]}'s score, and only you
                            rate them — an unrated one scores nothing.
                          </>
                        ) : (
                          <>
                            Satisfactory or Poor is the score{' '}
                            {data?.employee.full_name.split(' ')[0]} can do least about
                            without knowing why. Say what happened — they will see it.
                          </>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        // Whichever comes first in the block: something
                        // unrated, or a low rating with no reason. Sending
                        // them to the top every time would make the second
                        // pass hunt for the row again.
                        const first = sortedRatings.find(
                          r => !ratings[r.id] || (needsWhy(ratings[r.id]) && !coreWhy[r.id]?.trim()),
                        )
                        // Focus first and tell the browser not to scroll for
                        // it, then scroll deliberately. Focusing after a
                        // timed delay was the other option and it is a race:
                        // too short and the smooth scroll cancels, too long
                        // and the cursor arrives after the person has
                        // started reading.
                        if (first) {
                          // The dropdown if it is unrated, otherwise the
                          // box asking why — land on the field that is
                          // actually missing, not on the one above it.
                          const target = !ratings[first.id]
                            ? `core-${first.id}`
                            : `why-${first.id}`
                          document.getElementById(target)?.focus({ preventScroll: true })
                        }
                        document.getElementById('core-values')?.scrollIntoView({
                          block: 'start',
                          // Somebody who has asked for less motion has asked
                          // for it here too.
                          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                            ? 'auto'
                            : 'smooth',
                        })
                      }}
                      className="btn-primary"
                    >
                      <ArrowDown className="h-4 w-4" />
                      Rate them now
                    </button>
                  </div>
                ) : (
                <button
                  onClick={() => { setError(null); setArming(true) }}
                  disabled={busy || needsCutReason}
                  className="btn-primary"
                  title={needsCutReason ? 'Say why the score is lower first' : undefined}
                >
                  {busy ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  {needsCutReason ? 'Say why the score is lower' : 'Submit my scores'}
                </button>
                )
              )
            )}
            {/* Exactly one thing closes a month, and which one depends
                on the setting. With a closing date, the calendar does it
                and the manager's job ends at Submit — no button to
                remember, no month sitting in a state nobody can explain.
                With no closing date, nothing would ever close, so the
                button comes back. Both at once would mean a month could
                be final for two different reasons. */}
            {submission.status === 'scored' && (
              <>
                <button
                  onClick={async () => {
                    if (!(await save())) return
                    // Straight back to the question, rather than leaving
                    // the manager on a form with nothing left to do on it.
                    if (fromQuery) navigate('/queries')
                    else setNotice('Saved.')
                  }}
                  // Mandatory on this path too. Submit is gated, but a
                  // month that is already scored is edited through here,
                  // and clearing a rating drops the core-values figure
                  // without anything on screen saying so.
                  disabled={busy || coreIncomplete}
                  title={coreIncomplete
                    ? 'Every core value needs a rating, and a low one needs a reason'
                    : undefined}
                  className="btn-primary"
                >
                  {busy ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  {unratedCore > 0
                    ? `Rate ${unratedCore} more core value${unratedCore === 1 ? '' : 's'}`
                    : missingWhy > 0
                      ? `Give a reason for ${missingWhy} low rating${missingWhy === 1 ? '' : 's'}`
                      : fromQuery ? 'Save and go back to the query' : 'Save changes'}
                </button>
                {/* Offering a button that can only fail is how somebody
                     ends up reading a database error. While a query is
                     open the month legitimately cannot close, so the
                     button is replaced by the thing they should do. */}
                {closingDay === null && !openQuery && (
                  <button onClick={onFinalize} disabled={busy} className="btn-secondary">
                    <Lock className="h-4 w-4" /> Finalise this month
                  </button>
                )}
                {openQuery && (
                  <Link to="/queries" className="btn-secondary">
                    <MessageSquare className="h-4 w-4" /> Answer the query first
                  </Link>
                )}
              </>
            )}
            <button
              onClick={() => setShowReturn(v => !v)}
              disabled={busy}
              className="btn-secondary"
            >
              <Undo2 className="h-4 w-4" /> Send back
            </button>
            {/* Wrongly submitted months are deleted, not corrected — but
                only with both the manager's and HR's approval. */}
            {openDeletion ? (
              <span className="badge bg-amber-100 text-amber-800">
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Deletion {openDeletion.status === 'pending_manager'
                  ? 'awaiting your decision on the Records screen'
                  : 'with HR'}
              </span>
            ) : (
              <button
                onClick={() => setShowDelete(v => !v)}
                disabled={busy}
                className="btn-secondary !text-cyrixRed-700"
              >
                <Trash2 className="h-4 w-4" /> Request deletion
              </button>
            )}
          </div>

          {showDelete && !openDeletion && (
            <div className="card space-y-3 border-cyrixRed-200 p-4">
              <div>
                <p className="font-medium text-ink-900">
                  Request deletion of {monthLabel(submission.period_month)}
                </p>
                <p className="mt-0.5 text-sm text-ink-500">
                  Goes to HR after you approve it. The figures are written to the
                  audit log before the record is removed.
                </p>
              </div>
              <textarea
                rows={2}
                className="input"
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                placeholder="e.g. Submitted against the wrong month"
              />
              <div className="flex gap-2">
                <button
                  onClick={onRequestDeletion}
                  disabled={!deleteReason.trim() || busy || requestAction.isPending}
                  className="btn-danger"
                >
                  {requestAction.isPending && <Spinner className="h-4 w-4" />}
                  Send to HR for approval
                </button>
                <button onClick={() => setShowDelete(false)} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          )}

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
