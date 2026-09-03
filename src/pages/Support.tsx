import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  LifeBuoy, IdCard, Wrench, MessageSquarePlus, ListChecks, Send,
  CheckCircle2, Clock, MessageSquareWarning,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useMyTickets, useRaiseTicket } from '@/lib/queries'
import { Alert, PageLoader, Spinner, EmptyState } from '@/components/ui'
import type { SupportDesk } from '@/types/db'

/**
 * Asking HR or Software something, and seeing what came back.
 *
 * The app already has six ways to request something and every one of
 * them is attached to a record and travels up the reporting line — a
 * score, a month, a person. This is the other kind: "my leave balance
 * looks wrong", "the page will not load". It goes to a desk.
 *
 * Two tabs rather than two pages. Raising and chasing are the same
 * errand five minutes apart, and somebody who has just sent one wants to
 * see it land.
 */

const DESKS: Array<{
  key: SupportDesk
  name: string
  icon: typeof IdCard
  takes: string
  /** Tinted so the two are told apart before either is read. */
  on: string
}> = [
  {
    key: 'hr',
    name: 'HR',
    icon: IdCard,
    takes: 'Leave, attendance, your employee record, policy — anything about your employment.',
    on: 'border-ink-900 bg-ink-50 text-ink-900',
  },
  {
    key: 'software',
    name: 'Software',
    icon: Wrench,
    takes: 'Something broken, something you cannot get into, or anything about how the app behaves.',
    on: 'border-ink-900 bg-ink-50 text-ink-900',
  },
]

export default function Support() {
  const { employee } = useAuth()
  const [tab, setTab] = useState<'raise' | 'mine'>('raise')
  const { data: tickets, isLoading } = useMyTickets(employee?.id)

  const open = (tickets ?? []).filter(t => t.status === 'open').length

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900">
          <LifeBuoy className="h-5 w-5 text-teal-600" />
          Contact support
        </h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Ask HR or Software something. You get one answer back, here.
        </p>
      </div>

      {/* Two tabs, the second carrying its own count — the number is the
          reason to look at it, so it belongs on it rather than in a
          sentence underneath. */}
      <div className="flex gap-1 border-b border-ink-200">
        {([
          ['raise', 'Raise a request', MessageSquarePlus, 0],
          ['mine', 'My requests', ListChecks, open],
        ] as const).map(([key, label, Icon, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
            className={clsx(
              'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === key
                ? 'border-ink-900 text-ink-900'
                : 'border-transparent text-ink-400 hover:text-ink-700',
            )}
          >
            <Icon className="h-4 w-4" /> {label}
            {count > 0 && (
              <span className="badge bg-amber-200 text-amber-900">{count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'raise'
        ? <RaiseForm onSent={() => setTab('mine')} />
        : isLoading
          ? <PageLoader />
          : <MyTickets tickets={tickets ?? []} onRaise={() => setTab('raise')} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function RaiseForm({ onSent }: { onSent: () => void }) {
  const raise = useRaiseTicket()
  const [desk, setDesk] = useState<SupportDesk | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    if (!desk) return
    setError(null)
    try {
      await raise.mutateAsync({ desk, note: note.trim() })
      setNote('')
      setDesk(null)
      onSent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that.')
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}

      {/*
        The one thing this must not become.

        A score dispute has its own flow with consequences this one does
        not have — it holds the month open until the manager answers. Two
        doors to the same room is how one of them stops being used
        properly, so this says so before anybody types.
      */}
      <Alert kind="info" title="Is it about a score?">
        A score you disagree with goes to your manager, not here — open the
        month and raise a query on it, so the month stays open until they
        answer. <Link to="/history" className="font-medium underline">My assessments</Link>
      </Alert>

      <div>
        <p className="label mb-2">Who is it for?</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {DESKS.map(d => (
            <button
              key={d.key}
              onClick={() => setDesk(d.key)}
              aria-pressed={desk === d.key}
              className={clsx(
                'rounded-xl border-2 p-4 text-left transition-colors',
                desk === d.key ? d.on : 'border-ink-200 hover:border-ink-300',
              )}
            >
              <p className="flex items-center gap-2 font-medium">
                <d.icon className="h-4 w-4 shrink-0" /> {d.name}
              </p>
              <p className={clsx('mt-1 text-xs', desk === d.key ? '' : 'text-ink-500')}>
                {d.takes}
              </p>
            </button>
          ))}
        </div>
      </div>

      {desk && (
        <div className="animate-pop-in space-y-3">
          <div>
            <label htmlFor="ticket" className="label">What do you need?</label>
            <textarea
              id="ticket"
              rows={5}
              className="input mt-1"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={desk === 'hr'
                ? 'e.g. My leave balance shows 4 days but I have taken only 2 this year.'
                : 'e.g. My Team does not load on my phone — it stays on the spinner.'}
              autoFocus
            />
            {/* Counted down rather than up: the limit is the useful
                number once somebody is near it, and irrelevant before. */}
            <p className="mt-1 text-xs text-ink-400">
              {note.trim().length < 5
                ? 'A sentence or two is plenty.'
                : `${2000 - note.trim().length} characters left.`}
            </p>
          </div>

          <button
            onClick={send}
            disabled={note.trim().length < 5 || raise.isPending}
            className="btn-primary"
          >
            {raise.isPending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            Send to {DESKS.find(d => d.key === desk)!.name}
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function MyTickets({
  tickets, onRaise,
}: {
  tickets: Array<{
    id: string; desk: SupportDesk; employee_note: string; raised_at: string
    response: string | null; answered_at: string | null; status: string
  }>
  onRaise: () => void
}) {
  if (tickets.length === 0) {
    return (
      <EmptyState icon={MessageSquareWarning} title="Nothing raised yet">
        <p>When you ask HR or Software something, it shows here with their answer.</p>
        <button onClick={onRaise} className="btn-primary mt-4">
          <MessageSquarePlus className="h-4 w-4" /> Raise a request
        </button>
      </EmptyState>
    )
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric',
    })

  return (
    <div className="space-y-3">
      {tickets.map(t => {
        const d = DESKS.find(x => x.key === t.desk)!
        const answered = t.status === 'answered'
        return (
          <div key={t.id} className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
              <p className="flex items-center gap-1.5 text-sm font-medium text-ink-800">
                <d.icon className="h-4 w-4 text-ink-500" /> {d.name}
                <span className="font-normal text-ink-400">· {when(t.raised_at)}</span>
              </p>
              {/* Waiting is amber and answered is green, the same two
                  meanings those colours carry everywhere else here. */}
              <span
                className={clsx(
                  'badge',
                  answered ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900',
                )}
              >
                {answered
                  ? <><CheckCircle2 className="mr-1 h-3 w-3" /> Answered</>
                  : <><Clock className="mr-1 h-3 w-3" /> Waiting</>}
              </span>
            </div>

            <div className="space-y-3 p-4">
              <p className="whitespace-pre-wrap text-sm text-ink-900">{t.employee_note}</p>

              {answered ? (
                /* Indented under the question, the way a reply reads. */
                <div className="border-l-2 border-emerald-500 pl-3">
                  <p className="text-[11px] font-semibold uppercase tracking-label text-ink-400">
                    {d.name} replied · {when(t.answered_at!)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-800">{t.response}</p>
                </div>
              ) : (
                <p className="text-xs text-ink-400">
                  Waiting for {d.name} to reply. You will see their answer here.
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
