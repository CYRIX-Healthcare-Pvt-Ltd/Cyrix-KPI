import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { MessageCircle, X, SendHorizonal, BookOpen, Languages } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useAnnualSummary, useSubmissionHistory, useMyAssignment, usePendingCounts, currentFy,
} from '@/lib/queries'
import { monthLabel } from '@/lib/fy'
import { bandFor } from '@/lib/bands'
import { useLang, say, READY_LANGS, type Lang } from '@/lib/i18n'
import { HELP } from '@/lib/help-strings'
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
  /** Offer the manual, because nothing was understood. */
  lost?: boolean
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

  const firstName = employee?.full_name.split(' ')[0] ?? 'there'
  const t = (key: string, vars?: Record<string, string | number>) =>
    say(HELP[key], lang, vars)

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' })
  }, [turns, open])

  // Greeted by name, once, when they open it. Rebuilt on a language
  // change so the greeting is not left in the language they just left.
  useEffect(() => {
    if (!open) return
    setTurns(prev => (prev.length === 0
      ? [{ from: 'app', text: `Hello ${firstName}. Ask me anything about your KPI — in English, മലയാളം, हिन्दी or తెలుగు.` }]
      : prev))
  }, [open, firstName])

  const factAnswer = (id: FactId, month?: number): string => {
    const scored = (history ?? []).filter(
      s => s.final_total_score !== null || s.mgr_total_score !== null)
    const latest = scored[scored.length - 1]
    const scoreOf = (s: typeof latest) =>
      s?.final_total_score ?? s?.mgr_total_score ?? null

    switch (id) {
      case 'score.last': {
        if (!latest) return `No month has been scored for you yet, ${firstName}.`
        const v = scoreOf(latest)
        const band = bandFor(v)
        return `${monthLabel(latest.period_month)} came to ${v?.toFixed(2)} out of 100` +
          (band ? ` — ${band.label}.` : '.')
      }
      case 'score.month': {
        // The name they said, resolved against their own financial year
        // — April to March, so January belongs to the calendar year
        // after the one the FY is named for.
        const [startYear] = fy.split('-').map(Number)
        const year = month! >= 3 ? startYear : startYear + 1
        const key = `${year}-${String(month! + 1).padStart(2, '0')}-01`
        const row = (history ?? []).find(s => s.period_month.startsWith(key.slice(0, 7)))
        const v = row ? scoreOf(row) : null
        const name = monthLabel(key)

        if (!row) return `${name} has not been assessed. Nothing was submitted for it.`
        if (v === null) {
          return row.status === 'submitted'
            ? `${name} is with your manager and has not been scored yet.`
            : `${name} is still a draft — it has not been sent in yet.`
        }
        const band = bandFor(v)
        return `${name} came to ${v.toFixed(2)} out of 100` + (band ? ` — ${band.label}.` : '.')
      }
      case 'score.year': {
        const avg = annual?.avg_total_score
        if (avg === null || avg === undefined) {
          return `Nothing has been scored yet this year, so there is no average to show.`
        }
        const band = bandFor(avg)
        return `Your FY ${fy} average is ${avg.toFixed(2)} across ` +
          `${annual?.months_scored ?? 0} scored month${annual?.months_scored === 1 ? '' : 's'}` +
          (band ? `, which is ${band.label}.` : '.')
      }
      case 'score.split': {
        if (!annual || annual.avg_total_score === null) {
          return 'Nothing has been scored yet, so there is no split to show.'
        }
        const bits = [
          `Job Role ${annual.avg_job_role_score?.toFixed(1) ?? '—'} of 80`,
          annual.avg_esms_score !== null ? `ESMS ${annual.avg_esms_score.toFixed(1)} of 5` : null,
          `Core Values ${annual.avg_core_values_score?.toFixed(1) ?? '—'} of ` +
            (annual.avg_esms_score !== null ? '15' : '20'),
        ].filter(Boolean)
        return `On average this year: ${bits.join(', ')}.`
      }
      case 'score.months': {
        const done = annual?.months_scored ?? 0
        const open_ = (history ?? []).filter(
          s => s.status === 'draft' || s.status === 'submitted').length
        return `${done} month${done === 1 ? '' : 's'} scored so far` +
          (open_ ? `, and ${open_} still with you or your manager.` : '.')
      }
      case 'score.bestworst': {
        const hi = annual?.highest_month, lo = annual?.lowest_month
        if (hi === null || hi === undefined) return 'Nothing scored yet this year.'
        return `Your best month so far is ${hi.toFixed(2)} and your lowest is ` +
          `${lo?.toFixed(2) ?? '—'}, out of 100.`
      }
      case 'kpi.status': {
        const said: Record<string, string> = {
          active: 'Your KPI is approved and in force for the year.',
          pending_approval: 'Your KPI is with your manager, waiting to be approved.',
          rejected: 'Your manager sent your KPI back. Open My KPI to see why, change it and send it again.',
          draft: 'Your KPI is still a draft. Finish it and send it to your manager.',
        }
        return said[assignment?.assignment?.status ?? '']
          ?? 'You have not set up a KPI for this year yet.'
      }
      case 'team.pending': {
        const k = pending?.approvals ?? 0
        const m = pending?.scoring ?? 0
        if (!k && !m) return 'Nothing is waiting on you right now.'
        return [
          k ? `${k} KPI${k === 1 ? '' : 's'} to approve` : null,
          m ? `${m} month${m === 1 ? '' : 's'} to score` : null,
        ].filter(Boolean).join(' and ') + '.'
      }
    }
  }

  const ask = (question: string) => {
    const q = question.trim()
    if (!q) return
    const found = matchQuestion(q, { isManager, isHrAdmin, isSwAdmin })
    const reply: Turn =
      found.kind === 'fact'
        ? { from: 'app', text: factAnswer(found.id, found.month) }
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
              text: `I do not know that one, ${firstName}. The manual may — or ask your manager.`,
              lost: true,
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
          className="btn-press fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-ink-950 text-white shadow-lg hover:bg-cyrixRed-600 lg:bottom-6"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      )}

      {open && (
        <div className="animate-pop-in fixed inset-x-3 bottom-20 z-40 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-2xl sm:inset-x-auto sm:right-4 sm:w-96 lg:bottom-6">
          <div className="flex items-center justify-between gap-2 border-b border-ink-200 bg-ink-950 px-4 py-3 text-white">
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
                      ? 'rounded-br-sm bg-ink-900 text-white'
                      : 'rounded-bl-sm bg-ink-100 text-ink-800',
                  )}
                >
                  {turn.text}
                  {(turn.section || turn.lost) && (
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
                {[
                  'How do I set up my KPI?',
                  'What was my score last month?',
                  'My average this year',
                  'Why can I not open this month?',
                ].map(q => (
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
              className="btn-press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-950 text-white disabled:opacity-40"
            >
              <SendHorizonal className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  )
}
