import { Link } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarCheck, CheckSquare, ClipboardList,
  MessageSquare, ShieldAlert, Timer, Trash2, Users, HelpCircle,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTatPolicy } from '@/lib/queries'

/**
 * What this person can do, in plain words.
 *
 * Written for somebody who has just been handed a login and does not
 * know what the app is for — which on a service floor is most people,
 * most of the time, in their second language. Short sentences. One idea
 * a line. No word doing two jobs.
 *
 * Two things make it a manual worth having rather than a page nobody
 * reads:
 *
 *   It is about YOU. The sections come from the same role flags the
 *   navigation uses, so a service engineer is never told about
 *   approving KPIs and HR is never told to submit one. A manual that
 *   describes everybody describes nobody.
 *
 *   It links. Every point ends where the thing actually happens, so
 *   reading it and doing it are the same gesture. A step that only
 *   names a screen is a step somebody has to go hunting for.
 *
 * The rules at the bottom are the ones people get caught by — the
 * questions that get asked out loud. They are stated once, here, and
 * the numbers in them come from the live settings rather than from
 * something typed into this file that will quietly go stale.
 */

interface Point {
  what: string
  how: string
  to?: string
  cta?: string
}

function Section({
  icon: Icon, title, lead, points,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  lead?: string
  points: Point[]
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <Icon className="h-4 w-4 text-ink-400" />
        <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
      </div>
      <div className="p-4">
        {lead && <p className="mb-3 text-sm text-ink-500">{lead}</p>}
        <ul className="space-y-3">
          {points.map(p => (
            <li key={p.what}>
              <p className="text-sm font-medium text-ink-900">{p.what}</p>
              <p className="mt-0.5 text-sm text-ink-600">{p.how}</p>
              {p.to && (
                <Link
                  to={p.to}
                  className="link-accent mt-1 inline-flex items-center gap-1 text-sm font-medium"
                >
                  {p.cta ?? 'Go there'} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default function Help() {
  const { employee, isManager, isHrAdmin, isSwAdmin } = useAuth()
  const { data: policy } = useTatPolicy()

  const tmDays = policy?.tm_grace_days ?? 3
  const mgrDays = policy?.manager_grace_days ?? 5

  // HR administers the system rather than being appraised by it, and SW
  // Admin only handles logins. Neither has a KPI, so neither is told how
  // to submit one.
  const appraised = !isHrAdmin && !(isSwAdmin && !isHrAdmin)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          to="/me"
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back to my profile
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight text-ink-900">
          <BookOpen className="h-6 w-6 text-cyrixRed-600" />
          What I can do
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {employee?.full_name} · {employee?.ecode}
          {isHrAdmin && ' · HR Admin'}
          {isSwAdmin && ' · SW Admin'}
          {!isHrAdmin && !isSwAdmin && isManager && ' · Reporting manager'}
        </p>
      </div>

      <div className="rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm text-ink-600">
        This page only lists what <strong>your</strong> login can do. If a
        colleague can see something you cannot, it is because their job is
        different, not because something is broken.
      </div>

      {appraised && (
        <>
          <Section
            icon={ClipboardList}
            title="1. Your KPI for the year"
            lead="This is the list of things you are measured on. It is agreed once a year."
            points={[
              {
                what: 'Write your KPI',
                how: 'List your job role targets. Job role is 80 marks. Core values is the other 20. If you also have ESMS, core values becomes 15 and ESMS is 5.',
                to: '/my-kpi', cta: 'Open my KPI',
              },
              {
                what: 'Send it to your manager',
                how: 'Your manager has to approve it. You cannot start any month until they do.',
              },
              {
                what: 'If it comes back',
                how: 'Your manager may send it back with a reason. Change it and send it again.',
              },
            ]}
          />

          <Section
            icon={CalendarCheck}
            title="2. Every month"
            lead="You do this once a month, for the month that has just finished."
            points={[
              {
                what: 'Enter what you achieved',
                how: 'Put the real number against each target. The app works out the score for you.',
                to: '/history', cta: 'Open assessments',
              },
              {
                what: 'Rate yourself on the core values',
                how: 'Five values. Pick a rating for each one.',
              },
              {
                what: 'Send it to your manager',
                how: `Try to send it within ${tmDays} days of the month ending. After that it counts as late.`,
              },
              {
                what: 'Your manager scores it',
                how: `They enter their own figure for each row. Your final score is the average of yours and theirs. They have ${mgrDays} days.`,
              },
            ]}
          />

          <Section
            icon={MessageSquare}
            title="3. If you do not agree with a score"
            lead="You do not have to just accept it. Ask."
            points={[
              {
                what: 'Raise a query',
                how: 'Open the month your manager has scored. Tick the rows you want looked at. Say for each one whether you want it explained, or you think it is wrong.',
                to: '/history', cta: 'Open assessments',
              },
              {
                what: 'Attach proof if you have it',
                how: 'A photo, a PDF or a sheet. Optional. It is deleted once the query is finished.',
              },
              {
                what: 'What happens next',
                how: 'Your manager is told straight away. The month cannot be closed until they reply. You will see their answer, and whether the score was changed.',
              },
            ]}
          />
        </>
      )}

      {isManager && !isHrAdmin && (
        <Section
          icon={Users}
          title={appraised ? '4. Because you have a team' : 'Your team'}
          lead="Everything above is still yours to do. These are extra."
          points={[
            {
              what: 'Approve their KPI',
              how: 'Nobody on your team can start a month until you approve their KPI for the year.',
              to: '/approvals', cta: 'Open approvals',
            },
            {
              what: 'Score their months',
              how: 'Enter your own figure against each row. You can also correct the target, because you are the one who knows the right number. Changing a target changes both scores.',
              to: '/team', cta: 'Open my team',
            },
            {
              what: 'Answer their queries',
              how: 'If someone questions a score, you get a tab and a badge. Reply, and change the score first if it needs changing. The month stays open until you do.',
              to: '/queries', cta: 'Open queries',
            },
            {
              what: 'See how the team is doing',
              how: 'Team analysis shows everybody ranked, with job role and core values separately. You can pick one month or the whole year, and download it.',
              to: '/team/analysis', cta: 'Open team analysis',
            },
            {
              what: 'Flag somebody who has left',
              how: 'Send it to HR. They deactivate the person. You cannot do it yourself.',
              to: '/team', cta: 'Open my team',
            },
          ]}
        />
      )}

      {isHrAdmin && (
        <Section
          icon={CheckSquare}
          title="What HR can do"
          lead="You run the system. You are not scored by it."
          points={[
            {
              what: 'See where everybody is',
              how: 'Who has a KPI, who has submitted, who has been scored, and how late each side is.',
              to: '/admin/reports', cta: 'Open reports',
            },
            {
              what: 'Manage employees',
              how: 'Reporting lines, departments and who is active.',
              to: '/admin/employees', cta: 'Open employees',
            },
            {
              what: 'Watch the queries',
              how: 'Every score somebody has questioned, and how it was answered. View only — the reporting manager answers it.',
              to: '/admin/queries', cta: 'Open queries',
            },
            {
              what: 'Decide record requests',
              how: 'Deleting a month, or reopening a KPI. The manager approves first, then you.',
              to: '/deletions', cta: 'Open records',
            },
            {
              what: 'Process leavers',
              how: 'A manager flags somebody who has resigned. You deactivate them.',
              to: '/admin/requests', cta: 'Open leavers',
            },
          ]}
        />
      )}

      {isSwAdmin && (
        <Section
          icon={ShieldAlert}
          title="What SW Admin can do"
          lead="You look after logins and timing. You cannot see anybody's scores."
          points={[
            {
              what: 'Fix a login',
              how: "Reset somebody's password back to their employee code. You cannot read a password — nobody can.",
              to: '/admin/logins', cta: 'Open logins',
            },
            {
              what: 'Set the timing rules',
              how: 'How many days each side gets before a month counts as late, and which month to start counting from.',
              to: '/admin/timing', cta: 'Open KPI timing',
            },
          ]}
        />
      )}

      <Section
        icon={HelpCircle}
        title="Things people ask"
        points={[
          {
            what: 'Why can I not open this month?',
            how: 'A month can only be assessed after it has finished. July opens on 1 August.',
          },
          ...(appraised ? [
            {
              what: 'Why can I not submit anything?',
              how: 'Your KPI for the year is probably not approved yet. Check with your manager.',
              to: '/my-kpi', cta: 'Check my KPI',
            },
            {
              what: 'I sent the wrong month in',
              how: 'Ask for it to be deleted. Your manager reviews it, then HR. Nothing is removed until both agree.',
            },
            {
              what: 'Can I query a score twice?',
              how: 'No. One query per month, so put everything into the one you raise.',
            },
          ] : []),
          {
            what: 'What do the colours mean?',
            how: 'Red is Poor, orange Satisfactory, amber Good, lime Very Good, green Excellent. Each score is coloured against what it was out of, not out of 100.',
          },
          {
            what: 'I forgot my password',
            how: 'Ask SW Admin to reset it. It goes back to your employee code.',
            to: '/change-password', cta: 'Change my password',
          },
        ]}
      />

      <div className="flex flex-wrap gap-2">
        <Link to="/me" className="btn-secondary btn-press">
          <ArrowLeft className="h-4 w-4" /> Back to my profile
        </Link>
        {isSwAdmin && (
          <Link to="/admin/timing" className="btn-secondary btn-press">
            <Timer className="h-4 w-4" /> KPI timing
          </Link>
        )}
        {isManager && !isHrAdmin && (
          <Link to="/deletions" className="btn-secondary btn-press">
            <Trash2 className="h-4 w-4" /> Records
          </Link>
        )}
      </div>
    </div>
  )
}
