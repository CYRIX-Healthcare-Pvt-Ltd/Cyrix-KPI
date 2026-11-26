import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Paperclip, X } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'

/** Excel, PDF, Word and photos; 10 MB together (the user, 2 Nov: per month, optional, kept for good). */
const ACCEPT = '.xlsx,.xls,.csv,.pdf,.doc,.docx,.jpg,.jpeg,.png'
const OK_NAME = /\.(xlsx|xls|csv|pdf|doc|docx|jpe?g|png)$/i
const LIMIT = 10 * 1024 * 1024
const BUCKET = 'kpi-month-files'

interface MonthFile { id: string; path: string; name: string; size_bytes: number }

const iconFor = (name: string) =>
  /\.(xlsx?|csv)$/i.test(name) ? <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-600" />
  : /\.(jpe?g|png)$/i.test(name) ? <ImageIcon className="h-5 w-5 shrink-0 text-sky-600" />
  : <FileText className="h-5 w-5 shrink-0 text-red-600" />

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

/**
 * The month's supporting files (0244). The employee adds and removes them while the month is
 * theirs; the manager and HR open them. `title` names whose they are on someone else's month.
 */
export default function MonthFiles({ submissionId, editable, title = 'Supporting files (optional, max 10 MB)' }: {
  submissionId: string
  editable: boolean
  title?: string
}) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = ['month_files', submissionId]
  const { data: files = [], isSuccess } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from('kpi_submission_files')
        .select('id, path, name, size_bytes').eq('submission_id', submissionId).order('uploaded_at')
      if (error) throw error
      return data as MonthFile[]
    },
  })
  const used = files.reduce((n, f) => n + f.size_bytes, 0)

  const add = async (picked: File[]) => {
    setError('')
    const wrong = picked.find(f => !OK_NAME.test(f.name))
    if (wrong) { setError(`${wrong.name}: only Excel, PDF, Word or photo files`); return }
    if (used + picked.reduce((n, f) => n + f.size, 0) > LIMIT) {
      setError(`All files together can be up to 10 MB (${size(LIMIT - used)} left)`); return
    }
    setBusy(true)
    try {
      for (const f of picked) {
        const ext = f.name.split('.').pop()!.toLowerCase()
        const path = `${submissionId}/${crypto.randomUUID()}.${ext}`
        const up = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined })
        if (up.error) throw up.error
        const { error } = await supabase.rpc('kpi_month_file_add', { p_sub: submissionId, p_path: path, p_name: f.name, p_size: f.size })
        if (error) { await supabase.storage.from(BUCKET).remove([path]); throw error }
      }
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
      void qc.invalidateQueries({ queryKey: key })
    }
  }

  const remove = async (f: MonthFile) => {
    setError('')
    const { data: path, error } = await supabase.rpc('kpi_month_file_remove', { p_id: f.id })
    if (error) { setError(friendlyError(error)); return }
    await supabase.storage.from(BUCKET).remove([path as string])
    void qc.invalidateQueries({ queryKey: key })
  }

  // Opened in a new tab from a link that lasts a minute; the file itself is never public.
  const open = async (f: MonthFile) => {
    const w = window.open('', '_blank')
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.path, 60, /\.(jpe?g|png|pdf)$/i.test(f.name) ? undefined : { download: f.name })
    if (error || !data) { w?.close(); setError(friendlyError(error)); return }
    if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl
  }

  // Nothing to show on a month that is no longer theirs to change and has no files.
  if (!editable && (!isSuccess || !files.length)) return null

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label !mb-0">
          {title}
          {editable && files.length > 0 && <span className="ml-2 normal-case tracking-normal text-ink-500">{size(used)} of 10 MB used</span>}
        </span>
        {editable && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />} Add files
          </button>
        )}
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden"
          onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) void add(f) }} />
      </div>
      {error && <p className="mt-2 text-sm text-cyrixRed-600" role="alert">{error}</p>}
      {files.length > 0 && (
        <ul className="mt-3 divide-y divide-ink-100 rounded-lg border border-ink-200">
          {files.map(f => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2">
              {iconFor(f.name)}
              <button type="button" className="min-w-0 flex-1 truncate text-left text-sm text-ink-800 hover:underline" onClick={() => void open(f)}>
                {f.name}
              </button>
              <span className="shrink-0 text-xs text-ink-500">{size(f.size_bytes)}</span>
              {editable && (
                <button type="button" className="btn-icon" aria-label={`Remove ${f.name}`} onClick={() => void remove(f)}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
