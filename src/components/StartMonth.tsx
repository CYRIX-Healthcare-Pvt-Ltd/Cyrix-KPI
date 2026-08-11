import { CalendarClock } from 'lucide-react'
import { fyMonths, monthLabel } from '@/lib/fy'

/**
 * Which month a KPI starts from.
 *
 * The same control in three places — setting up a KPI, approving one, and
 * the prompt that collects the answer from everybody whose KPI predates
 * the question — so it lives here rather than being typed out three times
 * and drifting.
 */
export function StartMonthSelect({
  fy, value, onChange, disabled, id, className, placeholder,
}: {
  fy: string
  value: string
  onChange: (month: string) => void
  disabled?: boolean
  id?: string
  className?: string
  /**
   * Shown as a disabled first option while `value` is ''. For the
   * approval screen, where every KPI made before this existed has no
   * answer and pre-filling one would put a month nobody chose in front
   * of a manager about to press Approve.
   */
  placeholder?: string
}) {
  return (
    <select
      id={id}
      className={className ?? 'input'}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
    >
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {fyMonths(fy).map(m => (
        <option key={m} value={m}>{monthLabel(m)}</option>
      ))}
    </select>
  )
}

/**
 * The explanation, worded for whoever is reading it.
 *
 * Kept beside the control because the question looks obvious and is not:
 * the instinct is to answer "this month", and the right answer is the
 * month the work started being measured.
 */
export function StartMonthNote({ who = 'you' }: { who?: string }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ink-500">
      <CalendarClock className="mt-px h-3.5 w-3.5 shrink-0 text-ink-400" />
      <span>
        April if {who} {who === 'you' ? 'were' : 'was'} here for the whole
        year. Pick the joining month otherwise — the months before it stop
        being asked for, and stop counting as missing.
      </span>
    </p>
  )
}
