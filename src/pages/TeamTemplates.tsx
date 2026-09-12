import { useState, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  ArrowLeft, Plus, Upload, Trash2, Pencil, Save, X, FileSpreadsheet,
  Copy, Users, Building2, Info, UserPlus, Check, AlertTriangle, Search,
  Sparkles,
} from 'lucide-react'
import {
  useVisibleTemplates, useTemplateItems, useSaveTemplate,
  useScoringRules, useApplyTemplate, usePushTemplate, useArchiveTemplate,
  useSharedKpiGroups, useNameSharedKpi, currentFy,
  type AssignOutcome, type TemplateReach, type SharedKpiGroup,
} from '@/lib/queries'
import { parseEcodes } from '@/lib/ecodes'
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
  /*
    Archived, not deleted.

    A hard delete took the template row with kpi_template_items on the
    cascade — and kpi_assignments.source_template_id is ON DELETE SET
    NULL, so removing a template quietly severed every KPI that came
    from it. That is the link "23 people on this" is counted from, and
    the one the audit trail needs to say where somebody's rows came
    from. Archiving takes it out of every list and leaves both standing.
  */
  const remove = useArchiveTemplate()

  /** null when nothing is being edited; a draft when something is. */
  const [editing, setEditing] = useState<
    { id: string | null; name: string; rows: Draft[]; inUse?: number } | null
  >(null)
  const [confirmDelete, setConfirmDelete] = useState<VisibleTemplate | null>(null)
  const [assigning, setAssigning] = useState<VisibleTemplate | null>(null)
  const [hunt, setHunt] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /* Not while the editor is open: the list behind it is not on screen. */
  const { data: shared } = useSharedKpiGroups(fy, !editing)

  /*
    Name or keeper, one box for both.

    The list is everything under this person's own manager, which for a
    division head is dozens: "Engineer" kept by four different managers,
    and the one you want is the one whose name you already know.
  */
  const shown = useMemo(() => {
    const q = hunt.trim().toLowerCase()
    const all = templates ?? []
    if (!q) return all
    return all.filter(t =>
      t.name.toLowerCase().includes(q)
      || (t.owner_name ?? '').toLowerCase().includes(q)
      || (t.owner_ecode ?? '').toLowerCase().includes(q))
  }, [templates, hunt])

  const mine = shown.filter(t => t.is_mine)
  const company = shown.filter(t => t.is_company)

  /*
    Everybody else's, grouped under the manager who keeps them.

    One flat list said "kept by" on every row and left the reader to do
    the grouping in their head — and the question being asked of this
    screen is "what does Adrian give his engineers", which is a question
    about a person.
  */
  /*
    Templates somebody else owns that my own people are already on.

    These are in the list because of who is ON them, not because of who
    wrote them — so grouping them under the owner's name put "MOHANDAS
    N" as a heading on his subordinate's screen, which reads as exactly
    the thing the rule forbids: seeing your manager's templates. The
    owner is provenance, not the reason, and the row still says whose it
    is.
  */
  const onMyTeam = shown.filter(
    t => !t.is_mine && !t.is_company && Number(t.on_my_team) > 0)

  const keepers = useMemo(() => {
    const groups = new Map<
      string, { name: string; ecode: string | null; list: VisibleTemplate[] }
    >()
    for (const t of shown) {
      if (t.is_mine || t.is_company) continue
      if (Number(t.on_my_team) > 0) continue
      const key = t.owner_id ?? 'unknown'
      const g = groups.get(key)
        ?? { name: t.owner_name ?? 'A manager', ecode: t.owner_ecode, list: [] }
      g.list.push(t)
      groups.set(key, g)
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [shown])

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
      // Only yours can be pushed; somebody else's opens as a new one of
      // your own, which nobody is on yet.
      inUse: t.is_mine ? Number(t.in_use ?? 0) : 0,
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
      const out = await remove.mutateAsync(confirmDelete.id)
      setNotice(
        `Removed “${out.template}”. `
        + (out.people_keeping_it > 0
          ? `${out.people_keeping_it} ${out.people_keeping_it === 1 ? 'person keeps' : 'people keep'} `
            + 'the KPI it gave them, exactly as it is.'
          : 'Nobody was on it.'),
      )
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
            /*
              Not "everybody below you" — that is exactly backwards
              under the rule in 0125. Your own reportees see what is
              under YOU; your template is visible to the people beside
              you and the levels above. The way it reaches your own team
              is that you assign it to them.
            */
            setNotice(
              `Saved “${name}”. Hand it to your own team with Assign to — `
              + 'your colleagues at the same level, and the managers above you, '
              + 'can also start from it.',
            )
          }}
        />
      ) : (
        <>
          <div className="flex gap-3 rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
            <div className="text-ink-600">
              <p className="font-medium text-ink-900">Who sees these</p>
              <p className="mt-1">
                Everything kept by anyone under your own manager — yours, your
                colleagues' at the same level, and everything below them. Not
                your own manager's, which is written for their job rather than
                for the people you look after.
              </p>
              <p className="mt-1.5">
                Yours are yours to change. Everybody else's are here to use:
                open one to keep your own copy, or hand it straight to people
                with <span className="font-medium text-ink-800">Assign to</span>.
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
              Write the KPI you agree with most of your team once, then hand it
              to them with Assign to instead of everybody typing it out.
            </EmptyState>
          ) : (
            <div className="space-y-5">
              {/* Worth a box only once the list is long enough to scroll. */}
              {(templates ?? []).length > 6 && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <input
                    className="input pl-9"
                    value={hunt}
                    onChange={e => setHunt(e.target.value)}
                    placeholder="Search by name or who keeps it"
                    aria-label="Search templates"
                  />
                </div>
              )}
              {hunt.trim() && shown.length === 0 && (
                <EmptyState icon={Search} title="Nothing matches that">
                  No template's name or keeper contains “{hunt.trim()}”.
                </EmptyState>
              )}

              <TemplateGroup
                title="Your team is already on these"
                hint="Written elsewhere and already on your people. Hand them to a new joiner; changing them belongs to whoever keeps them."
                icon={Users}
                templates={onMyTeam}
                items={itemsByTemplate}
                preview={preview}
                onPreview={id => setPreview(preview === id ? null : id)}
                onEdit={startFrom}
                onAssign={setAssigning}
                assigningId={assigning?.id ?? null}
                fy={fy}
                onCloseAssign={() => setAssigning(null)}
              />

              {/* One section per manager, rather than one list with
                  "kept by" repeated down the side of it. */}
              {keepers.map(g => (
                <TemplateGroup
                  key={g.ecode ?? g.name}
                  title={g.name}
                  hint={`${g.ecode ? `${g.ecode} · ` : ''}theirs to change, yours to use`}
                  icon={Copy}
                  templates={g.list}
                  items={itemsByTemplate}
                  preview={preview}
                  onPreview={id => setPreview(preview === id ? null : id)}
                  onEdit={startFrom}
                  onAssign={setAssigning}
                  assigningId={assigning?.id ?? null}
                  fy={fy}
                  onCloseAssign={() => setAssigning(null)}
                />
              ))}

              {/*
                The KPIs your people already share, waiting for a name.

                This is the first thing to do on this screen and the
                reason it exists: 719 of the company's 773 active KPIs
                are one of thirty-one shapes, and five of them are
                linked to a template. Naming one changes nobody's rows —
                it writes the link that was never there, and after that
                one edit reaches all of them.
              */}
              {(shared ?? []).length > 0 && (
                <section className="space-y-2">
                  <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-800">
                      <Sparkles className="h-4 w-4 text-violet-600" />
                      Already shared, not named
                      <span className="badge bg-violet-100 text-violet-800">
                        {(shared ?? []).length}
                      </span>
                    </h2>
                    <p className="mt-0.5 text-xs text-ink-500">
                      These people are already on the same KPI — same KRAs,
                      weightages and scoring. Name it and one edit reaches all
                      of them. Nobody's rows change.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {(shared ?? []).map(g => (
                      <SharedGroupCard key={g.shape} group={g} fy={fy} />
                    ))}
                  </div>
                </section>
              )}

              <TemplateGroup
                title="Mine"
                hint="Templates you wrote. Yours to change, rename and hand out."
                icon={Users}
                templates={mine}
                items={itemsByTemplate}
                preview={preview}
                onPreview={id => setPreview(preview === id ? null : id)}
                onEdit={startFrom}
                onAssign={setAssigning}
                assigningId={assigning?.id ?? null}
                fy={fy}
                onCloseAssign={() => setAssigning(null)}
                onDelete={setConfirmDelete}
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
                onAssign={setAssigning}
                assigningId={assigning?.id ?? null}
                fy={fy}
                onCloseAssign={() => setAssigning(null)}
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
            {/* "Offered to your team" was wrong twice over: archiving
                takes it out of every list including the owner's own, and
                the people who could see it were never "your team" — they
                are everybody under your own manager. */}
            <p className="mt-0.5 text-sm text-ink-500">
              It disappears from every list, yours included.
              {Number(confirmDelete.in_use) > 0
                ? ` The ${confirmDelete.in_use} ${Number(confirmDelete.in_use) === 1
                    ? 'person on it keeps their KPI' : 'people on it keep their KPIs'}`
                  + ' exactly as they are — a template is copied onto somebody when'
                  + ' it is applied, and taking it away does not take that back.'
                : ' Nobody is on it.'}
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
  title, hint, icon: Icon, templates, items, preview, onPreview, onEdit,
  onAssign, onDelete, assigningId, fy, onCloseAssign,
}: {
  title: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
  templates: VisibleTemplate[]
  items: Map<string, KpiTemplateItem[]> | undefined
  preview: string | null
  onPreview: (id: string) => void
  onEdit: (t: VisibleTemplate) => void
  onAssign?: (t: VisibleTemplate) => void
  onDelete?: (t: VisibleTemplate) => void
  /** Which row has the paste box open, so it opens where it was asked for. */
  assigningId?: string | null
  fy?: string
  onCloseAssign?: () => void
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
                  {/* Wraps rather than truncates: with two buttons beside
                      it on a narrow screen, "Biomedical Engineer" was
                      being shown as "Biomedical En…". */}
                  <p className="font-medium text-ink-900">{t.name}</p>
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
                  {/*
                    How many people are on it, which is the fact that
                    turns an edit from a correction into an event. Said
                    plainly and only when it is not nought: "0 people" on
                    a template written five minutes ago is noise.
                  */}
                  {Number(t.in_use) > 0 && (
                    <p className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600">
                      <Users className="h-3 w-3 text-ink-400" />
                      {/* Two numbers when they differ, because they mean
                          different things: an edit reaches all 250, and
                          132 of them are this manager's problem. */}
                      {Number(t.on_my_team) > 0 && Number(t.on_my_team) < Number(t.in_use)
                        ? `${t.on_my_team} of your team · ${t.in_use} in all`
                        : `${t.in_use} ${Number(t.in_use) === 1 ? 'person' : 'people'} on this`}
                    </p>
                  )}
                </button>

                <div className="flex shrink-0 gap-1.5">
                  {onAssign && (
                    <button
                      onClick={() => onAssign(t)}
                      className="btn-primary !px-2.5 !py-1.5 text-xs"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Assign to
                    </button>
                  )}
                  <button
                    onClick={() => onEdit(t)}
                    className="btn-secondary !px-2.5 !py-1.5 text-xs"
                  >
                    {/* "Keep my own" was a label nobody could act on —
                        the first question asked of it was what it meant.
                        It copies somebody else's rows into a new
                        template of your own, so that is what it says. */}
                    {t.is_mine
                      ? <><Pencil className="h-3.5 w-3.5" /> Edit</>
                      : <><Copy className="h-3.5 w-3.5" /> Copy to mine</>}
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

              {/* Under the row it belongs to, not at the foot of the
                  page: the panel opened three templates away from the
                  button that opened it, and the first thing anybody did
                  was scroll back up to check which one they had hit. */}
              {assigningId === t.id && fy && onCloseAssign && (
                <div className="border-t border-violet-200 bg-violet-50/40 p-3">
                  <AssignPanel template={t} fy={fy} onClose={onCloseAssign} />
                </div>
              )}

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
 * One shape several people are already on, and the box to name it.
 *
 * The name is pre-filled from what those people are mostly called,
 * because "Jr.Biomedical Engineer" is right forty-five times out of
 * forty-five and typing it is the only work left. Editable, since the
 * one case it gets wrong is a group of eleven engineers and one
 * district in-charge.
 */
function SharedGroupCard({ group, fy }: { group: SharedKpiGroup; fy: string }) {
  const name = useNameSharedKpi()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)

  /*
    No box to type the name in.

    It already has one, taken from the job those people do, and it is
    right nearly every time — offering an empty-looking text field asks
    somebody to reconsider a decision that has already been made well.
    Renaming lives where renaming lives: Edit, on the template itself,
    afterwards.
  */
  const value = group.suggested_name

  const run = async () => {
    setError(null)
    try {
      const out = await name.mutateAsync({ shape: group.shape, name: value, fy })
      setDone(out.people)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not name that one.')
    }
  }

  if (done !== null) {
    return (
      <div className="card flex items-center gap-2.5 border-emerald-200 bg-emerald-50/40 p-4">
        <Check className="h-4 w-4 shrink-0 text-emerald-600" />
        <p className="text-sm text-ink-700">
          <span className="font-medium text-ink-900">“{value}”</span> now covers{' '}
          {done} {done === 1 ? 'person' : 'people'}. It is in Mine, below.
        </p>
      </div>
    )
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="font-medium text-ink-900">
          {group.people} people on the same {group.row_count}-row KPI
        </p>
        {group.designations && (
          <p className="text-xs text-ink-500">{group.designations}</p>
        )}
      </div>
      {group.examples && (
        <p className="text-xs text-ink-400">e.g. {group.examples}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={run} disabled={name.isPending} className="btn-primary">
          {name.isPending ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          Call it “{value}”
        </button>
        <span className="text-xs text-ink-400">
          Rename it later with Edit. Nobody's rows change.
        </span>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
    </div>
  )
}

/**
 * How far back a change reaches.
 *
 * The same three choices wherever a template meets a month, because it
 * is the same question: assigning one to somebody who already has a KPI
 * and editing one twenty-three people carry differ only in how many
 * people are on the other end.
 *
 * Radio buttons rather than a dropdown. Two of the three rewrite a month
 * somebody has already been scored on, and a choice with that in it
 * should be read rather than opened.
 */
const REACH: Array<{ key: TemplateReach; label: string; what: string }> = [
  {
    key: 'forward',
    label: 'From now on',
    what: 'Months not filed in yet take the new rows. Anything submitted, '
      + 'scored or finalised keeps exactly what it was assessed on.',
  },
  {
    key: 'keep',
    label: 'All months, keep the figures',
    what: 'Every month takes the new rows. What people typed stays wherever '
      + 'the KRA is still there, and the scores are worked out again.',
  },
  {
    key: 'clean',
    label: 'All months, start clean',
    what: 'Every month takes the new rows with nothing filled in. Use this '
      + 'when the KPI was wrong from April and the figures against it were '
      + 'measuring the wrong thing.',
  },
]

function ReachChoice({
  value, onChange, name,
}: {
  value: TemplateReach
  onChange: (v: TemplateReach) => void
  /** Unique per instance, or two panels share one radio group. */
  name: string
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="label !mb-1">How far back</legend>
      {REACH.map(r => (
        <label
          key={r.key}
          className={clsx(
            'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5',
            value === r.key
              ? 'border-violet-300 bg-violet-50/60'
              : 'border-ink-200 hover:bg-ink-50',
          )}
        >
          <input
            type="radio"
            name={name}
            checked={value === r.key}
            onChange={() => onChange(r.key)}
            className="mt-0.5 shrink-0"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink-900">{r.label}</span>
            <span className="mt-0.5 block text-xs leading-snug text-ink-500">{r.what}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/**
 * Handing a template to a list of people.
 *
 * A paste box rather than a picker of checkboxes, because the list
 * already exists somewhere else: in a WhatsApp message, a column of an
 * Excel sheet, an email from HR. Twelve codes pasted in one go is the
 * whole job; twelve checkboxes hunted down a list of two hundred is
 * somebody's afternoon.
 *
 * Separators are not the person's problem — commas, spaces, newlines,
 * tabs, semicolons, any mixture — and the prefix is kept because E, CT
 * and FTC are all real codes.
 *
 * What comes back is per code, never a single failure. A list of twenty
 * with one typo in it assigns nineteen and says which one was wrong,
 * because the alternative is somebody re-pasting the whole list to find
 * out.
 */
function AssignPanel({
  template, fy, onClose,
}: {
  template: VisibleTemplate
  fy: string
  onClose: () => void
}) {
  const apply = useApplyTemplate()
  const [pasted, setPasted] = useState('')
  const [reach, setReach] = useState<TemplateReach>('forward')
  const [out, setOut] = useState<AssignOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  const codes = useMemo(() => parseEcodes(pasted), [pasted])

  const run = async () => {
    setError(null)
    try {
      setOut(await apply.mutateAsync({ templateId: template.id, codes, fy, reach }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign that.')
    }
  }

  const kept = (out?.results ?? []).filter(r => r.status !== 'skipped')
  const missed = (out?.results ?? []).filter(r => r.status === 'skipped')
  const filed = kept.reduce((a, r) => a + (r.filed_months ?? 0), 0)

  return (
    <div className="card space-y-3 border-violet-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-ink-900">
            Assign “{template.name}” to your team
          </p>
          <p className="mt-0.5 text-sm text-ink-500">
            Paste their employee codes — commas, spaces or one per line, it
            does not matter.
          </p>
        </div>
        <button onClick={onClose} className="btn-icon shrink-0" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!out && (
        <>
          <textarea
            className="input min-h-24 font-mono text-sm"
            value={pasted}
            onChange={e => setPasted(e.target.value)}
            placeholder={'E1234, CT616\nFTC23'}
            aria-label="Employee codes"
            autoFocus
          />
          {/* Only matters for the ones who already have a KPI — a new
              joiner has no month to reach back into — and a mixed list
              is the normal case, so it is always asked. */}
          <ReachChoice value={reach} onChange={setReach} name={`reach-${template.id}`} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={run}
              disabled={codes.length === 0 || apply.isPending}
              className="btn-primary"
            >
              {apply.isPending ? <Spinner className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {codes.length === 0
                ? 'Paste some codes'
                : `Assign to ${codes.length} ${codes.length === 1 ? 'person' : 'people'}`}
            </button>
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            {codes.length > 0 && (
              <span className="text-xs text-ink-400">
                {codes.slice(0, 6).join(', ')}{codes.length > 6 && ` +${codes.length - 6} more`}
              </span>
            )}
          </div>
          {/* Said before pressing, not after: this is live the moment it
              runs, and a manager assigning to their own team is the
              person who would have approved it anyway. */}
          <p className="text-xs text-ink-400">
            Their KPI goes live straight away — no second approval, since it
            would be yours to give. Months already filed keep the KPI they
            were assessed on.
          </p>
        </>
      )}

      {error && <Alert kind="error">{error}</Alert>}

      {out && (
        <div className="space-y-3">
          <p className="text-sm text-ink-700">
            <span className="font-medium text-ink-900">{out.assigned}</span>
            {out.assigned === 1 ? ' person is' : ' people are'} on “{out.template}”
            {out.skipped > 0 && `, ${out.skipped} skipped`}.
            {filed > 0 && ` ${filed} month${filed === 1 ? '' : 's'} already filed kept what ${
              kept.length === 1 ? 'it' : 'they'} were assessed on.`}
          </p>

          {kept.length > 0 && (
            <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
              {kept.map(r => (
                <li key={r.code} className="flex items-center gap-2 px-3 py-2 text-sm">
                  {r.status === 'assigned'
                    ? <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                    : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />}
                  <span className="min-w-0 flex-1 truncate text-ink-800">
                    {r.name ?? r.code}
                    <span className="ml-1.5 text-xs text-ink-400">{r.code}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-ink-500">
                    {r.detail ?? (
                      <>
                        {r.was === 'new' ? 'new KPI' : 'replaced'}
                        {r.replaced && ` “${r.replaced}”`}
                        {' · from '}{r.starts_from}
                        {Number(r.kept_own_rows) > 0 && (
                          <span className="block text-amber-700">
                            {r.kept_own_rows} filed month
                            {Number(r.kept_own_rows) === 1 ? '' : 's'} kept its own rows
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {missed.length > 0 && (
            <ul className="divide-y divide-cyrixRed-100 rounded-lg border border-cyrixRed-200 bg-cyrixRed-50/40">
              {missed.map(r => (
                <li key={r.code} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <X className="h-4 w-4 shrink-0 text-cyrixRed-600" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-800">
                    {r.code}
                  </span>
                  <span className="shrink-0 text-xs text-cyrixRed-700">{r.detail}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setOut(null); setPasted('') }} className="btn-secondary">
              Assign to more
            </button>
            <button onClick={onClose} className="btn-primary">Done</button>
          </div>
        </div>
      )}
    </div>
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
  initial: { id: string | null; name: string; rows: Draft[]; inUse?: number }
  existing: Array<{ id: string; name: string; rows: ComparableRow[] }>
  onCancel: () => void
  onSaved: (name: string) => void
}) {
  const save = useSaveTemplate()
  const push = usePushTemplate()
  const { data: rules } = useScoringRules()
  const [name, setName] = useState(initial.name)
  const [rows, setRows] = useState<Draft[]>(initial.rows)
  const [error, setError] = useState<string | null>(null)
  /*
    Editing something people are already carrying is a different act
    from writing a new one, and it asks a question first.

    Nought here covers both the new template and the one nobody has
    taken yet, and neither needs asking: there is no month on the other
    end of it.
  */
  const inUse = Number(initial.inUse ?? 0)
  const [reach, setReach] = useState<TemplateReach>('forward')
  const [asking, setAsking] = useState(false)
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

  /** The rows, in the shape both the save and the push RPCs take. */
  const payload = () =>
    named.map(({ _key, _inferred, section, sort_order, ...r }) => {
      void _key; void _inferred; void section; void sort_order
      return {
        ...r,
        kpi_description: r.kpi_description?.trim() || null,
        alternates: r.alternates.filter(a => a.kra.trim() !== ''),
      }
    })

  const onSave = async () => {
    setError(null)
    if (duplicate && !dupAccepted) { setDupAccepted(true); return }

    // People on it: ask how far the change goes before it goes anywhere.
    if (inUse > 0 && initial.id && !asking) { setAsking(true); return }

    if (inUse > 0 && initial.id) {
      try {
        const out = await push.mutateAsync({
          templateId: initial.id, name, rows: payload(), reach,
        })
        onSaved(
          `${name.trim()}” — ${out.people} ${out.people === 1 ? 'person' : 'people'}, `
          + `${out.months} month${out.months === 1 ? '' : 's'} updated. Your manager has been told.“`,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not push that change.')
      }
      return
    }

    try {
      await save.mutateAsync({
        name,
        fy,
        templateId: initial.id,
        // Blank alternatives are dropped rather than saved: one with no
        // KRA is a row nobody can pick in a month, and it would come
        // back as a choice on every KPI made from this.
        rows: payload(),
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

      {asking && (
        <div className="card space-y-3 border-violet-300 p-4">
          <div>
            <p className="font-medium text-ink-900">
              {inUse} {inUse === 1 ? 'person is' : 'people are'} on this template
            </p>
            <p className="mt-0.5 text-sm text-ink-500">
              Changing a weightage here changes {inUse === 1 ? 'their' : 'their'} year.
              Your manager is told either way — they see the change and how many
              people it moved.
            </p>
          </div>
          <ReachChoice value={reach} onChange={setReach} name="reach-edit" />
          <div className="flex flex-wrap gap-2">
            <button onClick={onSave} disabled={push.isPending} className="btn-primary">
              {push.isPending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              Save and apply
            </button>
            <button onClick={() => setAsking(false)} className="btn-secondary">
              Back to the rows
            </button>
          </div>
        </div>
      )}

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
