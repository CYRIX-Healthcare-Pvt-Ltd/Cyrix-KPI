import type { Workbook } from 'exceljs'

/*
  The Digest's "Download all" Excel (DigestAdmin), on its own so a sample can be made from real data the same way.
  Sheets: People (one row each; for a quiz ranked), Function wise and Manager wise (the user, 6 Nov: "single shot
  function wise summary, and other sheet for manager wise"), and Answers for an anonymous form.
*/
export type DigestPerson = {
  ecode: string; full_name: string; department: string | null; function_name: string | null
  seen_at: string | null; opened_at: string | null; opens: number; last_opened: string | null; last_joined: string | null
  liked_at: string | null; comments: number; joins: number; joined_at: string | null; voted: string | null
  answered_at: string | null; answers: Record<string, string | string[]> | null
  watched_seconds: number | null; video_seconds: number | null; watched_at: string | null
  manager_name: string | null; manager_ecode: string | null
}
export type QuizScore = { ecode: string; score: number; max_score: number; started_at?: string | null; sent_at?: string | null }

/* The company's colours (the user, 6 Nov: "all excel format color should be same as our company theme"): the logo's
   black and its red X; headings light grey. */
const BLACK = 'FF111111', RED = 'FFE30613', HEAD = 'FFF3F4F6'
/** A share's light fill: 75% and up green, 50% and up yellow, below red. */
const band = (v: number) => (v >= 0.75 ? 'FFDCFCE7' : v >= 0.5 ? 'FFFEF9C3' : 'FFFEE2E2')
const ASKS = (k: string) => k === 'form' || k === 'quiz'
const LIKABLE = new Set(['news', 'announcement', 'alert', 'notice', 'vacancy', 'video'])
const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const answerText = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v))
const hms = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(Math.round(sec % 60)).padStart(2, '0')}`
const ms = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
const pct = (p: DigestPerson) => (p.watched_seconds && p.video_seconds ? `${Math.min(100, Math.round((p.watched_seconds / p.video_seconds) * 100))}%` : '')

export function buildDigestWorkbook(wb: Workbook, o: {
  row: { title: string; kind: string }
  all: DigestPerson[]
  questions: Array<{ id: string; label: string }>
  anonymous: boolean
  anonAnswers: Array<Record<string, unknown>>
  scoreOf: (p: DigestPerson) => QuizScore | undefined
}) {
  const { row, questions, anonymous, anonAnswers, scoreOf } = o
  type Person = DigestPerson
  // A quiz's rank (the user, 6 Nov: "score % and less time taken"): the higher score %, then the shorter time from
  // Start to sending (a timed quiz), then whoever sent first. The same score and time share a rank.
  const taken = (p: Person) => { const s = scoreOf(p); return s?.started_at && s.sent_at ? Math.max(0, (Date.parse(s.sent_at) - Date.parse(s.started_at)) / 1000) : null }
  const share = (p: Person) => { const s = scoreOf(p); return s && s.max_score ? s.score / s.max_score : 0 }
  const rankOf = new Map<string, number>()
  let all = o.all
  if (row.kind === 'quiz') {
    const done = all.filter(p => p.answered_at && scoreOf(p)).sort((x, y) =>
      share(y) - share(x) || (taken(x) ?? Infinity) - (taken(y) ?? Infinity) || Date.parse(scoreOf(x)!.sent_at ?? x.answered_at!) - Date.parse(scoreOf(y)!.sent_at ?? y.answered_at!))
    done.forEach((p, i) => {
      const prev = done[i - 1]
      rankOf.set(p.ecode, prev && share(prev) === share(p) && taken(prev) === taken(p) ? rankOf.get(prev.ecode)! : i + 1)
    })
    all = [...done, ...all.filter(p => !rankOf.has(p.ecode))]
  }
  const yn = (b: boolean) => (b ? 'Yes' : 'No')
  const head = ['E-code', 'Name', 'Department', 'Function', 'Reporting manager', 'Manager E-code', 'Viewed', 'Opened', 'First opened', 'Last opened', 'Times opened',
    ...(LIKABLE.has(row.kind) ? ['Liked', 'Liked at'] : []),
    'Commented', 'Comments',
    ...(row.kind === 'meeting' ? ['Clicked Join', 'Join clicks', 'First joined', 'Last joined'] : []),
    ...(row.kind === 'poll' ? ['Voted', 'Answer'] : []),
    ...(row.kind === 'form' ? ['Answered', 'Answered at', ...(anonymous ? [] : questions.map(q => q.label))] : []),
    ...(row.kind === 'quiz' ? ['Rank', 'Answered', 'Answered at', 'Score', 'Out of', 'Score %', 'Time taken (m:ss)', ...questions.map(q => q.label)] : []),
    ...(row.kind === 'video' ? ['Watched', 'Watch time (h:mm:ss)', 'Minutes watched', 'Video minutes', 'Percent watched', 'Started'] : [])]
  const body: Array<Array<string | number | null>> = all.map(p => [p.ecode, p.full_name, p.department, p.function_name, p.manager_name ?? '', p.manager_ecode ?? '',
    yn(!!p.seen_at), yn(!!p.opened_at), p.opened_at ? fmt(p.opened_at) : '', p.last_opened ? fmt(p.last_opened) : '', p.opens,
    ...(LIKABLE.has(row.kind) ? [yn(!!p.liked_at), p.liked_at ? fmt(p.liked_at) : ''] : []),
    yn(p.comments > 0), p.comments,
    ...(row.kind === 'meeting' ? [yn(p.joins > 0), p.joins, p.joined_at ? fmt(p.joined_at) : '', p.last_joined ? fmt(p.last_joined) : ''] : []),
    ...(row.kind === 'poll' ? [yn(!!p.voted), p.voted ?? ''] : []),
    ...(row.kind === 'form' ? [yn(!!p.answered_at), p.answered_at ? fmt(p.answered_at) : '',
      ...(anonymous ? [] : questions.map(q => answerText(p.answers?.[q.id])))] : []),
    ...(row.kind === 'quiz' ? [rankOf.get(p.ecode) ?? null, yn(!!p.answered_at), p.answered_at ? fmt(p.answered_at) : '', scoreOf(p)?.score ?? null, scoreOf(p)?.max_score ?? null,
      p.answered_at && scoreOf(p) ? share(p) : null, taken(p) == null ? '' : ms(taken(p)!),
      ...questions.map(q => answerText(p.answers?.[q.id]))] : []),
    ...(row.kind === 'video' ? [yn(!!p.watched_seconds), p.watched_seconds ? hms(p.watched_seconds) : '', p.watched_seconds ? (p.watched_seconds / 60).toFixed(1) : '',
      p.video_seconds ? (p.video_seconds / 60).toFixed(1) : '', pct(p), p.watched_at ? fmt(p.watched_at) : ''] : [])])
  const ws = wb.addWorksheet('People', { views: [{ state: 'frozen', ySplit: 3, xSplit: 2 }] })
  const thin = { style: 'thin' as const, color: { argb: 'FF94A3B8' } }
  const grid = { top: thin, left: thin, bottom: thin, right: thin }
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
  const opened = all.filter(p => p.opened_at).length
  const answered = ASKS(row.kind) ? all.filter(p => p.answered_at).length : null
  ws.addRow([row.title]); ws.mergeCells(1, 1, 1, head.length)
  ws.addRow([[`Out of ${all.length} people`, `Opened ${opened}`, answered === null ? '' : `Answered ${answered}`].filter(Boolean).join(' · ')])
  ws.mergeCells(2, 1, 2, head.length)
  ws.addRow(head)
  for (const r of body) ws.addRow(r)
  // A question's answer is free text: wide and wrapped. Short columns fit their longest value.
  const qFrom = row.kind === 'quiz' || (row.kind === 'form' && !anonymous) ? head.length - questions.length : head.length
  const isYn = head.map((_, i) => body.length > 0 && body.every(r => r[i] === 'Yes' || r[i] === 'No'))
  const widths = head.map((h, i) => (i >= qFrom ? 45 : Math.min(30, Math.max(10, h.length + 2, ...body.map(r => String(r[i] ?? '').length + 2)))))
  ws.columns = widths.map(width => ({ width }))
  ws.eachRow((r, rn) => r.eachCell({ includeEmpty: true }, (c, cn) => {
    if (cn > head.length) return
    const i = cn - 1
    c.font = { name: 'Calibri', size: 10, bold: rn === 3 }
    c.alignment = { vertical: 'top', wrapText: i >= qFrom, horizontal: typeof c.value === 'number' ? 'right' : isYn[i] ? 'center' : 'left' }
    if (rn >= 3) c.border = grid
    if (rn === 1) { c.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill(BLACK); c.border = { bottom: { style: 'medium', color: { argb: RED } } }; c.alignment = { vertical: 'middle' } }
    if (rn === 2) { c.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } }; c.alignment = { vertical: 'middle' } }
    if (rn === 3) { c.fill = fill(HEAD); c.border = { ...grid, bottom: { style: 'medium', color: { argb: RED } } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true } }
    if (rn > 3 && head[i] === 'Score %') { c.numFmt = '0%'; if (typeof c.value === 'number') c.fill = fill(band(c.value)) }
    if (rn > 3 && head[i] === 'Rank' && typeof c.value === 'number' && c.value <= 3) { c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF92400E' } }; c.fill = fill(['FFFDE68A', 'FFE5E7EB', 'FFFED7AA'][c.value - 1]) }
    if (rn > 3 && isYn[i]) c.font = { name: 'Calibri', size: 10, bold: c.value === 'Yes', color: { argb: c.value === 'Yes' ? 'FF15803D' : 'FF94A3B8' } }
  }))
  ws.getRow(1).height = 24
  ws.getRow(3).height = Math.min(90, 15 * Math.max(1, ...head.map((h, i) => Math.ceil(h.length / (widths[i] - 2)))))
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: head.length } }
  if (row.kind === 'form' && anonymous) {
    const wa = wb.addWorksheet('Answers', { views: [{ state: 'frozen', ySplit: 3 }] })
    const ah = ['#', ...questions.map(q => q.label)]
    wa.addRow([`${row.title} · anonymous`]); wa.mergeCells(1, 1, 1, ah.length)
    wa.addRow([`${anonAnswers.length} answers · no names`]); wa.mergeCells(2, 1, 2, ah.length)
    wa.addRow(ah)
    anonAnswers.forEach((a, k) => wa.addRow([k + 1, ...questions.map(q => answerText(a[q.id]))]))
    wa.columns = ah.map((_, i) => ({ width: i === 0 ? 6 : 45 }))
    wa.eachRow((r, rn) => r.eachCell({ includeEmpty: true }, (c, cn) => {
      if (cn > ah.length) return
      c.font = { name: 'Calibri', size: 10, bold: rn === 3 }
      c.alignment = { vertical: 'top', wrapText: cn > 1, horizontal: cn === 1 ? 'center' : 'left' }
      if (rn >= 3) c.border = grid
      if (rn === 1) { c.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill(BLACK); c.border = { bottom: { style: 'medium', color: { argb: RED } } }; c.alignment = { vertical: 'middle' } }
      if (rn === 2) { c.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } }; c.alignment = { vertical: 'middle' } }
      if (rn === 3) { c.fill = fill(HEAD); c.border = { ...grid, bottom: { style: 'medium', color: { argb: RED } } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true } }
    }))
    wa.getRow(1).height = 24
    wa.getRow(3).height = Math.min(90, 15 * Math.max(1, ...ah.map(h => Math.ceil(h.length / 43))))
  }
  // Function wise and Manager wise (the user, 6 Nov: "single shot function wise summary, and other sheet for manager
  // wise"): each group's people, how many viewed, opened, answered, and for a quiz the average score.
  const summary = (name: string, keyHead: string[], keyOf: (p: Person) => string[]) => {
    type Col = { h: string; v: (g: Person[]) => number | null; pct?: boolean }
    const count = (h: string, f: (p: Person) => boolean): Col[] => [
      { h, v: g => g.filter(f).length },
      { h: `${h} %`, v: g => (g.length ? g.filter(f).length / g.length : 0), pct: true },
    ]
    const quiz = (g: Person[]) => g.filter(p => p.answered_at && scoreOf(p))
    const cols: Col[] = [
      { h: 'People', v: g => g.length },
      ...count('Viewed', p => !!p.seen_at),
      ...count('Opened', p => !!p.opened_at),
      ...(LIKABLE.has(row.kind) ? count('Liked', p => !!p.liked_at) : []),
      ...count('Commented', p => p.comments > 0),
      ...(row.kind === 'meeting' ? count('Clicked Join', p => p.joins > 0) : []),
      ...(row.kind === 'poll' ? count('Voted', p => !!p.voted) : []),
      ...(ASKS(row.kind) ? count('Answered', p => !!p.answered_at) : []),
      ...(row.kind === 'quiz' ? [
        { h: 'Average score', v: (g: Person[]) => { const q = quiz(g); return q.length ? Math.round((q.reduce((t, p) => t + (scoreOf(p)!.score ?? 0), 0) / q.length) * 10) / 10 : null } },
        { h: 'Out of', v: (g: Person[]) => quiz(g)[0] ? scoreOf(quiz(g)[0])!.max_score ?? null : null },
        { h: 'Score %', v: (g: Person[]) => { const q = quiz(g); const of = q.reduce((t, p) => t + (scoreOf(p)!.max_score ?? 0), 0); return of ? q.reduce((t, p) => t + (scoreOf(p)!.score ?? 0), 0) / of : null }, pct: true },
      ] as Col[] : []),
      ...(row.kind === 'video' ? [
        ...count('Watched', p => !!p.watched_seconds),
        { h: 'Watch time (h:mm:ss)', v: () => null },
      ] : []),
    ]
    const groups = new Map<string, { key: string[]; people: Person[] }>()
    for (const p of all) {
      const key = keyOf(p), id = key.join('|')
      if (!groups.has(id)) groups.set(id, { key, people: [] })
      groups.get(id)!.people.push(p)
    }
    const rows = [...groups.values()].sort((x, y) => y.people.length - x.people.length || x.key[0].localeCompare(y.key[0]))
    const sh = [...keyHead, ...cols.map(c => c.h)]
    const watch = (g: Person[]) => hms(g.reduce((t, p) => t + (p.watched_seconds ?? 0), 0))
    const line = (key: string[], g: Person[]) => [...key, ...cols.map(c => (c.h.startsWith('Watch time') ? watch(g) : c.v(g)))]
    const wsS = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3, xSplit: keyHead.length }] })
    wsS.addRow([`${row.title} · ${name}`]); wsS.mergeCells(1, 1, 1, sh.length)
    wsS.addRow([`${rows.length} ${keyHead[0] === 'Function' ? (rows.length === 1 ? 'function' : 'functions') : (rows.length === 1 ? 'manager' : 'managers')} · ${all.length} people`]); wsS.mergeCells(2, 1, 2, sh.length)
    wsS.addRow(sh)
    for (const r of rows) wsS.addRow(line(r.key, r.people))
    const totalKey = keyHead.map((_, i) => (i === 0 ? 'Total' : ''))
    wsS.addRow(line(totalKey, all))
    const last = rows.length + 4
    wsS.columns = sh.map((h, i) => ({ width: i < keyHead.length ? Math.min(40, Math.max(14, h.length + 2, ...rows.map(r => String(r.key[i] ?? '').length + 2))) : Math.max(10, h.length + 3) }))
    wsS.eachRow((r, rn) => r.eachCell({ includeEmpty: true }, (c, cn) => {
      if (cn > sh.length) return
      const i = cn - 1, col = cols[i - keyHead.length]
      c.font = { name: 'Calibri', size: 10, bold: rn === 3 || rn === last }
      c.alignment = { vertical: 'middle', horizontal: i < keyHead.length ? 'left' : 'right' }
      if (rn >= 3) c.border = grid
      if (rn > 3 && col?.pct) c.numFmt = '0%'
      // Every % here is better higher: light green, light yellow, light red (the user, 6 Nov: "only light colors").
      if (rn > 3 && rn < last && col?.pct && typeof c.value === 'number') c.fill = fill(band(c.value))
      if (rn === last) c.fill = fill(HEAD)
      if (rn === 1) { c.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill(BLACK); c.border = { bottom: { style: 'medium', color: { argb: RED } } }; c.alignment = { vertical: 'middle' } }
      if (rn === 2) { c.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } }; c.alignment = { vertical: 'middle' } }
      if (rn === 3) { c.fill = fill(HEAD); c.border = { ...grid, bottom: { style: 'medium', color: { argb: RED } } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true } }
    }))
    wsS.getRow(1).height = 24
    wsS.getRow(3).height = 30
  }
  summary('Function wise', ['Function'], p => [p.function_name || '—'])
  summary('Manager wise', ['Reporting manager', 'Manager E-code'], p => [p.manager_name || '—', p.manager_ecode ?? ''])

  return wb
}
