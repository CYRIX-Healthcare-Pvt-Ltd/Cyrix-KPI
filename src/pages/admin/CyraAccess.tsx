/**
 * Software Admin → CYRA (0174; the user, 12 Oct: "need a tab in software admin,
 * cyra, in that for each user, we need check box, extra option ie review and
 * admin", "defaultly review and admin should be disabled").
 *
 * Everyone who holds the CYRA module, with two boxes. CYRA itself keeps its own
 * accounts in another project; its engine reads these boxes through
 * cyra_whoami() whenever the person opens CYRA from the portal, and gives or
 * takes CYRA's review and admin roles to match — so a change shows at their
 * next visit from the portal.
 */
import { useDeferredValue, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Stethoscope } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { Alert, EmptyState, Spinner, StatTile } from '@/components/ui'

interface Row {
  employee_id: string; ecode: string; full_name: string; designation: string | null
  function_name: string | null; location: string | null
  review: boolean; admin: boolean; updated_at: string | null; updated_by_name: string | null
}

export default function CyraAccess() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['cyra', 'access'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cyra_access_list')
      if (error) throw new Error(friendlyError(error))
      return data as Row[]
    },
  })
  const [q, setQ] = useState('')
  const needle = useDeferredValue(q.trim().toLowerCase())
  const [failed, setFailed] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async (r: Pick<Row, 'employee_id' | 'review' | 'admin'>) => {
      const { error } = await supabase.rpc('set_cyra_access', {
        p_employee_id: r.employee_id, p_review: r.review, p_admin: r.admin,
      })
      if (error) throw new Error(friendlyError(error))
    },
    // The tick shows at once; a refusal puts it back.
    onMutate: async r => {
      setFailed(null)
      await qc.cancelQueries({ queryKey: ['cyra', 'access'] })
      const before = qc.getQueryData<Row[]>(['cyra', 'access'])
      qc.setQueryData<Row[]>(['cyra', 'access'], rows =>
        rows?.map(x => (x.employee_id === r.employee_id ? { ...x, review: r.review, admin: r.admin } : x)))
      return { before }
    },
    onError: (e, _r, ctx) => {
      if (ctx?.before) qc.setQueryData(['cyra', 'access'], ctx.before)
      setFailed(e instanceof Error ? e.message : 'Could not save that.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['cyra', 'access'] }),
  })

  const rows = data ?? []
  const shown = useMemo(() => (needle
    ? rows.filter(r => r.full_name.toLowerCase().includes(needle) || r.ecode.toLowerCase().includes(needle))
    : rows), [rows, needle])

  if (isLoading) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-ink-400" /></div>
  if (error) return <Alert kind="error">{error instanceof Error ? error.message : 'Could not load Cyra Assist access.'}</Alert>

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="People with Cyra Assist" value={rows.length} />
        <StatTile label="Review" value={rows.filter(r => r.review).length} />
        <StatTile label="Admin" value={rows.filter(r => r.admin).length} />
      </div>

      {failed && <Alert kind="error">{failed}</Alert>}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-ink-50 px-3 py-2">
          <h3 className="flex items-center gap-2 px-1 text-sm font-semibold text-ink-800">
            <Stethoscope className="h-4 w-4 text-ink-400" /> Cyra Assist
          </h3>
          <label className="relative ml-auto w-full sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input className="input !py-1.5 !pl-8" placeholder="Name or code" value={q} onChange={e => setQ(e.target.value)} />
          </label>
        </div>

        {shown.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Stethoscope} title={q ? 'Nobody matches that' : 'Nobody has Cyra Assist yet'} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2.5 font-medium">Employee</th>
                  <th className="px-4 py-2.5 text-center font-medium">Review</th>
                  <th className="px-4 py-2.5 text-center font-medium">Admin</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Last updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {shown.map(r => (
                  <tr key={r.employee_id} className="hover:bg-ink-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-900">{r.full_name}</p>
                      <p className="text-xs text-ink-500">{r.ecode}{r.designation ? ` · ${r.designation}` : ''}</p>
                    </td>
                    {(['review', 'admin'] as const).map(k => (
                      <td key={k} className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-cyrixRed-600"
                          aria-label={`${k === 'review' ? 'Review' : 'Admin'} for ${r.full_name}`}
                          checked={r[k]}
                          onChange={e => save.mutate({ employee_id: r.employee_id, review: r.review, admin: r.admin, [k]: e.target.checked })}
                        />
                      </td>
                    ))}
                    <td className="hidden px-4 py-3 text-xs text-ink-500 sm:table-cell">
                      {r.updated_at
                        ? <>
                            {new Date(r.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {r.updated_by_name && <span className="block text-ink-400">by {r.updated_by_name}</span>}
                          </>
                        : <span className="text-ink-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
