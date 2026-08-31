/*
 * Layout harness — `npm run dev`, then /kpi/harness.html.
 *
 * The header only exists behind a sign-in, so its spacing could not be
 * measured locally without an account. This renders it on its own.
 *
 * The bar is a *copy* of Shell.tsx's, which is the thing that can drift —
 * change one, change the other. Real Avatar, real ThemeToggle, real
 * stylesheet, invented data.
 *
 * Vite builds index.html only, so none of this ships.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, NavLink } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Menu, LogOut, Bell } from 'lucide-react'
import { Logo } from './components/Logo'
import Avatar from './components/Avatar'
import ThemeToggle from './components/ThemeToggle'
import { BulkAssign } from './pages/admin/SwAdmin'
import SpareFields from './pages/admin/SpareFields'
import './index.css'

/* A 1x1 JPEG stands in for the base64 photo carried on the employee row —
   square, like every avatar the app produces (AVATAR_SIZE is 128). */
const PHOTO =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL' +
  'DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA' +
  'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQID' +
  'AAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpT' +
  'VFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcI' +
  'CQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk' +
  'NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOU' +
  'lZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oA' +
  'DAMBAAIRAxEAPwD3+iiigD//2Q=='

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-200 bg-surface">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <button className="btn-icon lg:hidden" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2.5">
          <a href="/" className="btn-press flex items-center gap-2.5 rounded-lg py-1 pr-1">
            <Logo className="h-[17px] sm:h-6" showSubtitle={false} />
          </a>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
          <NavLink
            to="/me"
            className="nav-profile btn-press flex items-center gap-3 rounded-lg py-1 pl-2 pr-1"
            aria-label="My profile"
          >
            <span className="hidden text-right lg:block">
              <span className="block text-sm font-medium leading-tight text-ink-900">Saranya K</span>
              <span className="block text-xs leading-tight text-ink-500">E1042</span>
            </span>
            <Avatar name="Saranya K" src={PHOTO} size="header" />
          </NavLink>
          <ThemeToggle />
          <button className="btn-icon" aria-label="Notifications">
            <Bell className="h-4.5 w-4.5 text-amber-500" />
          </button>
          <button className="btn-icon" aria-label="Sign out">
            <LogOut className="h-4.5 w-4.5 text-cyrixRed-600" />
          </button>
        </div>
      </div>
    </header>
  )
}

/*
 * The portal's sign-in panel, rebuilt here because that is the shape that
 * broke the mark: a *column* flex container, where a flex item's cross
 * axis is its width. The logo stretched to the panel, and with a definite
 * height the aspect ratio was then ignored — so the image inside rendered
 * many times too tall and the wrapper clipped it to a sliver of one
 * letter. Kept as a regression case.
 */
function BrandPanel() {
  return (
    <div
      className="flex flex-col justify-between bg-shade p-8 text-white"
      style={{ height: 360 }}
    >
      <Logo height={30} showSubtitle={false} onDark />
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-label text-white/45">
          Cyrix Platform
        </p>
        <h2 className="mt-2 text-3xl font-bold leading-tight">
          One account.<br />Every Cyrix tool.
        </h2>
      </div>
      <p className="text-xs text-white/40">India Operations</p>
    </div>
  )
}

/*
 * The bulk-upload panel, with its callbacks stubbed. It is the one part
 * of SW Admin that is pure presentation, so it can be looked at without
 * an account — the preview table inside a scroll box and the button row
 * under it are exactly the shapes that have gone wrong before.
 */
function UploadPanel() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      {/* The custom fields editor, which talks to the real table — so on
          a machine with database access this shows real rows, and on one
          without it shows the empty state. Either way the chrome is
          checkable without signing in. */}
      <SpareFields />
      <BulkAssign<string>
        title="Assign roles from a sheet"
        help="Two columns: the employee code, and the role."
        templateName="harness.xlsx"
        templateHeaders={['Employee Code', 'Role']}
        templateExamples={[{ 'Employee Code': 'CT655', Role: 'Engineer' }]}
        parseRow={() => ({ ecode: 'CT655', value: 'engineer' })}
        describe={v => v}
        apply={async () => ({ changed: 0, missing: [] })}
        onClose={() => {}}
      />
    </div>
  )
}

function Harness() {
  return (
    <div className="min-h-screen bg-canvas">
      <Header />
      <BrandPanel />
      <UploadPanel />
      <div className="mx-auto max-w-7xl space-y-3 p-4">
        {['Jul-26 status', 'Jul-26 score', 'Months scored', 'Job role / core values'].map(t => (
          <div key={t} className="card p-5">
            <p className="text-sm text-ink-500">{t}</p>
            <p className="text-2xl font-semibold text-ink-900">93.20</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// SpareFields is a react-query consumer, so it needs a client. `retry:
// false` so a machine with no database access shows the empty state at
// once rather than three failed attempts' worth of spinner.
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>
  </StrictMode>,
)
