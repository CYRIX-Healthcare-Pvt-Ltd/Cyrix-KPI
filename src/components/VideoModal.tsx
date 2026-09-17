import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { ManualVideo } from '@/lib/manualVideos'

/**
 * A how-to video, played over the manual.
 *
 * Over the page rather than in a new tab, so the section somebody was
 * reading is still there when the video ends. It closes with the cross,
 * Escape, or a tap on the dark around it — and closing stops it, because
 * the element goes with the dialog.
 */
export default function VideoModal({
  video, title, note, closeLabel, onClose,
}: {
  video: ManualVideo
  title: string
  /** Shown under the player — that the captions are English, when the manual is not. */
  note?: string | null
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
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-shade/80 p-3 sm:p-6"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-5xl overflow-hidden rounded-2xl bg-shade shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <p className="truncate text-sm font-semibold text-white">{title}</p>
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
        {note && <p className="px-4 py-2 text-xs text-white/60">{note}</p>}
      </div>
    </div>,
    document.body,
  )
}
