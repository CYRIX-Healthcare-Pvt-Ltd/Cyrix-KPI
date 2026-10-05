import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Alert } from '@/components/ui'
import { useLastApprovedRevision, useMyManager } from '@/lib/queries'
import type { KpiAssignment } from '@/types/db'

const onDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

/**
 * Whose move it is on a KPI that is not active yet, said by name.
 *
 * "Your KPI is not approved yet" read as waiting on the manager when it
 * was not: an approved revision hands the KPI back to its owner as a
 * draft, and nothing said so — Ammu Gopan's sat a draft from 3 Oct while
 * her manager had nothing to approve (the user, 5 Oct: "Your revision was
 * approved on 3 Oct. Your KPI is back with you — make the change and send
 * it to Salman for approval … ya make like this thing").
 *
 * `where` is the page it sits on: the month page links to My KPI; My KPI
 * already has its Edit button beside the title.
 */
export default function KpiStatusNote({ assignment, fy, where }: {
  assignment: KpiAssignment | null
  fy: string
  where: 'month' | 'my-kpi'
}) {
  const { employee } = useAuth()
  const { data: manager } = useMyManager(employee?.reporting_manager_id)
  const { data: revision } = useLastApprovedRevision(assignment?.status === 'draft' ? assignment.id : undefined)
  const boss = manager?.full_name?.split(' ')[0] || 'your manager'
  const toKpi = (label: string) => where === 'month'
    ? <> <Link to="/my-kpi" className="font-medium underline">{label}</Link></>
    : null

  if (!assignment) {
    return (
      <Alert kind="warning" title={`You have no KPI for FY ${fy} yet`}>
        Set it up and send it to {boss} for approval. Months open once it is approved.
        {where === 'month' && <> <Link to="/my-kpi/setup" className="font-medium underline">Set up my KPI</Link></>}
      </Alert>
    )
  }
  if (assignment.status === 'draft' && revision?.hr_decided_at) {
    return (
      <Alert kind="warning" title="Your KPI is back with you">
        Your revision was approved on {onDay.format(new Date(revision.hr_decided_at))}. Make the change and send it to {boss} for approval.
        {toKpi('Edit my KPI')}
      </Alert>
    )
  }
  if (assignment.status === 'draft') {
    return (
      <Alert kind="warning" title="Your KPI is not sent yet">
        Finish it and send it to {boss} for approval. Months open once it is approved.
        {toKpi('Open my KPI')}
      </Alert>
    )
  }
  if (assignment.status === 'pending_approval') {
    return (
      <Alert kind="info" title={`Waiting for ${boss} to approve your KPI`}>
        Months open once it is approved.{toKpi('View my KPI')}
      </Alert>
    )
  }
  if (assignment.status === 'rejected') {
    return (
      <Alert kind="error" title={`${boss === 'your manager' ? 'Your manager' : boss} sent your KPI back`}>
        {assignment.rejection_reason && <span className="italic">“{assignment.rejection_reason}” </span>}
        Make the change and send it again.{toKpi('Edit my KPI')}
      </Alert>
    )
  }
  return null
}
