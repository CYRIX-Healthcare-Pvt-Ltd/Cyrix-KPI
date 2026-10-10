import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronDown, Search, X } from 'lucide-react'

export interface PickOption { value: string; label: string; hint?: string }

/**
 * A dropdown of checkboxes with a search box, for choosing several at
 * once (the user, 10 Oct: "manager dropdown with check box so that I can
 * send to multiple managers, same for departments and functions").
 */
export default function MultiPick({ id, options, value, onChange, placeholder = 'Choose…' }: {
  id?: string
  options: PickOption[]
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc) }
  }, [open])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? options.filter(o => `${o.label} ${o.value} ${o.hint ?? ''}`.toLowerCase().includes(t)) : options
  }, [options, q])
  const chosen = new Set(value)
  const flip = (v: string) => onChange(chosen.has(v) ? value.filter(x => x !== v) : [...value, v])
  const labelOf = (v: string) => options.find(o => o.value === v)?.label ?? v

  return (
    <div className="relative" ref={wrap}>
      <button id={id} type="button" className="input flex items-center gap-2 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={clsx('min-w-0 flex-1 truncate', !value.length && 'text-ink-400')}>
          {value.length === 0 ? placeholder : value.length === 1 ? labelOf(value[0]) : `${value.length} selected`}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" />
      </button>

      {value.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map(v => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-700">
              {labelOf(v)}
              <button type="button" onClick={() => flip(v)} aria-label={`Remove ${labelOf(v)}`} className="text-ink-400 hover:text-ink-700">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-lg">
          <div className="flex items-center gap-2 border-b border-ink-200 px-3 py-2">
            <Search className="h-4 w-4 text-ink-400" />
            <input autoFocus className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-400"
              placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
            {value.length > 0 && (
              <button type="button" className="text-xs font-medium text-ink-500 hover:text-ink-800" onClick={() => onChange([])}>Clear</button>
            )}
          </div>
          <ul className="max-h-64 overflow-y-auto py-1" role="listbox" aria-multiselectable>
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-ink-400">No match</li>}
            {shown.map(o => {
              const on = chosen.has(o.value)
              return (
                <li key={o.value}>
                  <button type="button" role="option" aria-selected={on} onClick={() => flip(o.value)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-ink-50">
                    <span className={clsx('flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      on ? 'border-cyrixRed-600 bg-cyrixRed-600 text-white' : 'border-ink-300')}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink-900">{o.label}</span>
                    {o.hint && <span className="shrink-0 text-xs text-ink-400">{o.hint}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
