import clsx from 'clsx'
import { ArrowDown, ArrowUp, Check, Plus, X } from 'lucide-react'

/**
 * The questions of a Cyrix Digest form (0181; the user, 12 Oct: "can we add forms also?").
 * Each has its wording, a type, choices for the choice types, and whether it must be answered.
 */
export type QType = 'short' | 'long' | 'one' | 'many' | 'yesno' | 'number' | 'date' | 'rating'
export interface Question {
  id?: string; label: string; qtype: QType; options: string[]; required: boolean
  /** A quiz (0253): the correct choices by their place in options, and the question's marks. */
  right?: number[]; points?: number
  /** A quiz's Text question (0255): the answers it accepts, matched without regard to capitals or spaces. */
  accepted?: string[]
}

export const QTYPES: Array<[QType, string]> = [
  ['short', 'Short text'], ['long', 'Long text'], ['one', 'One choice'], ['many', 'Many choices'],
  ['yesno', 'Yes / No'], ['number', 'Number'], ['date', 'Date'], ['rating', 'Rating 1–5'],
]
export const blankQuestion = (): Question => ({ label: '', qtype: 'short', options: [], required: true })
const hasChoices = (t: QType) => t === 'one' || t === 'many'
/** A quiz question (0253; the user, 5 Nov): one choice or many, the correct ones marked, marks for each. */
export const blankQuizQuestion = (): Question => ({ label: '', qtype: 'one', options: ['', ''], required: true, right: [], points: 1 })
const QUIZ_TYPES: Array<[QType, string]> = [['one', 'One choice'], ['many', 'Many choices'], ['short', 'Text answer']]

export default function FormBuilder({ questions, onChange, quiz = false, locked = false }: {
  questions: Question[]; onChange: (q: Question[]) => void
  /** A quiz: choice questions only, each with its correct answer and marks. */
  quiz?: boolean
  /** A quiz people have sent: wording and order may change, not the choices, answers or marks. */
  locked?: boolean
}) {
  const put = (i: number, patch: Partial<Question>) => onChange(questions.map((q, k) => (k === i ? { ...q, ...patch } : q)))
  const move = (i: number, by: number) => {
    const next = [...questions]
    const [q] = next.splice(i, 1)
    next.splice(i + by, 0, q)
    onChange(next)
  }

  const types = quiz ? QUIZ_TYPES : QTYPES
  const mark = (i: number, k: number) => {
    const q = questions[i]
    const cur = q.right ?? []
    put(i, { right: q.qtype === 'one' ? [k] : cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k].sort((a, b) => a - b) })
  }
  const dropChoice = (i: number, k: number) => {
    const q = questions[i]
    put(i, { options: q.options.filter((_, j) => j !== k), right: (q.right ?? []).filter(x => x !== k).map(x => (x > k ? x - 1 : x)) })
  }
  const total = questions.reduce((t, q) => t + (q.points ?? 1), 0)
  return (
    <div className="space-y-3">
      <span className="label">Questions <span className="text-cyrixRed-600" aria-hidden>*</span>{quiz && <span className="ml-2 normal-case tracking-normal text-ink-500">· {total} marks</span>}</span>
      {questions.map((q, i) => (
        <div key={q.id ?? i} className="space-y-2 rounded-xl border border-ink-200 bg-ink-50/60 p-3">
          <div className="flex items-start gap-2">
            <span className="mt-2.5 w-6 shrink-0 text-center text-sm font-semibold text-ink-400">{i + 1}</span>
            <input className="input" maxLength={200} value={q.label} placeholder={quiz ? 'Which year was Cyrix founded?' : 'Your T-shirt size'}
              onChange={e => put(i, { label: e.target.value })} aria-label={`Question ${i + 1}`} />
            <div className="flex shrink-0 items-center">
              <button type="button" className="btn-icon" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></button>
              <button type="button" className="btn-icon" title="Move down" disabled={i === questions.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></button>
              {questions.length > 1 && !locked && (
                <button type="button" className="btn-icon text-ink-400 hover:text-cyrixRed-600" title="Remove question"
                  onClick={() => onChange(questions.filter((_, k) => k !== i))}><X className="h-4 w-4" /></button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pl-8">
            {types.map(([t, word]) => (
              <button key={t} type="button" disabled={locked} onClick={() => put(i, { qtype: t, options: hasChoices(t) && q.options.length < 2 ? ['', ''] : q.options, right: t === 'one' ? (q.right ?? []).slice(0, 1) : q.right, accepted: t === 'short' && !q.accepted?.length ? [''] : q.accepted })}
                className={clsx('rounded-full border px-2.5 py-1 text-xs font-medium',
                  q.qtype === t ? 'border-violet-600 bg-violet-600 text-white' : 'border-ink-300 text-ink-700 hover:border-violet-400 hover:text-violet-700')}>
                {word}
              </button>
            ))}
            {quiz ? (
              <label className="ml-auto inline-flex items-center gap-1.5 text-sm text-ink-800">
                Marks
                <input type="number" min={0} max={100} inputMode="numeric" className="input !w-20 !py-1" value={q.points ?? 1} disabled={locked}
                  onChange={e => { const v = Number(e.target.value); put(i, { points: Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0 }) }} />
              </label>
            ) : (
              <label className="ml-auto inline-flex items-center gap-1.5 text-sm text-ink-800">
                <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={q.required} onChange={e => put(i, { required: e.target.checked })} />
                Required
              </label>
            )}
          </div>
          {quiz && q.qtype === 'short' && (
            <div className="space-y-1.5 pl-8">
              {(q.accepted?.length ? q.accepted : ['']).map((a, k, list) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border-2 border-green-600 bg-green-600 text-white"><Check className="h-4 w-4" /></span>
                  <input className="input !border-green-600 !py-1.5" maxLength={120} value={a} disabled={locked}
                    placeholder={k === 0 ? 'Correct answer' : 'Also accept'}
                    onChange={e => put(i, { accepted: list.map((x, j) => (j === k ? e.target.value : x)) })} />
                  {list.length > 1 && !locked && (
                    <button type="button" className="btn-icon" title="Remove" onClick={() => put(i, { accepted: list.filter((_, j) => j !== k) })}><X className="h-4 w-4" /></button>
                  )}
                </div>
              ))}
              {(q.accepted?.length ?? 1) < 10 && !locked && (
                <button type="button" className="text-sm font-medium text-violet-700 hover:underline" onClick={() => put(i, { accepted: [...(q.accepted?.length ? q.accepted : ['']), ''] })}>
                  + Also accept
                </button>
              )}
            </div>
          )}
          {hasChoices(q.qtype) && (
            <div className="space-y-1.5 pl-8">
              {q.options.map((o, k) => {
                const right = !!q.right?.includes(k)
                return (
                  <div key={k} className="flex items-center gap-2">
                    {quiz && (
                      <button type="button" disabled={locked} onClick={() => mark(i, k)} aria-pressed={right} title="Correct answer"
                        className={clsx('grid h-8 w-8 shrink-0 place-items-center border-2', q.qtype === 'one' ? 'rounded-full' : 'rounded-md',
                          right ? 'border-green-600 bg-green-600 text-white' : 'border-ink-300 text-transparent hover:border-green-500')}>
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                    <input className={clsx('input !py-1.5', right && '!border-green-600')} maxLength={120} value={o} placeholder={`Choice ${k + 1}`} disabled={locked}
                      onChange={e => put(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} />
                    {quiz && right && <span className="shrink-0 text-xs font-semibold text-green-700">Correct</span>}
                    {q.options.length > 2 && !locked && (
                      <button type="button" className="btn-icon" title="Remove choice" onClick={() => dropChoice(i, k)}><X className="h-4 w-4" /></button>
                    )}
                  </div>
                )
              })}
              {q.options.length < 12 && !locked && (
                <button type="button" className="text-sm font-medium text-violet-700 hover:underline" onClick={() => put(i, { options: [...q.options, ''] })}>
                  + Add choice
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {questions.length < (quiz ? 50 : 30) && !locked && (
        <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => onChange([...questions, quiz ? blankQuizQuestion() : blankQuestion()])}>
          <Plus className="h-4 w-4" /> Add question
        </button>
      )}
    </div>
  )
}
