import { useState, useMemo, useRef, type FormEvent } from 'react'
import { Search, UserPlus, Upload, Download, X, ArrowLeftRight } from 'lucide-react'
import { downloadTemplate, bigDeactivation } from '@/lib/sheet'
import { supabase, friendlyError } from '@/lib/supabase'
import { BulkAssign } from '@/pages/admin/SwAdmin'
import EditEmployee from '@/components/EditEmployee'
import { useQueryClient } from '@tanstack/react-query'
import { useOrgKpiStatus, currentFy } from '@/lib/queries'
import { exportOrgStatus, exportSheets } from '@/lib/export'
import { Alert, PageLoader, Spinner, ScorePill, StatusBadge } from '@/components/ui'
import type { OrgKpiStatusRow, AssignmentStatus } from '@/types/db'

export default function AdminEmployees() {
  const fy = currentFy()
  const qc = useQueryClient()
  const { data: org, isLoading } = useOrgKpiStatus(true, fy)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [adding, setAdding] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [recoding, setRecoding] = useState(false)
  /** Whose record is open for correction, by code. */
  const [editing, setEditing] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!org) return []
    const q = search.trim().toLowerCase()
    return org.filter(e => {
      if (statusFilter !== 'all' && e.kpi_status !== statusFilter) return false
      if (!q) return true
      return (
        e.ecode.toLowerCase().includes(q) ||
        e.full_name.toLowerCase().includes(q) ||
        (e.department ?? '').toLowerCase().includes(q) ||
        (e.manager_name ?? '').toLowerCase().includes(q)
      )
    })
  }, [org, search, statusFilter])

  const download = () =>
    exportOrgStatus(
      filtered.map(e => ({
        Ecode: e.ecode,
        Name: e.full_name,
        Designation: e.designation ?? '',
        Department: e.department ?? '',
        Location: e.location ?? '',
        Manager: e.manager_name ?? '',
        'Manager Ecode': e.manager_ecode ?? '',
        'KPI status': e.kpi_status,
        'Months scored': e.months_scored,
        'Awaiting manager': e.months_awaiting_manager,
        'Average score': e.avg_score ?? '',
      })),
      `Cyrix-employees-${fy}.xlsx`,
    )

  if (isLoading) return <PageLoader label="Loading employees…" />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Employees</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {filtered.length} of {org?.length ?? 0} shown · FY {fy}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setAdding(true)} className="btn-primary">
            <UserPlus className="h-4 w-4" /> Add employee
          </button>
          <button onClick={() => setBulk(true)} className="btn-secondary">
            <Upload className="h-4 w-4" /> Bulk import
          </button>
          {/* Beside the import on purpose. Both take a sheet of people,
              and the difference between them is the whole point: import
              adds somebody, this renames somebody who is already here.
              Reaching for the wrong one is how a permanent engineer ends
              up in the system twice. */}
          <button onClick={() => setRecoding(true)} className="btn-secondary">
            <ArrowLeftRight className="h-4 w-4" /> Change codes
          </button>
          <button onClick={download} className="btn-secondary">
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      {adding && <AddEmployee onClose={() => setAdding(false)}
                              onSaved={() => qc.invalidateQueries({ queryKey: ['org_kpi_status'] })} />}
      {bulk && <BulkImport onClose={() => setBulk(false)}
                           onSaved={() => qc.invalidateQueries({ queryKey: ['org_kpi_status'] })} />}

      {/* Correcting one record — and the only way to give somebody a
          login, because Add employee never made one. Everybody added
          through that form has a record and no account. */}
      {editing && (
        <EditEmployee
          ecode={editing}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['org_kpi_status'] })}
        />
      )}

      {/*
        Renaming, not re-creating.

        An engineer on CT111 who goes permanent gets an E code, and until
        now there was nothing to do about it — so they were added again
        under the new code and the year they had already been scored on
        stayed behind with the old one. The employee id is what every
        submission, assignment and audit row hangs off; this changes the
        label on it and moves the login with it, and touches nothing else.
      */}
      {recoding && (
        <BulkAssign<string>
          title="Change employee codes"
          help={
            <>
              Two columns: the code somebody has now, and the code they should
              have. Their KPI, every month they have been scored and their
              whole history stay with them — only the code changes, and their
              login changes with it, so <strong>CT111</strong> signs in as{' '}
              <strong>E250</strong> from then on. Their password does not
              change.
            </>
          }
          templateName="cyrix-change-employee-codes.xlsx"
          templateHeaders={['Current code', 'New code']}
          templateExamples={[
            { 'Current code': 'CT111', 'New code': 'E250' },
            { 'Current code': 'CT618', 'New code': 'E251' },
          ]}
          parseRow={row => {
            const from = String(row['Current code'] ?? '').trim().toUpperCase()
            const to = String(row['New code'] ?? '').trim().toUpperCase()
            if (!to) return { ecode: from, problem: 'No new code given' }
            if (to === from) return { ecode: from, problem: 'Already their code' }
            return { ecode: from, value: to }
          }}
          describe={to => `→ ${to}`}
          apply={async rows => {
            // One at a time, and each one reports for itself: a code
            // already taken is that person's problem to fix, not a reason
            // to abandon the other seventy-seven.
            let changed = 0
            const missing: string[] = []
            for (const r of rows) {
              const { data, error } = await supabase.rpc('change_ecode', {
                p_from: r.ecode, p_to: r.value,
              })
              const said = data as { status?: string; detail?: string } | null
              if (error) missing.push(`${r.ecode} — ${friendlyError(error)}`)
              else if (said?.status === 'changed') changed++
              else missing.push(`${r.ecode} — ${said?.detail ?? 'not changed'}`)
            }
            return { changed, missing }
          }}
          onClose={() => {
            setRecoding(false)
            qc.invalidateQueries({ queryKey: ['org_kpi_status'] })
          }}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            className="input pl-9"
            placeholder="Search by code, name, department or manager"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-auto"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="all">All KPI statuses</option>
          <option value="active">Approved</option>
          <option value="pending_approval">Awaiting approval</option>
          <option value="draft">Draft</option>
          <option value="rejected">Sent back</option>
          <option value="not_set_up">Not set up</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2.5 font-medium">Employee</th>
                <th className="px-4 py-2.5 font-medium">Department</th>
                <th className="px-4 py-2.5 font-medium">Manager</th>
                <th className="px-4 py-2.5 font-medium">KPI</th>
                <th className="px-4 py-2.5 text-right font-medium">Scored</th>
                <th className="px-4 py-2.5 text-right font-medium">Average</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.slice(0, 200).map(e => (
                <Row key={e.employee_id} e={e} onEdit={() => setEditing(e.ecode)} />
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
    </div>
  )
}

function Row({ e, onEdit }: { e: OrgKpiStatusRow; onEdit: () => void }) {
  return (
    // The whole row opens it. A pencil in the last column is a target to
    // aim at on a list of 1,148; the row is the thing being corrected.
    <tr className="cursor-pointer hover:bg-ink-50" onClick={onEdit}>
      <td className="px-4 py-3">
        <p className="font-medium text-ink-900">{e.full_name}</p>
        <p className="text-xs text-ink-500">
          {e.ecode}{e.designation && ` · ${e.designation}`}
        </p>
      </td>
      <td className="px-4 py-3 text-ink-600">{e.department ?? '—'}</td>
      <td className="px-4 py-3">
        {e.manager_name ? (
          <>
            <p className="text-ink-700">{e.manager_name}</p>
            <p className="text-xs text-ink-400">{e.manager_ecode}</p>
          </>
        ) : (
          <span className="text-xs text-amber-700">No manager</span>
        )}
      </td>
      <td className="px-4 py-3">
        {e.kpi_status === 'not_set_up'
          ? <span className="badge bg-ink-100 text-ink-500">Not set up</span>
          : <StatusBadge status={e.kpi_status as AssignmentStatus} kind="assignment" />}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-ink-600">{e.months_scored}</td>
      <td className="px-4 py-3 text-right"><ScorePill value={e.avg_score} size="sm" /></td>
    </tr>
  )
}

// ---------------------------------------------------------------------
// Add one employee
// ---------------------------------------------------------------------
function AddEmployee({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    ecode: '', full_name: '', designation: '', department: '',
    location: '', manager_ecode: '', work_email: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ ecode: string; loginMade: boolean } | null>(null)

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value })

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    setError(null); setBusy(true)
    try {
      const ecode = form.ecode.trim().toUpperCase()
      if (!ecode || !form.full_name.trim()) throw new Error('Employee code and name are required.')

      let manager_id: string | null = null
      if (form.manager_ecode.trim()) {
        const { data } = await supabase.from('employees').select('id')
          .ilike('ecode', form.manager_ecode.trim()).maybeSingle()
        if (!data) throw new Error(`No employee with code ${form.manager_ecode}.`)
        manager_id = data.id
      }

      // The login itself needs the service role, which the browser must
      // never hold. The record is created here and the account is issued
      // by the import script, which HR runs with the admin key.
      const { error: insErr } = await supabase.from('employees').insert({
        ecode,
        full_name: form.full_name.trim(),
        designation: form.designation.trim() || null,
        department: form.department.trim() || null,
        location: form.location.trim() || null,
        work_email: form.work_email.trim() || null,
        reporting_manager_id: manager_id,
        is_active: true,
        must_change_password: true,
      })
      if (insErr) throw new Error(friendlyError(insErr))

      /*
        And a login, which this form used to leave to a terminal.

        It printed a scripts/user-admin.mjs command and told HR to go and
        run it with the service key, so in practice it did not get run --
        the person had a record, no account, and a sign-in screen that
        could only tell them the password was wrong.

        Not fatal if it fails: the employee row is already saved and
        correct, and Edit offers the login again. Losing the record
        because the account could not be made would be the worse half.
      */
      let loginMade = true
      try {
        const { data: made, error: loginErr } =
          await supabase.rpc('hr_create_login', { p_ecode: ecode })
        if (loginErr || !(made as { ok?: boolean })?.ok) loginMade = false
      } catch {
        loginMade = false
      }

      setDone({ ecode, loginMade })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that employee.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Add an employee" onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}
      {done ? (
        <Alert
          kind={done.loginMade ? 'success' : 'warning'}
          title={`${done.ecode} added`}
        >
          {done.loginMade ? (
            <p>
              They sign in as <strong>{done.ecode}</strong> with
              {' '}<strong>{done.ecode}</strong> as the password, and should change it.
            </p>
          ) : (
            <p>
              The record is saved, but their login could not be created. Open
              their row and use <strong>Create their login</strong>.
            </p>
          )}
        </Alert>
      ) : (
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee code *" value={form.ecode} onChange={set('ecode')}
                 placeholder="E1234" uppercase />
          <Field label="Full name *" value={form.full_name} onChange={set('full_name')} />
          <Field label="Designation" value={form.designation} onChange={set('designation')} />
          <Field label="Department" value={form.department} onChange={set('department')} />
          <Field label="Location" value={form.location} onChange={set('location')} />
          <Field label="Reporting manager code" value={form.manager_ecode}
                 onChange={set('manager_ecode')} placeholder="E551" uppercase />
          <Field label="Work email" value={form.work_email} onChange={set('work_email')}
                 type="email" />
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />} Add employee
            </button>
          </div>
        </form>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------

/**
 * The stop before a large deactivation.
 *
 * Modelled on the one in SpareFields: a number has to be typed, and it
 * is the count itself rather than a word, so the only way past is to
 * have read how many people this affects. "Yes" and "Confirm" are things
 * a hand does; 1101 is a thing an eye has to look at first.
 */
function ConfirmDeactivation({
  going, activeNow, busy, onCancel, onConfirm,
}: {
  going: number; activeNow: number; busy: boolean
  onCancel: () => void; onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-shade/60 p-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-ink-200 bg-surface p-5 shadow-2xl">
        <div>
          <h4 className="font-semibold text-ink-900">
            Deactivate {going} of {activeNow} people?
          </h4>
          <p className="mt-1 text-sm text-ink-600">
            That is most of the payroll, which usually means the file is a
            part of the master rather than all of it. Everyone missing from
            it loses their login. Their records and scored months are kept,
            and you can reactivate somebody by including them in the next
            upload.
          </p>
        </div>
        <label className="block text-sm">
          <span className="text-ink-600">Type {going} to confirm</span>
          <input
            autoFocus
            className="input mt-1 font-mono"
            placeholder={String(going)}
            value={typed}
            onChange={e => setTyped(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={busy || typed.trim() !== String(going)}
            className="btn-danger"
          >
            Import and deactivate {going}
          </button>
        </div>
      </div>
    </div>
  )
}

function BulkImport({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    added: number
    failed: string[]
    /** Deactivated by this upload, for the report. */
    gone: Array<{ ecode: string; full_name: string }>
    /** Codes this upload saw for the first time, for the report. */
    joined: Array<Record<string, string>>
  } | null>(null)
  /**
   * Active people the file does not mention — read as having left.
   *
   * Worked out while reading the file rather than while saving it, so
   * the number is on screen before anything is pressed. That ordering is
   * the whole safeguard: this reads "missing means left", which is true
   * of a complete master and catastrophically false of a partial one, and
   * "1,101 will be deactivated" is a sentence somebody stops reading.
   */
  const [leaving, setLeaving] = useState<Array<{ ecode: string; full_name: string }>>([])
  /** Active headcount when the file was read, for judging the scale. */
  const [activeNow, setActiveNow] = useState(0)
  /** The confirmation is open. Only ever for a big deactivation. */
  const [confirming, setConfirming] = useState(false)

  const read = async (file: File) => {
    setError(null); setResult(null)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf)
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        wb.Sheets[wb.SheetNames[0]], { defval: null },
      )
      const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      const pick = (r: Record<string, unknown>, ...names: string[]) => {
        const map = Object.fromEntries(Object.keys(r).map(k => [key(k), k]))
        for (const n of names) {
          const hit = map[key(n)]
          if (hit && r[hit] != null && String(r[hit]).trim() !== '') return String(r[hit]).trim()
        }
        return ''
      }
      const parsed = raw.map(r => ({
        ecode: pick(r, 'employee_code', 'ecode', 'employee code', 'code'),
        full_name: pick(r, 'employee_name', 'name', 'full name'),
        designation: pick(r, 'designation', 'title'),
        department: pick(r, 'department', 'dept'),
        location: pick(r, 'location', 'branch'),
        manager_ecode: pick(r, 'reportingmanager_code', 'reporting manager code', 'manager ecode', 'manager code'),
        work_email: pick(r, 'email', 'work email'),
      })).filter(r => r.ecode && r.full_name)

      if (parsed.length === 0) {
        setError('No rows had both an employee code and a name. Check the column headers.')
        return
      }
      setRows(parsed)

      // Who is active now and not in this file. Compared on upper case,
      // the same way the codes are stored and the same way the server
      // compares them, so a lower-case sheet does not read as a company
      // that has all resigned.
      const inFile = new Set(parsed.map(r => r.ecode.toUpperCase()))
      const { data: activeRows, error: activeErr } = await supabase
        .from('employees').select('ecode, full_name').eq('is_active', true)
      if (activeErr) throw new Error(friendlyError(activeErr))
      const active = (activeRows ?? []) as Array<{ ecode: string; full_name: string }>

      setActiveNow(active.length)
      setLeaving(
        active
          .filter(e => !inFile.has(e.ecode.toUpperCase()))
          .sort((a, b) => a.ecode.localeCompare(b.ecode)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }

  const save = async () => {
    if (!rows) return
    setBusy(true); setError(null)
    try {
      const { data: existing } = await supabase.from('employees').select('id, ecode')
      const byEcode = new Map((existing ?? []).map(e => [e.ecode.toUpperCase(), e.id]))

      /*
        Codes this upload has never seen before.

        Worked out against every employee row, active or not, so somebody
        coming back after a break is a return rather than a new joiner —
        their old record, and the year they were scored on, is still
        theirs. Captured here because after the upsert everybody looks
        like they were always there.
      */
      const joined = rows.filter(r => !byEcode.has(r.ecode.toUpperCase()))

      const payload = rows.map(r => ({
        ecode: r.ecode.toUpperCase(),
        full_name: r.full_name,
        designation: r.designation || null,
        department: r.department || null,
        location: r.location || null,
        work_email: r.work_email || null,
        is_active: true,
        must_change_password: true,
      }))

      const { error: upErr } = await supabase
        .from('employees').upsert(payload, { onConflict: 'ecode' })
      if (upErr) throw new Error(friendlyError(upErr))

      // Second pass for reporting lines, so the sheet need not be ordered.
      const { data: after } = await supabase.from('employees').select('id, ecode')
      ;(after ?? []).forEach(e => byEcode.set(e.ecode.toUpperCase(), e.id))

      const failed: string[] = []
      for (const r of rows) {
        if (!r.manager_ecode) continue
        const mgrId = byEcode.get(r.manager_ecode.toUpperCase())
        const selfId = byEcode.get(r.ecode.toUpperCase())
        if (!mgrId || !selfId || mgrId === selfId) {
          failed.push(`${r.ecode} → ${r.manager_ecode}`)
          continue
        }
        await supabase.from('employees')
          .update({ reporting_manager_id: mgrId }).eq('id', selfId)
      }

      /*
        Anybody not in the file has left.

        After the upsert, never before it: somebody who moved branch is
        in the file under the same code, and deactivating first would
        take their login away and hand it back a second later. Doing it
        last also means a failure above stops here, rather than leaving
        the company deactivated and half-imported.

        Deactivated, not deleted — deleting the row takes the appraisal
        history with it, and a year of somebody's scoring should not be
        destroyed by leaving them out of a spreadsheet.
      */
      const { data: goneRows, error: goneErr } = await supabase.rpc(
        'deactivate_missing', { p_ecodes: payload.map(p => p.ecode) },
      )
      if (goneErr) throw new Error(friendlyError(goneErr))
      const gone = (goneRows ?? []) as Array<{ ecode: string; full_name: string }>

      setResult({ added: payload.length, failed, gone, joined })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Bulk import employees" onClose={onClose}>
      {error && <Alert kind="error">{error}</Alert>}

      {result ? (
        <Alert kind="success" title={`${result.added} employee record(s) imported`}>
          <p>
            {result.joined.length} new, {result.gone.length} deactivated.
          </p>
          {/*
            The two answers this upload produced, in one file.

            Offered rather than described: who joined and who left is
            what HR has to pass on to payroll and IT, and reading it off
            a panel that closes is how it gets retyped wrong.
          */}
          <button
            onClick={() => exportSheets(
              [
                {
                  name: 'Deactivated',
                  headers: ['Employee_Code', 'Employee_Name'],
                  rows: result.gone.map(g => ({
                    Employee_Code: g.ecode, Employee_Name: g.full_name,
                  })),
                },
                {
                  name: 'New team members',
                  headers: ['Employee_Code', 'Employee_Name', 'Designation',
                            'Department', 'Location', 'ReportingManager_Code', 'Email'],
                  rows: result.joined.map(j => ({
                    Employee_Code: j.ecode, Employee_Name: j.full_name,
                    Designation: j.designation, Department: j.department,
                    Location: j.location, ReportingManager_Code: j.manager_ecode,
                    Email: j.work_email,
                  })),
                },
              ],
              `cyrix-master-upload-${new Date().toISOString().slice(0, 10)}.xlsx`,
            )}
            className="btn-secondary mt-3"
          >
            <Download className="h-4 w-4" /> Download the report
          </button>
          <p className="mt-3">Logins still need issuing for new joiners — run:</p>
          <code className="mt-2 block rounded bg-ink-900 px-2 py-1.5 text-xs text-onInk">
            node scripts/import-employees.mjs "your-file.xlsx"
          </code>
          {result.failed.length > 0 && (
            <p className="mt-2">
              {result.failed.length} reporting line(s) could not be resolved:{' '}
              {result.failed.slice(0, 5).join(', ')}
              {result.failed.length > 5 && ' …'}
            </p>
          )}
        </Alert>
      ) : rows ? (
        <>
          <p className="text-sm text-ink-600">
            {rows.length} row(s) ready. Existing employee codes are updated, not duplicated.
          </p>

          {/*
            Who this file says has left, before anything is pressed.

            Named rather than counted. "12 will be deactivated" is a
            number people accept; twelve names is a list somebody reads
            and recognises, which is how a wrong file gets caught.
          */}
          {leaving.length > 0 && (
            <Alert
              kind={bigDeactivation(leaving.length, activeNow) ? 'error' : 'warning'}
              title={`${leaving.length} of ${activeNow} will be deactivated`}
            >
              <p>
                They are active now and not in this file, so it reads them as
                having left. Their record, KPI and every scored month stay —
                only their login stops working.
              </p>
              <p className="mt-2 text-xs">
                {leaving.slice(0, 12).map(e => `${e.full_name} (${e.ecode})`).join(', ')}
                {leaving.length > 12 && ` … and ${leaving.length - 12} more`}
              </p>
            </Alert>
          )}
          <div className="max-h-64 overflow-auto rounded-lg border border-ink-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-ink-50">
                <tr className="text-left text-ink-500">
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Manager</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 font-medium">{r.ecode}</td>
                    <td className="px-3 py-1.5">{r.full_name}</td>
                    <td className="px-3 py-1.5 text-ink-500">{r.department || '—'}</td>
                    <td className="px-3 py-1.5 text-ink-500">{r.manager_ecode || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            {/* The button says what it will do, including the half that
                is not an import. "Import 50" hides the other 1,101. */}
            <button
              onClick={() =>
                bigDeactivation(leaving.length, activeNow) ? setConfirming(true) : save()}
              className="btn-primary"
              disabled={busy}
            >
              {busy && <Spinner className="h-4 w-4" />}
              Import {rows.length}
              {leaving.length > 0 && ` and deactivate ${leaving.length}`}
            </button>
            <button onClick={() => setRows(null)} className="btn-secondary">Choose another file</button>
          </div>

          {confirming && (
            <ConfirmDeactivation
              going={leaving.length}
              activeNow={activeNow}
              busy={busy}
              onCancel={() => setConfirming(false)}
              onConfirm={() => { setConfirming(false); void save() }}
            />
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-ink-600">
            Start from the template, or upload your own Excel or CSV. Column headers are
            matched loosely — recognised names include Employee_Code, Employee_Name,
            Designation, Department, Location, ReportingManager_Code and Email.
          </p>
          <div className="flex flex-wrap gap-2">
            {/*
              The template first, and the same way round as every other
              import in the app. A paragraph describing seven columns is
              a paragraph somebody has to translate into a spreadsheet;
              the file cannot be misread, and what comes back already
              matches. The two example rows are the test accounts, which
              makes the shape of a code obvious and shows a manager code
              pointing at another row in the same file — the one thing
              about this format nobody guesses right first time.
            */}
            <button
              onClick={() => downloadTemplate(
                'cyrix-employees-template.xlsx',
                ['Employee_Code', 'Employee_Name', 'Designation', 'Department',
                 'Location', 'ReportingManager_Code', 'Email'],
                [
                  {
                    Employee_Code: 'E8888', Employee_Name: 'Kevin - Test',
                    Designation: 'MIS', Department: 'AI', Location: 'HO',
                    ReportingManager_Code: 'E9999', Email: 'kevin.test@cyrix.in',
                  },
                  {
                    Employee_Code: 'E9999', Employee_Name: 'Saranya - Test',
                    Designation: 'Manager', Department: 'AI', Location: 'HO',
                    ReportingManager_Code: 'E2', Email: 'saranya.test@cyrix.in',
                  },
                ],
              )}
              className="btn-secondary"
            >
              <Download className="h-4 w-4" /> Download the template
            </button>
            <button onClick={() => fileRef.current?.click()} className="btn-primary">
              <Upload className="h-4 w-4" /> Choose file
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = '' }}
          />
        </>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------
function Panel({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink-900">{title}</h2>
        <button onClick={onClose} className="btn-icon !p-1.5">
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  )
}

function Field({
  label, value, onChange, placeholder, type = 'text', uppercase,
}: {
  label: string
  value: string
  onChange: (e: { target: { value: string } }) => void
  placeholder?: string
  type?: string
  uppercase?: boolean
}) {
  return (
    <div>
      <label className="label text-xs">{label}</label>
      <input
        className={`input ${uppercase ? 'uppercase' : ''}`}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange({
          target: { value: uppercase ? e.target.value.toUpperCase() : e.target.value },
        })}
      />
    </div>
  )
}
