import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarCheck, CheckSquare, ClipboardList,
  MessageSquare, ShieldAlert, Timer, Trash2, Users, HelpCircle, UserRound,
  Languages,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTatPolicy, useMonthClose } from '@/lib/queries'
import { useLang, say, READY_LANGS, type Lang } from '@/lib/i18n'
import { HELP } from '@/lib/help-strings'
import { markHelpSeen } from '@/lib/seenHelp'

/**
 * What this person can do, in plain words.
 *
 * Written for somebody who has just been handed a login and does not
 * know what the app is for — which on a service floor is most people,
 * most of the time, in their second language. Short sentences. One idea
 * a line. No word doing two jobs.
 *
 * Three things make it a manual worth having rather than a page nobody
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
 *   It can be read in Malayalam. "Second language" is the whole premise
 *   of the writing above, and the honest conclusion of that premise is
 *   that plain English is still English. The words the software itself
 *   prints stay English inside the translated sentence — see i18n.ts —
 *   because the reader has to find them on a screen afterwards.
 *
 * Every word lives in help-strings.ts. Nothing user-facing is typed in
 * this file, so a sentence cannot exist in one language only.
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
  /**
   * Deliberately not translated: it names a button or a tab that is
   * itself in English. "Open my KPI" translated is a signpost pointing
   * at words that do not exist.
   */
  cta?: string
}

function Section({
  icon: Icon, tint, title, lead, points,
}: {
  icon: React.ComponentType<{ className?: string }>
  /**
   * The same colour language as the navigation: green where work gets
   * finished, amber where somebody is waiting, red where things are
   * taken away, neutral where you are only looking. A reader scanning
   * for "the bit about disagreeing with a score" finds the amber one.
   */
  tint: string
  title: string
  lead?: string
  points: Point[]
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <Icon className={clsx('h-4 w-4 shrink-0', tint)} />
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
  const [lang, setLang] = useLang()

  // Null is a real setting — no month closes on its own — so it is not
  // defaulted away. The manual has to describe whichever is switched on.
  const closingDay = useMonthClose().data ?? null
  const tmDays = policy?.tm_grace_days ?? 3
  const mgrDays = policy?.manager_grace_days ?? 5

  const t = (key: string, vars?: Record<string, string | number>) =>
    say(HELP[key], lang, vars)

  // Reaching this page is the whole point of the card on the dashboard,
  // so the card retires itself here rather than needing a dismiss.
  useEffect(markHelpSeen, [])

  // HR administers the system rather than being appraised by it, and SW
  // Admin only handles logins. Neither has a KPI, so neither is told how
  // to submit one.
  const appraised = !isHrAdmin && !(isSwAdmin && !isHrAdmin)

  return (
    // lang on the container, not the document: the navigation and the
    // rest of the app stay English whatever this is set to.
    <div lang={lang} className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          to="/me"
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" /> {t('page.back')}
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight text-ink-900">
          <BookOpen className="h-6 w-6 shrink-0 text-cyrixRed-600" />
          {t('page.title')}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {employee?.full_name} · {employee?.ecode}
          {isHrAdmin && ' · HR Admin'}
          {isSwAdmin && ' · SW Admin'}
          {!isHrAdmin && !isSwAdmin && isManager && ' · Reporting manager'}
        </p>
      </div>

      {/* Only the languages the manual is actually finished in. A picker
          offering Hindi and then rendering English reads as broken; not
          offering it reads as not added yet, which is the truth. */}
      {READY_LANGS.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500">
            <Languages className="h-4 w-4 text-ink-400" />
            {t('page.readIn')}
          </span>
          <div className="flex rounded-lg bg-ink-100 p-0.5" role="group">
            {READY_LANGS.map(l => (
              <button
                key={l.code}
                onClick={() => setLang(l.code as Lang)}
                aria-pressed={lang === l.code}
                className={clsx(
                  'btn-press rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  lang === l.code
                    ? 'bg-white text-ink-900 shadow-sm'
                    : 'text-ink-500 hover:text-ink-800',
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm text-ink-600">
        {t('page.scopeBefore')} <strong>{t('page.scopeStrong')}</strong>{' '}
        {t('page.scopeAfter')}
      </div>

      {appraised && (
        <>
          <Section
            icon={ClipboardList}
            tint="text-violet-600"
            title={t('s1.title')}
            lead={t('s1.lead')}
            points={[
              { what: t('s1.p1.what'), how: t('s1.p1.how'), to: '/my-kpi', cta: 'Open my KPI' },
              { what: t('s1.p2.what'), how: t('s1.p2.how'), to: '/my-kpi', cta: 'Open my KPI' },
              { what: t('s1.p3.what'), how: t('s1.p3.how'), to: '/my-kpi', cta: 'Open my KPI' },
              { what: t('s1.p4.what'), how: t('s1.p4.how') },
              { what: t('s1.p5.what'), how: t('s1.p5.how') },
            ]}
          />

          <Section
            icon={CalendarCheck}
            tint="text-emerald-600"
            title={t('s2.title')}
            lead={t('s2.lead')}
            points={[
              { what: t('s2.p1.what'), how: t('s2.p1.how'), to: '/history', cta: 'Open assessments' },
              { what: t('s2.p2.what'), how: t('s2.p2.how') },
              { what: t('s2.p3.what'), how: t('s2.p3.how', { tmDays }) },
              { what: t('s2.p4.what'), how: t('s2.p4.how', { mgrDays }) },
              { what: t('s2.p5.what'), how: t('s2.p5.how') },
              {
                what: t(closingDay === null ? 's2.p6.what.open' : 's2.p6.what.day'),
                how: t(closingDay === null ? 's2.p6.how.open' : 's2.p6.how.day',
                       { closingDay: closingDay ?? '' }),
              },
            ]}
          />

          <Section
            icon={MessageSquare}
            tint="text-amber-600"
            title={t('s3.title')}
            lead={t('s3.lead')}
            points={[
              {
                what: t('s3.p1.what'),
                how: `${t('s3.p1.how.base')} ${
                  closingDay === null
                    ? t('s3.p1.how.open')
                    : t('s3.p1.how.day', { closingDay })}`,
                to: '/history', cta: 'Open assessments',
              },
              { what: t('s3.p2.what'), how: t('s3.p2.how') },
              { what: t('s3.p3.what'), how: t('s3.p3.how'), to: '/history', cta: 'Open assessments' },
              { what: t('s3.p4.what'), how: t('s3.p4.how') },
              { what: t('s3.p5.what'), how: t('s3.p5.how') },
            ]}
          />
        </>
      )}

      {isManager && !isHrAdmin && (
        <Section
          icon={Users}
          tint="text-indigo-600"
          title={t(appraised ? 'team.title.num' : 'team.title.plain')}
          lead={t('team.lead')}
          points={[
            { what: t('team.p1.what'), how: t('team.p1.how'), to: '/approvals', cta: 'Open approvals' },
            { what: t('team.p2.what'), how: t('team.p2.how'), to: '/approvals', cta: 'Open approvals' },
            { what: t('team.p3.what'), how: t('team.p3.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p4.what'), how: t('team.p4.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p5.what'), how: t('team.p5.how'), to: '/queries', cta: 'Open queries' },
            { what: t('team.p6.what'), how: t('team.p6.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p7.what'), how: t('team.p7.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p8.what'), how: t('team.p8.how'), to: '/team/analysis', cta: 'Open team analysis' },
            { what: t('team.p9.what'), how: t('team.p9.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p10.what'), how: t('team.p10.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p11.what'), how: t('team.p11.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p12.what'), how: t('team.p12.how'), to: '/team', cta: 'Open my team' },
          ]}
        />
      )}

      {isHrAdmin && (
        <Section
          icon={CheckSquare}
          tint="text-emerald-600"
          title={t('hr.title')}
          lead={t('hr.lead')}
          points={[
            { what: t('hr.p1.what'), how: t('hr.p1.how'), to: '/admin/reports', cta: 'Open reports' },
            { what: t('hr.p2.what'), how: t('hr.p2.how'), to: '/admin/employees', cta: 'Open employees' },
            { what: t('hr.p3.what'), how: t('hr.p3.how'), to: '/admin/queries', cta: 'Open queries' },
            { what: t('hr.p4.what'), how: t('hr.p4.how'), to: '/deletions', cta: 'Open records' },
            { what: t('hr.p5.what'), how: t('hr.p5.how'), to: '/admin/requests', cta: 'Open leavers' },
          ]}
        />
      )}

      {isSwAdmin && (
        <Section
          icon={ShieldAlert}
          tint="text-cyrixRed-600"
          title={t('sw.title')}
          lead={t('sw.lead')}
          points={[
            { what: t('sw.p1.what'), how: t('sw.p1.how'), to: '/admin/logins', cta: 'Open logins' },
            { what: t('sw.p2.what'), how: t('sw.p2.how'), to: '/admin/timing', cta: 'Open KPI timing' },
          ]}
        />
      )}

      {/* Everyone, whatever their role — HR and SW Admin have a profile
          and a photo like anybody else, even though neither is scored. */}
      <Section
        icon={UserRound}
        tint="text-sky-600"
        title={t('prof.title')}
        lead={t('prof.lead')}
        points={[
          { what: t('prof.p1.what'), how: t('prof.p1.how'), to: '/me', cta: 'Open my profile' },
          { what: t('prof.p2.what'), how: t('prof.p2.how') },
          { what: t('prof.p3.what'), how: t('prof.p3.how'), to: '/change-password', cta: 'Change my password' },
          ...(appraised
            ? [{ what: t('prof.p4.what'), how: t('prof.p4.how'), to: '/me', cta: 'Open my profile' }]
            : []),
        ]}
      />

      <Section
        icon={HelpCircle}
        tint="text-ink-400"
        title={t('ask.title')}
        points={[
          { what: t('ask.p1.what'), how: t('ask.p1.how') },
          ...(appraised ? [
            { what: t('ask.p2.what'), how: t('ask.p2.how'), to: '/my-kpi', cta: 'Check my KPI' },
            { what: t('ask.p3.what'), how: t('ask.p3.how'), to: '/my-kpi', cta: 'Open my KPI' },
            { what: t('ask.p4.what'), how: t('ask.p4.how') },
            { what: t('ask.p5.what'), how: t('ask.p5.how'), to: '/history', cta: 'Open assessments' },
            { what: t('ask.p6.what'), how: t('ask.p6.how') },
            { what: t('ask.p7.what'), how: t('ask.p7.how') },
          ] : []),
          { what: t('ask.p8.what'), how: t('ask.p8.how') },
          { what: t('ask.p9.what'), how: t('ask.p9.how') },
          { what: t('ask.p10.what'), how: t('ask.p10.how'), to: '/', cta: 'Open dashboard' },
          { what: t('ask.p11.what'), how: t('ask.p11.how') },
          { what: t('ask.p12.what'), how: t('ask.p12.how'), to: '/change-password', cta: 'Change my password' },
        ]}
      />

      <div className="flex flex-wrap gap-2">
        <Link to="/me" className="btn-secondary btn-press">
          <ArrowLeft className="h-4 w-4" /> {t('page.back')}
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
