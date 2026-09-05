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
import { StrictMode, useState } from 'react'
import clsx from 'clsx'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, NavLink } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Menu, LogOut, Bell } from 'lucide-react'
import { Logo } from './components/Logo'
import Avatar from './components/Avatar'
import ThemeToggle from './components/ThemeToggle'
import { ViewTeamButton } from './components/TeamDrill'
import { ScorePill, StatusBadge } from './components/ui'
import { ScoreHeader } from './components/analysis'
import { BANDS } from './lib/bands'
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
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:h-16">
        <button className="btn-icon lg:hidden" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2.5">
          <a href="/" className="btn-press flex items-center gap-2.5 rounded-lg py-1 pr-1">
            <Logo className="h-9 sm:h-11" />
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
      <Logo height={72} showTagline onDark />
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-label text-white/45">
          Cyrix Platform
        </p>
        <h2 className="mt-2 text-3xl font-bold leading-tight">
          One account.<br />Every Cyrix tool.
        </h2>
      </div>
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

/*
 * The manager's scoring row, and the core value beneath it.
 *
 * A COPY of the two blocks in ScoreSubmission.tsx, which is the thing
 * that can drift — change one, change the other. Same convention as the
 * header bar above: that is a copy of Shell.tsx's for the same reason.
 *
 * It is here because the real screen sits behind a manager sign-in, so
 * the one question nobody could answer was how these rows reflow on a
 * phone — where each field becomes its own row and the block grows a
 * textarea the moment a rating goes low. That is the layout most likely
 * to be wrong and was the only part of the scoring screen never looked
 * at.
 */
function ScoringRows() {
  const [rating, setRating] = useState('Satisfactory')
  const low = rating === 'Satisfactory' || rating === 'Poor'
  const tone = BANDS.find(b => b.label === rating)

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <p className="text-xs font-semibold uppercase tracking-label text-ink-400">
        Scoring row — four fields, one per cell above 640px
      </p>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">
            Job Role <span className="font-normal text-ink-500">— 80%</span>
          </h3>
        </div>
        <div className="divide-y divide-ink-100">
          {[
            { kra: 'Business/ Vertical growth', kpi: 'Revenue against the quarterly plan', wt: 40 },
            { kra: 'Salesforce Usage Compliance and KPI', kpi: 'Calls logged the same day', wt: 10 },
          ].map(r => (
            <div key={r.kra} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{r.kra}</p>
                  <p className="mt-0.5 text-sm text-ink-500">{r.kpi}</p>
                </div>
                <span className="badge bg-ink-100 text-ink-600">{r.wt}%</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="label text-xs">Target</label>
                  <input className="input" defaultValue="100" />
                </div>
                <div>
                  <label className="label text-xs">They claimed</label>
                  <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm tabular-nums text-ink-700">
                    96 <span className="ml-2 text-xs text-ink-400">= 38.40</span>
                  </p>
                </div>
                <div>
                  <label className="label text-xs">My value</label>
                  <input className="input" defaultValue="94" />
                </div>
                <div>
                  <label className="label text-xs">Score</label>
                  <div className="py-1.5">
                    <ScorePill value={37.6} outOf={r.wt} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs font-semibold uppercase tracking-label text-ink-400">
        Core value — the "why" box appears on Satisfactory and Poor
      </p>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">
            Alignment To Core Values <span className="font-normal text-ink-500">— 20%</span>
          </h3>
          {low && (
            <span className="badge shrink-0 bg-amber-200 text-amber-900">1 needs a reason</span>
          )}
        </div>
        <div className="divide-y divide-ink-100">
          <div className={clsx('p-4 sm:flex sm:items-center sm:gap-4', low && 'bg-amber-50/60')}>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink-900">Customer Delight</p>
              <p className="mt-0.5 text-sm text-ink-500">
                Responds effectively to negative feedback and appreciates team contributions.
              </p>
              {low && (
                <div className="mt-2">
                  <label
                    className={clsx('mb-1 block text-xs font-medium', tone?.accent ?? 'text-ink-700')}
                  >
                    Why {rating.toLowerCase()}? Kevin will see this.
                  </label>
                  <textarea
                    rows={2}
                    className="input text-sm"
                    placeholder="e.g. three reports went out with figures that had to be corrected"
                  />
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center gap-3 sm:mt-0">
              <select
                className={clsx('input w-44', low && 'border-amber-400 ring-1 ring-amber-300')}
                value={rating}
                onChange={e => setRating(e.target.value)}
              >
                <option value="">Choose a rating…</option>
                {['Excellent', 'Very Good', 'Good', 'Satisfactory', 'Poor'].map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/*
 * The score hero at every band, so the 1-5 rating chip can be checked
 * against the slab without an account.
 *
 * One per band and both sides of the two boundaries people will argue
 * about — 90 is a 4 and 90.1 is a 5; 60 is a 2 and 60.1 is a 3 — because
 * the chip is where anybody will notice if the slab and the words ever
 * disagree. The last row is the unscored case, which has no rating and
 * must not invent one.
 */
function ScoreHeaders() {
  const cases: Array<{ label: string; score: number | null }> = [
    { label: 'Excellent — 5', score: 94.2 },
    { label: 'On the 90 boundary — still a 4', score: 90 },
    { label: 'Just over it — a 5', score: 90.1 },
    { label: 'Very Good — 4', score: 84.7 },
    { label: 'Good — 3', score: 72.5 },
    { label: 'On the 60 boundary — a 2, not a 3', score: 60 },
    { label: 'Satisfactory — 2', score: 55.0 },
    { label: 'Poor — 1', score: 38.4 },
    { label: 'Nothing scored yet', score: null },
  ]
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      {cases.map(c => (
        <div key={c.label}>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-label text-ink-400">
            {c.label}
          </p>
          <ScoreHeader
            title="Hello, Kevin"
            subtitle="FY 2026-27 · reporting on Aug-26"
            score={c.score}
            scoreLabel="My year average"
          />
        </div>
      ))}
    </div>
  )
}

/*
 * The team list's row, at every band its View team button can wear.
 *
 * The button is tinted by the average of the team behind it, and the
 * thing that needs looking at is not one button but the column of them:
 * whether five tints are told apart at a glance while scrolling, whether
 * the tint survives the flip to dark, and whether it fights the score
 * pill two columns over — that pill is a filled chip off the same five
 * colours, and a row showing a person's 92 beside their team's 41 must
 * not read as one number contradicting itself.
 *
 * The last row is the case most rows are in today: a team nobody has
 * scored yet, which has no band and must stay grey rather than borrow
 * the bottom of the scale.
 */
function TeamButtons() {
  const rows = [
    { name: 'Nagasai Kiran Battikala', count: 41, own: 92.4, team: 94.1 },
    { name: 'Mayankkumar Rameshbhai Patel', count: 27, own: 71.5, team: 83.6 },
    { name: 'Raghwender Prasad', count: 14, own: 88.0, team: 67.2 },
    { name: 'Afsal Y', count: 9, own: 64.3, team: 48.9 },
    { name: 'Jerry Joseph', count: 6, own: 92.0, team: 31.4 },
    { name: 'Manoj Kumar Kumar I S', count: 3, own: null, team: null },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="card divide-y divide-ink-100 overflow-hidden">
        {rows.map(r => (
          <div key={r.name} className="flex items-center gap-3 p-4">
            <Avatar name={r.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink-900">{r.name}</p>
              <p className="truncate text-xs text-ink-500">E669 · Project Technical Manager</p>
            </div>
            <div className="w-10 shrink-0 sm:w-[124px]">
              <ViewTeamButton
                name={r.name}
                count={r.count}
                average={r.team}
                month="2026-07-01"
                onClick={() => {}}
              />
            </div>
            <div className="hidden w-36 shrink-0 text-right sm:block">
              <StatusBadge status={r.own === null ? null : 'scored'} />
            </div>
            <div className="w-24 shrink-0 text-right sm:w-32">
              <ScorePill value={r.own} size="sm" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Harness() {
  return (
    <div className="min-h-screen bg-canvas">
      <Header />
      <TeamButtons />
      <BrandPanel />
      <ScoringRows />
      <ScoreHeaders />
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
