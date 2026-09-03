import { useState, useMemo, useRef, useEffect, type ReactNode } from 'react'
import clsx from 'clsx'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, ShieldAlert, KeyRound, Download, Info, RotateCcw, Eraser, Mail, Send,
  LayoutGrid, Timer, QrCode, Activity, Upload, X, Check, LifeBuoy,
} from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { exportOrgStatus } from '@/lib/export'
import { readSheet, pick, downloadTemplate } from '@/lib/sheet'
import { SPARE_ROLES, ADMIN_HINT, normaliseRole, saysAdmin, type SpareRole } from '@/lib/spareRoles'
import SpareFields from './SpareFields'
import SupportDeskQueue from '@/components/SupportDeskQueue'
import SpareWarehouses from './SpareWarehouses'
import {
  useOtpSender, useSaveOtpSender,
  useAppModules, useModuleGrants, useSetModuleAccess,
} from '@/lib/queries'
import { sendOtpTest } from '@/lib/passwordOtp'
import { PageLoader, Alert, StatTile, Spinner } from '@/components/ui'
import KpiTiming from './KpiTiming'
import BulkKpi from './BulkKpi'

interface LoginStatusRow {
  employee_id: string
  ecode: string
  full_name: string
  designation: string | null
  department: string | null
  is_active: boolean
  manager_ecode: string | null
  manager_name: string | null
  login_email: string | null
  has_login: boolean
  on_issued_default: boolean
  login_created_at: string | null
  last_sign_in_at: string | null
  password_changed_at: string | null
  login_state: string
}

const STATE_STYLE: Record<string, string> = {
  'No login issued': 'bg-cyrixRed-100 text-cyrixRed-800',
  'Never signed in': 'bg-ink-100 text-ink-600',
  'Using the issued default': 'bg-amber-100 text-amber-800',
  'Set their own password': 'bg-emerald-100 text-emerald-800',
}

function LoginsTab() {
  const qc = useQueryClient()
  const { data: modules } = useAppModules()
  const { data: grants } = useModuleGrants(true)
  const setModule = useSetModuleAccess()
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [confirming, setConfirming] = useState<LoginStatusRow | null>(null)
  const [wiping, setWiping] = useState<LoginStatusRow | null>(null)
  const [typedCode, setTypedCode] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['login_status'],
    queryFn: async () => {
      // PostgREST caps a response at 1,000 rows. With 1,100+ accounts that
      // silently truncates, so page through explicitly — ordered, because
      // two unordered range queries can return the same row twice and miss
      // another entirely.
      const all: LoginStatusRow[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .rpc('login_status').order('ecode').range(from, from + 999)
        if (error) throw new Error(friendlyError(error))
        const page = (data ?? []) as LoginStatusRow[]
        all.push(...page)
        if (page.length < 1000) break
      }
      return all
    },
  })

  const filtered = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return data.filter(r => {
      if (stateFilter !== 'all' && r.login_state !== stateFilter) return false
      if (!q) return true
      return (
        r.ecode.toLowerCase().includes(q) ||
        r.full_name.toLowerCase().includes(q) ||
        (r.login_email ?? '').toLowerCase().includes(q) ||
        (r.manager_name ?? '').toLowerCase().includes(q)
      )
    })
  }, [data, search, stateFilter])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of data ?? []) c[r.login_state] = (c[r.login_state] ?? 0) + 1
    return c
  }, [data])

  /**
   * Puts an account back to ecode-as-password. The hash is written inside
   * the database by a definer function that checks the caller's role, so
   * the service key stays out of the browser — the reason this used to be
   * command line only.
   */
  const reset = useMutation({
    mutationFn: async (row: LoginStatusRow) => {
      const { error } = await supabase.rpc('admin_reset_password', {
        p_employee_id: row.employee_id,
      })
      if (error) throw new Error(friendlyError(error))
      return row
    },
    onSuccess: row => {
      setConfirming(null)
      setNotice(
        `${row.full_name} (${row.ecode}) can now sign in with ${row.ecode.toUpperCase()} as their password.`,
      )
      qc.invalidateQueries({ queryKey: ['login_status'] })
    },
    onError: err => {
      setConfirming(null)
      setResetError(err instanceof Error ? err.message : 'Could not reset that password.')
    },
  })

  /**
   * Puts one person back to having no KPI at all, for starting a test
   * over. Testing-phase only, and the server enforces that rather than
   * trusting this screen — erasing a year in one click is exactly what
   * the manager-then-HR deletion flow exists to prevent, so the two
   * cannot both be available once the data is real.
   */
  const wipe = useMutation({
    mutationFn: async (args: { row: LoginStatusRow; code: string }) => {
      const { data, error } = await supabase.rpc('sw_reset_employee_data', {
        p_employee_id: args.row.employee_id,
        p_confirm_ecode: args.code,
      })
      if (error) throw new Error(friendlyError(error))
      return data as {
        ecode: string; full_name: string
        submissions_removed: number; assignments_removed: number
      }
    },
    onSuccess: r => {
      setWiping(null)
      setTypedCode('')
      setNotice(
        `Cleared ${r.full_name} (${r.ecode}) — ${r.assignments_removed} KPI and ` +
        `${r.submissions_removed} month${r.submissions_removed === 1 ? '' : 's'} removed. ` +
        `Their login is untouched and they can set up a KPI again from scratch.`,
      )
      qc.invalidateQueries()
    },
    onError: err => {
      setResetError(err instanceof Error ? err.message : 'Could not clear that data.')
    },
  })

  if (isLoading) return <PageLoader label="Loading login records…" />
  if (error) return <Alert kind="error">{(error as Error).message}</Alert>

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB') : '—')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* h2, not h1: the tab shell above owns the page heading now. */}
          <h2 className="text-lg font-semibold text-ink-900">Login administration</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {filtered.length} of {data?.length ?? 0} accounts
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!importing && (
            <button onClick={() => setImporting(true)} className="btn-secondary">
              <Upload className="h-4 w-4" /> Bulk assign modules
            </button>
          )}
          <button
            onClick={() => exportOrgStatus(
              filtered.map(r => ({
                Ecode: r.ecode, Name: r.full_name,
                Designation: r.designation ?? '', Department: r.department ?? '',
                Manager: r.manager_name ?? '', 'Login email': r.login_email ?? '',
                'Login state': r.login_state, Active: r.is_active ? 'Yes' : 'No',
                'Last signed in': r.last_sign_in_at ?? '',
                'Password changed': r.password_changed_at ?? '',
              })),
              'Cyrix-login-status.xlsx', 'Login status',
            )}
            className="btn-secondary"
          >
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      {importing && (
        <BulkAssign<string[]>
          title="Assign modules from a sheet"
          help={
            <>
              Two columns: the employee code, and the modules they should be
              offered — separated by commas. Codes are{' '}
              {(modules ?? []).map(m => m.code).join(', ') || 'kpi, spare, bemmp'}.
              An empty modules cell takes every tile away from that person.
            </>
          }
          templateName="Cyrix-module-access-template.xlsx"
          templateHeaders={['Employee Code', 'Modules']}
          templateExamples={[
            { 'Employee Code': 'CT655', Modules: 'kpi, spare' },
            { 'Employee Code': 'CT656', Modules: 'kpi' },
            { 'Employee Code': 'CT661', Modules: 'kpi, spare, bemmp' },
          ]}
          parseRow={row => {
            const ecode = pick(row, 'employee_code', 'ecode', 'employee code', 'code', 'emp code')
            const raw = pick(row, 'modules', 'module', 'access', 'tiles', 'apps')
            const known = new Set((modules ?? []).map(m => m.code))
            const wanted = raw
              .split(/[,;/|]+/)
              .map(s => s.trim().toLowerCase())
              .filter(Boolean)
            const unknown = wanted.filter(w => !known.has(w))
            if (unknown.length > 0) {
              return { ecode, problem: `unknown module ${unknown.join(', ')}` }
            }
            // A blank cell is a decision, not a gap: it says this person
            // gets nothing. The preview spells that out before it happens.
            return { ecode, value: [...new Set(wanted)] }
          }}
          describe={codes => (codes.length ? codes.join(', ') : 'no modules at all')}
          apply={async assignments => {
            const byEcode = new Map((data ?? []).map(r => [r.ecode.toUpperCase(), r]))
            const missing: string[] = []
            let changed = 0
            for (const a of assignments) {
              const person = byEcode.get(a.ecode.toUpperCase())
              if (!person) { missing.push(a.ecode); continue }
              const want = new Set(a.value)
              for (const m of modules ?? []) {
                const has = grants?.has(`${person.employee_id}:${m.code}`) ?? false
                const should = want.has(m.code)
                // Only the differences are written. A sheet that repeats
                // what is already true should cost nothing and should not
                // fill the audit with grants nobody made.
                if (has === should) continue
                await setModule.mutateAsync({
                  employeeId: person.employee_id, module: m.code, granted: should,
                })
                changed++
              }
            }
            await qc.invalidateQueries({ queryKey: ['module_grants'] })
            return { changed, missing }
          }}
          onClose={() => setImporting(false)}
        />
      )}

      {/* Said plainly rather than buried: this is the question people ask
          first, and the honest answer is that nobody can answer it. */}
      <div className="flex gap-3 rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <div className="text-ink-600">
          <p className="font-medium text-ink-900">Passwords cannot be displayed</p>
          <p className="mt-1">
            They are stored as one-way bcrypt hashes. Nobody can read one back —
            not this screen, not the Supabase dashboard, not a database
            administrator. What is shown instead is whether each person is still
            on the code we issued them, or has set their own.
          </p>
          <p className="mt-1.5">
            While the system is in testing everyone's password{' '}
            <strong>is their employee code</strong>. To get someone in, use
            Reset on their row — it puts the password back to their code.
          </p>
        </div>
      </div>

      {/* Sits above the table, because the Modules column is the one
          thing on this screen whose effect is somewhere else entirely. */}
      <div className="flex gap-3 rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm">
        <LayoutGrid className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
        <div className="text-ink-600">
          <p className="font-medium text-ink-900">Modules decide what appears on app.cyrix.in</p>
          <p className="mt-1">
            Everybody has <strong>KPI</strong> — everybody is appraised. The rest
            are handed out here: click a name in the Modules column to give or
            take away the tile. It changes what a person is{' '}
            <em>offered</em> on the portal, not what they are permitted to do
            once inside — each module still checks that for itself.
          </p>
        </div>
      </div>

      <OtpSenderCard />

      {notice && <Alert kind="success">{notice}</Alert>}
      {resetError && <Alert kind="error">{resetError}</Alert>}

      {confirming && (
        <div className="card space-y-3 border-cyrixRed-200 p-4">
          <div>
            <p className="font-medium text-ink-900">
              Reset {confirming.full_name} back to their employee code?
            </p>
            <p className="mt-0.5 text-sm text-ink-500">
              Their password becomes{' '}
              <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs font-semibold">
                {confirming.ecode.toUpperCase()}
              </code>
              . Whatever they had set is overwritten and cannot be recovered.
              They are not notified.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => reset.mutate(confirming)}
              disabled={reset.isPending}
              className="btn-danger"
            >
              {reset.isPending && <Spinner className="h-4 w-4" />}
              Reset to {confirming.ecode.toUpperCase()}
            </button>
            <button onClick={() => setConfirming(null)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {wiping && (
        <div className="card space-y-3 border-cyrixRed-300 p-4">
          <div>
            <p className="font-medium text-ink-900">
              Clear all KPI data for {wiping.full_name}?
            </p>
            <p className="mt-0.5 text-sm text-ink-500">
              Deletes their KPI for every year and every month they have
              submitted or been scored on. The figures are written to the audit
              log first, but the records themselves cannot be recovered. Their
              login and employee record are untouched, so they can set up a KPI
              again from scratch.
            </p>
          </div>

          <div className="max-w-xs">
            <label className="label text-xs">
              Type {wiping.ecode.toUpperCase()} to confirm
            </label>
            <input
              className="input font-mono"
              value={typedCode}
              onChange={e => setTypedCode(e.target.value.toUpperCase())}
              placeholder={wiping.ecode.toUpperCase()}
              autoFocus
              autoComplete="off"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => wipe.mutate({ row: wiping, code: typedCode })}
              disabled={
                typedCode.trim().toUpperCase() !== wiping.ecode.toUpperCase() ||
                wipe.isPending
              }
              className="btn-danger"
            >
              {wipe.isPending && <Spinner className="h-4 w-4" />}
              Clear everything for {wiping.ecode.toUpperCase()}
            </button>
            <button
              onClick={() => { setWiping(null); setTypedCode('') }}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 grid-pairs sm:grid-cols-4">
        <StatTile label="Total accounts" value={data?.length ?? 0} />
        <StatTile
          label="On issued default"
          value={counts['Using the issued default'] ?? 0}
          sub="password is their ecode"
        />
        <StatTile
          label="Set their own"
          value={counts['Set their own password'] ?? 0}
        />
        <StatTile
          label="No login issued"
          value={counts['No login issued'] ?? 0}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
          <input
            className="input pl-9"
            placeholder="Search by code, name, email or manager"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-auto"
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value)}
        >
          <option value="all">All login states</option>
          {Object.keys(STATE_STYLE).map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2.5">Employee</th>
                <th className="px-4 py-2.5">Login</th>
                <th className="px-4 py-2.5">Manager</th>
                <th className="px-4 py-2.5">State</th>
                {/* Which tiles this person is offered on app.cyrix.in.
                    Everybody starts with KPI because everybody is
                    appraised; the rest are handed out here. */}
                <th className="px-4 py-2.5">Modules</th>
                <th className="px-4 py-2.5">Last sign-in</th>
                <th className="px-4 py-2.5">Password changed</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.slice(0, 200).map(r => (
                <tr key={r.employee_id} className="hover:bg-ink-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink-900">
                      {r.full_name}
                      {!r.is_active && (
                        <span className="ml-2 badge bg-ink-100 text-ink-500">Inactive</span>
                      )}
                    </p>
                    <p className="text-xs text-ink-500">
                      {r.ecode}{r.designation && ` · ${r.designation}`}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-600">
                    {r.login_email ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-600">
                    {r.manager_name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${STATE_STYLE[r.login_state] ?? 'bg-ink-100 text-ink-600'}`}>
                      {r.login_state}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(modules ?? []).map(m => {
                        const on = grants?.has(`${r.employee_id}:${m.code}`) ?? false
                        return (
                          <button
                            key={m.code}
                            onClick={() => setModule.mutate({
                              employeeId: r.employee_id, module: m.code, granted: !on,
                            })}
                            disabled={setModule.isPending}
                            // Named rather than ticked: a row of bare
                            // checkboxes needs a header to decode, and this
                            // table is already seven columns wide.
                            title={on
                              ? `Remove ${m.name} from ${r.full_name}`
                              : `Give ${r.full_name} access to ${m.name}`}
                            aria-pressed={on}
                            className={clsx(
                              'badge cursor-pointer transition-colors disabled:opacity-50',
                              on
                                ? 'bg-ink-900 text-onInk hover:bg-cyrixRed-700 hover:text-white'
                                : 'bg-ink-100 text-ink-400 hover:bg-ink-200',
                            )}
                          >
                            {m.name}
                          </button>
                        )
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500">{fmt(r.last_sign_in_at)}</td>
                  <td className="px-4 py-3 text-xs text-ink-500">{fmt(r.password_changed_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      {r.has_login ? (
                        <button
                          onClick={() => {
                            setNotice(null); setResetError(null)
                            setWiping(null); setConfirming(r)
                          }}
                          className="btn-secondary !px-2.5 !py-1.5 text-xs"
                          title={`Reset ${r.ecode} back to their employee code`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Reset
                        </button>
                      ) : (
                        <span className="self-center text-xs text-ink-300">No login</span>
                      )}
                      <button
                        onClick={() => {
                          setNotice(null); setResetError(null)
                          setConfirming(null); setTypedCode(''); setWiping(r)
                        }}
                        className="btn-secondary !px-2.5 !py-1.5 text-xs !text-cyrixRed-700"
                        title={`Clear all KPI data for ${r.ecode}`}
                      >
                        <Eraser className="h-3.5 w-3.5" /> Clear KPI
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 200 && (
          <p className="border-t border-ink-100 px-4 py-3 text-xs text-ink-500">
            Showing the first 200. Narrow the search, or export for the full list.
          </p>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-ink-400">
        <KeyRound className="h-3.5 w-3.5" />
        Every reset and clear is written to the audit log against your account.
        Clearing KPI data works only while the system is in testing — after
        that, removing a record goes through the reporting manager and HR.
      </p>
    </div>
  )
}

/**
 * The address password codes come from.
 *
 * Here rather than in an edge-function secret, because changing a secret
 * needs the CLI, a Supabase login and a redeploy — and the moment this
 * needs changing is the moment somebody is locked out and the person who
 * can do all three is asleep.
 *
 * The test button is the point of the card. A From address the mail
 * provider has not verified is rejected on every send, and the way you
 * find out is that resets quietly stop working for the whole company:
 * nobody reports an email they were not expecting. One button, one real
 * message, to the only inbox the server will address — your own.
 */
function OtpSenderCard() {
  const { data: saved, isLoading } = useOtpSender()
  const save = useSaveOtpSender()
  const [draft, setDraft] = useState<string | null>(null)
  const [target, setTarget] = useState('')
  const [state, setState] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const value = draft ?? saved ?? ''
  const dirty = draft !== null && draft !== saved

  const onSave = async () => {
    setState(null)
    try {
      await save.mutateAsync(value.trim())
      setDraft(null)
      setState({ kind: 'success', text: 'Saved. Send a test to prove it works.' })
    } catch (err) {
      setState({ kind: 'error', text: err instanceof Error ? err.message : 'Could not save.' })
    }
  }

  const onTest = async () => {
    setState(null); setTesting(true)
    const r = await sendOtpTest(target)
    setTesting(false)
    setState({ kind: r.ok ? 'success' : 'error', text: r.message })
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <Mail className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
        <div className="min-w-0">
          <p className="font-medium text-ink-900">Password codes come from</p>
          <p className="mt-0.5 text-sm text-ink-500">
            Shown in the inbox of anyone resetting or changing their password.
            The domain has to be verified with the mail provider — an
            unverified one is refused on every send.
          </p>
        </div>
      </div>

      {state && <Alert kind={state.kind}>{state.text}</Alert>}

      <div className="flex flex-wrap gap-2">
        <input
          className="input min-w-0 flex-1"
          value={isLoading ? '' : value}
          placeholder={isLoading ? 'Loading…' : 'Cyrix KPI <no-reply@send.cyrix.in>'}
          onChange={e => setDraft(e.target.value)}
          aria-label="Sender address for password codes"
        />
        <button
          onClick={onSave}
          disabled={!dirty || save.isPending}
          className="btn-primary shrink-0"
        >
          {save.isPending && <Spinner className="h-4 w-4" />} Save
        </button>
      </div>

      {/* An employee code rather than an address, and the difference is
          the safeguard: a free-text address here would be a way to send
          company mail to anywhere at all. A code can only reach somebody
          already on the payroll. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
        <label htmlFor="otp-test-target" className="text-sm text-ink-600">
          Send a test to
        </label>
        <input
          id="otp-test-target"
          className="input w-32 uppercase"
          value={target}
          onChange={e => setTarget(e.target.value.toUpperCase())}
          placeholder="E1427"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          onClick={onTest}
          disabled={testing || dirty}
          title={dirty ? 'Save the address first' : undefined}
          className="btn-secondary shrink-0"
        >
          {testing ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          Send test
        </button>
        {!target.trim() && (
          <span className="text-xs text-ink-400">Blank sends it to you.</span>
        )}
      </div>

      <p className="text-xs text-ink-400">
        A name in front of the address is what people see —{' '}
        <span className="font-medium text-ink-600">Cyrix KPI</span> rather than
        the address itself. The test says plainly that it is a test, so it can
        go to a colleague without alarming them, and it uses the address on
        their record — an employee code, never a typed address.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------------
 * Spare Mapping
 *
 * Spare's roster lives in this database now, so who administers Spare is
 * answerable from here rather than from inside Spare's own admin screens.
 * Only the role is editable: name and employee code come from the HR
 * record and the database refuses to change them from this side, which is
 * what makes the employee list the master rather than one copy of three.
 * ------------------------------------------------------------------- */
interface SpareProfile {
  id: string
  ecode: string
  full_name: string
  role: SpareRole
  /** Administering is something people also do — see migration 0069. */
  is_spare_admin: boolean
  active: boolean
}

// SPARE_ROLES and normaliseRole live in lib/spareRoles: the aliases are
// the part that can be wrong without anybody noticing, so they are tested.

/**
 * One employee code per row, and whatever that sheet is assigning.
 *
 * Shared because the two uploads differ only in what the second column
 * means: a role for Spare, a list of modules for Logins. Everything
 * around it — reading the file, matching codes to people, saying what
 * will happen before it happens, and reporting what did — is the same
 * problem, and solving it twice is how two importers end up disagreeing
 * about whether a blank cell clears a value.
 *
 * Nothing is written until the preview has been read. An upload that
 * applies itself the moment a file is chosen gives nobody the chance to
 * notice they picked last month's sheet.
 */
export function BulkAssign<T>({
  title,
  help,
  templateName,
  templateHeaders,
  templateExamples,
  parseRow,
  describe,
  apply,
  onClose,
}: {
  title: string
  help: ReactNode
  templateName: string
  templateHeaders: string[]
  templateExamples: Array<Record<string, string>>
  /** One sheet row to one intent, or a reason it cannot be used. */
  parseRow: (row: Record<string, unknown>) => { ecode: string; value: T } | { ecode: string; problem: string }
  /** How the intent reads in the preview. */
  describe: (value: T) => string
  /** Returns what changed and what was left alone. */
  apply: (rows: Array<{ ecode: string; value: T }>) => Promise<{ changed: number; missing: string[] }>
  onClose: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Array<{ ecode: string; value: T }> | null>(null)
  const [rejected, setRejected] = useState<Array<{ ecode: string; problem: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ changed: number; missing: string[] } | null>(null)

  const read = async (file: File) => {
    setError(null); setResult(null); setRows(null); setRejected([])
    try {
      const raw = await readSheet(file)
      const good: Array<{ ecode: string; value: T }> = []
      const bad: Array<{ ecode: string; problem: string }> = []
      for (const r of raw) {
        const parsed = parseRow(r)
        if (!parsed.ecode) continue
        if ('problem' in parsed) bad.push(parsed)
        else good.push(parsed)
      }
      if (good.length === 0 && bad.length === 0) {
        setError('No rows had an employee code in them. Check the column headers, or start from the template.')
        return
      }
      setRows(good)
      setRejected(bad)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }

  const save = async () => {
    if (!rows?.length) return
    setBusy(true); setError(null)
    try {
      setResult(await apply(rows))
      setRows(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply that sheet.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink-900">{title}</h3>
          <div className="mt-1 text-sm text-ink-500">{help}</div>
        </div>
        <button onClick={onClose} className="btn-icon shrink-0" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => downloadTemplate(templateName, templateHeaders, templateExamples)}
          className="btn-secondary"
        >
          <Download className="h-4 w-4" /> Download the template
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = '' }}
        />
        <button onClick={() => fileRef.current?.click()} className="btn-primary">
          <Upload className="h-4 w-4" /> Choose a file
        </button>
      </div>

      {rejected.length > 0 && (
        <Alert kind="warning">
          {rejected.length} row{rejected.length === 1 ? '' : 's'} could not be read and
          will be skipped: {rejected.slice(0, 5).map(r => `${r.ecode} (${r.problem})`).join(', ')}
          {rejected.length > 5 && `, and ${rejected.length - 5} more`}.
        </Alert>
      )}

      {rows && rows.length > 0 && (
        <>
          {/* Read before it is applied. The whole point of a preview is
              that "1,148 rows" is the moment somebody realises they
              picked the wrong file. */}
          <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-ink-50 text-left text-xs uppercase tracking-label text-ink-400">
                <tr>
                  <th className="px-3 py-2">Employee code</th>
                  <th className="px-3 py-2">Will be set to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((r, i) => (
                  <tr key={`${r.ecode}-${i}`}>
                    <td className="px-3 py-1.5 font-medium text-ink-900">{r.ecode}</td>
                    <td className="px-3 py-1.5 text-ink-600">{describe(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={save} disabled={busy} className="btn-primary">
              {busy ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              Apply {rows.length} row{rows.length === 1 ? '' : 's'}
            </button>
            <span className="text-xs text-ink-500">
              Anybody not in this file is left exactly as they are.
            </span>
          </div>
        </>
      )}

      {result && (
        <Alert kind={result.missing.length ? 'warning' : 'success'}>
          {result.changed} change{result.changed === 1 ? '' : 's'} applied.
          {result.missing.length > 0 && (
            <>
              {' '}
              {result.missing.length} code{result.missing.length === 1 ? '' : 's'} matched
              nobody and {result.missing.length === 1 ? 'was' : 'were'} skipped:{' '}
              {result.missing.slice(0, 8).join(', ')}
              {result.missing.length > 8 && `, and ${result.missing.length - 8} more`}.
            </>
          )}
        </Alert>
      )}
    </div>
  )
}

/**
 * Spare's two administrative jobs, side by side.
 *
 * Who may do what, and what an engineer is asked for when tagging. They
 * are different questions with different answers, and stacking both onto
 * one scrolling page meant the fields sat below a table of 1,148 rows.
 */
/**
 * KPI setup, in two halves.
 *
 * Timing is when the year opens and closes; bulk assignment is who gets
 * what. Both are this screen's business and neither is the other, so they
 * are sub-tabs rather than one page that scrolls past the thing you did
 * not come for.
 */
function KpiTab() {
  const [view, setView] = useState<'timing' | 'bulk'>('timing')

  return (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-lg bg-ink-100 p-1 sm:w-fit">
        {([
          { key: 'timing' as const, label: 'Timing' },
          { key: 'bulk' as const, label: 'Bulk assign' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            aria-current={view === t.key ? 'page' : undefined}
            className={clsx(
              'flex-1 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors sm:flex-none',
              view === t.key ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === 'timing' ? <KpiTiming /> : <BulkKpi />}
    </div>
  )
}

function SpareTab() {
  const [view, setView] = useState<'roles' | 'warehouses' | 'fields'>('roles')

  return (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-lg bg-ink-100 p-1 sm:w-fit">
        {([
          { key: 'roles' as const, label: 'Roles' },
          // Between the two on purpose: a warehouse is the one thing the
          // tag form will not go without, so it is set up before the
          // fields that are optional by comparison.
          { key: 'warehouses' as const, label: 'Warehouses' },
          { key: 'fields' as const, label: 'Custom fields' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            aria-current={view === t.key ? 'page' : undefined}
            className={clsx(
              'flex-1 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors sm:flex-none',
              view === t.key ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === 'roles' ? <SpareRolesView /> : view === 'warehouses' ? <SpareWarehouses /> : <SpareFields />}
    </div>
  )
}

function SpareRolesView() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | SpareRole>('all')

  const { data, isLoading } = useQuery({
    queryKey: ['spare_profiles'],
    queryFn: async () => {
      // Paged for the same reason the login list is: PostgREST stops at
      // 1,000 rows and there is a profile for every employee with a login.
      const all: SpareProfile[] = []
      for (let from = 0; ; from += 1000) {
        const page = await supabase
          .from('profiles')
          .select('id, ecode, full_name, role, is_spare_admin, active')
          .order('ecode')
          .range(from, from + 999)
        if (page.error) throw page.error
        const rows = (page.data ?? []) as SpareProfile[]
        all.push(...rows)
        if (rows.length < 1000) return all
      }
    },
  })

  /** One mutation for both, because they are one row and one round trip. */
  const setAccess = useMutation({
    mutationFn: async (
      { id, ...patch }: { id: string; role?: SpareRole; is_spare_admin?: boolean },
    ) => {
      const { error } = await supabase.from('profiles').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['spare_profiles'] }),
    onError: (e) => setError(friendlyError(e)),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = data ?? []
    // "admin" is its own filter rather than a fourth role, matching the
    // shape of the thing: it is a flag somebody also holds, so asking
    // "who are the admins" is a different question from "who are the
    // managers", and both have answers.
    if (roleFilter === 'admin') rows = rows.filter(r => r.is_spare_admin)
    else if (roleFilter !== 'all') rows = rows.filter(r => r.role === roleFilter)
    if (!q) return rows
    return rows.filter(r =>
      r.ecode.toLowerCase().includes(q) || r.full_name.toLowerCase().includes(q))
  }, [data, search, roleFilter])

  /** How many hold each, so the filter says what it will show. */
  const counts = useMemo(() => {
    const rows = data ?? []
    return {
      all: rows.length,
      admin: rows.filter(r => r.is_spare_admin).length,
      ...Object.fromEntries(
        SPARE_ROLES.map(r => [r.value, rows.filter(p => p.role === r.value).length]),
      ),
    } as Record<string, number>
  }, [data])

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Spare Mapping roles</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {filtered.length} of {data?.length ?? 0} people
          </p>
        </div>
        {!importing && (
          <button onClick={() => setImporting(true)} className="btn-secondary shrink-0">
            <Upload className="h-4 w-4" /> Bulk assign roles
          </button>
        )}
      </div>

      {importing && (
        <BulkAssign<{ role: SpareRole; admin: boolean }>
          title="Assign roles from a sheet"
          help={
            <>
              The employee code, the role — Engineer, Project manager or
              Purchase — and whether they also administer Spare. Say that in
              an Admin column, or just add "Admin" to the role cell.
            </>
          }
          templateName="Cyrix-spare-roles-template.xlsx"
          templateHeaders={['Employee Code', 'Role', 'Admin']}
          templateExamples={[
            { 'Employee Code': 'CT655', Role: 'Engineer', Admin: '' },
            { 'Employee Code': 'CT656', Role: 'Project manager', Admin: 'Yes' },
            { 'Employee Code': 'CT661', Role: 'Purchase', Admin: '' },
          ]}
          parseRow={row => {
            const ecode = pick(row, 'employee_code', 'ecode', 'employee code', 'code', 'emp code')
            const raw = pick(row, 'role', 'spare role', 'role in spare', 'access')
            if (!raw) return { ecode, problem: 'no role' }
            const role = normaliseRole(raw)
            if (!role) return { ecode, problem: `unknown role "${raw}"` }
            // Either column says it. "Project manager, Admin" in one cell
            // is how people write it when there is no Admin column.
            const adminCell = pick(row, 'admin', 'is admin', 'spare admin', 'administrator')
            return { ecode, value: { role, admin: saysAdmin(adminCell) || saysAdmin(raw) } }
          }}
          describe={v =>
            `${SPARE_ROLES.find(r => r.value === v.role)?.label ?? v.role}${v.admin ? ' + admin' : ''}`}
          apply={async assignments => {
            // Matched on the code that is already loaded rather than a
            // query per row: this list is the whole roster and is in
            // memory, so a thousand-row sheet costs one round trip.
            const byEcode = new Map((data ?? []).map(p => [p.ecode.toUpperCase(), p]))
            const missing: string[] = []
            const updates = new Map<string, { role: SpareRole; is_spare_admin: boolean }>()
            for (const a of assignments) {
              const person = byEcode.get(a.ecode.toUpperCase())
              if (!person) { missing.push(a.ecode); continue }
              // Last row wins if a code appears twice, and a row asking
              // for what somebody already has is not a write.
              if (person.role === a.value.role && person.is_spare_admin === a.value.admin) continue
              updates.set(person.id, { role: a.value.role, is_spare_admin: a.value.admin })
            }
            for (const [id, patch] of updates) {
              const { error: e } = await supabase.from('profiles').update(patch).eq('id', id)
              if (e) throw new Error(friendlyError(e))
            }
            await qc.invalidateQueries({ queryKey: ['spare_profiles'] })
            return { changed: updates.size, missing }
          }}
          onClose={() => setImporting(false)}
        />
      )}

      <div className="flex gap-3 rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm text-ink-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <div>
          <p className="font-medium text-ink-900">A role is not a tile</p>
          <p className="mt-1">
            This decides what somebody can do inside Spare. Whether they are
            offered it at all is the Modules column on the Logins tab — a
            person can hold a role here and never see the tile.
          </p>
          <p className="mt-1.5">
            Names and employee codes cannot be edited here or in Spare. They
            come from the HR employee record, and a change there reaches Spare
            on its own.
          </p>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="sm:flex sm:items-center sm:gap-3">
        <div className="relative sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            className="input pl-9"
            placeholder="Search by name or employee code"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {/* Counted, so the filter answers the question before it is used:
            "how many admins are there" is usually the whole reason
            somebody came looking. */}
        <select
          className="input mt-3 sm:mt-0 sm:w-56"
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value as typeof roleFilter)}
          aria-label="Filter by role"
        >
          <option value="all">Everyone ({counts.all})</option>
          {SPARE_ROLES.map(r => (
            <option key={r.value} value={r.value}>{r.label} ({counts[r.value] ?? 0})</option>
          ))}
          <option value="admin">Admins ({counts.admin})</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-ink-200">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-label text-ink-400">
            <tr>
              <th className="px-3 py-2.5">Employee</th>
              <th className="px-3 py-2.5">Role in Spare</th>
              <th className="px-3 py-2.5">Also admin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {filtered.slice(0, 200).map(r => (
              <tr key={r.id} className={clsx(!r.active && 'opacity-50')}>
                <td className="px-3 py-2.5">
                  <span className="font-medium text-ink-900">{r.full_name}</span>
                  <span className="ml-2 text-ink-400">{r.ecode}</span>
                  {!r.active && <span className="ml-2 badge bg-ink-100 text-ink-500">Inactive</span>}
                </td>
                {/* One of three. A job, and everybody has exactly one. */}
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {SPARE_ROLES.map(role => (
                      <button
                        key={role.value}
                        title={role.hint}
                        aria-pressed={r.role === role.value}
                        disabled={setAccess.isPending}
                        onClick={() => setAccess.mutate({ id: r.id, role: role.value })}
                        className={clsx(
                          'badge cursor-pointer transition-colors disabled:opacity-50',
                          r.role === role.value
                            ? 'bg-ink-900 text-onInk hover:bg-cyrixRed-700 hover:text-white'
                            : 'bg-ink-100 text-ink-400 hover:bg-ink-200',
                        )}
                      >
                        {role.label}
                      </button>
                    ))}
                  </div>
                </td>
                {/* Separate, because it is not one of them. A manager who
                    maintains the custom fields is both, and the old
                    four-way choice made granting the keys take the job
                    away. */}
                <td className="px-3 py-2.5">
                  <label className="inline-flex cursor-pointer items-center gap-2" title={ADMIN_HINT}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[color:var(--score-accent)]"
                      checked={r.is_spare_admin}
                      disabled={setAccess.isPending}
                      onChange={e => setAccess.mutate({ id: r.id, is_spare_admin: e.target.checked })}
                    />
                    <span className="text-xs text-ink-500">Admin</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > 200 && (
        <p className="text-sm text-ink-500">
          Showing the first 200. Search to narrow it down.
        </p>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------
 * BEMMP
 *
 * Its roster lives in this database, so who may open BEMMP and in what
 * capacity is answerable here rather than from inside the module.
 *
 * Three separate questions, kept separate because they are independent in
 * the business — the original Andhra login is a Director who nonetheless
 * sees only Andhra:
 *
 *   role       what they can do
 *   contracts  which contracts they see at all
 *   area       which slice of a contract, when they should not see it whole
 *
 * The area lists are read from the dataset rows rather than declared here.
 * Districts are a property of the ticket data and a hard-coded fourteen
 * goes stale the day a contract gains one; 0063 records them beside the
 * pointer so this screen can offer them without downloading 5 MB of
 * tickets to find out what they are.
 * ------------------------------------------------------------------- */
interface BemmpProfile {
  id: string
  code: string
  full_name: string | null
  role: string
  scope: string[] | null
  zones: string[] | null
  districts: string[] | null
}

interface DatasetRow {
  state: string
  zones: string[] | null
  districts: string[] | null
}

const BEMMP_ROLES: { value: string; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'director', label: 'Director' },
  { value: 'divisional_manager', label: 'Divisional manager' },
  { value: 'zonal_manager', label: 'Zonal manager' },
  { value: 'district_incharge', label: 'District in-charge' },
  { value: 'project_head', label: 'Project head' },
  { value: 'coordinator', label: 'Coordinator' },
  { value: 'purchase', label: 'Purchase' },
]

/** The contracts BEMMP runs. Two, and they are structural, not data. */
const CONTRACTS: { id: string; label: string }[] = [
  { id: 'kl', label: 'Kerala' },
  { id: 'ap', label: 'Andhra' },
]

function BemmpTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['bemmp_profiles'],
    queryFn: async () => {
      const all: BemmpProfile[] = []
      for (let from = 0; ; from += 1000) {
        const page = await supabase
          .from('profile')
          .select('id, code, full_name, role, scope, zones, districts')
          .order('code')
          .range(from, from + 999)
        if (page.error) throw page.error
        const rows = (page.data ?? []) as BemmpProfile[]
        all.push(...rows)
        if (rows.length < 1000) return all
      }
    },
  })

  /** What the published exports say the zones are. */
  const { data: datasets } = useQuery({
    queryKey: ['bemmp_datasets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dataset').select('state, zones, districts')
      if (error) throw error
      return (data ?? []) as DatasetRow[]
    },
  })

  const zoneOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const d of datasets ?? []) for (const z of d.zones ?? []) seen.add(z)
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [datasets])

  const districtOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const d of datasets ?? []) for (const x of d.districts ?? []) seen.add(x)
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [datasets])

  /*
   * Districts are picked in a dialog rather than inline, and that is not a
   * cosmetic choice. There are fourteen of them; as chips on every row that
   * is several hundred controls on the page, and each one saving on click
   * means four round trips to assign four districts. The dialog collects
   * the whole set and saves once — which is exactly why BEMMP's own screen
   * does it this way.
   */
  const [picking, setPicking] = useState<BemmpProfile | null>(null)
  const [draft, setDraft] = useState<string[]>([])

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<BemmpProfile> }) => {
      const { error } = await supabase.from('profile').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bemmp_profiles'] }),
    onError: (e) => setError(friendlyError(e)),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = data ?? []
    if (!q) return rows
    return rows.filter(r =>
      r.code.toLowerCase().includes(q) ||
      (r.full_name ?? '').toLowerCase().includes(q))
  }, [data, search])

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink-900">BEMMP access</h2>
        <p className="mt-0.5 text-sm text-ink-500">
          {filtered.length} of {data?.length ?? 0} people
        </p>
      </div>

      <div className="flex gap-3 rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm text-ink-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <div>
          <p className="font-medium text-ink-900">Role, contract and area are three questions</p>
          <p className="mt-1">
            The role is what somebody can do. The contracts are which of them
            they see at all. The area narrows a contract for people who work
            one zone — leave it on <strong>Everything</strong> and they get the
            whole contract, which is right for most.
          </p>
          <p className="mt-1.5">
            Whether the tile is offered at all is the Modules column on the
            Logins tab. Names and employee codes come from the HR record.
          </p>
          {zoneOptions.length === 0 && (
            <p className="mt-1.5">
              No zones are listed yet — they are read from the published
              ticket export, so they appear here once somebody publishes one
              in BEMMP.
            </p>
          )}
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          className="input pl-9"
          placeholder="Search by name or employee code"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-ink-200">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-label text-ink-400">
            <tr>
              <th className="px-3 py-2.5">Employee</th>
              <th className="px-3 py-2.5">Role</th>
              <th className="px-3 py-2.5">Contracts</th>
              <th className="px-3 py-2.5">Area</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {filtered.slice(0, 200).map(r => {
              const scope = r.scope ?? []
              const zone = (r.zones ?? [])[0] ?? ''
              const byDistrict = (r.districts ?? []).length > 0
              return (
                <tr key={r.id}>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-ink-900">{r.full_name}</span>
                    <span className="ml-2 text-ink-400">{r.code}</span>
                  </td>

                  <td className="px-3 py-2.5">
                    <select
                      className="input h-8 py-0 text-sm"
                      value={r.role}
                      disabled={update.isPending}
                      onChange={e => update.mutate({ id: r.id, patch: { role: e.target.value } })}
                    >
                      {BEMMP_ROLES.map(role => (
                        <option key={role.value} value={role.value}>{role.label}</option>
                      ))}
                    </select>
                  </td>

                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {CONTRACTS.map(c => {
                        const on = scope.includes(c.id)
                        return (
                          <button
                            key={c.id}
                            aria-pressed={on}
                            disabled={update.isPending}
                            onClick={() => update.mutate({
                              id: r.id,
                              patch: {
                                scope: on
                                  ? scope.filter(s => s !== c.id)
                                  : [...scope, c.id],
                              },
                            })}
                            className={clsx(
                              'badge cursor-pointer transition-colors disabled:opacity-50',
                              on ? 'bg-ink-900 text-onInk hover:bg-cyrixRed-700 hover:text-white'
                                 : 'bg-ink-100 text-ink-400 hover:bg-ink-200',
                            )}
                          >
                            {c.label}
                          </button>
                        )
                      })}
                    </div>
                    {scope.length === 0 && (
                      // Empty means none here, not everything — the opposite of
                      // what it means for the area below, which is exactly the
                      // confusion that once left everybody locked out.
                      <p className="mt-1 text-xs text-cyrixRed-600">Sees nothing</p>
                    )}
                  </td>

                  <td className="px-3 py-2.5">
                    {/* Zone or districts, never both: a zone is a whole set of
                        districts, so holding both would leave two answers to
                        "what does this person see". Choosing a zone clears the
                        districts, which is the rule BEMMP's own server applies. */}
                    <select
                      className="input h-8 py-0 text-sm"
                      value={byDistrict ? '__districts__' : zone}
                      disabled={update.isPending
                        || (zoneOptions.length === 0 && districtOptions.length === 0)}
                      onChange={e => {
                        if (e.target.value === '__districts__') {
                          setDraft(r.districts ?? [])
                          setPicking(r)
                          return
                        }
                        update.mutate({
                          id: r.id,
                          patch: {
                            // Choosing a zone clears the districts: a zone is a
                            // whole set of them, so holding both would leave two
                            // answers to what this person sees.
                            zones: e.target.value ? [e.target.value] : [],
                            districts: [],
                          },
                        })
                      }}
                    >
                      <option value="">Everything</option>
                      {zoneOptions.map(z => <option key={z} value={z}>{z}</option>)}
                      {districtOptions.length > 0 && (
                        <option value="__districts__">
                          {byDistrict
                            ? `${(r.districts ?? []).length} districts — change`
                            : 'Choose districts…'}
                        </option>
                      )}
                    </select>
                    {byDistrict && (
                      <p className="mt-1 max-w-56 truncate text-xs text-ink-500"
                         title={(r.districts ?? []).join(', ')}>
                        {(r.districts ?? []).join(', ')}
                      </p>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {filtered.length > 200 && (
        <p className="text-sm text-ink-500">
          Showing the first 200. Search to narrow it down.
        </p>
      )}
      {/* The whole set, saved once. */}
      {picking && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-shade/60 p-0 sm:items-center sm:p-4"
          onClick={() => setPicking(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-ink-900">
              Districts for {picking.full_name}
            </h3>
            <p className="mt-1 text-sm text-ink-500">
              Choosing districts clears any zone. Ticking none is the same as
              Everything.
            </p>

            <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
              {districtOptions.map(d => {
                const on = draft.includes(d)
                return (
                  <label key={d} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-700 hover:bg-ink-50">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setDraft(prev =>
                        on ? prev.filter(x => x !== d) : [...prev, d])}
                    />
                    <span className="truncate">{d}</span>
                  </label>
                )
              })}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setPicking(null)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={update.isPending}
                onClick={() => {
                  update.mutate({
                    id: picking.id,
                    patch: { districts: draft, zones: [] },
                  })
                  setPicking(null)
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

/*
 *  is what the phone bar shows: five cells on a 375px screen is
 * about seven characters each, and "Spare Mapping" is thirteen.
 */
const ADMIN_TABS = [
  { id: 'logins', label: 'Logins', short: 'Logins', icon: ShieldAlert, render: () => <LoginsTab /> },
  // KPI belongs beside the other two, not a level above them. It sat in the
  // navigation as a sibling of this whole screen, which made one module's
  // settings look like a different kind of thing from the other two.
  { id: 'kpi', label: 'KPI', short: 'KPI', icon: Timer, render: () => <KpiTab /> },
  { id: 'spare', label: 'Spare Mapping', short: 'Spare', icon: QrCode, render: () => <SpareTab /> },
  { id: 'bemmp', label: 'BEMMP', short: 'BEMMP', icon: Activity, render: () => <BemmpTab /> },
  // Last, because it is the only tab that is somebody else's work
  // rather than a setting. Everything to its left is configuration;
  // this is a queue with people waiting in it.
  {
    id: 'support', label: 'Support', short: 'Support', icon: LifeBuoy,
    render: () => <SupportDeskQueue desk="software" enabled />,
  },
] as const

/**
 * Which build is on screen, and how long it has been there.
 *
 * The question this answers is "has my change gone out yet?", which was
 * being answered by reloading and squinting at whether something looked
 * different. So the relative time leads: "4 minutes ago" settles it at a
 * glance, where a timestamp still has to be compared against the clock.
 *
 * The exact time and the commit are underneath rather than hidden in a
 * tooltip — a tooltip is nothing on the phone half of these admins use,
 * and the commit is what turns "it deployed" into "it deployed *this*".
 *
 * Ticks every half minute. A page left open on a second monitor saying
 * "just now" an hour later is worse than no answer, because it reads as
 * a deploy that has only just landed.
 */
function BuildStamp() {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const built = new Date(__BUILD_TIME__)
  if (Number.isNaN(built.getTime())) return null

  const mins = Math.floor((Date.now() - built.getTime()) / 60_000)
  const ago =
    mins < 1 ? 'just now'
    : mins < 60 ? `${mins} minute${mins === 1 ? '' : 's'} ago`
    : mins < 60 * 24 ? `${Math.floor(mins / 60)} hour${mins < 120 ? '' : 's'} ago`
    : `${Math.floor(mins / 1440)} day${mins < 2880 ? '' : 's'} ago`

  return (
    <p className="text-xs leading-tight text-ink-400 sm:text-right">
      Deployed <span className="font-medium text-ink-600">{ago}</span>
      <span className="mt-0.5 block">
        {built.toLocaleString(undefined, {
          day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
        })}
        {' · '}
        <span className="font-mono">{__BUILD_SHA__}</span>
      </span>
    </p>
  )
}

/**
 * One administration screen for every module rather than one per app.
 *
 * Each module used to be administered from inside itself, which meant
 * knowing which app a question belonged to before you could answer it, and
 * signing into that app to do it. Everything answerable from this database
 * is answerable here; the one tab that still points elsewhere says why.
 */
export default function SwAdmin() {
  const [tab, setTab] = useState<(typeof ADMIN_TABS)[number]['id']>('logins')
  const active = ADMIN_TABS.find(t => t.id === tab) ?? ADMIN_TABS[0]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900">
          <ShieldAlert className="h-5 w-5 text-cyrixRed-600" />
          Administration
        </h1>
        <BuildStamp />
      </div>

      {/* Desktop: a row under the heading, where tabs belong on a wide
          screen. */}
      <div className="hidden gap-1 overflow-x-auto border-b border-ink-200 lg:flex">
        {ADMIN_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={t.id === tab ? 'page' : undefined}
            className={clsx(
              'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              t.id === tab
                ? 'border-cyrixRed-600 text-ink-900'
                : 'border-transparent text-ink-400 hover:text-ink-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* pb for the bar below, which is fixed and would otherwise sit over
          the last row of whichever table is open. */}
      <div className="pb-16 lg:pb-0">{active.render()}</div>

      {/*
        Phone: the same tabs as a bar along the bottom.

        These are the only navigation an administrator has — the module bar
        is gone, because with one destination it was a bar of one tab. So
        they belong where every other module puts navigation on a phone,
        under the thumb rather than at the top of a scrolling page you have
        to return to in order to move.

        No Apps cell. In the other modules that cell is how you leave for
        a different one, but an administrator arrives here from the portal
        and has no second module to leave for — it offered a round trip to
        the page they just came from, and cost every real tab a fifth of
        the bar to do it. The wordmark in the header still goes back.
      */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-surface lg:hidden">
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${ADMIN_TABS.length}, minmax(0, 1fr))` }}
        >
          {ADMIN_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={t.id === tab ? 'page' : undefined}
              className={clsx(
                'flex min-w-0 flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium transition-colors',
                t.id === tab ? 'text-[color:var(--page-strong)]' : 'text-ink-400',
              )}
            >
              <t.icon className={clsx('h-5 w-5', t.id === tab ? '' : 'text-ink-400')} />
              <span className="w-full truncate px-0.5 text-center">{t.short}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
