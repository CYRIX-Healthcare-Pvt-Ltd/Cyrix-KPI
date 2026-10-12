import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'

/**
 * A duration as hours and minutes, picked from two columns (the user, 12 Oct:
 * "how can i select 1 hr 20 mins? make something like this", beside a time
 * picker's hour and minute columns). Minutes in fives; 5 minutes to 10 hours.
 */
const HOURS = Array.from({ length: 11 }, (_, h) => h)
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)

export const durationLabel = (total: number) => {
  const h = Math.floor(total / 60)
  const m = total % 60
  return [h ? `${h} hr` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min'
}

export default function DurationPicker({ id, value, onChange }: {
  id?: string
  /** Minutes. */
  value: number
  onChange: (minutes: number) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const h = Math.floor(value / 60)
  const m = value % 60

  // Closes on a press outside it or on Escape.
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  // The chosen ones in view when it opens.
  useEffect(() => {
    if (!open) return
    box.current?.querySelectorAll<HTMLElement>('[data-on="true"]').forEach(el => el.scrollIntoView({ block: 'center' }))
  }, [open])

  const set = (hours: number, minutes: number) => {
    const total = Math.min(600, hours * 60 + minutes)
    onChange(total < 5 ? 5 : total)
  }

  const column = (items: number[], current: number, word: string, pick: (n: number) => void) => (
    <div className="max-h-56 w-20 overflow-y-auto overscroll-contain py-1" role="listbox" aria-label={word}>
      {items.map(n => (
        <button
          key={n}
          type="button"
          role="option"
          aria-selected={n === current}
          data-on={n === current}
          onClick={() => pick(n)}
          className={clsx(
            'mx-auto my-0.5 block w-16 rounded-lg py-1.5 text-center text-sm tabular-nums',
            n === current ? 'bg-violet-600 font-semibold text-white' : 'text-ink-700 hover:bg-ink-100',
          )}
        >
          {String(n).padStart(2, '0')}
        </button>
      ))}
    </div>
  )

  return (
    <div className="relative" ref={box}>
      <button
        id={id}
        type="button"
        className="input flex items-center justify-between text-left"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span className="tabular-nums">{durationLabel(value)}</span>
        <ChevronDown className={clsx('h-4 w-4 text-ink-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 rounded-xl border border-ink-200 bg-surface p-2 shadow-lg">
          <div className="flex text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            <span className="w-20 text-center">Hours</span>
            <span className="w-20 text-center">Minutes</span>
          </div>
          <div className="flex divide-x divide-ink-100">
            {column(HOURS, h, 'Hours', n => set(n, m))}
            {column(MINUTES, m - (m % 5), 'Minutes', n => set(h, n))}
          </div>
          <button type="button" className="btn-primary mt-2 w-full justify-center !py-1.5" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      )}
    </div>
  )
}
