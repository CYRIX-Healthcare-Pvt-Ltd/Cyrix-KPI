import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { MessageCircle, X, SendHorizonal, BookOpen, Languages } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useAnnualSummary, useSubmissionHistory, useMyAssignment, usePendingCounts,
  useTeamMonth, useTeamSubmissions, useTatPolicy, useMonthClose,
  useKraAttainment, useMyCoreValueTrend, useCoreValues, currentFy,
} from '@/lib/queries'
import { currentReportingMonth } from '@/lib/fy'
import { useLang, say, READY_LANGS, type Lang } from '@/lib/i18n'
import { HELP } from '@/lib/help-strings'
import { CHAT } from '@/lib/chat-strings'
import { answerFact } from '@/lib/chatAnswers'
import { matchQuestion, SECTION_TITLE, type FactId } from '@/lib/chatbot'

/**
 * Answering the fifteen questions the floor actually asks.
 *
 * Two sources, both already in the building: the manual, which is 50
 * reviewed question-and-answer pairs in four languages, and the person's
 * own figures, which this screen has loaded anyway. See lib/chatbot.ts
 * for why neither of them is a language model.
 *
 * It uses their first name and answers in whichever language they read
 * the manual in — the same setting, so choosing Malayalam once covers
 * both. Every answer it gives from the manual carries the link to the
 * section it came from, and every answer it cannot give says so and
 * points at the same place.
 */

interface Turn {
  from: 'them' | 'app'
  text: string
  /** Manual section this came from, for the link under it. */
  section?: string
  /** Show the link to the manual under this answer. */
  manualLink?: boolean
}

export default function ChatBot() {
  const { employee, isManager, isHrAdmin, isSwAdmin } = useAuth()
  const fy = currentFy()
  const [lang, setLang] = useLang()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const endRef = useRef<HTMLDivElement>(null)

  const { data: annual } = useAnnualSummary(employee?.id, fy)
  const { data: history } = useSubmissionHistory(employee?.id, fy)
  const { data: assignment } = useMyAssignment(employee?.id, fy)
  const { data: pending } = usePendingCounts(employee?.id, fy)
  // A manager's questions are mostly about somebody else. Only fetched
  // for a manager, and the server filters it to their own reports.
  const { data: teamNow } = useTeamMonth(
    isManager ? employee?.id : undefined, currentReportingMonth(), fy)
  const teamIds = (teamNow?.team ?? []).map(t => t.id)
  const { data: teamMonths } = useTeamSubmissions(
    teamIds.length ? teamIds : undefined, fy)
  // Which ROW is weakest, not which block. The section totals cannot
  // answer "in which job role am I worst" — that is the one question the
  // 80/20 split is guaranteed not to help with.
  const { data: kras } = useKraAttainment(employee ? [employee.id] : undefined, fy)
  const { data: coreTrend } = useMyCoreValueTrend(employee?.id, fy)
  const { data: coreValues } = useCoreValues()
  // The manual states deadlines as {tmDays} and {mgrDays}, filled from
  // live settings. The Help page has always done this; the panel quoted
  // the same sentences without them and printed the braces at people.
  const { data: policy } = useTatPolicy()
  const closingDay = useMonthClose().data ?? null

  /**
   * What to call them, and when not to call them anything.
   *
   * SW_ADMIN's record is named "Software Administrator", so the first
   * word of it is "Software" and the panel opened with "Hello Software".
   * The underscore codes are shared system logins rather than people —
   * there is nobody on the other side of them to greet by name.
   */
  const systemAccount = (employee?.ecode ?? '').includes('_')
  const firstName = systemAccount
    ? ''
    : employee?.full_name.trim().split(/\s+/)[0] ?? ''

  const t = (key: string, vars?: Record<string, string | number>) =>
    say(HELP[key], lang, {
      tmDays: policy?.tm_grace_days ?? 3,
      mgrDays: policy?.manager_grace_days ?? 5,
      closingDay: closingDay ?? '',
      ...vars,
    })
  const c = (key: string, vars?: Record<string, string | number>) =>
    // Trimmed because every one of these can take an empty {name}, and a
    // system account should not be greeted as "Hello ." either.
    // Only a full stop with a space in front of it. Taking the space off
    // the em dash too produced "The manual may— or ask".
    say(CHAT[key], lang, vars).replace(/,?\s+\./g, '.').replace(/\s{2,}/g, ' ').trim()

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' })
  }, [turns, open])

  /*
    Greeted by name, and re-greeted in the new language if they switch.

    Only the opening line is rewritten: everything after it is a real
    exchange, and silently restating somebody's earlier answers in a
    different language would be rewriting what they were told.
  */
  useEffect(() => {
    if (!open) return
    setTurns(prev => (prev.length <= 1
      ? [{ from: 'app', text: c('greeting', { name: firstName }) }]
      : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, firstName, lang])

  /**
   * Built from data this screen has loaded anyway. The sentence itself
   * is assembled in lib/chatAnswers.ts so it can be run against the real
   * database without a browser — which is how "lowest score teammember
   * in july" was found to be answering with the manager's own score.
   */
  const factAnswer = (id: FactId, month?: number, ecode?: string): string =>
    answerFact(id, {
      lang, fy, firstName,
      me: { full_name: employee?.full_name ?? '', ecode: employee?.ecode ?? '' },
      history: history ?? [],
      annual: annual ?? null,
      kpiStatus: assignment?.assignment?.status ?? null,
      pending: pending ?? null,
      team: teamNow?.team ?? [],
      teamMonths: teamMonths ?? [],
      kras: kras ?? [],
      coreTrend: coreTrend ?? [],
      coreValues: coreValues ?? [],
      month, ecode,
    })

  const ask = (question: string) => {
    const q = question.trim()
    if (!q) return
    const found = matchQuestion(q, {
      isManager, isHrAdmin, isSwAdmin, team: teamNow?.team ?? [],
    })
    const reply: Turn =
      found.kind === 'fact'
        ? {
            from: 'app',
            text: factAnswer(found.id, found.month, found.ecode),
            manualLink: found.id === 'manual',
          }
        : found.kind === 'manual'
          ? {
              from: 'app',
              // The manual's own answer, in their language, so nothing is
              // paraphrased into meaning something slightly different.
              text: t(`${found.key}.how`) || t(`${found.key}.how.base`),
              section: found.section,
            }
          : {
              from: 'app',
              text: c('lost', { name: firstName }),
              manualLink: true,
            }
    setTurns(prev => [...prev, { from: 'them', text: q }, reply])
    setDraft('')
  }

  if (!employee) return null

  return (
    <>
      {/* Above the mobile nav bar, out of the thumb's way on the tab it
          would otherwise cover. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask about your KPI"
          className="btn-press fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-shade text-white shadow-lg hover:bg-cyrixRed-600 hover:text-white lg:bottom-6"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      )}

      {open && (
        <div className="animate-pop-in fixed inset-x-3 bottom-20 z-40 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-ink-200 bg-surface shadow-2xl sm:inset-x-auto sm:right-4 sm:w-96 lg:bottom-6">
          <div className="flex items-center justify-between gap-2 border-b border-ink-200 bg-shade px-4 py-3 text-white">
            <p className="text-sm font-semibold">Ask about your KPI</p>
            <div className="flex items-center gap-1">
              <Languages className="h-3.5 w-3.5 text-white/50" />
              <select
                value={lang}
                onChange={e => setLang(e.target.value as Lang)}
                aria-label="Reply language"
                className="select-on-dark rounded bg-white/10 px-1.5 py-1 text-xs text-white outline-none"
              >
                {READY_LANGS.map(l => (
                  <option key={l.code} value={l.code} className="text-ink-900">
                    {l.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="ml-1 rounded p-1 hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {turns.map((turn, i) => (
              <div
                key={i}
                className={clsx('flex', turn.from === 'them' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={clsx(
                    'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                    turn.from === 'them'
                      ? 'rounded-br-sm bg-ink-900 text-onInk'
                      : 'rounded-bl-sm bg-ink-100 text-ink-800',
                  )}
                >
                  {turn.text}
                  {(turn.section || turn.manualLink) && (
                    <Link
                      to="/help"
                      onClick={() => setOpen(false)}
                      className="mt-2 flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-900"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      {turn.section && SECTION_TITLE[turn.section]
                        ? t(SECTION_TITLE[turn.section])
                        : t('page.title')}
                    </Link>
                  )}
                </div>
              </div>
            ))}

            {turns.length <= 1 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {/* A manager's first questions are about their team, not
                    about their own KPI — everybody got the same four,
                    and none of them were the ones a manager opens this
                    panel to ask. Only offered where there is an answer:
                    a manager with no scored month behind them would be
                    shown a chip that returns "nothing scored yet". */}
                {(isManager
                  ? [
                      'Who has not submitted yet?',
                      'Who is the lowest in my team?',
                      'My team average',
                      'How do I approve a KPI?',
                    ]
                  : [
                      'How do I set up my KPI?',
                      'What was my score last month?',
                      'My average this year',
                      'Why can I not open this month?',
                    ]
                ).map(q => (
                  <button
                    key={q}
                    onClick={() => ask(q)}
                    className="rounded-full border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:border-ink-400 hover:text-ink-900"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={e => { e.preventDefault(); ask(draft) }}
            className="flex items-center gap-2 border-t border-ink-200 p-2"
          >
            <input
              className="input !py-2"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Type your question…"
              aria-label="Your question"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send"
              className="btn-press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-shade text-white disabled:opacity-40"
            >
              <SendHorizonal className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  )
}
