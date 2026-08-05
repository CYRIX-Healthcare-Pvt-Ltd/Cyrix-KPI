import { useState, Fragment } from 'react'
import { CheckSquare, Check, X, Pencil, CheckCheck, Shuffle } from 'lucide-react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import {
  usePendingApprovals, useAssignmentAction, useEditAssignmentItem,
  useScoringRules, currentFy,
} from '@/lib/queries'
import { supabase, friendlyError } from '@/lib/supabase'
import { Alert, PageLoader, Spinner, EmptyState, NumberInput } from '@/components/ui'
import { sectionsOf } from '@/lib/sections'
import type { KpiAssignment, KpiAssignmentItem, Section, Alternate } from '@/types/db'

export default function Approvals() {
  const { employee } = useAuth()
  const fy = currentFy()
  const { data, isLoading } = usePendingApprovals(employee?.id, fy)
  const [expanded, setExpanded] = useState<string | null>(null)

  if (isLoading) return <PageLoader />

  if (!data || data.length === 0) {
    return (
      <EmptyState icon={CheckSquare} title="Nothing waiting for approval">
        When someone on your team submits their KPI for FY {fy}, it will appear here.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">KPI approvals</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {data.length} waiting · FY {fy}
          </p>
        </div>
      </div>

      <ApproveAll
        pending={data.map(({ assignment, employee: tm }) => ({
          id: assignment.id, name: tm.full_name, ecode: tm.ecode,
        }))}
      />

      <div className="space-y-3">
        {data.map(({ assignment, employee: tm }) => (
          <ApprovalCard
            key={assignment.id}
            assignment={assignment}
            name={tm.full_name}
            ecode={tm.ecode}
            designation={tm.designation}
            expanded={expanded === assignment.id}
            onToggle={() =>
              setExpanded(expanded === assignment.id ? null : assignment.id)
            }
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Approving a whole queue at once.
 *
 * A manager with thirty reports cannot reasonably open thirty cards, and
 * the alternative to this button is not thirty careful reviews — it is
 * thirty reflexive clicks on Approve. So the bulk action is honest about
 * what it is: it says how many, warns that each one locks for the year,
 * and needs a second press.
 *
 * Each KPI still goes through approve_assignment individually, which
 * re-validates the weightages. One that does not add up is refused and
 * named rather than quietly skipped, and the rest still go through — a
 * single bad row must not block a queue of thirty.
 */
function ApproveAll({
  pending,
}: {
  pending: Array<{ id: string; name: string; ecode: string }>
}) {
  const qc = useQueryClient()
  const [arming, setArming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState<Array<{ name: string; why: string }>>([])
  const [result, setResult] = useState<string | null>(null)

  // The offer only makes sense for a queue, but the outcome has to
  // survive it: approving 3 of 4 drops the queue below the threshold, and
  // hiding the panel at that moment takes the explanation of why the
  // fourth is still sitting there with it.
  if (pending.length < 2 && !result) return null

  const run = async () => {
    setBusy(true); setDone(0); setFailed([]); setResult(null)
    const problems: Array<{ name: string; why: string }> = []
    let ok = 0

    for (const p of pending) {
      const { error } = await supabase.rpc('approve_assignment', {
        p_assignment_id: p.id,
      })
      if (error) problems.push({ name: `${p.name} (${p.ecode})`, why: friendlyError(error) })
      else ok++
      setDone(d => d + 1)
    }

    setFailed(problems)
    setResult(
      problems.length === 0
        ? `Approved all ${ok}.`
        : `Approved ${ok} of ${pending.length}. ${problems.length === 1
            ? 'One could not be approved and is'
            : `${problems.length} could not be approved and are`} still waiting below.`,
    )
    setBusy(false)
    setArming(false)
    qc.invalidateQueries({ queryKey: ['pending_approvals'] })
    qc.invalidateQueries({ queryKey: ['pending_counts'] })
    qc.invalidateQueries({ queryKey: ['assignment'] })
    qc.invalidateQueries({ queryKey: ['team'] })
  }

  return (
    <div className="card space-y-3 p-4">
      {result && (
        <Alert kind={failed.length ? 'warning' : 'success'}>
          {result}
        </Alert>
      )}

      {failed.length > 0 && (
        <ul className="space-y-1 text-sm text-ink-700">
          {failed.map(f => (
            <li key={f.name}>
              <span className="font-medium">{f.name}</span> — {f.why}
            </li>
          ))}
        </ul>
      )}

      {pending.length < 2 ? (
        result && (
          <button
            onClick={() => { setResult(null); setFailed([]) }}
            className="btn-secondary"
          >
            Dismiss
          </button>
        )
      ) : !arming ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink-900">
              Approve all {pending.length}?
            </p>
            <p className="mt-0.5 text-sm text-ink-500">
              For when you have already agreed these offline. Each one is still
              checked for a valid 80 / 20 split.
            </p>
          </div>
          <button onClick={() => { setArming(true); setResult(null) }} className="btn-secondary">
            <CheckCheck className="h-4 w-4" /> Approve all
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-ink-900">
              Approve {pending.length} KPIs without opening them?
            </p>
            <p className="mt-0.5 text-sm text-ink-500">
              Each becomes the locked basis for that person's scoring all year.
              Reopening one afterwards needs your approval and then HR's.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={run} disabled={busy} className="btn-primary">
              {busy && <Spinner className="h-4 w-4" />}
              {busy ? `Approving ${done} of ${pending.length}…` : `Yes, approve all ${pending.length}`}
            </button>
            <button onClick={() => setArming(false)} disabled={busy} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * One of a row's alternatives, on the approval table.
 *
 * Editable for exactly the same reason the row above it is: the manager
 * is approving this, so a typo here should not cost a round trip either.
 * The weightage column says "same" and cannot be typed into — an
 * alternative with its own weightage is a second row, and the year would
 * stop totalling 100.
 *
 * Saving writes the whole alternates array back, because it is one jsonb
 * column. Editing two alternatives on the same row in quick succession
 * therefore reads the array as it was rendered — acceptable here, where
 * one person is correcting one KPI in front of them.
 */
function AlternateRow({
  item, alt, editable,
}: {
  item: KpiAssignmentItem
  alt: Alternate
  editable: boolean
}) {
  const edit = useEditAssignmentItem()
  const { data: rules } = useScoringRules()
  const [draft, setDraft] = useState(alt)

  const commit = (patch: Partial<Alternate>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    edit.mutate({
      itemId: item.id,
      patch: {
        alternates: (item.alternates ?? []).map(a => (a.id === alt.id ? next : a)),
      },
    })
  }

  const marker = (
    <span className="inline-flex items-center gap-1.5">
      <Shuffle className="h-3.5 w-3.5 shrink-0 text-ink-400" />
      <span className="badge bg-ink-200 text-ink-700">or</span>
    </span>
  )

  if (!editable) {
    return (
      <tr className="bg-ink-50/60">
        <td className="py-2 pl-10 pr-4">
          {marker}{' '}
          <span className="font-medium text-ink-800">{draft.kra || '—'}</span>
        </td>
        <td className="px-4 py-2 text-ink-600">{draft.kpi_description ?? '—'}</td>
        <td className="px-4 py-2 text-right text-ink-400">same</td>
        <td className="px-4 py-2 text-right tabular-nums text-ink-600">
          {draft.target_value ?? '—'}
        </td>
        <td className="px-4 py-2 text-xs text-ink-500">
          {draft.scoring_rule.replace(/_/g, ' ')}
        </td>
      </tr>
    )
  }

  return (
    <tr className="bg-amber-50/40">
      <td className="py-1.5 pl-8 pr-2">
        <div className="flex items-center gap-1.5">
          {marker}
          <input
            className="input !py-1.5 text-sm"
            value={draft.kra}
            onChange={e => setDraft({ ...draft, kra: e.target.value })}
            onBlur={e => commit({ kra: e.target.value })}
          />
        </div>
      </td>
      <td className="px-2 py-1.5">
        <input
          className="input !py-1.5 text-xs"
          value={draft.kpi_description ?? ''}
          onChange={e => setDraft({ ...draft, kpi_description: e.target.value })}
          onBlur={e => commit({ kpi_description: e.target.value })}
        />
      </td>
      <td
        className="px-4 py-1.5 text-right text-xs text-ink-400"
        title="An alternative shares the row's weightage — that is what makes it an alternative"
      >
        same
      </td>
      <td className="px-2 py-1.5">
        <NumberInput
          step="any"
          className="input !py-1.5 w-20 text-right text-sm"
          value={draft.target_value}
          onValue={v => { setDraft({ ...draft, target_value: v }); commit({ target_value: v }) }}
        />
      </td>
      <td className="px-2 py-1.5">
        <select
          className="input !py-1.5 text-xs"
          value={draft.scoring_rule}
          onChange={e => commit({ scoring_rule: e.target.value as Alternate['scoring_rule'] })}
        >
          {(rules ?? []).map(r => (
            <option key={r.code} value={r.code}>{r.label}</option>
          ))}
        </select>
      </td>
    </tr>
  )
}

/**
 * A KPI row on the approval screen. The manager can nudge the wording,
 * weightage or target in place — RLS already allows it while the
 * assignment is pending — so a typo doesn't cost a full round trip.
 * Saved on blur rather than with a Save button, since these are meant to
 * be small corrections made in passing.
 */
function EditableRow({
  item, editable,
}: {
  item: KpiAssignmentItem
  editable: boolean
}) {
  const edit = useEditAssignmentItem()
  // Cached for the session, so asking here rather than threading it down
  // through three components costs nothing.
  const { data: rules } = useScoringRules()
  const [draft, setDraft] = useState(item)

  const commit = (patch: Partial<KpiAssignmentItem>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    const changed =
      next.kra !== item.kra ||
      next.kpi_description !== item.kpi_description ||
      next.weightage !== item.weightage ||
      next.target_value !== item.target_value ||
      next.scoring_rule !== item.scoring_rule
    if (changed) {
      edit.mutate({
        itemId: item.id,
        patch: {
          kra: next.kra,
          kpi_description: next.kpi_description,
          weightage: next.weightage,
          target_value: next.target_value,
          // The manager's to correct as much as the target is, and more
          // consequential: the wrong rule scores every month of the year
          // in the wrong direction, and the team member picking it was
          // often guessing — or had it guessed for them by the importer.
          scoring_rule: next.scoring_rule,
        },
      })
    }
  }

  if (!editable) {
    return (
      <tr>
        <td className="px-4 py-2.5 font-medium text-ink-900">{draft.kra}</td>
        <td className="max-w-md px-4 py-2.5 text-xs text-ink-500">{draft.kpi_description}</td>
        <td className="px-4 py-2.5 text-right tabular-nums">{draft.weightage}%</td>
        <td className="px-4 py-2.5 text-right tabular-nums">{draft.target_value ?? '—'}</td>
        <td className="px-4 py-2.5 text-xs text-ink-500">
          {draft.scoring_rule.replace(/_/g, ' ')}
        </td>
      </tr>
    )
  }

  return (
    <tr className="bg-amber-50/40">
      <td className="px-2 py-1.5">
        <input
          className="input !py-1.5 text-sm"
          value={draft.kra}
          onChange={e => setDraft({ ...draft, kra: e.target.value })}
          onBlur={e => commit({ kra: e.target.value })}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          className="input !py-1.5 text-xs"
          value={draft.kpi_description ?? ''}
          onChange={e => setDraft({ ...draft, kpi_description: e.target.value })}
          onBlur={e => commit({ kpi_description: e.target.value })}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number" step="any"
          className="input !py-1.5 w-20 text-right text-sm"
          value={draft.weightage}
          onChange={e => setDraft({ ...draft, weightage: Number(e.target.value) })}
          onBlur={e => commit({ weightage: Number(e.target.value) })}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number" step="any"
          className="input !py-1.5 w-20 text-right text-sm"
          value={draft.target_value ?? ''}
          onChange={e => setDraft({
            ...draft,
            target_value: e.target.value === '' ? null : Number(e.target.value),
          })}
          onBlur={e => commit({
            target_value: e.target.value === '' ? null : Number(e.target.value),
          })}
        />
      </td>
      <td className="px-2 py-1.5">
        <select
          className="input !py-1.5 text-xs"
          value={draft.scoring_rule}
          onChange={e => {
            const rule = e.target.value as KpiAssignmentItem['scoring_rule']
            // Same reset as the setup form: each rule carries its own
            // promise about ceilings and negatives, and leaving the old
            // row's parameters behind would make the label a lie.
            setDraft({ ...draft, scoring_rule: rule })
            commit({ scoring_rule: rule })
          }}
        >
          {(rules ?? []).map(r => (
            <option key={r.code} value={r.code}>{r.label}</option>
          ))}
        </select>
      </td>
    </tr>
  )
}

function ApprovalCard({
  assignment, name, ecode, designation, expanded, onToggle,
}: {
  // The whole row rather than its id: the section weights are per person
  // — 20% core values, or 15% with ESMS carrying the other 5% — so the
  // targets each block is checked against have to come from it.
  assignment: KpiAssignment
  name: string
  ecode: string
  designation: string | null
  expanded: boolean
  onToggle: () => void
}) {
  const assignmentId = assignment.id
  const action = useAssignmentAction()
  const [rejecting, setRejecting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: items } = useQuery({
    enabled: expanded,
    queryKey: ['approval_items', assignmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kpi_assignment_items').select('*')
        .eq('assignment_id', assignmentId).order('sort_order')
      if (error) throw new Error(friendlyError(error))
      return data as KpiAssignmentItem[]
    },
  })

  const run = async (act: 'approve' | 'reject') => {
    setError(null)
    try {
      await action.mutateAsync({
        action: act, assignmentId, reason: act === 'reject' ? reason : undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete that.')
    }
  }

  const total = (s: Section) =>
    (items ?? []).filter(i => i.section === s).reduce((a, b) => a + b.weightage, 0)

  return (
    <div className="card overflow-hidden">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-ink-50"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-200 text-xs font-semibold text-ink-700">
          {name.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-900">{name}</p>
          <p className="truncate text-xs text-ink-500">
            {ecode}{designation && ` · ${designation}`}
          </p>
        </div>
        <span className="text-xs font-medium text-ink-900">
          {expanded ? 'Hide' : 'Review'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-ink-100">
          {!items ? (
            <div className="p-6 text-center"><Spinner className="mx-auto h-5 w-5 text-ink-400" /></div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                      <th className="px-4 py-2 font-medium">KRA</th>
                      <th className="px-4 py-2 font-medium">KPI</th>
                      <th className="px-4 py-2 text-right font-medium">Wt</th>
                      <th className="px-4 py-2 text-right font-medium">Target</th>
                      <th className="px-4 py-2 font-medium">Scoring</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {sectionsOf(assignment).map(({ key: section, label, weight, standard }) => (
                      <Fragment key={section}>
                        <tr className="bg-ink-50/60">
                          <td colSpan={5} className="px-4 py-1.5 text-xs font-semibold text-ink-600">
                            {label} — {weight}%
                            <span className={`ml-2 font-normal ${
                              total(section) === weight ? 'text-emerald-700' : 'text-red-700'
                            }`}>
                              (total {total(section)}%)
                            </span>
                          </td>
                        </tr>
                        {items.filter(i => i.section === section).map(item => (
                          <Fragment key={item.id}>
                            <EditableRow
                              item={item}
                              // The standard bands are the same for everyone
                              // who has them, so a manager approving one
                              // person cannot quietly reword them.
                              editable={editing && !standard}
                            />
                            {/* An alternative is part of what is being
                                approved — the same weightage measuring
                                something else in some months — so it has
                                to be on the table the manager reads
                                before pressing Approve. Indented and
                                tinted rather than listed flat, or it
                                reads as another row and the weightages
                                appear not to add up. */}
                            {(item.alternates ?? []).map(alt => (
                              <AlternateRow
                                key={alt.id}
                                item={item}
                                alt={alt}
                                editable={editing && !standard}
                              />
                            ))}
                          </Fragment>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 border-t border-ink-100 p-4">
                {error && <Alert kind="error">{error}</Alert>}

                {editing && (
                  <Alert kind="info">
                    Editing directly. Changes are saved as you leave each field —
                    no need to send the whole KPI back. Sending it back is still the
                    right move for anything the team member should rethink.
                  </Alert>
                )}

                {!rejecting ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => run('approve')}
                      disabled={action.isPending}
                      className="btn-primary"
                    >
                      {action.isPending ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                      Approve
                    </button>
                    <button
                      onClick={() => setEditing(v => !v)}
                      className="btn-secondary"
                    >
                      <Pencil className="h-4 w-4" />
                      {editing ? 'Done editing' : 'Edit'}
                    </button>
                    <button onClick={() => setRejecting(true)} className="btn-secondary">
                      <X className="h-4 w-4" /> Send back
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="label" htmlFor={`r-${assignmentId}`}>
                      What needs changing?
                    </label>
                    <textarea
                      id={`r-${assignmentId}`}
                      rows={2}
                      className="input"
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="e.g. Response time should be weighted 30%, not 25%"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => run('reject')}
                        disabled={!reason.trim() || action.isPending}
                        className="btn-danger"
                      >
                        Send back to {name.split(' ')[0]}
                      </button>
                      <button onClick={() => setRejecting(false)} className="btn-secondary">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
