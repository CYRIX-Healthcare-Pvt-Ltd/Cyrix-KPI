import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

/**
 * A draft Cyrix Digest post as people will see it, before it is posted (the user, 12 Oct:
 * "need a preview for all mode of digests so user can see how it will look in user page").
 *
 * The portal draws it — the same cards and the same opened view as its home page, at
 * /?digest-preview — so the preview cannot drift from the real thing. The draft goes to
 * the frame by postMessage when it says it is ready, and again on every change.
 */
export interface PreviewPost {
  kind: string; title: string; body: string; image_url: string | null; color: string
  meet_at: string | null; meet_minutes: number | null; meet_link: string | null; meet_place: string | null
  posted_as: 'hr' | 'it' | 'mkt'; author: string | null; created_at: string
  likes: number; liked: boolean; comments: number
  vac_location: string | null; apply_by: string | null; apply_link: string | null
}

/** The portal: the same site in production; its dev server locally (the KPI one is a different origin). */
const PORTAL = import.meta.env.DEV ? 'http://localhost:5176' : ''

export default function DigestPreview({ post, options, multi, closes, questions = [], onClose }: {
  post: PreviewPost
  options: string[]
  /** A form's questions (0181). */
  questions?: Array<{ label: string; qtype: string; options: string[]; required: boolean }>
  multi: boolean
  closes: string | null
  onClose: () => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const send = () => frame.current?.contentWindow?.postMessage(
    { type: 'cyrix-digest-preview', post: { ...post, id: 'preview' }, options, multi, closes, questions }, PORTAL || window.location.origin)

  useEffect(() => {
    const ready = (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === 'cyrix-digest-preview-ready') send() }
    window.addEventListener('message', ready)
    return () => window.removeEventListener('message', ready)
  })
  // Every change, live.
  useEffect(send)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex h-full max-h-[52rem] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-ink-200 bg-surface shadow-2xl" role="dialog" aria-modal="true" aria-label="Preview">
        <div className="flex items-center justify-between border-b border-ink-200 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-900">Preview</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <iframe ref={frame} title="Preview" src={`${PORTAL}/?digest-preview`} className="h-full w-full flex-1 border-0" />
      </div>
    </div>
  )
}
