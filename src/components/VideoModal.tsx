import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, X } from 'lucide-react'
import type { ManualVideo } from '@/lib/manualVideos'

/**
 * A how-to video, played over the manual.
 *
 * Over the page rather than in a new tab, so the section somebody was
 * reading is still there when the video ends. It closes with the cross,
 * Escape, or a tap on the dark around it — and closing stops it, because
 * the element goes with the dialog.
 *
 * Each video ends by naming the next one, so the next one is a button
 * here: the series can be watched straight through without closing.
 */
export default function VideoModal({
  video, part, title, note, next, closeLabel, onClose,
}: {
  video: ManualVideo
  /** "Video 2 of 4", as its title card says — only when all four are the reader's. */
  part: string | null
  title: string
  /** Shown under the player — that the captions are English, when the manual is not. */
  note?: string | null
  next?: { label: string; play: () => void } | null
  closeLabel: string
  onClose: () => void
}) {
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeButton.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      opener?.focus?.()
    }
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={part ? `${part} · ${title}` : title}
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-shade/80 p-3 sm:p-6"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-5xl overflow-hidden rounded-2xl bg-shade shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <p className="truncate text-sm font-semibold text-white">
            {part && <span className="text-white/60">{part} · </span>}{title}
          </p>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="btn-press grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <video
          key={video.id}
          src={video.file}
          poster={video.poster}
          controls
          autoPlay
          playsInline
          preload="metadata"
          className="aspect-video w-full bg-black"
        />
        {(note || next) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
            {note && <p className="text-xs text-white/60">{note}</p>}
            {next && (
              <button
                type="button"
                onClick={next.play}
                className="btn-press ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white"
              >
                {next.label} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
