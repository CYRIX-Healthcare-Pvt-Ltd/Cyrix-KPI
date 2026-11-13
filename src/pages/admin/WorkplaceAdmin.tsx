import { Building2, ExternalLink } from 'lucide-react'

/*
  SW Admin → Workplace (the user, 13 Nov: "why workspace is not available here on this tabs section").

  Workplace (app.cyrix.in/workplace: the asset register and the IT service desk) keeps its settings
  inside its own app, beside its own tables (inv_*, wp_* in this database, owned by the
  Cyrix-Workplace repo). So this tab does not copy them: it says what is set where and opens the
  page. Who gets the Workplace tile stays here, in Logins → Modules, like every other module.

  Nothing on this tab reads or writes the database. The links are relative, so they open
  app.cyrix.in/workplace with the same sign-in; Workplace's settings page opens for the software
  administrator whether or not the login holds the Workplace tile.
*/

const WHERE: Array<[string, string]> = [
  ['Who gets the Workplace tile', 'Here: Logins → the Modules box on their row'],
  ['Who runs the IT, Warehouse or Admin assets', 'Workplace settings → People & areas'],
  ['Branches and stores, and who looks after each', 'Workplace settings → Locations'],
  ['Projects and their coordinators', 'Workplace settings → Projects'],
  ['Kinds of asset (laptop, SIM card, uniform…)', 'Workplace settings → Kinds of asset'],
  ['What each bulk upload changed', 'Workplace settings → Upload log'],
  ['Service desk team: lead, agents, levels, the bell', 'Workplace → Desk → Team (the team lead or you)'],
]

export function WorkplaceAdmin() {
  return (
    <div className="card max-w-2xl overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <Building2 className="h-4 w-4 text-violet-600" />
        <h3 className="text-sm font-semibold text-ink-800">Workplace</h3>
      </div>
      <div className="space-y-4 p-4">
        <dl className="space-y-2 text-sm">
          {WHERE.map(([what, where]) => (
            <div key={what} className="grid gap-1 rounded-lg border border-ink-200 px-3 py-2 sm:grid-cols-2 sm:gap-3">
              <dt className="text-ink-900">{what}</dt>
              <dd className="text-ink-600">{where}</dd>
            </div>
          ))}
        </dl>

        <div className="grid grid-cols-2 gap-2">
          <a className="btn-primary inline-flex items-center justify-center gap-1.5" href="/workplace/sw-admin" target="_blank" rel="noopener noreferrer">
            Workplace settings <ExternalLink className="h-4 w-4" />
          </a>
          <a className="btn-secondary inline-flex items-center justify-center gap-1.5" href="/workplace/desk" target="_blank" rel="noopener noreferrer">
            Service desk <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  )
}
