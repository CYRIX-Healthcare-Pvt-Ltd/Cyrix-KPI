import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  MessageSquare, Paperclip, CheckCircle2, Pencil, Eye, ExternalLink,
} from 'lucide-react'
import {
  useScoreQueries, useAnswerScoreQuery, evidenceUrl, purgeExpiredEvidence,
  type ScoreQueryRow,
} from '@/lib/queries'
import { monthLabel } from '@/lib/fy'
import { PageLoader, Alert, Spinner, EmptyState, StatTile, ScorePill } from '@/components/ui'
import type { ScoreQueryPoint, KpiSubmissionItem } from '@/types/db'

/**
 * Queries a team member has raised about how a month was scored.
 *
 * One screen, two readings. A manager sees their own team's and can
 * answer; HR sees everybody's and cannot. HR's read-only-ness is a role,
 * not a different query — the database decides who sees what, and this
 * only decides who is offered a reply box.
 *
 * HR's presence here is the point of the tab. A disagreement about
 * somebody's appraisal that only the two people arguing can see is not
 * a process, and the manager being the sole judge of a complaint about
 * the manager is the thing HR exists to be able to look at.
 */
export default function ScoreQueries({ readOnly = false }: { readOnly?: boolean }) {
  const { data, isLoading, error } = useScoreQueries(true)
  const [purged, setPurged] = useState(0)

  // No scheduler in this system, so the retention rule runs where the
  // records are read. Anything whose window has closed on an answered
  // query goes now — see purgeExpiredEvidence.
  useEffect(() => {
    if (!data?.length) return
    let alive = true
    purgeExpiredEvidence().then(n => { if (alive && n > 0) setPurged(n) })
    return () => { alive = false }
  }, [data])

  if (isLoading) return <PageLoader label="Loading queries…" />
  if (error) return <Alert kind="error">{(error as Error).message}</Alert>

  const rows = data ?? []
  const open = rows.filter(r => r.query.status === 'open')
  const answered = rows.filter(r => r.query.status === 'answered')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900">
          <MessageSquare className="h-5 w-5 text-cyrixRed-600" />
          {readOnly ? 'Score queries' : 'Queries from my team'}
        </h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {readOnly
            ? 'Every query raised across the company, and how it was answered. View only.'
            : 'A team member has asked about rows you scored. The month cannot be finalised until you reply.'}
        </p>
      </div>

      {purged > 0 && (
        <Alert kind="info">
          {purged} attachment{purged === 1 ? '' : 's'} removed — those queries
          are answered and their window has closed.
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Waiting for a reply"
          value={open.length}
          tone={open.length > 0 ? 'brand' : 'default'}
        />
        <StatTile label="Answered" value={answered.length} />
        <StatTile
          label="Score changed"
          value={answered.filter(r => r.query.score_changed).length}
          sub="of those answered"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={MessageSquare} title="Nothing queried">
          {readOnly
            ? 'Nobody has questioned a score yet.'
            : 'Nobody on your team has questioned a score.'}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {[...open, ...answered].map(row => (
            <QueryCard key={row.query.id} row={row} readOnly={readOnly} />
          ))}
        </div>
      )}
    </div>
  )
}

function QueryCard({ row, readOnly }: { row: ScoreQueryRow; readOnly: boolean }) {
  const answer = useAnswerScoreQuery()
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)
  const open = row.query.status === 'open'

  const byId = useMemo(
    () => new Map(row.items.map(i => [i.id, i])),
    [row.items],
  )

  const send = async () => {
    setError(null)
    try {
      await answer.mutateAsync({ queryId: row.query.id, response: reply })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that reply.')
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-ink-50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink-900">
            {row.employee?.full_name ?? 'A team member'}
            <span className="ml-2 text-sm font-normal text-ink-500">
              {row.employee?.ecode}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {row.submission && monthLabel(row.submission.period_month)} ·
            raised {new Date(row.query.raised_at).toLocaleDateString('en-GB')} ·
            {' '}{row.points.length} row{row.points.length === 1 ? '' : 's'}
          </p>
        </div>
        <span className={clsx(
          'badge',
          open ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800',
        )}>
          {open ? 'Needs your reply' : 'Answered'}
        </span>
        {row.submission && !readOnly && open && (
          <Link
            to={`/score/${row.submission.id}`}
            state={{ fromQuery: row.query.id }}
            className="btn-secondary !px-2.5 !py-1.5 text-xs"
          >
            <Pencil className="h-3.5 w-3.5" /> Revise the scores
          </Link>
        )}
      </div>

      <div className="space-y-3 p-4">
        {/* What the total was when they asked, and what it is now.
            The manager revises scores on another screen and comes back
            here to reply, so without this they are answering from memory
            about whether their own change landed. */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-50 px-3 py-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-label text-ink-400">
            Manager total
          </span>
          <span className="tabular-nums text-ink-600">
            {row.query.mgr_total_at_raise?.toFixed(2) ?? '—'}
          </span>
          <span className="text-ink-300">when asked</span>
          {row.submission?.mgr_total_score != null && (
            <>
              <span className="text-ink-300">&rarr;</span>
              <span className={clsx(
                'font-semibold tabular-nums',
                row.query.mgr_total_at_raise != null &&
                Math.abs(row.submission.mgr_total_score - row.query.mgr_total_at_raise) > 0.001
                  ? 'text-emerald-700'
                  : 'text-ink-700',
              )}>
                {row.submission.mgr_total_score.toFixed(2)}
              </span>
              <span className="text-ink-400">now</span>
            </>
          )}
        </div>

        {row.query.employee_note && (
          <p className="text-sm italic text-ink-700">“{row.query.employee_note}”</p>
        )}

        {row.points.map(p => (
          <PointRow key={p.id} point={p} item={byId.get(p.item_id)} />
        ))}

        {open && !readOnly && (
          <div className="space-y-2 border-t border-ink-100 pt-3">
            <label className="label text-xs" htmlFor={`reply-${row.query.id}`}>
              Your reply
            </label>
            <textarea
              id={`reply-${row.query.id}`}
              rows={3}
              className="input"
              value={reply}
              onChange={e => setReply(e.target.value)}
              placeholder="Explain the figure, or say what you have changed and why"
            />
            {error && <Alert kind="error">{error}</Alert>}
            <p className="text-xs text-ink-400">
              If a score needs correcting, revise it first — whether it moved is
              recorded from the scores themselves, not from what the reply says.
            </p>
            <button
              onClick={send}
              disabled={!reply.trim() || answer.isPending}
              className="btn-primary"
            >
              {answer.isPending ? <Spinner className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              Send reply and close
            </button>
          </div>
        )}

        {open && readOnly && (
          <p className="flex items-center gap-1.5 border-t border-ink-100 pt-3 text-xs text-ink-400">
            <Eye className="h-3.5 w-3.5" />
            Waiting on {row.employee?.full_name?.split(' ')[0] ?? 'the'}'s reporting
            manager. HR sees this, and does not answer it.
          </p>
        )}

        {!open && row.query.manager_response && (
          <div className="rounded-lg bg-ink-50 p-3">
            <p className="text-xs font-medium text-ink-500">
              Reply · {row.query.answered_at &&
                new Date(row.query.answered_at).toLocaleDateString('en-GB')}
            </p>
            <p className="mt-1 text-sm text-ink-800">{row.query.manager_response}</p>
            <p className={clsx(
              'mt-1.5 text-xs font-medium',
              row.query.score_changed ? 'text-emerald-700' : 'text-ink-500',
            )}>
              {row.query.score_changed
                ? 'The score was changed as a result.'
                : 'The score was left as it was.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function PointRow({
  point, item,
}: {
  point: ScoreQueryPoint
  item: KpiSubmissionItem | undefined
}) {
  const [busy, setBusy] = useState(false)

  const openEvidence = async () => {
    if (!point.evidence_path) return
    setBusy(true)
    try {
      // Signed for two minutes. The bucket is private, so there is no URL
      // to hand around and nothing to leak if this page is screenshotted.
      window.open(await evidenceUrl(point.evidence_path), '_blank', 'noopener')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-ink-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-900">
            {item?.kra ?? 'A row of this month'}
          </p>
          <span className={clsx(
            'badge mt-1',
            point.kind === 'disagreement'
              ? 'bg-cyrixRed-100 text-cyrixRed-800'
              : 'bg-ink-100 text-ink-700',
          )}>
            {point.kind === 'disagreement' ? 'Thinks this is wrong' : 'Wants it explained'}
          </span>
        </div>
        {item && (
          <div className="flex items-center gap-3 text-xs text-ink-500">
            <span>
              They claimed <ScorePill value={item.self_score} outOf={item.weightage} size="sm" />
            </span>
            <span>
              You scored <ScorePill value={item.manager_score} outOf={item.weightage} size="sm" />
            </span>
          </div>
        )}
      </div>

      {(point.sub_items ?? []).length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-400">Specifically:</span>
          {point.sub_items!.map(name => (
            <span key={name} className="badge bg-cyrixRed-50 text-cyrixRed-800">
              {name}
            </span>
          ))}
        </p>
      )}

      {point.note && <p className="mt-2 text-sm text-ink-600">{point.note}</p>}

      {point.evidence_name && (
        <p className="mt-2">
          {point.evidence_path ? (
            <button
              onClick={openEvidence}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-700 hover:text-ink-900 hover:underline"
            >
              {busy ? <Spinner className="h-3.5 w-3.5" /> : <Paperclip className="h-3.5 w-3.5" />}
              {point.evidence_name}
              <ExternalLink className="h-3 w-3" />
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-400">
              <Paperclip className="h-3.5 w-3.5" />
              {point.evidence_name} — removed, the window has closed
            </span>
          )}
        </p>
      )}
    </div>
  )
}
