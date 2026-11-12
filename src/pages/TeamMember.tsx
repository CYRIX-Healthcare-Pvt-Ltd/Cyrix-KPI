import { Fragment, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import {
  useMyAssignment, useSetKpiStart, useFirstAssessedMonth, currentFy,
} from '@/lib/queries'
import { StartMonthBanner } from '@/components/StartMonth'
import { PageLoader, Alert } from '@/components/ui'
import { AssessmentYear } from '@/pages/MyHistory'
import { sectionsOf } from '@/lib/sections'
import type { Employee } from '@/types/db'

export default function TeamMember() {
  const { employeeId = '' } = useParams()
  const fy = currentFy()
  const setStart = useSetKpiStart()
  const [startError, setStartError] = useState<string | null>(null)

  const { data: member, isLoading } = useQuery({
    enabled: !!employeeId,
    queryKey: ['employee', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees').select('*').eq('id', employeeId).single()
      if (error) throw new Error(friendlyError(error))
      return data as Employee
    },
  })

  const { data: assignment } = useMyAssignment(employeeId, fy)
  const { data: firstAssessed } = useFirstAssessedMonth(employeeId, fy)

  if (isLoading) return <PageLoader />
  if (!member) return <Alert kind="error">Team member not found.</Alert>

  // The month their KPI starts, for the banner that lets the manager move it.
  const startsFrom = assignment?.assignment?.starts_from ?? null

  return (
    <div className="space-y-5">
      <div>
        <Link to="/team" className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" /> Back to my team
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink-900">{member.full_name}</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {member.ecode}
          {member.designation && ` · ${member.designation}`}
          {member.department && ` · ${member.department}`}
        </p>
      </div>

      {/* The same year as the person's own Assessments page (the user, 12 Nov). */}
      <AssessmentYear employeeId={employeeId} manager />

      {/* their KPI structure, for context while scoring */}
      {assignment?.assignment && (
        <>
          {/* The manager's place to fix this. It is the only screen that
              shows one person's whole year, which is where somebody
              notices the start month is wrong — and the approval screen
              is gone by then, because the KPI is already approved. */}
          <StartMonthBanner
            fy={fy}
            startsFrom={startsFrom}
            who={member.full_name.split(' ')[0]}
            editable
            latest={firstAssessed}
            busy={setStart.isPending}
            onChange={month => {
              setStartError(null)
              setStart.mutate(
                { assignmentId: assignment.assignment!.id, month },
                { onError: e => setStartError(e.message) },
              )
            }}
          />
          {startError && <Alert kind="error">{startError}</Alert>}
        </>
      )}

      {assignment?.items.length ? (
        <div className="card overflow-hidden">
          <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-ink-800">Their KPI for FY {fy}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-ink-100">
                {sectionsOf(assignment.assignment).map(({ key: section, label, weight }) => (
                  <Fragment key={section}>
                    <tr className="bg-ink-50/60">
                      <td colSpan={3} className="px-4 py-1.5 text-xs font-semibold text-ink-600">
                        {label} — {weight}%
                      </td>
                    </tr>
                    {assignment.items.filter(i => i.section === section).map(i => (
                      <tr key={i.id}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-ink-900">{i.kra}</p>
                          {/* Core values' description on desktop only (the user, 12 Nov). */}
                          <p className={section === 'core_values' ? 'hidden text-xs text-ink-500 sm:block' : 'text-xs text-ink-500'}>{i.kpi_description}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                          {i.weightage}%
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-ink-500">
                          target {i.target_value ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
