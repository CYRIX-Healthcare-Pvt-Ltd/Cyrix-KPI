/**
 * Travel Expense — SW Admin's "Travel Expense" tab.
 *
 * Since 17 Oct 2026 Travel Expense is the monthly claim by day cards on the
 * 2026 travel policy (Travel te_0012), and its settings — allowances by grade,
 * the km allowance, bill limit, late deductions, purposes, coordinators and
 * the Travel Desk — are kept on the module's own Travel policy page, by SW
 * Admin and ACC_ADMIN. The old trip settings (photographs, per-mode rates,
 * delete by claim number) belonged to the trip tracker that was replaced, so
 * this tab now points there (the user, 17 Oct: "point the old SW Admin travel
 * tab to the new policy page").
 */
import { ExternalLink, Settings2 } from 'lucide-react'

/** The module's policy page: on app.cyrix.in it is the same origin; elsewhere, the live site. */
const POLICY_URL = window.location.hostname === 'app.cyrix.in' ? '/travel/policy' : 'https://app.cyrix.in/travel/policy'

export function TravelAdmin() {
  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-100 text-violet-700"><Settings2 className="h-5 w-5" /></span>
        <div>
          <h2 className="text-base font-semibold text-ink-900">Travel policy</h2>
          <p className="text-sm text-ink-500">Allowances by grade, settings, purposes, coordinators and the Travel Desk</p>
        </div>
      </div>
      <a href={POLICY_URL} className="btn-primary inline-flex">
        <ExternalLink className="h-4 w-4" /> Open Travel policy
      </a>
    </div>
  )
}
