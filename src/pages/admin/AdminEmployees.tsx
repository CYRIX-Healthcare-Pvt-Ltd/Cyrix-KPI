import { useState, useMemo, useRef, type FormEvent } from 'react'
import { Search, UserPlus, Upload, Download, X, ArrowLeftRight } from 'lucide-react'
import { supabase, friendlyError, ecodeToEmail } from '@/lib/supabase'
import { BulkAssign } from '@/pages/admin/SwAdmin'
import { useQueryClient } from '@tanstack/react-query'
import { useOrgKpiStatus, currentFy } from '@/lib/queries'
import { exportOrgStatus } from '@/lib/export'
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
                <Row key={e.employee_id} e={e} />
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

function Row({ e }: { e: OrgKpiStatusRow }) {
  return (
    <tr className="hover:bg-ink-50">
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
  const [done, setDone] = useState<string | null>(null)

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

      setDone(ecode)
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
        <Alert kind="success" title={`${done} added`}>
          <p>
            Their record exists but has no login yet. Issue one by running:
          </p>
          <code className="mt-2 block rounded bg-ink-900 px-2 py-1.5 text-xs text-onInk">
            node scripts/user-admin.mjs issue-login {done}
          </code>
          <p className="mt-2">
            They will then sign in with <strong>{done}</strong> / <strong>{done}</strong>
            {' '}({ecodeToEmail(done)}).
          </p>
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
function BulkImport({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ added: number; failed: string[] } | null>(null)

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

      setResult({ added: payload.length, failed })
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
          <p>Logins still need issuing — run:</p>
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
            <button onClick={save} className="btn-primary" disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />} Import {rows.length} employee(s)
            </button>
            <button onClick={() => setRows(null)} className="btn-secondary">Choose another file</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-600">
            Upload an Excel or CSV file. Column headers are matched loosely — recognised names
            include Employee_Code, Employee_Name, Designation, Department, Location,
            ReportingManager_Code and Email.
          </p>
          <button onClick={() => fileRef.current?.click()} className="btn-primary">
            <Upload className="h-4 w-4" /> Choose file
          </button>
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
