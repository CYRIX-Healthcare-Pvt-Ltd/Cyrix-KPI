import { useState, useRef, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  MessageCircle, X, SendHorizonal, BookOpen, Languages, ArrowRight,
  IdCard, Wrench,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useAnnualSummary, useSubmissionHistory, useMyAssignment, usePendingCounts,
  useTeamMonth, useTeamSubmissions, useTatPolicy, useMonthClose,
  useKraAttainment, useMyCoreValueTrend, useCoreValues, useRaiseTicket, currentFy,
} from '@/lib/queries'
import { currentReportingMonth, monthLabel, fyMonthsFrom } from '@/lib/fy'
import { useLang, say, READY_LANGS, type Lang } from '@/lib/i18n'
import { HELP } from '@/lib/help-strings'
import { CHAT } from '@/lib/chat-strings'
import { answerFact } from '@/lib/chatAnswers'
import { matchQuestion, SECTION_TITLE, type FactId } from '@/lib/chatbot'
import { pickTip } from '@/lib/tips'
import { forecastYear, biggestLever, averageRows, weakestOf } from '@/lib/forecast'
import { ratingToPoints } from '@/lib/scoring'
import type { SupportDesk } from '@/types/db'

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

/**
 * What a turn IS, rather than what it said.
 *
 * Stored as the ingredients — a phrase key and its numbers, a question
 * in somebody's own words — and turned into a sentence only when it is
 * drawn. That is what lets the language selector reach backwards: the
 * whole conversation is rendered again in the new language instead of
 * only what is said next.
 *
 * Holding the finished sentence, as this did, left a panel half in
 * English and half in Malayalam after a switch, which is worse than
 * either. The argument for it was that restating somebody's earlier
 * answers rewrites what they were told — true of their own words, which
 * is why 'said' is kept verbatim and never translated, and not true of
 * ours, which are the same sentence in both languages by construction.
 */
type Speech =
  /** Their own words. Never touched. */
  | { kind: 'said'; text: string }
  /** A phrase from CHAT, with whatever numbers it takes. */
  | { kind: 'chat'; key: string; vars?: Record<string, string | number> }
  /** The lead-in and a did-you-know, which is two phrases in one bubble. */
  | { kind: 'tip'; key: string }
  /** The manual's own answer, in whichever language it is being read in. */
  | { kind: 'manual'; key: string }
  /** Computed from their own figures — recomputed, not re-translated. */
  | { kind: 'fact'; id: FactId; month?: number; ecode?: string }

interface Turn {
  say: Speech
  /** Manual section this came from, for the link under it. */
  section?: string
  /** Show the link to the manual under this answer. */
  manualLink?: boolean
  /** Somewhere to go and do the thing this turn is about. */
  to?: string
  /** What that link says. English on purpose — it is a screen name. */
  toLabel?: string
  /** Offer to hand this question to a person. */
  offerDesks?: boolean
}

/** One thing waiting on this person, and where to go and do it. */
interface Nudge {
  key: string
  vars?: Record<string, string | number>
  to: string
  toLabel: string
}

/**
 * Where Cyra's unread mark is remembered.
 *
 * Per device, like the language. It stores a signature of what was
 * outstanding when the panel was last opened, so the mark comes back
 * when the situation changes — a new month opening, somebody submitting
 * — and stays away when it is the same list as yesterday. Storing a
 * count instead would leave the mark up permanently for anybody with a
 * standing job to do, which is how a badge stops meaning anything.
 */
const SEEN_KEY = 'cyrix.cyra.seen'

/**
 * How many "did you know" tips this device has been shown, and whether
 * this sitting has already taken one.
 *
 * Once per SESSION rather than once per opening. Somebody who opens the
 * panel four times in an afternoon — to check a score, then a month,
 * then ask something — should not be handed four different facts about
 * the app; that is a colleague who will not stop talking. One per
 * sitting, a different one next time, working through the list in order
 * rather than at random so nothing is repeated before everything has
 * been seen.
 */
const TIP_KEY = 'cyrix.cyra.tip'
const TIP_SESSION = 'cyrix.cyra.tip.session'

/** English on purpose: they are the names on the tabs the answer comes from. */
const DESK_NAME: Record<SupportDesk, string> = { hr: 'HR', software: 'Software' }

export default function ChatBot() {
  const { employee, isManager, isHrAdmin, isSwAdmin } = useAuth()
  const fy = currentFy()
  const [lang, setLang] = useLang()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [ticketDesk, setTicketDesk] = useState<SupportDesk | null>(null)
  /** Cyra is composing. See ask(). */
  const [thinking, setThinking] = useState(false)
  // What they last asked, so handing it to a person does not ask them to
  // type it again.
  const lastAsked = useRef('')
  const raise = useRaiseTicket()
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
  }, [turns, thinking, open])

  /*
    Which tip this sitting gets.

    Read once at mount so it cannot change under the panel mid-session,
    and advanced in an effect rather than while computing — a counter
    that increments inside a useMemo would step twice under StrictMode
    and skip a tip every time in development.
  */
  const [tipSeen] = useState(() => {
    try { return Number(localStorage.getItem(TIP_KEY) ?? '0') || 0 } catch { return 0 }
  })

  useEffect(() => {
    try {
      if (sessionStorage.getItem(TIP_SESSION)) return
      sessionStorage.setItem(TIP_SESSION, '1')
      localStorage.setItem(TIP_KEY, String(tipSeen + 1))
    } catch { /* private window, or storage switched off */ }
  }, [tipSeen])

  /**
   * What to open with when nothing is waiting.
   *
   * "All caught up" is true and is a dead end — it closes the
   * conversation on the one occasion the person has time for it. All of
   * this is already loaded for the facts Cyra answers with, so asking
   * something real costs nothing.
   *
   * Order is deliberate. The lowest core value first, because that is
   * the half of the score nobody discusses and the one a person can
   * actually change by deciding to; then the KRA where effort pays most,
   * which is arithmetic rather than judgement; then praise for a year
   * that is climbing. If none applies — nothing scored yet, or nothing
   * to single out — it falls back to saying so plainly, which is honest
   * and better than inventing a concern.
   */
  const idleOpening = useMemo<{ key: string; vars: Record<string, string | number> } | null>(() => {
    const names = new Map((coreValues ?? []).map(v => [v.id, v.name]))
    const weakCore = weakestOf(
      (coreTrend ?? []).map(r => ({ id: r.core_value_id, value: ratingToPoints(r.rating) })),
    )
    // Only worth raising below Good. Asking somebody's plan for a core
    // value they are already scoring 80 on is a question with no answer.
    if (weakCore && weakCore.pct <= 60 && names.has(weakCore.id)) {
      return {
        key: 'nudge.plancore' as string,
        vars: { name: firstName, name2: names.get(weakCore.id)!, pct: weakCore.pct.toFixed(0) } as Record<string, string | number>,
      }
    }

    const lever = biggestLever(averageRows(kras ?? []))
    if (lever) {
      return {
        key: 'nudge.planlever',
        vars: {
          name: firstName, kra: lever.kra,
          gain: lever.gain.toFixed(1), target: lever.target,
        } as Record<string, string | number>,
      }
    }

    const points = (history ?? [])
      .filter(s => s.final_total_score !== null)
      .map(s => ({ period_month: s.period_month, value: Number(s.final_total_score) }))
    const f = forecastYear(points, 0)
    if (f && f.direction === 'up') {
      return {
        key: 'nudge.planclimb',
        vars: { name: firstName, soFar: f.soFar.toFixed(1), recent: f.recent.toFixed(1) } as Record<string, string | number>,
      }
    }
    return null
  }, [coreValues, coreTrend, kras, history, firstName])

  const tip = useMemo(
    () => (systemAccount ? null : pickTip({
      isManager,
      isHrAdmin,
      hasKpi: !!assignment?.assignment,
      hasScoredMonth: (annual?.months_scored ?? 0) > 0,
    }, tipSeen)),
    [systemAccount, isManager, isHrAdmin, assignment, annual, tipSeen],
  )

  /**
   * What is waiting on this person, right now.
   *
   * Assembled from what this panel already loads, so it costs nothing to
   * ask. Ordered by who is blocked: their own overdue month first
   * because only they can move it, then the people held up behind them.
   *
   * Nothing here is new information — every line has a badge somewhere
   * already. The difference is that a badge is a number to interpret and
   * this is a sentence with the way to fix it attached.
   */
  const month = currentReportingMonth()
  const nudges = useMemo<Nudge[]>(() => {
    if (systemAccount) return []
    const list: Nudge[] = []
    const kpi = assignment?.assignment
    const startsFrom = kpi?.starts_from ?? null
    // Not before their KPI begins. A June joiner asked about April is
    // being chased for a month that was never theirs.
    const inScope = !startsFrom || month >= startsFrom
    const sub = (history ?? []).find(s => s.period_month === month)

    if (!kpi) {
      list.push({ key: 'nudge.kpi', to: '/my-kpi/setup', toLabel: 'My KPI' })
    } else if (kpi.status === 'rejected') {
      list.push({ key: 'nudge.rejected', to: '/my-kpi/setup', toLabel: 'My KPI' })
    } else if (kpi.status === 'active' && inScope) {
      if (!sub) {
        list.push({
          key: 'nudge.newmonth',
          vars: { month: monthLabel(month) },
          to: `/submission/${month}`,
          toLabel: 'Assessments',
        })
      } else if (sub.status === 'draft') {
        list.push({
          key: 'nudge.draft',
          vars: { month: monthLabel(month) },
          to: `/submission/${month}`,
          toLabel: 'Assessments',
        })
      }
    }

    if ((pending?.scoring ?? 0) > 0) {
      list.push({
        key: 'nudge.score',
        vars: { n: pending!.scoring },
        to: '/team',
        toLabel: 'My Team',
      })
    }
    if ((pending?.approvals ?? 0) > 0) {
      list.push({
        key: 'nudge.approve',
        vars: { n: pending!.approvals },
        to: '/approvals',
        toLabel: 'Approvals',
      })
    }
    return list
  }, [assignment, history, pending, month, systemAccount])

  /*
    The unread mark.

    Keyed on what is outstanding rather than on how many, so it comes
    back when the situation changes and stays away when today's list is
    yesterday's. A mark tied to a count would sit there permanently for
    anybody with a standing job, and a badge that is always on is a badge
    nobody looks at.
  */
  const signature = JSON.stringify(nudges.map(n => [n.key, n.vars]))
  const [seen, setSeen] = useState<string>(() => {
    try { return localStorage.getItem(SEEN_KEY) ?? '' } catch { return '' }
  })
  const unread = nudges.length > 0 && seen !== signature

  /*
    Greeted by name and told what is waiting.

    Built once, as keys rather than sentences, so a language switch
    re-renders it along with the rest of the conversation rather than
    forcing it to be assembled again. The guard is against clobbering a
    real exchange in progress, not against translating one.
  */
  useEffect(() => {
    if (!open) return
    setTurns(prev => {
      if (prev.length > (1 + nudges.length)) return prev
      const opening: Turn[] = [{
        // Nothing waiting is not nothing to say. See idleOpening.
        say: nudges.length
          ? { kind: 'chat', key: 'nudge.hi', vars: { name: firstName } }
          : idleOpening
            ? { kind: 'chat', key: idleOpening.key, vars: idleOpening.vars }
            : { kind: 'chat', key: 'nudge.clear', vars: { name: firstName } },
      }]
      for (const n of nudges) {
        opening.push({
          say: { kind: 'chat', key: n.key, vars: n.vars },
          to: n.to,
          toLabel: n.toLabel,
        })
      }
      /*
        One thing they probably do not know about, last.

        After the outstanding work rather than before it: somebody with
        a month overdue does not want a fact about dark mode first. And
        one only — a panel that opens with a list of suggestions is one
        people stop opening.
      */
      if (tip) {
        opening.push({
          say: { kind: 'tip', key: tip.key },
          to: tip.to ?? undefined,
          toLabel: tip.toLabel || undefined,
        })
      }
      return opening
    })
    try { localStorage.setItem(SEEN_KEY, signature) } catch { /* private window */ }
    setSeen(signature)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `lang` is deliberately not a dependency any more. It was here to
    // rebuild the opening in the new language; the opening is keys now,
    // and rendering handles that.
  }, [open, firstName, signature, idleOpening, tip])

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
      /*
        Months still ahead of this person, which is what a projection has
        to spread the recent run across.

        Counted from their own KPI's start month rather than from April —
        a June joiner has nine months in their year, not twelve — and
        only months later than the one currently being reported on. A
        month that is late is overdue rather than upcoming, and counting
        it as future would quietly forgive it.
      */
      remainingMonths: fyMonthsFrom(fy, assignment?.assignment?.starts_from)
        .filter(m => m > currentReportingMonth()).length,
      month, ecode,
    })

  /**
   * The sentence for a turn, in whichever language is selected now.
   *
   * Called while drawing rather than when the turn was made, which is
   * the whole mechanism behind the language switch reaching backwards
   * through the conversation. Everything it calls is a pure function of
   * `lang` and data this screen has already loaded, so re-rendering the
   * panel in Malayalam costs no fetch and cannot fail halfway.
   *
   * One consequence worth knowing: a 'fact' is recomputed, not replayed.
   * If somebody asks how many approvals are waiting, clears them, and
   * scrolls back, that bubble will say none are left rather than what it
   * said at the time. A scrollback that corrects itself is the better
   * side of the trade — the alternative is an answer that is now wrong
   * sitting above the screen that proves it — but it does mean these
   * bubbles are a live reading rather than a transcript.
   */
  const render = (s: Speech): string => {
    switch (s.kind) {
      // Somebody's own question, exactly as they typed it.
      case 'said': return s.text
      case 'chat': return c(s.key, s.vars)
      case 'tip': return `${c('tip.lead')} ${c(s.key)}`
      case 'manual': return t(`${s.key}.how`) || t(`${s.key}.how.base`)
      case 'fact': return factAnswer(s.id, s.month, s.ecode)
    }
  }

  const ask = (question: string) => {
    const q = question.trim()
    if (!q) return
    const found = matchQuestion(q, {
      isManager, isHrAdmin, isSwAdmin, team: teamNow?.team ?? [],
    })
    const reply: Turn =
      found.kind === 'fact'
        ? {
            say: { kind: 'fact', id: found.id, month: found.month, ecode: found.ecode },
            manualLink: found.id === 'manual',
          }
        : found.kind === 'manual'
          ? {
              // The manual's own answer, in their language, so nothing is
              // paraphrased into meaning something slightly different.
              say: { kind: 'manual', key: found.key },
              section: found.section,
            }
          : {
              say: { kind: 'chat', key: 'lost', vars: { name: firstName } },
              manualLink: true,
              // The honest end of a bot that refuses to guess: it says so,
              // and immediately offers somebody who does know.
              offerDesks: true,
            }
    /*
      The question lands at once; the answer takes a beat.

      Every answer here is computed on the device, so it was appearing in
      the same frame as the question — which reads as a lookup table
      rather than a reply, and people said so. The pause is not
      pretending to think: it is the pause a person leaves before
      answering, and without it the exchange does not read as one.

      Long enough to register, short enough not to wait for. Somebody who
      has asked for less motion gets the answer immediately, since for
      them the dots are the animation.
    */
    setTurns(prev => [...prev, { say: { kind: 'said', text: q } }])
    setDraft('')
    lastAsked.current = q

    const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (instant) {
      setTurns(prev => [...prev, reply])
      return
    }
    setThinking(true)
    window.setTimeout(() => {
      setThinking(false)
      setTurns(prev => [...prev, reply])
    }, 520)
    return
  }

  /**
   * Hand the question to a person.
   *
   * The composer becomes the request and the send button says where it
   * is going, so there is no second screen and no second typing — what
   * they already asked is already in the box.
   */
  const startTicket = (desk: SupportDesk) => {
    setTicketDesk(desk)
    setDraft(lastAsked.current)
    setTurns(prev => [...prev, {
      say: { kind: 'chat', key: 'sup.mode', vars: { desk: DESK_NAME[desk] } },
    }])
  }

  const sendTicket = async () => {
    if (!ticketDesk) return
    const note = draft.trim()
    if (note.length < 5) return
    try {
      await raise.mutateAsync({ desk: ticketDesk, note })
      setTurns(prev => [...prev,
        { say: { kind: 'said', text: note } },
        {
          say: { kind: 'chat', key: 'sup.sent', vars: { desk: DESK_NAME[ticketDesk] } },
          to: '/support',
          toLabel: 'My requests',
        },
      ])
      setDraft('')
      setTicketDesk(null)
    } catch (err) {
      setTurns(prev => [...prev, {
        say: {
          kind: 'chat',
          key: 'sup.failed',
          // The server's own words. Not ours to translate.
          vars: { why: err instanceof Error ? err.message : '' },
        },
      }])
    }
  }

  if (!employee) return null

  return (
    <>
      {/* Above the mobile nav bar, out of the thumb's way on the tab it
          would otherwise cover. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={
            nudges.length
              ? `Cyra has ${nudges.length} thing${nudges.length === 1 ? '' : 's'} waiting for you`
              : 'Ask Cyra about your KPI'
          }
          className="btn-press fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-shade text-white shadow-lg hover:bg-cyrixRed-600 hover:text-white lg:bottom-6"
        >
          <MessageCircle className="h-5 w-5" />
          {/*
            The count stays up while the work does.

            It used to disappear the moment they opened the panel once,
            on the argument that the mark was about news rather than
            about the work. That is right about the ring and wrong about
            the number: somebody with a month still to submit opened
            Cyra on Monday and had no reminder of it for the rest of the
            week, which is the one person the badge exists for.

            So the two are split. The number is the work, and it clears
            when the work is done. The ring is the news, and it clears
            when they have looked.
          */}
          {nudges.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center">
              {unread && (
                <span className="animate-alert-ping absolute inline-flex h-full w-full rounded-full bg-cyrixRed-600" />
              )}
              <span className="relative flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border-2 border-canvas bg-cyrixRed-600 px-1 text-[10px] font-bold leading-none text-white">
                {nudges.length}
              </span>
            </span>
          )}
        </button>
      )}

      {open && (
        <div className="animate-pop-in fixed inset-x-3 bottom-20 z-40 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-ink-200 bg-surface shadow-2xl sm:inset-x-auto sm:right-4 sm:w-96 lg:bottom-6">
          <div className="flex items-center justify-between gap-2 border-b border-ink-200 bg-shade px-4 py-3 text-white">
            {/* Named, and then told what it is for. The name on its own
                says nothing about what to type; the purpose on its own
                leaves "who are you" unanswered before it is asked. */}
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">Cyra</p>
              <p className="text-[11px] leading-tight text-white/60">Ask about your KPI</p>
            </div>
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
                className={clsx(
                  'flex',
                  turn.say.kind === 'said' ? 'justify-end' : 'justify-start',
                )}
              >
                <div
                  className={clsx(
                    'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                    turn.say.kind === 'said'
                      ? 'rounded-br-sm bg-ink-900 text-onInk'
                      : 'rounded-bl-sm bg-ink-100 text-ink-800',
                  )}
                >
                  {render(turn.say)}
                  {/* Where to go and do it. A nudge without one is a
                      complaint; with one it is an errand. */}
                  {turn.to && (
                    <Link
                      to={turn.to}
                      onClick={() => setOpen(false)}
                      className="mt-2 flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-900"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                      {turn.toLabel}
                    </Link>
                  )}
                  {/* The bot failing is the best moment to offer a
                      person: they have just typed the question, and it
                      becomes the request as it stands. */}
                  {turn.offerDesks && !ticketDesk && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {([['hr', IdCard], ['software', Wrench]] as const).map(([d, Icon]) => (
                        <button
                          key={d}
                          onClick={() => startTicket(d)}
                          className="btn-press inline-flex items-center gap-1 rounded-full border border-ink-300 px-2.5 py-1 text-xs font-medium text-ink-700 hover:border-ink-400 hover:text-ink-900"
                        >
                          <Icon className="h-3.5 w-3.5" /> Ask {DESK_NAME[d]}
                        </button>
                      ))}
                    </div>
                  )}
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
            {/*
              Three dots, in a bubble the same shape as an answer.

              Deliberately in the answer's own bubble rather than a bar
              somewhere else: it stands where the reply will stand, so
              the reply does not arrive somewhere the eye was not
              already. aria-live tells a screen reader an answer is
              coming, which is the one thing dots cannot say.
            */}
            {thinking && (
              <div
                className="max-w-[85%] self-start rounded-2xl rounded-bl-sm bg-ink-100 px-4 py-3"
                role="status"
                aria-live="polite"
              >
                <span className="sr-only">Cyra is answering</span>
                <span className="flex items-center gap-1" aria-hidden>
                  {[0, 1, 2].map(i => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-cyra-dot rounded-full bg-ink-400"
                      style={{ animationDelay: `${i * 160}ms` }}
                    />
                  ))}
                </span>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/*
            One composer, two jobs.

            In ticket mode the same box becomes the request and the
            button says where it is going, so handing a question to a
            person is not a second screen and not a second typing.
          */}
          <form
            onSubmit={e => {
              e.preventDefault()
              if (ticketDesk) void sendTicket()
              else ask(draft)
            }}
            className={clsx(
              "flex items-center gap-2 border-t p-2",
              ticketDesk ? "border-violet-700 bg-violet-50" : "border-ink-200",
            )}
          >
            {ticketDesk && (
              <button
                type="button"
                onClick={() => { setTicketDesk(null); setDraft("") }}
                aria-label="Back to asking Cyra"
                title="Back to asking Cyra"
                className="btn-icon shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <input
              className="input !py-2"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={ticketDesk
                ? `What should ${DESK_NAME[ticketDesk]} know?`
                : "Type your question…"}
              aria-label={ticketDesk ? `Your request to ${DESK_NAME[ticketDesk]}` : "Your question"}
            />
            <button
              type="submit"
              disabled={ticketDesk ? draft.trim().length < 5 || raise.isPending : !draft.trim()}
              aria-label={ticketDesk ? `Send to ${DESK_NAME[ticketDesk]}` : "Send"}
              title={ticketDesk ? `Send to ${DESK_NAME[ticketDesk]}` : undefined}
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
