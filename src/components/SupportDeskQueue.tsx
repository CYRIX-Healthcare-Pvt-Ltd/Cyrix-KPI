import { useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, Clock, Send, Inbox } from 'lucide-react'
import { useDeskTickets, useAnswerTicket } from '@/lib/queries'
import { Alert, PageLoader, Spinner, EmptyState } from '@/components/ui'
import Avatar from '@/components/Avatar'
import { waitingLabel, turnaroundLabel, daysWaiting } from '@/lib/tat'
import type { SupportDesk } from '@/types/db'

/**
 * One desk's queue: what people have asked, and the box to answer in.
 *
 * Unanswered first and oldest first inside that, which is the order the
 * work should be done in — a queue sorted newest-first quietly buries
 * whoever has been waiting longest, and they are the person the queue
 * exists for.
 *
 * The answer box is on the row rather than behind a dialog. Every one of
 * these is a paragraph, and a dialog for a paragraph is a click and a
 * scroll position lost for nothing.
 */
export default function SupportDeskQueue({
  desk, enabled,
}: {
  desk: SupportDesk
  /** False for anybody who does not staff this desk — the query is skipped. */
  enabled: boolean
}) {
  const { data: tickets, isLoading } = useDeskTickets(desk, enabled)
  const answer = useAnswerTicket()
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (isLoading) return <PageLoader />

  const rows = tickets ?? []
  const open = rows.filter(t => t.status === 'open')
  const overdue = open.filter(t => daysWaiting(t.raised_at) >= 1).length

  if (rows.length === 0) {
    return (
      <EmptyState icon={Inbox} title="Nothing waiting">
        Questions people send to this desk arrive here.
      </EmptyState>
    )
  }

  const send = async (id: string) => {
    setError(null)
    try {
      await answer.mutateAsync({ id, response: draft.trim() })
      setReplyTo(null)
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that answer.')
    }
  }

  // With the time: two requests raised the same day read as the same
  // moment, and whether somebody has waited an hour or all day is what
  // decides which one to answer first.
  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    })

  return (
    <div className="space-y-3">
      {error && <Alert kind="error">{error}</Alert>}

      <p className="text-sm text-ink-500">
        {open.length === 0
          ? `All ${rows.length} answered.`
          : `${open.length} waiting, oldest first`}
        {/* The figure the reminder mail is sent on, said where the work
            is: anything over a day is chased by email tonight. */}
        {overdue > 0 && (
          <span className="font-medium text-cyrixRed-700">
            {' '}· {overdue} over a day
          </span>
        )}
      </p>

      {rows.map(t => {
        const answered = t.status === 'answered'
        const waited = waitingLabel(t.raised_at)
        const who = t.employee
        return (
          <div
            key={t.id}
            className={clsx(
              'card overflow-hidden',
              // The same amber edge the team list uses for the same
              // meaning: this one is waiting on you.
              !answered && 'border-l-4 border-amber-500',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar name={who?.full_name ?? "—"} src={who?.avatar} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">
                    {who?.full_name ?? "Someone"}
                  </p>
                  <p className="truncate text-xs text-ink-500">
                    {who?.ecode} · {when(t.raised_at)}
                  </p>
                </div>
              </div>
              {/*
                How long, not only that it is waiting.

                "Waiting" said the same thing on an hour-old question and
                a five-day-old one, and the five-day-old one is the whole
                reason anybody opens this screen. A day is the line the
                reminder mail chases on, so it is the line the badge
                changes colour on — screen and email agree.
              */}
              {answered ? (
                <span className="badge bg-emerald-100 text-emerald-900">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  {turnaroundLabel(t.raised_at, t.answered_at) || 'Answered'}
                </span>
              ) : (
                <span
                  className={clsx('badge', {
                    'bg-amber-100 text-amber-900': waited.tone === 'ok',
                    'bg-orange-100 text-orange-900': waited.tone === 'warn',
                    'bg-cyrixRed-100 text-cyrixRed-900': waited.tone === 'late',
                  })}
                >
                  <Clock className="mr-1 h-3 w-3" /> {waited.text}
                </span>
              )}
            </div>

            <div className="space-y-3 p-4">
              <p className="whitespace-pre-wrap text-sm text-ink-900">{t.employee_note}</p>

              {answered ? (
                <div className="border-l-2 border-emerald-500 pl-3">
                  <p className="text-[11px] font-semibold uppercase tracking-label text-ink-400">
                    Answered {when(t.answered_at!)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-800">{t.response}</p>
                </div>
              ) : replyTo === t.id ? (
                <div className="space-y-2">
                  <textarea
                    rows={4}
                    className="input"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="Your answer. They see this and the request closes."
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => send(t.id)}
                      disabled={draft.trim().length < 2 || answer.isPending}
                      className="btn-primary"
                    >
                      {answer.isPending
                        ? <Spinner className="h-4 w-4" />
                        : <Send className="h-4 w-4" />}
                      Send answer
                    </button>
                    <button
                      onClick={() => { setReplyTo(null); setDraft('') }}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                  {/* Said before they send rather than after. There is no
                      second reply, so the first one has to be the whole
                      answer. */}
                  <p className="text-xs text-ink-400">
                    One answer closes it. If more is needed they raise another.
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => { setReplyTo(t.id); setDraft('') }}
                  className="btn-secondary"
                >
                  <Send className="h-4 w-4" /> Answer
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
