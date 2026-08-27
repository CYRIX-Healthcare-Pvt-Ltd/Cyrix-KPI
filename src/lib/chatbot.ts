import { HELP } from './help-strings'
import { LANGS, type Lang } from './i18n'

/**
 * Answering the questions people actually ask, out of what is already
 * known.
 *
 * Two sources, and neither of them is a language model.
 *
 * The manual is already 128 what/how pairs in four languages, written
 * to state rules that decide somebody's appraisal. Those `.what` lines
 * are questions — "Why can I not open this month?" — so the manual is a
 * FAQ that has been reviewed, translated and kept current, and matching
 * against it costs nothing and cannot invent an answer.
 *
 * The other source is the person's own figures, which the app has
 * already loaded. "What was last month" and "what is my average" are
 * the two most common questions in the building and both are a lookup.
 *
 * Why not a model. It would cost per message, need a key on a server,
 * need a connection on a service floor where the app is used precisely
 * because it works on a bad one — and, worst of the four, it would
 * answer questions about somebody's appraisal by prediction. A bot that
 * confidently invents a deadline is worse than no bot. Everything here
 * either quotes the manual or reads a number, and says plainly when it
 * can do neither.
 */

export type AnswerSource =
  /** Straight from the manual, with a link to the section it came from. */
  | { kind: 'manual'; key: string; section: string }
  /** Their own figures, filled in by the caller. */
  | { kind: 'fact'; id: FactId; month?: number }
  /** Nothing matched well enough to guess. */
  | { kind: 'unknown' }

export type FactId =
  | 'manual'
  | 'chit.hello'
  | 'whoami'
  | 'score.last'
  | 'score.month'
  | 'score.year'
  | 'score.split'
  | 'score.months'
  | 'score.bestworst'
  | 'kpi.status'
  | 'team.pending'

/**
 * Who a section of the manual is written for.
 *
 * The reason this exists: "How do I set up my KPI?" came back with "Set
 * the month their KPI starts from", which is a manager's answer about
 * one of their reports. It won on words alone — it contains "set" and
 * "KPI" — and word overlap has no idea whose question it is answering.
 *
 * A team member cannot approve a KPI or change somebody's start month,
 * so those pages are not wrong answers to them, they are unreachable
 * ones.
 */
export interface Reader {
  isManager?: boolean
  isHrAdmin?: boolean
  isSwAdmin?: boolean
}

const canRead = (section: string, who: Reader): boolean => {
  switch (section) {
    case 'team': return !!who.isManager
    case 'hr': return !!who.isHrAdmin
    case 'sw': return !!who.isSwAdmin
    // s1, s2, s3, prof, ask — everybody's own account.
    default: return true
  }
}

/** Sections about the reader's own record come first on a tie. */
const OWN_SECTIONS = new Set(['s1', 's2', 's3', 'ask', 'prof'])

/**
 * Phrasings the manual does not use for things people ask about daily.
 *
 * The manual says "Write your KPI", which is the right heading and not
 * the words anybody types. Nobody has ever asked how to *write* their
 * KPI; they ask how to set it up, create it, add it, start it.
 */
const ALIASES: Record<string, string[]> = {
  's1.p1': ['set up', 'setup', 'create', 'make', 'add', 'start', 'build', 'new kpi',
            'fill', 'enter kpi', 'kra', 'weightage'],
  // Not "approve" — that is what a manager does, and putting it here
  // meant a manager asking how to approve a KPI was told how to send
  // one to their own manager.
  's1.p4': ['submit kpi', 'send kpi', 'waiting for approval'],
  's2.p1': ['submit', 'fill month', 'monthly', 'achieved', 'enter month'],
  's2.p3': ['deadline', 'due', 'late', 'last date', 'how many days'],
  's3.p1': ['disagree', 'dispute', 'query', 'complain', 'wrong score', 'appeal'],
  'prof.p1': ['photo', 'picture', 'avatar', 'profile'],
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]
const SHORT = MONTHS.map(m => m.slice(0, 3))

/** The month somebody named, 0-11, or null. */
export function monthNamed(query: string): number | null {
  for (const word of normalise(query).split(' ')) {
    const full = MONTHS.indexOf(word)
    if (full !== -1) return full
    if (word.length >= 3) {
      const short = SHORT.indexOf(word.slice(0, 3))
      if (short !== -1 && MONTHS[short].startsWith(word)) return short
    }
  }
  return null
}

/**
 * Words that point at a figure rather than at the manual.
 *
 * Deliberately including the native-script nouns people actually type.
 * Somebody who set the app to Malayalam and asks "എന്റെ score എത്ര" has
 * written one English word and one Malayalam one, which is how people
 * on the floor genuinely write — so both have to match.
 */
const FACT_PATTERNS: Array<{ id: FactId; any: string[]; all?: string[] }> = [
  {
    // Asked for the manual by name. Answering that with "I do not know
    // that one — the manual may" is the panel refusing to hand over the
    // one thing it was certainly asked for.
    id: 'manual',
    any: ['manual', 'guide', 'help page', 'documentation', 'instructions',
          'how to use', 'user manual', 'മാനുവൽ', 'मैनुअल', 'మాన్యువల్'],
  },
  {
    // Somebody opening with "hi" is not asking anything, and answering
    // it with "I do not know that one" is the bot failing its very
    // first exchange.
    id: 'chit.hello',
    any: ['hi', 'hii', 'hello', 'hey', 'good morning', 'good evening',
          'ഹലോ', 'നമസ്കാരം', 'नमस्ते', 'हैलो', 'హలో', 'నమస్కారం'],
  },
  {
    // It knows. Being asked and saying no reads as a bot that knows
    // nothing about you, right before you ask it about your score.
    id: 'whoami',
    any: ['my name', 'who am i', 'my ecode', 'my employee code', 'my code',
          'എന്റെ പേര്', 'मेरा नाम', 'నా పేరు'],
  },
  {
    id: 'score.last',
    any: ['last month', 'previous month', 'lastmonth', 'കഴിഞ്ഞ മാസം', 'पिछले महीने', 'గత నెల'],
  },
  {
    id: 'score.year',
    any: ['average', 'avg', 'this year', 'year score', 'overall', 'annual',
          'ശരാശരി', 'औसत', 'సగటు'],
  },
  {
    id: 'score.split',
    any: ['job role', 'core value', 'esms', 'split', 'breakdown', 'out of 80', 'out of 20'],
  },
  {
    id: 'score.months',
    any: ['how many months', 'months scored', 'pending month', 'missing month',
          'not submitted', 'which months'],
  },
  {
    id: 'score.bestworst',
    // Matched on words rather than phrases: "which month has best?" does
    // not contain the string "best month", and that is exactly how
    // somebody asks it.
    any: ['best', 'worst', 'highest', 'lowest', 'top month'],
    all: ['month'],
  },
  {
    // The same question without the word "month" in it — "my highest
    // score", "what is my best". Two entries rather than one loose one,
    // because dropping the requirement entirely makes "best engineer"
    // and "worst case" into questions about somebody's record.
    id: 'score.bestworst',
    any: ['best', 'worst', 'highest', 'lowest'],
    all: ['score'],
  },
  {
    id: 'kpi.status',
    any: ['kpi approved', 'is my kpi', 'kpi status', 'approved yet', 'my kpi ready'],
  },
  {
    id: 'team.pending',
    any: ['who has not', 'team pending', 'waiting for me', 'to approve', 'to score',
          'my team pending'],
  },
]

/** Everything the matcher ignores — they carry no signal. */
const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'i',
  'my', 'me', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'it', 'this', 'that',
  'what', 'how', 'when', 'where', 'why', 'which', 'who', 'be', 'have', 'has',
  'you', 'your', 'get', 'got', 'if', 'so', 'at', 'from', 'with', 'about',
])

/**
 * \p{M} is load-bearing, and leaving it out broke all three Indian
 * languages at once.
 *
 * Malayalam, Hindi and Telugu build a syllable from a letter plus marks
 * — vowel signs, the virama, the zero-width joiner. Those are category
 * Mark, not Letter, so keeping only \p{L} shreds a word into its
 * consonants: നിങ്ങളുടെ came out as "ന ങ ങള ട", four fragments that
 * match nothing and never could. English was fine, which is exactly why
 * it would have shipped.
 */
export const normalise = (s: string) =>
  (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

const tokens = (s: string) =>
  normalise(s).split(' ').filter(t => t.length > 1 && !STOP.has(t))

/**
 * Every question the manual answers, in every language it has.
 *
 * Built once. A question typed in Malayalam has to match the Malayalam
 * `.what`, so all four go into the same haystack and whichever scores
 * highest wins — which also means somebody can ask in English and get
 * the Malayalam answer, if that is the language they are reading in.
 */
interface ManualEntry {
  key: string
  section: string
  /** Tokens from the question itself, in every language. */
  asked: Set<string>
  /**
   * Tokens from the answer, kept apart and worth far less.
   *
   * Merging the two is how "why can I not open this month" came back
   * with a manager's page about changing somebody's start month: that
   * answer happens to contain "open", "month" and "start", and three
   * incidental words in a long paragraph outvoted the question that was
   * actually being asked.
   */
  explained: Set<string>
}

let index: ManualEntry[] | null = null

export function manualIndex(): ManualEntry[] {
  if (index) return index
  const built: ManualEntry[] = []
  for (const key of Object.keys(HELP)) {
    if (!key.endsWith('.what')) continue
    const section = key.split('.')[0]
    const stem = key.slice(0, -'.what'.length)
    const asked = new Set<string>()
    const explained = new Set<string>()
    const collect = (suffix: string, into: Set<string>) => {
      const phrase = HELP[stem + suffix]
      if (!phrase) return
      for (const l of LANGS) {
        const text = phrase[l.code as Exclude<Lang, 'en'>] ?? phrase.en
        for (const t of tokens(text)) into.add(t)
      }
    }
    collect('.what', asked)
    collect('.how', explained)
    collect('.how.base', explained)
    // The words people use for it, which are not always the manual's.
    for (const alias of ALIASES[stem] ?? []) {
      for (const t of tokens(alias)) asked.add(t)
    }
    built.push({ key: stem, section, asked, explained })
  }
  index = built
  return built
}

/** Only for tests, which build a fresh index per case. */
export const resetManualIndex = () => { index = null }

const factScore = (query: string, p: (typeof FACT_PATTERNS)[number]): number => {
  const flat = normalise(query)
  const words = new Set(flat.split(' '))

  // Everything in `all` has to be there, which is what stops "best
  // engineer" being read as a question about a month.
  for (const need of p.all ?? []) {
    if (!words.has(normalise(need))) return 0
  }

  let hits = 0
  for (const phrase of p.any) {
    const needle = normalise(phrase)
    // A single word matches as a whole word; a phrase matches anywhere.
    // Without the first half, "hi" fires on "this", "achieved" and
    // half the manual.
    const found = needle.includes(' ') ? flat.includes(needle) : words.has(needle)
    if (found) hits += 2
  }
  return hits
}

/**
 * What is this person asking?
 *
 * Figures beat the manual on a tie. "What was my score last month" is
 * answerable exactly, and an exact answer beats a page that explains
 * where scores come from.
 */
export function matchQuestion(query: string, who: Reader = {}): AnswerSource {
  const asked = tokens(query)
  if (asked.length === 0) return { kind: 'unknown' }

  // A named month with a score word in it is a lookup, and beats every
  // page explaining where scores come from.
  const month = monthNamed(query)
  if (month !== null && /score|kpi|get|got|result|mark/i.test(query)) {
    return { kind: 'fact', id: 'score.month', month }
  }

  let bestFact: { id: FactId; score: number } | null = null
  for (const p of FACT_PATTERNS) {
    const score = factScore(query, p)
    if (score > 0 && (!bestFact || score > bestFact.score)) bestFact = { id: p.id, score }
  }
  if (bestFact) return { kind: 'fact', id: bestFact.id }

  let best: { entry: ManualEntry; score: number; own: boolean } | null = null
  for (const entry of manualIndex()) {
    // Pages this person cannot act on are not weaker answers, they are
    // wrong ones — a team member has no approval screen to go to.
    if (!canRead(entry.section, who)) continue

    let hits = 0
    for (const t of asked) {
      // A word in the question is worth three in the answer. Both count,
      // because "ESMS" only ever appears in an answer — but a paragraph
      // cannot win on incidental vocabulary alone.
      if (entry.asked.has(t)) hits += 3
      else if (entry.explained.has(t)) hits += 1
    }
    // Share of what THEY asked, not of what the entry contains: a long
    // answer must not win by having more words in it.
    const score = hits / (asked.length * 3)
    const own = OWN_SECTIONS.has(entry.section)

    // Ties went to whichever entry the index happened to list first,
    // which is how a test passed on luck. Own record wins a tie now.
    const better = !best || score > best.score || (score === best.score && own && !best.own)
    if (better) best = { entry, score, own }
  }

  // Below this it is guessing, and a confident wrong answer about an
  // appraisal rule is worse than "I don't know, here is the manual".
  if (!best || best.score < 0.5) return { kind: 'unknown' }
  return { kind: 'manual', key: best.entry.key, section: best.entry.section }
}

/** Where in the manual an answer came from, for the link under it. */
export const SECTION_TITLE: Record<string, string> = {
  s1: 's1.title', s2: 's2.title', s3: 's3.title',
  team: 'team.title.plain', hr: 'hr.title', sw: 'sw.title',
  prof: 'prof.title', ask: 'ask.title',
}
