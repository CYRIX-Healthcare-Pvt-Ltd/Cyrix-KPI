import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Eye } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import {
  useSubmissionHistory, useMyAssignment, useSubmissionById, useCoreValues, currentFy,
} from '@/lib/queries'
import { fyMonthsFrom, monthLabel } from '@/lib/fy'
import { SECTION_SHORT } from '@/lib/sections'
import { Alert, Spinner, StatusBadge, BandCell } from '@/components/ui'
import Dialog from '@/components/Dialog'
import type { Employee } from '@/types/db'

const fmt = (n: number | null | undefined, d = 2) => (n == null ? '—' : Number(n).toFixed(d))

/**
 * HR's look at one person's assessments, month by month (the user, 10 Nov:
 * "when we type name or ecode, then search, their assesmnt ... month wise,
 * just view option only no editing"). Nothing here writes.
 */
export default function AssessmentView() {
  const fy = currentFy()
  const [text, setText] = useState('')
  const [asked, setAsked] = useState('')
  const [person, setPerson] = useState<Employee | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)

  const { data: found, isFetching: searching, error } = useQuery({
    enabled: asked.length > 0,
    queryKey: ['assessment_search', asked],
    placeholderData: prev => prev,
    queryFn: async () => {
      const q = asked.replace(/[%,()]/g, ' ').trim()
      const { data, error } = await supabase.from('employees')
        .select('id, ecode, full_name, designation, department, is_active')
        .or(`full_name.ilike.%${q}%,ecode.ilike.%${q}%`)
        .order('full_name').limit(20)
      if (error) throw new Error(friendlyError(error))
      return (data ?? []) as Employee[]
    },
  })

  // Suggestions while typing (the user, 10 Nov: "when typing suggesion should come"): a moment after the last key.
  useEffect(() => {
    const q = text.trim()
    const t = setTimeout(() => setAsked(q.length >= 2 ? q : ''), 250)
    return () => clearTimeout(t)
  }, [text])
  const search = () => {
    const q = text.trim()
    setPerson(null)
    setAsked(q)
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); search() }}>
          <input className="input flex-1" value={text} onChange={e => { setText(e.target.value); setPerson(null) }}
            placeholder="Name or ECODE" aria-label="Name or ECODE" />
          <button type="submit" className="btn-primary" disabled={!text.trim()}>
            {searching ? <Spinner className="h-4 w-4" /> : <Search className="h-4 w-4" />} Search
          </button>
        </form>
        {error && <div className="mt-3"><Alert kind="error">{(error as Error).message}</Alert></div>}
        {!person && asked && found && (
          found.length === 0
            ? <p className="mt-3 text-sm text-ink-500">Nobody found for “{asked}”</p>
            : (
              <div className="mt-3 divide-y divide-ink-100 rounded-xl border border-ink-200">
                {found.map(e => (
                  <button key={e.id} type="button" onClick={() => setPerson(e)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink-900">{e.full_name}</span>
                      <span className="block truncate text-xs text-ink-500">
                        {e.ecode}{e.designation && ` · ${e.designation}`}{e.department && ` · ${e.department}`}
                      </span>
                    </span>
                    {!e.is_active && <span className="badge bg-ink-100 text-ink-600">Left</span>}
                  </button>
                ))}
              </div>
            )
        )}
      </div>

      {person && <PersonMonths person={person} fy={fy} onView={setViewing} onBack={() => setPerson(null)} />}
      {viewing && <MonthView submissionId={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function PersonMonths({ person, fy, onView, onBack }: {
  person: Employee; fy: string; onView: (id: string) => void; onBack: () => void
}) {
  const { data: history, isLoading } = useSubmissionHistory(person.id, fy)
  const { data: assignment } = useMyAssignment(person.id, fy)
  const hasEsms = Number(assignment?.assignment?.esms_weight ?? 0) > 0
  const months = fyMonthsFrom(fy, assignment?.assignment?.starts_from ?? null)
  const byMonth = new Map((history ?? []).map(s => [s.period_month, s]))

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-ink-50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-ink-900">{person.full_name}</h3>
          <p className="truncate text-xs text-ink-500">
            {person.ecode}{person.designation && ` · ${person.designation}`} · FY {fy}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onBack}>Change person</button>
      </div>
      {isLoading ? (
        <div className="flex justify-center p-6"><Spinner className="h-5 w-5" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2.5 font-medium">Month</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Self
                  <span className="block text-[10px] font-normal normal-case tracking-normal text-ink-400">job role only</span>
                </th>
                <th className="px-4 py-2.5 text-right font-medium">Score</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {months.map(m => {
                const s = byMonth.get(m)
                return (
                  <tr key={m} className="hover:bg-ink-50">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-ink-900">{monthLabel(m)}</td>
                    <td className="px-4 py-3"><StatusBadge status={s?.status ?? null} outcome={s?.deadline_outcome} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-600">{fmt(s?.self_job_role_score)}</td>
                    <BandCell total={s?.final_total_score} job={s?.final_job_role_score} esms={s?.final_esms_score}
                      core={s?.final_core_score} hasEsms={hasEsms} pill />
                    <td className="px-4 py-3 text-right">
                      {s ? (
                        <button type="button" onClick={() => onView(s.id)}
                          className="inline-flex items-center gap-1 text-sm font-medium text-ink-900 hover:underline">
                          <Eye className="h-4 w-4" /> View
                        </button>
                      ) : <span className="text-ink-300">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** One month, read only: each row with what the person claimed and what the manager gave. */
function MonthView({ submissionId, onClose }: { submissionId: string; onClose: () => void }) {
  const { data, isLoading } = useSubmissionById(submissionId)
  const { data: coreValues } = useCoreValues()
  const name = new Map((coreValues ?? []).map(c => [c.id, c.name]))
  const s = data?.submission

  return (
    <Dialog wide title={s ? `${data!.employee.full_name} · ${monthLabel(s.period_month)}` : 'Assessment'} icon={<Eye className="h-5 w-5" />} onClose={onClose}>
      {isLoading || !data || !s ? (
        <div className="flex justify-center p-6"><Spinner className="h-5 w-5" /></div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status} outcome={s.deadline_outcome} />
            <span className="text-sm text-ink-600">Score <strong className="tabular-nums text-ink-900">{fmt(s.final_total_score)}</strong></span>
          </div>
          <div className="space-y-2">
            {data.items.map(i => (
              <div key={i.id} className="rounded-xl border border-ink-200 p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <span className="badge bg-ink-100 text-ink-700">{SECTION_SHORT[i.section]}</span>
                  <p className="min-w-0 flex-1 font-medium text-ink-900">{i.kra}</p>
                  <span className="text-xs text-ink-500">{fmt(i.weightage, 0)}%</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div><p className="text-ink-500">Target</p><p className="tabular-nums text-ink-900">{i.target_value ?? '—'}{i.target_unit ? ` ${i.target_unit}` : ''}</p></div>
                  <div><p className="text-amber-700">Self</p><p className="tabular-nums font-semibold text-amber-700">{i.self_achieved ?? '—'}</p></div>
                  <div><p className="text-emerald-700">Manager</p><p className="tabular-nums font-semibold text-emerald-700">{i.manager_achieved ?? '—'}</p></div>
                  <div><p className="text-ink-500">Score</p><p className="tabular-nums font-semibold text-ink-900">{fmt(i.final_score ?? i.manager_score ?? i.self_score)}</p></div>
                </div>
                {i.self_remarks && <p className="mt-2 text-xs text-ink-600"><span className="text-amber-700">{data.employee.full_name.split(' ')[0]}:</span> {i.self_remarks}</p>}
                {i.manager_remarks && <p className="mt-1 text-xs text-ink-600"><span className="text-emerald-700">Manager:</span> {i.manager_remarks}</p>}
              </div>
            ))}
          </div>
          {data.ratings.length > 0 && (
            // In columns, so Self and Manager line up down the list (the user, 10 Nov: "make it oriented").
            <div className="overflow-hidden rounded-xl border border-ink-200">
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-3 py-2 font-semibold">Core values</th>
                    <th className="w-[28%] px-3 py-2 font-semibold text-amber-700">Self</th>
                    <th className="w-[28%] px-3 py-2 font-semibold text-emerald-700">Manager</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {data.ratings.map(r => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-ink-800">{name.get(r.core_value_id) ?? 'Core value'}</td>
                      <td className="px-3 py-2 text-amber-700">{r.self_rating ?? '—'}</td>
                      <td className="px-3 py-2 font-medium text-emerald-700">{r.manager_rating ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(s.employee_remarks || s.manager_remarks) && (
            <div className="space-y-1 text-sm">
              {s.employee_remarks && <p><span className="text-ink-500">{data.employee.full_name.split(' ')[0]}'s remarks:</span> {s.employee_remarks}</p>}
              {s.manager_remarks && <p><span className="text-ink-500">Manager's remarks:</span> {s.manager_remarks}</p>}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
