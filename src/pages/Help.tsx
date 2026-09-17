import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarCheck, CheckSquare, ClipboardList,
  MessageSquare, ShieldAlert, Users, HelpCircle, LifeBuoy, UserRound, Scale,
  Languages, MessageCircle, Play, PlayCircle,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTatPolicy, useMonthClose } from '@/lib/queries'
import { useLang, say, READY_LANGS, type Lang } from '@/lib/i18n'
import { HELP } from '@/lib/help-strings'
import { markHelpSeen } from '@/lib/seenHelp'
import { MANUAL_VIDEOS, VIDEO_SERIES, videosFor, nextVideo, type ManualVideo } from '@/lib/manualVideos'
import VideoModal from '@/components/VideoModal'

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
  /** A how-to video for this point, played over the page. */
  video?: ManualVideo
}

/** What a Watch video button needs from the page. */
interface Watch {
  label: string
  play: (video: ManualVideo) => void
}

function Section({
  icon: Icon, tint, title, lead, points, video, watch,
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
  /** A video for the whole section, on its heading. */
  video?: ManualVideo
  watch?: Watch
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <Icon className={clsx('h-4 w-4 shrink-0', tint)} />
        <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
        {video && watch && (
          <button
            type="button"
            onClick={() => watch.play(video)}
            className="btn-secondary btn-press ml-auto !px-2.5 !py-1 text-xs"
          >
            <PlayCircle className="h-4 w-4 text-cyrixRed-600" />
            {watch.label} · {video.duration}
          </button>
        )}
      </div>
      <div className="p-4">
        {lead && <p className="mb-3 text-sm text-ink-500">{lead}</p>}
        <ul className="space-y-3">
          {points.map(p => (
            <li key={p.what}>
              <p className="text-sm font-medium text-ink-900">{p.what}</p>
              <p className="mt-0.5 text-sm text-ink-600">{p.how}</p>
              {(p.to || (p.video && watch)) && (
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {p.to && (
                    <Link
                      to={p.to}
                      className="link-accent inline-flex items-center gap-1 text-sm font-medium"
                    >
                      {p.cta ?? 'Go there'} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                  {p.video && watch && (
                    <button
                      type="button"
                      onClick={() => watch.play(p.video!)}
                      className="link-accent inline-flex items-center gap-1 text-sm font-medium"
                    >
                      <PlayCircle className="h-4 w-4 text-cyrixRed-600" />
                      {watch.label} · {p.video.duration}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/**
 * The videos for this person's part of the year, first, in order.
 *
 * Only the steps they do: a team member gets setting up their KPI and
 * filling in a month, not the manager's two. Somebody who does both sides
 * gets all four, numbered as the title cards number them, with the team
 * member's part down the left and the manager's down the right. Anybody
 * else gets no numbers — "Video 3 of 4" beside a list of two is how parts
 * 2 and 4 came to be asked for.
 */
function VideoSeries({ videos, title, lead, partLabel, whoLabel, titleOf, play }: {
  videos: ManualVideo[]
  title: string
  lead: string
  /** "Video 2 of 4", or null where the numbers would point at videos not shown. */
  partLabel: ((v: ManualVideo) => string) | null
  whoLabel: ((v: ManualVideo) => string) | null
  titleOf: (v: ManualVideo) => string
  play: (v: ManualVideo) => void
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <PlayCircle className="h-4 w-4 shrink-0 text-cyrixRed-600" />
        <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
      </div>
      <div className="p-4">
        <p className="mb-3 text-sm text-ink-500">{lead}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {videos.map(v => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => play(v)}
                className="btn-press group flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-ink-50"
              >
                <span className="relative w-28 shrink-0 overflow-hidden rounded-lg bg-shade">
                  <img
                    src={v.poster}
                    alt=""
                    loading="lazy"
                    className="aspect-video w-full object-cover"
                  />
                  <span className="absolute inset-0 grid place-items-center">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-white/90 shadow transition-transform duration-150 ease-out group-hover:scale-110">
                      <Play className="ml-0.5 h-3.5 w-3.5 fill-cyrixRed-600 text-cyrixRed-600" />
                    </span>
                  </span>
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] font-medium tabular-nums leading-4 text-white">
                    {v.duration}
                  </span>
                </span>
                <span className="min-w-0">
                  {partLabel && (
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                      {partLabel(v)}
                    </span>
                  )}
                  <span className="block text-sm font-medium text-ink-900">{titleOf(v)}</span>
                  {whoLabel && <span className="block text-xs text-ink-500">{whoLabel(v)}</span>}
                </span>
              </button>
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
  const myId = employee?.id
  useEffect(() => { markHelpSeen(myId) }, [myId])

  /*
    The video playing, if any. Also opened from a link — Cyra's "Watch the
    video" goes to /help?video=… — and closing takes the parameter off
    again, so the back button does not reopen it.
  */
  const [params, setParams] = useSearchParams()
  const [playing, setPlaying] = useState<ManualVideo | null>(null)
  useEffect(() => {
    const asked = params.get('video')
    if (asked && MANUAL_VIDEOS[asked]) setPlaying(MANUAL_VIDEOS[asked])
  }, [params])
  const stop = useCallback(() => {
    setPlaying(null)
    if (params.has('video')) {
      const next = new URLSearchParams(params)
      next.delete('video')
      setParams(next, { replace: true })
    }
  }, [params, setParams])
  const watch: Watch = { label: t('video.watch'), play: setPlaying }

  // HR administers the system rather than being appraised by it, and SW
  // Admin only handles logins. Neither has a KPI, so neither is told how
  // to submit one.
  const appraised = !isHrAdmin && !(isSwAdmin && !isHrAdmin)
  const hasTeam = isManager && !isHrAdmin

  // The videos for the steps this person does, and whether that is the
  // whole series — the only case where "Video 2 of 4" means anything.
  const videos = videosFor({ appraised, hasTeam })
  const whole = videos.length === VIDEO_SERIES.length
  const after = playing && nextVideo(playing, videos)

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
                    ? 'bg-surface text-ink-900 shadow-sm'
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

      {videos.length > 0 && (
        <VideoSeries
          videos={videos}
          title={t('video.series.title', { count: videos.length })}
          lead={t(whole ? 'video.series.lead' : appraised ? 'video.series.lead.member' : 'video.series.lead.manager')}
          partLabel={whole ? v => t('video.part', { n: v.part }) : null}
          whoLabel={whole ? v => t(v.who === 'manager' ? 'video.who.manager' : 'video.who.member') : null}
          titleOf={v => t(v.titleKey)}
          play={setPlaying}
        />
      )}

      {appraised && (
        <>
          <Section
            icon={ClipboardList}
            tint="text-violet-600"
            title={t('s1.title')}
            lead={t('s1.lead')}
            video={MANUAL_VIDEOS['your-kpi']}
            watch={watch}
            points={[
              // First, because for most people it is now the whole answer.
              { what: t('s1.p0.what'), how: t('s1.p0.how'), to: '/my-kpi/setup', cta: 'Set up my KPI' },
              { what: t('s1.p1.what'), how: t('s1.p1.how'), to: '/my-kpi', cta: 'Open my KPI' },
              { what: t('s1.p3.what'), how: t('s1.p3.how'), to: '/my-kpi', cta: 'Open my KPI' },
              { what: t('s1.p4.what'), how: t('s1.p4.how') },
              { what: t('s1.p5.what'), how: t('s1.p5.how') },
              { what: t('s1.p6.what'), how: t('s1.p6.how'), to: '/my-kpi/setup', cta: 'Set up my KPI' },
            ]}
          />

          <Section
            icon={CalendarCheck}
            tint="text-emerald-600"
            title={t('s2.title')}
            lead={t('s2.lead')}
            video={MANUAL_VIDEOS['every-month']}
            watch={watch}
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
              // What the columns on that page mean, now that two of them
              // changed shape: Self stopped being blank, and Manager and
              // Final stopped being printed twice.
              { what: t('s2.p7.what'), how: t('s2.p7.how'), to: '/history', cta: 'Open assessments' },
              { what: t('s2.p8.what'), how: t('s2.p8.how'), to: '/history', cta: 'Open assessments' },
              { what: t('s2.p9.what'), how: t('s2.p9.how'), to: '/history', cta: 'Open assessments' },
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

          {/*
            The rules behind the numbers, rather than what to do each
            month.

            Last of the sections everybody reads, because it answers
            questions that only occur to somebody once they have seen
            their own record — why the manager's figure is the whole
            score, where the 1-5 came from, why somebody with a lower
            percentage is ranked above them. All four changed at once
            after the September demo, and every one of them is visible on
            a person's own page without being explained anywhere else.
          */}
          <Section
            icon={Scale}
            tint="text-sky-600"
            title={t('s4.title')}
            lead={t('s4.lead')}
            points={[
              { what: t('s4.p1.what'), how: t('s4.p1.how') },
              { what: t('s4.p2.what'), how: t('s4.p2.how') },
              { what: t('s4.p3.what'), how: t('s4.p3.how'), to: '/my-kpi', cta: 'Open my KPI' },
              { what: t('s4.p4.what'), how: t('s4.p4.how'), to: '/me', cta: 'See my rating' },
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
          watch={watch}
          points={[
            { what: t('team.p1.what'), how: t('team.p1.how'), to: '/approvals', cta: 'Open approvals', video: MANUAL_VIDEOS.approve },
            { what: t('team.p2.what'), how: t('team.p2.how'), to: '/approvals', cta: 'Open approvals' },
            { what: t('team.p3.what'), how: t('team.p3.how'), to: '/team', cta: 'Open my team', video: MANUAL_VIDEOS.score },
            { what: t('team.p4.what'), how: t('team.p4.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p5.what'), how: t('team.p5.how'), to: '/queries', cta: 'Open queries' },
            { what: t('team.p6.what'), how: t('team.p6.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p7.what'), how: t('team.p7.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p8.what'), how: t('team.p8.how'), to: '/team/analysis', cta: 'Open team analysis' },
            { what: t('team.p9.what'), how: t('team.p9.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p10.what'), how: t('team.p10.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p11.what'), how: t('team.p11.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p12.what'), how: t('team.p12.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p13.what'), how: t('team.p13.how'), to: '/team/templates', cta: 'Open KPI templates' },
            { what: t('team.p14.what'), how: t('team.p14.how'), to: '/approvals', cta: 'Open approvals' },
            { what: t('team.p19.what'), how: t('team.p19.how'), to: '/team/templates', cta: 'Open KPI templates' },
            { what: t('team.p20.what'), how: t('team.p20.how'), to: '/team/templates', cta: 'Open KPI templates' },
            { what: t('team.p21.what'), how: t('team.p21.how'), to: '/team/templates', cta: 'Open KPI templates' },
            { what: t('team.p22.what'), how: t('team.p22.how'), to: '/team/templates', cta: 'Open KPI templates' },
            { what: t('team.p23.what'), how: t('team.p23.how'), to: '/team/templates', cta: 'Open KPI templates' },
            // The three rules that arrived with the manager's own
            // scoring screen: every core value rated, a reason for a low
            // one, and how their own position is worked out.
            { what: t('team.p15.what'), how: t('team.p15.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p16.what'), how: t('team.p16.how'), to: '/team', cta: 'Open my team' },
            { what: t('team.p17.what'), how: t('team.p17.how') },
            { what: t('team.p18.what'), how: t('team.p18.how'), to: '/approvals', cta: 'Open approvals' },
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
            { what: t('hr.p6.what'), how: t('hr.p6.how'), to: '/admin/reports', cta: 'Open reports' },
            { what: t('hr.p7.what'), how: t('hr.p7.how'), to: '/admin/employees', cta: 'Open employees' },
            { what: t('hr.p8.what'), how: t('hr.p8.how'), to: '/admin/support', cta: 'Open support' },
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
            { what: t('sw.p3.what'), how: t('sw.p3.how'), to: '/admin/logins', cta: 'Open logins' },
            { what: t('sw.p4.what'), how: t('sw.p4.how'), to: '/admin/logins', cta: 'Open logins' },
            { what: t('sw.p5.what'), how: t('sw.p5.how'), to: '/admin/logins', cta: 'Open SW Admin' },
            { what: t('sw.p6.what'), how: t('sw.p6.how'), to: '/admin/logins', cta: 'Open SW Admin' },
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
          // Nobody would go looking for this, and the offer stopped
          // coming to them when the sign-in dialog was removed. The
          // manual is now the only thing that says it exists.
          { what: t('prof.p5.what'), how: t('prof.p5.how'), to: '/me', cta: 'Open my profile' },
          // The band and the two sub-bands only exist once something has
          // been scored. Offered on the same condition as the rank above.
          ...(appraised
            ? [{ what: t('prof.p6.what'), how: t('prof.p6.how'), to: '/me', cta: 'Open my profile' }]
            : []),
          { what: t('prof.p7.what'), how: t('prof.p7.how'), to: '/me', cta: 'Open my profile' },
        ]}
      />

      {/*
        Cyra, before the two sections about not finding an answer.

        She is where most people will actually ask first — the button is
        on every screen — and the support section below already refers to
        her by name, so it cannot be the first mention. Everyone gets
        this one: the panel is on every screen for every role.
      */}
      <Section
        icon={MessageCircle}
        tint="text-violet-600"
        title={t('cyra.title')}
        lead={t('cyra.lead')}
        points={[
          { what: t('cyra.p1.what'), how: t('cyra.p1.how') },
          { what: t('cyra.p2.what'), how: t('cyra.p2.how') },
          { what: t('cyra.p3.what'), how: t('cyra.p3.how') },
          { what: t('cyra.p4.what'), how: t('cyra.p4.how') },
          { what: t('cyra.p5.what'), how: t('cyra.p5.how'), to: '/support', cta: 'My requests' },
        ]}
      />

      {/* Before "Things people ask" on purpose. Half of that section is
          somebody who could not find an answer, and this is where they
          go next — so it has to be read before they get there, not
          after. */}
      <Section
        icon={LifeBuoy}
        tint="text-teal-600"
        title={t('sup.title')}
        lead={t('sup.lead')}
        points={[
          { what: t('sup.p1.what'), how: t('sup.p1.how'), to: '/support', cta: 'Contact support' },
          { what: t('sup.p2.what'), how: t('sup.p2.how'), to: '/support', cta: 'Contact support' },
          { what: t('sup.p3.what'), how: t('sup.p3.how'), to: '/history', cta: 'Open assessments' },
          { what: t('sup.p4.what'), how: t('sup.p4.how'), to: '/support', cta: 'My requests' },
        ]}
      />

      <Section
        icon={HelpCircle}
        tint="text-ink-400"
        title={t('ask.title')}
        watch={watch}
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
          { what: t('ask.p10.what'), how: t('ask.p10.how'), to: '/', cta: 'Open dashboard' },
          { what: t('ask.p11.what'), how: t('ask.p11.how') },
          { what: t('ask.p12.what'), how: t('ask.p12.how'), to: '/change-password', cta: 'Change my password' },
          ...(videos.length > 0
            ? [{ what: t('ask.p13.what'), how: t('ask.p13.how'), video: videos[0] }]
            : []),
        ]}
      />

      {/*
        Only the way back. There used to be a Records button here for
        managers and KPI timing for SW Admin, and neither belonged to a
        manual: Records is a queue whose tab appears only when somebody is
        waiting, so the button opened an empty tray and made its tab show
        for nothing; KPI timing is a tab inside Administration now. Every
        point above already links to its own screen.
      */}
      {playing && (
        <VideoModal
          video={playing}
          part={whole ? t('video.part', { n: playing.part }) : null}
          title={t(playing.titleKey)}
          next={after && { label: t('video.next', { title: t(after.titleKey) }), play: () => setPlaying(after) }}
          note={lang === 'en' ? null : t('video.english')}
          closeLabel={t('video.close')}
          onClose={stop}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <Link to="/me" className="btn-secondary btn-press">
          <ArrowLeft className="h-4 w-4" /> {t('page.back')}
        </Link>
      </div>
    </div>
  )
}
