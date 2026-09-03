import { useState, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  ArrowLeft, Plus, Upload, Trash2, Pencil, Save, X, FileSpreadsheet,
  Copy, Users, Building2, Info,
} from 'lucide-react'
import {
  useVisibleTemplates, useTemplateItems, useSaveTemplate, useDeleteTemplate,
  useScoringRules, currentFy,
} from '@/lib/queries'
import { findDuplicate, type ComparableRow } from '@/lib/templates'
import { JOB_ROLE_TOTAL } from '@/lib/sections'
import RowEditor, { blankRow, type Draft } from '@/components/KpiRowEditor'
import { Alert, PageLoader, Spinner, EmptyState } from '@/components/ui'
import type { KpiTemplateItem, VisibleTemplate } from '@/types/db'

/**
 * The KPI templates a manager keeps for their line.
 *
 * The problem this solves is eight engineers typing eight versions of one
 * KPI. A manager writes the rows once, names them, and everybody below
 * them starts from that instead of from an empty grid — which is also the
 * first time "Use my role's template" on the setup screen has had
 * anything to offer.
 *
 * Reached from My Team rather than from a tab of its own. A manager
 * already carries six, and this is not somewhere anybody goes daily: it
 * is set up in September and used every time somebody joins.
 */

/**
 * A template row is an assignment row, so it is edited by the same
 * editor — alternatives, the "try it" calculator and all. Anything less
 * would be a template that cannot say what the KPI it produces can.
 */
const fromItem = (i: KpiTemplateItem, idx: number): Draft => ({
  _key: crypto.randomUUID(),
  section: 'job_role',
  kra: i.kra,
  kpi_description: i.kpi_description,
  weightage: Number(i.weightage) || 0,
  target_value: i.target_value === null ? null : Number(i.target_value),
  target_unit: i.target_unit,
  scoring_rule: i.scoring_rule,
  rule_params: i.rule_params ?? {},
  sort_order: idx + 1,
  alternates: i.alternates ?? [],
})

export default function TeamTemplates() {
  const fy = currentFy()
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: templates, isLoading } = useVisibleTemplates(fy)
  const ids = useMemo(() => (templates ?? []).map(t => t.id), [templates])
  const { data: itemsByTemplate } = useTemplateItems(ids)
  const remove = useDeleteTemplate()

  /** null when nothing is being edited; a draft when something is. */
  const [editing, setEditing] = useState<
    { id: string | null; name: string; rows: Draft[] } | null
  >(null)
  const [confirmDelete, setConfirmDelete] = useState<VisibleTemplate | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const mine = (templates ?? []).filter(t => t.is_mine)
  const inherited = (templates ?? []).filter(t => !t.is_mine && !t.is_company)
  const company = (templates ?? []).filter(t => t.is_company)

  /** Every template's rows, in the shape the duplicate check compares. */
  const existing = useMemo(
    () => (templates ?? []).map(t => ({
      id: t.id,
      name: t.name,
      rows: (itemsByTemplate?.get(t.id) ?? []) as ComparableRow[],
    })),
    [templates, itemsByTemplate],
  )

  const startBlank = () => {
    setError(null); setNotice(null)
    setEditing({ id: null, name: '', rows: [blankRow(1)] })
  }

  const startFrom = (t: VisibleTemplate) => {
    setError(null); setNotice(null)
    setEditing({
      // Somebody else's template opens as a NEW one of your own. Copying
      // your manager's rows and adjusting them is the common case, and
      // saving that over theirs would change it for their whole line.
      id: t.is_mine ? t.id : null,
      name: t.is_mine ? t.name : `${t.name} (my version)`,
      rows: (itemsByTemplate?.get(t.id) ?? []).map(fromItem),
    })
  }

  const onFile = async (file: File) => {
    setError(null); setNotice(null)
    try {
      const { parseKpiWorkbook } = await import('@/lib/excel')
      const parsed = parseKpiWorkbook(await file.arrayBuffer())
      const jobRows = parsed.rows.filter(r => r.section === 'job_role')
      if (jobRows.length === 0) {
        setError(parsed.errors[0] ?? 'No Job Role rows were found in that file.')
        return
      }
      setEditing({
        id: null,
        // The sheet name is nearly always the role, which is nearly
        // always the name the manager was about to type.
        name: parsed.sheetName?.trim().slice(0, 60) ?? '',
        rows: jobRows.map((r, idx) => ({
          _key: crypto.randomUUID(),
          section: 'job_role' as const,
          kra: r.kra,
          kpi_description: r.kpi_description,
          weightage: r.weightage,
          target_value: r.target_value,
          target_unit: r.target_unit,
          scoring_rule: r.scoring_rule,
          rule_params: r.rule_params,
          sort_order: idx + 1,
          alternates: [],
          // The importer guesses a scoring rule when the sheet does not
          // say. Carried through so the row is flagged here exactly as it
          // would be on the setup form — a guessed rule in a template is
          // a guess repeated onto everybody who uses it.
          _inferred: r.rule_inferred,
        })),
      })
      setNotice(
        `Read ${jobRows.length} Job Role row(s) from “${parsed.sheetName}”. ` +
        'Core values and ESMS are not imported — they are the same for ' +
        'everyone and are added to each KPI automatically.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }

  const onDelete = async () => {
    if (!confirmDelete) return
    setError(null)
    try {
      await remove.mutateAsync(confirmDelete.id)
      setNotice(`Removed “${confirmDelete.name}”. Anyone already using it keeps their own copy.`)
      setConfirmDelete(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that template.')
    }
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-5">
      <Link to="/team" className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Back to my team
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Team KPI templates</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            FY {fy} · the rows your people start from
          </p>
        </div>
        {!editing && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button onClick={() => fileRef.current?.click()} className="btn-secondary">
              <Upload className="h-4 w-4" /> New from Excel
            </button>
            <button onClick={startBlank} className="btn-primary">
              <Plus className="h-4 w-4" /> New template
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.xlsm"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {editing ? (
        <TemplateEditor
          key={editing.id ?? 'new'}
          fy={fy}
          initial={editing}
          existing={existing}
          onCancel={() => setEditing(null)}
          onSaved={name => {
            setEditing(null)
            setNotice(`Saved “${name}”. Everybody below you can start from it now.`)
          }}
        />
      ) : (
        <>
          <div className="flex gap-3 rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
            <div className="text-ink-600">
              <p className="font-medium text-ink-900">Who sees these</p>
              <p className="mt-1">
                Everybody below you in the reporting line, not only your direct
                reports — so a template you write here reaches the people who
                report to <em>them</em> as well. They pick it on their own
                setup screen, adjust their targets, and send it to their
                manager as usual.
              </p>
              <p className="mt-1.5">
                Targets come along as a starting point. Everything else — the
                KRAs, the weightages, how each row is scored — is what the
                template is actually for.
              </p>
            </div>
          </div>

          {(templates ?? []).length === 0 ? (
            <EmptyState icon={FileSpreadsheet} title="No templates yet">
              Write the KPI you agree with most of your team once, and everybody
              below you can start from it instead of from an empty grid.
            </EmptyState>
          ) : (
            <div className="space-y-5">
              <TemplateGroup
                title="Mine"
                hint="Yours to change. Everybody below you can use them."
                icon={Users}
                templates={mine}
                items={itemsByTemplate}
                preview={preview}
                onPreview={id => setPreview(preview === id ? null : id)}
                onEdit={startFrom}
                onDelete={setConfirmDelete}
              />
              <TemplateGroup
                title="From my managers"
                hint="Written above you in the line. Open one to keep your own version of it."
                icon={Copy}
                templates={inherited}
                items={itemsByTemplate}
                preview={preview}
                onPreview={id => setPreview(preview === id ? null : id)}
                onEdit={startFrom}
              />
              <TemplateGroup
                title="Company"
                hint="HR's, for your job role."
                icon={Building2}
                templates={company}
                items={itemsByTemplate}
                preview={preview}
                onPreview={id => setPreview(preview === id ? null : id)}
                onEdit={startFrom}
              />
            </div>
          )}
        </>
      )}

      {confirmDelete && (
        <div className="card space-y-3 border-cyrixRed-200 p-4">
          <div>
            <p className="font-medium text-ink-900">
              Remove “{confirmDelete.name}”?
            </p>
            <p className="mt-0.5 text-sm text-ink-500">
              It stops being offered to your team. Nobody's KPI changes —
              a template is copied onto a person when they use it, so
              everybody who already has one keeps it exactly as it is.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onDelete} disabled={remove.isPending} className="btn-danger">
              {remove.isPending && <Spinner className="h-4 w-4" />}
              Remove it
            </button>
            <button onClick={() => setConfirmDelete(null)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TemplateGroup({
  title, hint, icon: Icon, templates, items, preview, onPreview, onEdit, onDelete,
}: {
  title: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
  templates: VisibleTemplate[]
  items: Map<string, KpiTemplateItem[]> | undefined
  preview: string | null
  onPreview: (id: string) => void
  onEdit: (t: VisibleTemplate) => void
  onDelete?: (t: VisibleTemplate) => void
}) {
  if (templates.length === 0) return null

  return (
    <section className="space-y-2">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-800">
          <Icon className="h-4 w-4 text-ink-400" />
          {title}
          <span className="badge bg-ink-100 text-ink-500">{templates.length}</span>
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{hint}</p>
      </div>

      <div className="space-y-2">
        {templates.map(t => {
          const rows = items?.get(t.id) ?? []
          const total = rows.reduce((a, b) => a + (Number(b.weightage) || 0), 0)
          const open = preview === t.id
          return (
            <div key={t.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
                <button
                  onClick={() => onPreview(t.id)}
                  className="min-w-0 flex-1 text-left"
                  aria-expanded={open}
                >
                  <p className="truncate font-medium text-ink-900">{t.name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-500">
                    {t.item_count} row{Number(t.item_count) === 1 ? '' : 's'}
                    {/* Whose it is, always. Two managers in one division
                        both keeping an "Engineer" is the normal case, and
                        the name alone cannot tell them apart. */}
                    {t.is_company
                      ? ' · company standard'
                      : t.is_mine
                        ? ' · yours'
                        : ` · kept by ${t.owner_name ?? 'a manager'}${t.owner_ecode ? ` (${t.owner_ecode})` : ''}`}
                    {total !== JOB_ROLE_TOTAL && ` · totals ${total}%`}
                  </p>
                </button>

                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => onEdit(t)}
                    className="btn-secondary !px-2.5 !py-1.5 text-xs"
                  >
                    {t.is_mine
                      ? <><Pencil className="h-3.5 w-3.5" /> Edit</>
                      : <><Copy className="h-3.5 w-3.5" /> Keep my own</>}
                  </button>
                  {onDelete && (
                    <button
                      onClick={() => onDelete(t)}
                      className="btn-secondary !px-2.5 !py-1.5 text-xs !text-cyrixRed-700"
                      aria-label={`Remove ${t.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {open && (
                <div className="overflow-x-auto border-t border-ink-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-label text-ink-400">
                        <th className="px-4 py-2">KRA</th>
                        <th className="px-4 py-2">KPI</th>
                        <th className="px-4 py-2 text-right">Wt</th>
                        <th className="px-4 py-2 text-right">Target</th>
                        <th className="px-4 py-2">Scoring</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {rows.map(r => (
                        <tr key={r.id}>
                          <td className="px-4 py-2 font-medium text-ink-900">{r.kra}</td>
                          <td className="max-w-md px-4 py-2 text-xs text-ink-500">
                            {r.kpi_description}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.weightage}%</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-600">
                            {r.target_value ?? '—'}
                          </td>
                          <td className="px-4 py-2 text-xs text-ink-500">
                            {r.scoring_rule.replace(/_/g, ' ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * Writing one.
 *
 * Deliberately narrower than the KPI setup form: no alternatives, no
 * rule tester, no ESMS question. Those are decisions about one person's
 * year, and a template is not one person's year — it is the shape their
 * year starts from.
 */
function TemplateEditor({
  fy, initial, existing, onCancel, onSaved,
}: {
  fy: string
  initial: { id: string | null; name: string; rows: Draft[] }
  existing: Array<{ id: string; name: string; rows: ComparableRow[] }>
  onCancel: () => void
  onSaved: (name: string) => void
}) {
  const save = useSaveTemplate()
  const { data: rules } = useScoringRules()
  const [name, setName] = useState(initial.name)
  const [rows, setRows] = useState<Draft[]>(initial.rows)
  const [error, setError] = useState<string | null>(null)
  /** Set once the manager has been shown the duplicate and pressed on. */
  const [dupAccepted, setDupAccepted] = useState(false)

  const total = rows.reduce((a, b) => a + (Number(b.weightage) || 0), 0)
  const named = rows.filter(r => r.kra.trim() !== '')

  const duplicate = useMemo(
    () => findDuplicate(rows, existing, initial.id),
    [rows, existing, initial.id],
  )

  const update = (key: string, patch: Partial<Draft>) =>
    setRows(rows.map(r => (r._key === key ? { ...r, ...patch } : r)))

  const onSave = async () => {
    setError(null)
    if (duplicate && !dupAccepted) { setDupAccepted(true); return }
    try {
      await save.mutateAsync({
        name,
        fy,
        templateId: initial.id,
        rows: named.map(({ _key, _inferred, section, sort_order, ...r }) => {
          void _key; void _inferred; void section; void sort_order
          return {
            ...r,
            kpi_description: r.kpi_description?.trim() || null,
            // Blank ones are dropped rather than saved: an alternative
            // with no KRA is a row nobody can pick in a month, and it
            // would come back as a choice on every KPI made from this.
            alternates: r.alternates.filter(a => a.kra.trim() !== ''),
          }
        }),
      })
      onSaved(name.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that template.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <div>
          <label htmlFor="tpl-name" className="label">Template name</label>
          <input
            id="tpl-name"
            className="input max-w-sm border-violet-700 font-medium shadow-[0_0_0_3px_rgb(var(--violet-700)/0.14)] focus:border-violet-700"
            value={name}
            onChange={e => setName(e.target.value.slice(0, 60))}
            placeholder="e.g. Service Engineer"
            autoFocus
          />
          <p className="mt-1.5 text-xs text-ink-500">
            What your team will see in the dropdown, next to your name. Name it
            after the job rather than the person — “Service Engineer”, not
            “Rahul's KPI”.
          </p>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Shown while it is still avoidable, and it does not block: two
          teams genuinely running the same KPI under different names is a
          real thing, and the manager is the one who knows whether this is
          that or a slip. */}
      {duplicate && (
        <Alert kind="warning" title={`These are the same rows as “${duplicate.name}”`}>
          Every KRA, weightage and scoring rule matches a template that already
          exists — only the targets differ, and those are set per person
          anyway. Use “{duplicate.name}” instead unless this really is a
          separate one.
          {dupAccepted && (
            <span className="mt-1.5 block font-medium">
              Press Save again to keep it anyway.
            </span>
          )}
        </Alert>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">
            Job Role rows <span className="font-normal text-ink-500">— {JOB_ROLE_TOTAL}%</span>
          </h3>
          <span className={clsx(
            'badge',
            total === JOB_ROLE_TOTAL
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-amber-100 text-amber-800',
          )}>
            {total}% of {JOB_ROLE_TOTAL}%
          </span>
        </div>

        {/* The same editor the setup form uses, so a template can say
            everything a KPI can — including the alternatives a row
            measures in some months, and the calculator for checking a
            scoring rule does what its name suggests. */}
        <div className="divide-y divide-ink-100">
          {rows.map((row, i) => (
            <RowEditor
              key={row._key}
              row={row}
              index={i + 1}
              rules={(rules ?? []).filter(r => r.is_selectable)}
              onChange={patch => update(row._key, patch)}
              onRemove={() => setRows(rows.filter(r => r._key !== row._key))}
            />
          ))}
        </div>

        <button
          onClick={() => setRows([...rows, blankRow(rows.length + 1)])}
          className="flex w-full items-center justify-center gap-1.5 border-t border-ink-100 py-2.5 text-sm font-medium text-ink-900 hover:bg-ink-50"
        >
          <Plus className="h-4 w-4" /> Add a row
        </button>
      </div>

      {/* A warning rather than a block. Whoever uses this template still
          has to reach 80% before they can submit, and a template that is
          most of the way there is a better start than none. */}
      {named.length > 0 && total !== JOB_ROLE_TOTAL && (
        <Alert kind="info">
          These rows total {total}%, and a KPI has to reach {JOB_ROLE_TOTAL}% before
          it can be submitted. You can still save it — whoever uses it will be
          asked to make up the difference.
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSave}
          disabled={!name.trim() || named.length === 0 || save.isPending}
          className="btn-primary"
        >
          {save.isPending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {initial.id ? 'Save changes' : 'Save template'}
        </button>
        <button onClick={onCancel} className="btn-secondary">
          <X className="h-4 w-4" /> Cancel
        </button>
        {!name.trim() && (
          <span className="self-center text-xs text-ink-400">Give it a name first.</span>
        )}
      </div>
    </div>
  )
}
