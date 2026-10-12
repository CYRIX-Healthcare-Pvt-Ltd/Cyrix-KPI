import clsx from 'clsx'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'

/**
 * The questions of a Cyrix Digest form (0181; the user, 12 Oct: "can we add forms also?").
 * Each has its wording, a type, choices for the choice types, and whether it must be answered.
 */
export type QType = 'short' | 'long' | 'one' | 'many' | 'yesno' | 'number' | 'date' | 'rating'
export interface Question { id?: string; label: string; qtype: QType; options: string[]; required: boolean }

export const QTYPES: Array<[QType, string]> = [
  ['short', 'Short text'], ['long', 'Long text'], ['one', 'One choice'], ['many', 'Many choices'],
  ['yesno', 'Yes / No'], ['number', 'Number'], ['date', 'Date'], ['rating', 'Rating 1–5'],
]
export const blankQuestion = (): Question => ({ label: '', qtype: 'short', options: [], required: true })
const hasChoices = (t: QType) => t === 'one' || t === 'many'

export default function FormBuilder({ questions, onChange }: { questions: Question[]; onChange: (q: Question[]) => void }) {
  const put = (i: number, patch: Partial<Question>) => onChange(questions.map((q, k) => (k === i ? { ...q, ...patch } : q)))
  const move = (i: number, by: number) => {
    const next = [...questions]
    const [q] = next.splice(i, 1)
    next.splice(i + by, 0, q)
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <span className="label">Questions <span className="text-cyrixRed-600" aria-hidden>*</span></span>
      {questions.map((q, i) => (
        <div key={q.id ?? i} className="space-y-2 rounded-xl border border-ink-200 bg-ink-50/60 p-3">
          <div className="flex items-start gap-2">
            <span className="mt-2.5 w-6 shrink-0 text-center text-sm font-semibold text-ink-400">{i + 1}</span>
            <input className="input" maxLength={200} value={q.label} placeholder="Your T-shirt size"
              onChange={e => put(i, { label: e.target.value })} aria-label={`Question ${i + 1}`} />
            <div className="flex shrink-0 items-center">
              <button type="button" className="btn-icon" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></button>
              <button type="button" className="btn-icon" title="Move down" disabled={i === questions.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></button>
              {questions.length > 1 && (
                <button type="button" className="btn-icon text-ink-400 hover:text-cyrixRed-600" title="Remove question"
                  onClick={() => onChange(questions.filter((_, k) => k !== i))}><X className="h-4 w-4" /></button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pl-8">
            {QTYPES.map(([t, word]) => (
              <button key={t} type="button" onClick={() => put(i, { qtype: t, options: hasChoices(t) && q.options.length < 2 ? ['', ''] : q.options })}
                className={clsx('rounded-full border px-2.5 py-1 text-xs font-medium',
                  q.qtype === t ? 'border-violet-600 bg-violet-600 text-white' : 'border-ink-300 text-ink-700 hover:border-violet-400 hover:text-violet-700')}>
                {word}
              </button>
            ))}
            <label className="ml-auto inline-flex items-center gap-1.5 text-sm text-ink-800">
              <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={q.required} onChange={e => put(i, { required: e.target.checked })} />
              Required
            </label>
          </div>
          {hasChoices(q.qtype) && (
            <div className="space-y-1.5 pl-8">
              {q.options.map((o, k) => (
                <div key={k} className="flex items-center gap-2">
                  <input className="input !py-1.5" maxLength={120} value={o} placeholder={`Choice ${k + 1}`}
                    onChange={e => put(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} />
                  {q.options.length > 2 && (
                    <button type="button" className="btn-icon" title="Remove choice" onClick={() => put(i, { options: q.options.filter((_, j) => j !== k) })}><X className="h-4 w-4" /></button>
                  )}
                </div>
              ))}
              {q.options.length < 12 && (
                <button type="button" className="text-sm font-medium text-violet-700 hover:underline" onClick={() => put(i, { options: [...q.options, ''] })}>
                  + Add choice
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {questions.length < 30 && (
        <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => onChange([...questions, blankQuestion()])}>
          <Plus className="h-4 w-4" /> Add question
        </button>
      )}
    </div>
  )
}
