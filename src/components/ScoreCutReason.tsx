import { AlertTriangle, MessageSquare } from 'lucide-react'

/**
 * A score materially below somebody's own assessment, and why.
 *
 * Two views of one fact, kept together so they cannot drift apart in
 * wording: the manager writes it while deciding the score, the team
 * member reads it beside the score it explains.
 *
 * Both are one column at every width. The instinct is to put the figure
 * beside the box to save vertical space, which on a phone leaves a
 * textarea about forty characters wide for the most consequential
 * sentence on the screen.
 */

/** The manager's copy: required, and it blocks Submit until filled. */
export function ScoreCutPrompt({
  gap, name, value, onChange, disabled,
}: {
  /** How many points below the self assessment, already positive. */
  gap: number
  /** The team member's first name. */
  name: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div className="card border-amber-300 bg-amber-50 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            You are scoring {gap.toFixed(1)} points below {name}'s own assessment
          </p>
          <p className="mt-1 text-sm leading-relaxed text-amber-800">
            Say why. {name} sees this with their score, which is usually the
            difference between a conversation and a query.
          </p>
        </div>
      </div>

      <div className="mt-4">
        <label className="label" htmlFor="cut-reason">
          Reason for the lower score
          <span className="ml-1 font-normal text-amber-700">· required</span>
        </label>
        <textarea
          id="cut-reason"
          rows={3}
          className="input bg-white"
          disabled={disabled}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="e.g. Two of the four site visits were not completed, and the November report went in a week late."
        />
        {!value.trim() && (
          <p className="mt-1.5 text-xs text-amber-800">
            Submit stays locked until this is filled in.
          </p>
        )}
      </div>
    </div>
  )
}

/** The team member's copy: read-only, beside their score. */
export function ScoreCutNotice({
  reason, canQuery,
}: {
  reason: string
  /** Is the query route actually open to them right now? */
  canQuery?: boolean
}) {
  return (
    <div className="card border-amber-200 bg-amber-50 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
          <MessageSquare className="h-4 w-4 text-amber-700" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-label text-amber-700">
            Why your manager scored this lower
          </p>
          {/* whitespace-pre-line: managers write these in short lines and
              a paragraph break is usually deliberate. */}
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-amber-900">
            {reason}
          </p>
          {canQuery && (
            <p className="mt-2 text-xs text-amber-800">
              If this does not match how the month went, you can query it
              below rather than leave it.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
