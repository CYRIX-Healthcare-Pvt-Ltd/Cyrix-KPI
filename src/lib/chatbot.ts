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
  | { kind: 'fact'; id: FactId; month?: number; ecode?: string }
  /** Nothing matched well enough to guess. */
  | { kind: 'unknown' }

export type FactId =
  | 'manual'
  | 'chit.hello'
  /** Who the bot is, as opposed to `whoami`, which is who the reader is. */
  | 'chit.whoisbot'
  | 'whoami'
  | 'score.last'
  | 'score.month'
  | 'score.year'
  | 'score.split'
  | 'score.months'
  | 'score.bestworst'
  | 'kpi.status'
  | 'team.pending'
  // A manager's questions are mostly about somebody else. Asked "lowest
  // score teammember in july", the panel returned the manager's own July
  // score — it had no idea a team existed.
  | 'team.size'
  | 'team.average'
  | 'team.lowest'
  | 'team.highest'
  | 'team.notdone'
  | 'team.weak'
  | 'team.person'
  | 'team.overview'
  // Which KRA, not which section. "In which job role am I worst" was
  // answered with the Job Role total out of 80, which is the one number
  // that cannot tell them which row to work on.
  | 'kra.weakest'
  | 'kra.best'
  | 'kra.declining'
  | 'core.weakest'
  | 'core.declining'
  /*
   * The two questions people actually open the panel with.
   *
   * Everything above reports the past, accurately, and none of it
   * answers "am I going to be alright" or "so what do I do". Those got
   * matched to whichever past-tense fact shared the most words —
   * "how am I doing" landed on the year average, which is the question
   * restated rather than answered.
   */
  | 'score.forecast'
  | 'kra.lever'

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
  /**
   * The people reporting to them, so "how is Rahul doing" can be
   * understood. Names only ever come from the roster the server already
   * returned, so this can never resolve to somebody they cannot see.
   */
  team?: Array<{ ecode: string; full_name: string }>
}

/** Words that mean "not about me". */
const TEAM_WORDS = new Set([
  'team', 'teammate', 'teammates', 'teammember', 'teammembers', 'member',
  'members', 'report', 'reports', 'reportee', 'reportees', 'staff', 'everyone',
  'everybody', 'who', 'whose', 'whom', 'anybody', 'anyone', 'subordinate',
  'subordinates', 'people', 'boys', 'juniors', 'engineers',
])

const anyOf = (words: Set<string>, list: string[]) => list.some(w => words.has(w))

/**
 * "Who are you" — the bot's own name, not the reader's and not a
 * colleague's.
 *
 * A regex rather than a keyword row in FACT_PATTERNS, because this has to
 * be decided before the team matcher: `who` is a TEAM_WORD, so a manager
 * typing "who are you" walks straight into the branch that answers
 * questions about their reports. Being asked your name and replying with
 * somebody's appraisal score is the worst version of this being wrong.
 *
 * `r`/`u` are in it because that is how the question actually arrives on
 * a phone. The non-English forms are the plain ways to ask it; like the
 * rest of the four-language strings here, they are not reviewed by a
 * native speaker and sit where somebody who reads one can correct it.
 */
const BOT_IDENTITY = new RegExp(
  [
    /*
     * Deliberately not `(who|what)\s+is\s+this`: "what is this" is an
     * existing question meaning "what is this app", and its answer is the
     * manual. The bot's name only wins when the sentence is addressed to
     * it — "you", or the word bot.
     */
    String.raw`\b(who|what)\s+(are|r)\s+(you|u)\b`,
    String.raw`\b(who|what)\s+is\s+(this\s+)?(bot|assistant|chat\s?bot)\b`,
    String.raw`\byour\s+name\b`,
    String.raw`\bwhat\s+(do|should)\s+i\s+call\s+you\b`,
    String.raw`\bare\s+you\s+(a\s+)?(bot|robot|human|ai|real|person)\b`,
    'നീ ആരാണ്', 'നിന്റെ പേര',
    'तुम कौन हो', 'आप कौन ह', 'तुम्हारा नाम', 'आपका नाम',
    'నువ్వు ఎవరు', 'మీరు ఎవరు', 'నీ పేరు', 'మీ పేరు',
  ].join('|'),
)

/**
 * Somebody on this manager's team, named in the question.
 *
 * Matched on the employee code or the first name, both of which people
 * actually type. Deliberately not on every part of a full name — "K P"
 * and "P M" are initials on this roster and would match half of it.
 */
function personNamed(
  query: string,
  team: Array<{ ecode: string; full_name: string }>,
): string | null {
  const words = new Set(normalise(query).split(' '))
  const flat = normalise(query)

  for (const member of team) {
    if (words.has(normalise(member.ecode))) return member.ecode
  }
  // Longest name first, so "Vineesh" is not answered with "Vineesan".
  const byLength = [...team].sort((a, b) => b.full_name.length - a.full_name.length)
  for (const member of byLength) {
    if (flat.includes(normalise(member.full_name))) return member.ecode
  }
  for (const member of byLength) {
    const first = normalise(member.full_name).split(' ')[0]
    if (first.length >= 4 && words.has(first)) return member.ecode
  }
  return null
}

/**
 * The manager's half of the panel.
 *
 * Checked before anything personal, because a manager asking "lowest
 * score teammember in july" wants their team and got their own July
 * score — the question was read as if the only person in it was them.
 */
function teamFact(query: string, who: Reader): AnswerSource | null {
  if (!who.isManager) return null

  const flat = normalise(query)
  const words = new Set(flat.split(' '))
  const month = monthNamed(query) ?? undefined

  // A named colleague is the strongest signal there is.
  const ecode = personNamed(query, who.team ?? [])
  if (ecode) return { kind: 'fact', id: 'team.person', ecode, month }

  if (!anyOf(words, [...TEAM_WORDS])) return null

  // "who am i" is a question about themselves that happens to start
  // with a team word.
  if (/\bwho\s+am\s+i\b/.test(flat) || flat.includes('my name')) return null

  if (anyOf(words, ['lowest', 'worst', 'bottom', 'least', 'weakest', 'poorest'])) {
    return { kind: 'fact', id: 'team.lowest', month }
  }
  if (anyOf(words, ['highest', 'best', 'top', 'strongest'])) {
    return { kind: 'fact', id: 'team.highest', month }
  }
  if (anyOf(words, ['average', 'avg', 'mean', 'overall'])) {
    return { kind: 'fact', id: 'team.average', month }
  }
  if (anyOf(words, ['submitted', 'submit', 'pending', 'missing', 'waiting',
                    'left', 'yet', 'due', 'late'])) {
    return { kind: 'fact', id: 'team.notdone', month }
  }
  if (anyOf(words, ['weak', 'struggling', 'below', 'attention', 'risk', 'pip',
                    'improve', 'concern', 'trouble'])) {
    return { kind: 'fact', id: 'team.weak', month }
  }
  if (anyOf(words, ['many', 'count', 'size', 'strength', 'much'])) {
    return { kind: 'fact', id: 'team.size' }
  }
  // Asked about the team without naming a figure — a summary is a better
  // answer than "I do not know that one".
  return { kind: 'fact', id: 'team.overview', month }
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
  // "Template" appears in the answer but not the heading, which is a
  // question phrased as a question — so the word people actually type has
  // to be listed. Both entries carry it: a manager asking about templates
  // wants team.p13, a team member wants this one, and the section each
  // belongs to is what tells them apart.
  's1.p0': ['template', 'templates', 'my role template', 'team template',
            'ready made', 'copy my manager', 'same as my colleague'],
  'team.p13': ['template', 'templates', 'save a template', 'team template',
               'reuse', 'same kpi for everyone', 'standard kpi'],
  // A manager correcting somebody else's row before approving it. The
  // answer says so; the heading does not, so the words never matched.
  'team.p1': ['approve', 'their target', 'their weightage', 'change their',
              'correct their', 'edit their', 'their kra'],
  'team.p3': ['score my team', 'score them', 'scoring', 'their figures'],
  's2.p1': ['submit', 'fill month', 'monthly', 'achieved', 'enter month'],
  's2.p3': ['deadline', 'due', 'late', 'last date', 'how many days'],
  's3.p1': ['disagree', 'dispute', 'query', 'complain', 'wrong score', 'appeal'],
  'prof.p1': ['photo', 'picture', 'avatar', 'profile'],
  // Nobody is prompted to install any more, so the words people would
  // reach for have to find the one page that says where it is.
  'prof.p5': ['install', 'home screen', 'homescreen', 'app on my phone',
              'add to phone', 'download the app', 'shortcut', 'icon'],
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
          'how to use', 'user manual', 'what is this', 'what can i do',
          'supposed to do', 'where do i start', 'explain this app',
          'മാനുവൽ', 'मैनुअल', 'మాన్యువల్'],
  },
  {
    // Somebody opening with "hi" is not asking anything, and answering
    // it with "I do not know that one" is the bot failing its very
    // first exchange.
    id: 'chit.hello',
    // Spelled the way people actually type it on a phone. The fuzzy
    // fallback below catches a slip of one letter, but "hlo" is two
    // letters short of "hello" and no threshold loose enough to reach it
    // is tight enough to be safe — so the common ones are listed
    // outright, which is both cheaper and exact.
    any: ['hi', 'hii', 'hiii', 'hello', 'helo', 'hlo', 'hallo', 'halo',
          'hey', 'heyy', 'hai', 'haai', 'yo',
          'good morning', 'good evening', 'good afternoon',
          'ഹലോ', 'നമസ്കാരം', 'नमस्ते', 'हैलो', 'హలో', 'నమస్కారం', 'வணக்கம்'],
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
  /*
    Placed above the past-tense facts on purpose: these patterns are
    narrower, and the first match wins. "How will I finish the year"
    contains "year", which would otherwise be answered with the year
    average — the very number the question is asking to have projected
    forward.
  */
  {
    id: 'score.forecast',
    /*
      Every phrase here names the score or the year.

      'will i get' and 'am i going to' were in this list and had to come
      out: "how much increment will i get" matched, and an appraisal bot
      answering a salary question with a projected KPI figure is the one
      confusion this app must never create. The test that asserts those
      questions stay unknown is what caught it, and it is worth more than
      the extra recall was.
    */
    any: ['forecast', 'predict', 'prediction', 'projection', 'projected',
          'on track', 'am i on track', 'how will i finish', 'where will i end',
          'end of year', 'year end', 'finish the year', 'final score',
          'expected score', 'score looking like', 'how will my score',
          'how am i doing overall', 'am i doing well', 'am i ok',
          'എങ്ങനെ അവസാനിക്കും', 'क्या मैं ठीक हूं', 'साल के अंत',
          'నేను బాగున్నానా', 'நான் சரியாக இருக்கிறேனா'],
  },
  {
    // "So what do I do about it" — the only question whose answer is an
    // instruction rather than a figure.
    id: 'kra.lever',
    any: ['what should i improve', 'what should i focus', 'what to improve',
          'how do i improve', 'how can i improve', 'what will help',
          'biggest impact', 'most impact', 'where should i focus',
          'what should i work on', 'how to increase my score',
          'how to improve my score', 'what would help most', 'best use of my time',
          'എന്ത് മെച്ചപ്പെടുത്തണം', 'क्या सुधारूं', 'ఏమి మెరుగుపరచాలి',
          'எதை மேம்படுத்த வேண்டும்'],
  },
  {
    // A named row of the KPI, rather than the block it sits in.
    id: 'kra.weakest',
    any: ['which kra', 'which job role', 'worst kra', 'weakest kra',
          'which area', 'where am i weak', 'worst in', 'lowest kra',
          'which row', 'weakest area', 'worst area'],
  },
  {
    id: 'kra.best',
    any: ['best kra', 'strongest kra', 'best area', 'strongest area',
          'which kra is best', 'best job role'],
  },
  {
    id: 'kra.declining',
    any: ['kra dropping', 'kra falling', 'which kra is decreasing',
          'area dropping', 'getting worse', 'going down', 'declining'],
  },
  {
    // The five values are rated individually and rolled into one figure.
    // "Which core value is decreasing" needs the five, not the roll-up.
    id: 'core.declining',
    any: ['core value decreasing', 'core value dropping', 'core value falling',
          'which core value is decreasing', 'core value going down',
          'core value getting worse'],
  },
  {
    id: 'core.weakest',
    any: ['which core value', 'worst core value', 'lowest core value',
          'weakest core value', 'core value am i worst'],
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

/**
 * How many single-character edits separate two words.
 *
 * Two rows rather than a full matrix. The words here are short, so the
 * saving is not the point — it is that two rows fit on a screen and a
 * full matrix does not.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length || !b.length) return Math.max(a.length, b.length)

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,                                        // delete
        row[j - 1] + 1,                                     // insert
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),      // substitute
      )
    }
    prev = row
  }
  return prev[b.length]
}

/**
 * How far a word of this length is allowed to be wrong.
 *
 * Nothing under five characters, because at four a single edit reaches
 * half the language: "hi" is one edit from "his", "him" and "hit", and a
 * bot that reads "his score" as a greeting is worse than one that misses
 * a typo. Longer words can afford more slack — "assessment" is not one
 * edit from anything.
 */
const slackFor = (len: number) => (len >= 9 ? 2 : len >= 5 ? 1 : 0)

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
    if (found) { hits += 2; continue }

    /*
      A typo is worth half of the real thing.

      Phones and thumbs: "submitt", "achived", "assesment". Scored lower
      than an exact hit on purpose, so a question that genuinely matches
      one pattern is never beaten by a near-miss on another — the fuzzy
      match only decides between patterns that would all otherwise have
      scored nothing.
    */
    const slack = needle.includes(' ') ? 0 : slackFor(needle.length)
    if (slack > 0) {
      for (const w of words) {
        // Length alone rules most of them out before the expensive part.
        if (Math.abs(w.length - needle.length) > slack) continue
        if (editDistance(w, needle) <= slack) { hits += 1; break }
      }
    }
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
/**
 * Is this somebody asking to be taught, rather than told a number?
 *
 * Found by testing as a manager who had never seen the app: "how do i
 * score my team" was answered with the team's average, and "what does
 * ESMS mean" with their ESMS figure. Both are the panel hearing a
 * keyword and reaching for data when the person wanted the procedure.
 *
 * "how many" is deliberately not here — that one really is a count.
 */
const TEACH_ME =
  /\bhow\s+(do|to|can|should|does)\b|\bwhat\s+(is|are|does)\b[^?]*\bmeans?\b|\bwhat\s+(is|are)\s+(a|an)\b/

/**
 * Money, which this app does not decide and must not appear to.
 *
 * "will i get a raise this year" was answered with the year average,
 * because 'this year' is one of the words score.year matches on. The
 * figure was correct and the exchange was not: a KPI average offered in
 * reply to a pay question reads as the answer to it, and the one thing
 * an appraisal tool must never do is imply what an appraisal is worth in
 * rupees. Nothing here knows, so nothing here should sound like it does.
 *
 * These come back as unknown, which is not a dead end — an unknown
 * offers to hand the question to HR, who can actually answer it.
 *
 * 'raise' carries a second meaning in this app: you raise a query and
 * raise a ticket, and both are things the manual explains. So it counts
 * only when it is not one of those.
 */
const NOT_MINE = new RegExp(
  '\\b(salary|increment|hike|bonus|ctc|payslip|wage|wages|promotion|promoted|'
  + 'appraisal\\s+amount|pay\\s+(rise|revision))\\b'
  + '|\\braise\\b(?!\\s+(a\\s+|an\\s+)?(query|ticket|request|issue|concern|complaint|dispute))',
  'i',
)

export function matchQuestion(query: string, who: Reader = {}): AnswerSource {
  const asked = tokens(query)
  const teachMe = TEACH_ME.test(normalise(query))

  /*
    "what is this" used to come back as "I do not know that one", and the
    reason is worth keeping in mind before adding anything above here:
    every word in it is a stop word, so the token list was empty and the
    function returned before it had looked at a single pattern.

    The fact patterns match on the raw sentence rather than on tokens, so
    they work on a question made entirely of small words. Only the manual
    search below needs something left after the stop words are gone.
  */

  // Before the team matcher, deliberately: `who` is a team word, so a
  // manager asking the bot its name would otherwise be handed a fact
  // about one of their reports.
  if (BOT_IDENTITY.test(normalise(query))) {
    return { kind: 'fact', id: 'chit.whoisbot' }
  }

  // Before anything that could produce a figure. A pay question that
  // reaches the matchers comes back with a score, and a score offered in
  // answer to "will I get a raise" is read as a yes.
  if (NOT_MINE.test(query)) return { kind: 'unknown' }

  // A manager's question is usually about somebody else, and reading it
  // as if it were about them is the worst kind of wrong answer here: a
  // real number, confidently given, for the wrong person.
  if (!teachMe) {
    const team = teamFact(query, who)
    if (team) return team
  }

  // A named month with a score word in it is a lookup, and beats every
  // page explaining where scores come from.
  const month = monthNamed(query)
  if (!teachMe && month !== null && /score|kpi|get|got|result|mark/i.test(query)) {
    return { kind: 'fact', id: 'score.month', month }
  }

  let bestFact: { id: FactId; score: number } | null = null
  for (const p of FACT_PATTERNS) {
    const score = factScore(query, p)
    if (score > 0 && (!bestFact || score > bestFact.score)) bestFact = { id: p.id, score }
  }
  /*
    The manual answer to "what is this" is the manual itself.

    kra.lever is the other exception, and for the same reason: "how can I
    improve my score" trips TEACH_ME on "how can", which is right for
    every other fact — somebody asking how to do something wants the
    procedure, not a number. But kra.lever IS the procedure. It is the
    only fact here whose answer is an instruction, so sending it to the
    manual hands back a page about how scoring works to somebody who
    asked what to work on.
  */
  if (bestFact && (!teachMe || bestFact.id === 'manual' || bestFact.id === 'kra.lever')) {
    return { kind: 'fact', id: bestFact.id }
  }

  if (asked.length === 0) return { kind: 'unknown' }

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
