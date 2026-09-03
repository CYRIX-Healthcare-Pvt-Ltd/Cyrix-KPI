import { LifeBuoy } from 'lucide-react'
import SupportDeskQueue from '@/components/SupportDeskQueue'

/**
 * The HR desk.
 *
 * A page of its own rather than a tab inside another screen, because HR's
 * navigation is already a row of pages and this is one more of them —
 * unlike SW Admin, whose whole administration lives under one roof.
 *
 * Nothing here is about a score. The Queries tab beside it is where
 * scores are watched, and it is deliberately view-only: those are
 * answered by the reporting manager. This one HR answers.
 */
export default function HrSupport() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900">
          <LifeBuoy className="h-5 w-5 text-teal-600" />
          Support
        </h1>
        <p className="mt-0.5 text-sm text-ink-500">
          What people have asked HR — leave, attendance, records, policy. One
          answer closes each one.
        </p>
      </div>

      <SupportDeskQueue desk="hr" enabled />
    </div>
  )
}
