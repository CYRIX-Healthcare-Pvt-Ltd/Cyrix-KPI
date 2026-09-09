import { useState, useId } from 'react'
import clsx from 'clsx'
import {
  Trash2, Shuffle, Calculator, ArrowUp, ArrowDown, Minus, FlaskConical, TrendingDown,
  AlertTriangle,
} from 'lucide-react'
import RuleTraits from './RuleTraits'
import { NumberInput, cleanNumberText } from './ui'
import { calcKpiScore, type ScoringRule, type RuleParams } from '@/lib/scoring'
import { bandFor, attainmentPct } from '@/lib/bands'
import type { KpiRowDefinition, Alternate, ScoringRuleMeta } from '@/types/db'

/**
 * The editor for one KPI row, shared by the two screens that write one.
 *
 * It was a private function inside the setup form until managers got
 * templates to keep, and a template is the same eight fields: a KRA, what
 * it measures, what it is worth, what it is scored against, whichever
 * other things it measures in some months, and a calculator for checking
 * you picked the right rule. A second copy of that would have been a
 * second set of answers to "can this row go past its weightage" -- and the
 * copy nobody was looking at would be the wrong one.
 */
export type Draft = KpiRowDefinition & {
  _key: string
  _inferred?: boolean
  /** Other things this row could measure — see migration 0040. */
  alternates: Alternate[]
}

/**
 * Which way is good, said with a colour and an arrow.
 *
 * "Higher is better" and "lower is better" are opposite meanings wearing
 * the same sentence shape, and this control was the quietest on a form
 * where it decides the most — whether beating a target earns anything,
 * and whether going over is good or bad.
 */
const DIRECTION = {
  higher_better: { label: 'Higher is better', icon: ArrowUp, chip: 'bg-emerald-100 text-emerald-800' },
  lower_better:  { label: 'Lower is better',  icon: ArrowDown, chip: 'bg-cyrixRed-100 text-cyrixRed-800' },
  neutral:       { label: 'Rated',            icon: Minus, chip: 'bg-ink-100 text-ink-700' },
} as const

/**
 * The default, named once.
 *
 * Every row starts here — a new one, a guessed one, an imported one whose
 * label nobody recognised. It is the only rule that cannot surprise
 * anybody: the score rises to the weightage and stops. Everything else
 * either pays for beating the target or takes marks off the rest of the
 * appraisal, and neither should be arrived at by leaving a dropdown alone.
 */
export const DEFAULT_RULE: ScoringRule = 'higher_capped'

/**
 * What each rule does to a score, in the words somebody would use out loud,
 * and a colour of its own.
 *
 * The dropdown had one appearance for seven behaviours that range from
 * "cannot go above its weightage" to "can go below zero and drag the total
 * down with it". Read quickly they are the same sentence shape with a word
 * changed, which is how the wrong one gets picked and stays picked.
 *
 * The colour is a ramp, and what it ramps along is how far this row can
 * move the total: green where the score can only rise to its weightage,
 * deeper green where it can rise past it, amber where the row can lose
 * its own weightage, red where it can take marks off everything else.
 *
 * Direction alone would have coloured the two "lower is better" rules the
 * same, and those two are the pair most often confused and the pair that
 * differs most — one stops at nought, the other does not stop.
 */
export const RULE_TONE: Record<string, { chip: string; ink: string; ring: string; bar: string }> = {
  /*
    Written out, never assembled.

    The stripe class used to be derived from the border class by string
    replacement. Tailwind only generates class names it can find in the
    source, and "bg-green-600" appears nowhere — so that stripe was never
    built and simply did not draw. Amber survived because its class happens
    to be used elsewhere in the app, which is luck rather than a system.

    Only the ends of these ramps turn with the theme: 100/200 for a wash,
    700/800/900 for ink on it, per the note in the Tailwind config. 300 to
    600 are literal and safe on either ground, which is what a stripe wants.
  */
  higher_capped:   { chip: 'bg-emerald-100',  ink: 'text-emerald-800',  ring: 'border-emerald-400',  bar: 'bg-emerald-400' },
  higher_uncapped: { chip: 'bg-green-200',    ink: 'text-green-800',    ring: 'border-green-600',    bar: 'bg-green-600' },
  lower_penalty:   { chip: 'bg-amber-100',    ink: 'text-amber-800',    ring: 'border-amber-400',    bar: 'bg-amber-400' },
  lower_linear:    { chip: 'bg-cyrixRed-100', ink: 'text-cyrixRed-800', ring: 'border-cyrixRed-500', bar: 'bg-cyrixRed-500' },
  banded:          { chip: 'bg-violet-100',   ink: 'text-violet-800',   ring: 'border-violet-400',   bar: 'bg-violet-400' },
  boolean:         { chip: 'bg-ink-100',      ink: 'text-ink-800',      ring: 'border-ink-400',      bar: 'bg-ink-400' },
  rating_scale:    { chip: 'bg-lime-100',     ink: 'text-lime-800',     ring: 'border-lime-500',     bar: 'bg-lime-500' },
}

const FALLBACK_TONE = { chip: 'bg-ink-100', ink: 'text-ink-800', ring: 'border-ink-300', bar: 'bg-ink-300' }
export const toneFor = (rule: string) => RULE_TONE[rule] ?? FALLBACK_TONE

/**
 * The one sentence somebody has to agree with before the rule changes.
 *
 * Not a restatement of the label — the label is already on screen and
 * agreeing with it proves nothing. Each of these says what the rule can do
 * that the default cannot, because that is the part that gets found out in
 * March when the totals are wrong.
 */
export const RULE_WARNING: Record<string, string> = {
  higher_capped:
    'Achieving more than the target earns nothing further. The score rises with what was achieved and stops at the full weightage.',
  higher_uncapped:
    "Achievement above the target continues to earn. This row can score more than its weightage, which can take the monthly total above 100.",
  lower_penalty:
    'Exceeding the target reduces the score, but this row cannot fall below 0 — at worst it forfeits its own weightage.',
  lower_linear:
    "Exceeding the target reduces the score with no floor. This row can fall below 0 and draw marks from the rest of the monthly score, not only its own.",
  banded:
    'The score steps at defined thresholds rather than rising smoothly. The bands must be set here — without them this row cannot be scored.',
  boolean:
    'All or nothing: the full weightage if completed, zero if not. Any target value entered is not used.',
  rating_scale:
    'Assessed on a 0 to 100 scale by judgement rather than from a measured figure, so the target is not used in the calculation.',
}

/**
 * The rule, wearing its colour, wherever it is only being read.
 *
 * The editor is not the last place this matters — it is arguably not even
 * the place it matters most. A manager approving a template sees the rule
 * as three grey words in a narrow column, so "lower linear", the one that
 * can take marks off the rest of the month, reads exactly like "higher
 * capped", the one that cannot. Same colours here as on the form the
 * employee filled in, so the two screens agree about which rows are the
 * ones to look at twice.
 */
export function RuleChip({ rule, label, className }: {
  rule: string
  /** The human label when the caller has it; the code, tidied, when not. */
  label?: string
  className?: string
}) {
  const tone = toneFor(rule)
  return (
    <span className={clsx(
      'badge gap-1 normal-case tracking-normal', tone.chip, tone.ink, className,
    )}>
      <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', tone.bar)} aria-hidden />
      {label ?? rule.replace(/_/g, ' ')}
    </span>
  )
}

export const blankRow = (sortOrder: number): Draft => ({
  _key: crypto.randomUUID(),
  section: 'job_role',
  kra: '',
  kpi_description: '',
  weightage: 0,
  target_value: null,
  target_unit: null,
  scoring_rule: DEFAULT_RULE,
  rule_params: {},
  sort_order: sortOrder,
  alternates: [],
})

export default function RowEditor({
  row, index, rules, onChange, onRemove,
}: {
  row: Draft
  /** Its place in the list, 1-based. Shown so a row can be referred to. */
  index: number
  rules: ScoringRuleMeta[]
  onChange: (patch: Partial<Draft>) => void
  onRemove: () => void
}) {
  const ruleMeta = rules.find(r => r.code === row.scoring_rule)
  const tone = toneFor(row.scoring_rule)

  /*
    A rule change is asked about before it is made.

    This dropdown decides whether beating a target earns anything and
    whether missing one can take marks off the rest of the appraisal, and
    it was the quietest control on the form: one keystroke on a focused
    select moves it, and nothing on screen changes enough to notice. The
    row still reads plausibly afterwards, so it is found in March.

    Held rather than applied, and released by the panel below.
  */
  const [pendingRule, setPendingRule] = useState<ScoringRule | null>(null)

  const applyRule = (rule: ScoringRule) => {
    onChange({
      scoring_rule: rule,
      _inferred: false,
      // The behaviour each rule promises, set from the choice
      // rather than asked for separately. "Can exceed weightage"
      // means no ceiling; "can go negative" means exactly that,
      // and the label would be a lie if a hidden default clamped
      // it at zero.
      rule_params: {
        ...row.rule_params,
        max_multiplier: undefined,
        allow_negative: rule === 'lower_linear' ? true : undefined,
        floor: undefined,
        // A "% off the total per one over" belongs to this
        // rule alone. Carried onto any other it is dead
        // weight that the marks would still be reading.
        penalty_per_unit:
          rule === 'lower_linear' ? row.rule_params.penalty_per_unit : undefined,
      },
    })
    setPendingRule(null)
  }

  return (
    <div className={`p-4 ${row._inferred ? 'bg-amber-50/60' : ''}`}>
      {/*
        The KRA and its KPI are what this row IS; the weightage, target and
        scoring rule are how it is measured. They were laid out as six
        equal fields with six identical grey labels, so the two that name
        the row read no louder than the two that number it -- and people
        scanning for "where do I write the KRA" had to read every label to
        find out.

        A number, because a form of eight rows is discussed out loud:
        "row three is wrong" needs a row three.
      */}
      <div className="mb-3 flex items-start gap-3">
        {/* Outlined in the same violet as the fields it numbers, rather
            than filled.

            It was a dark disc with white text, which is invisible on the
            dark page: the ink ramp flips end for end with the theme, so
            ink-800 is near-black on one and near-white on the other while
            the white text stayed white. A colour that flips with the
            theme, used for both the ring and the digit, cannot come apart
            that way. */}
        <span
          className="mt-6 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-violet-700 text-xs font-bold text-violet-700"
          aria-hidden
        >
          {index}
        </span>
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-12">
          {/* The two that name the row are bordered in the accent rather
              than the ordinary field grey, so the pair is found by colour
              before anything is read.

              violet-700 rather than the ambient accent: that one moves
              with the team's score, and a field border that changes
              colour because somebody had a good month is a border that
              means nothing. This ramp flips end for end with the theme,
              so it is deep on the light page and bright on the dark one
              -- the same idea in both rather than a light-mode colour
              that has to be corrected in the other. */}
          <div className="sm:col-span-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-label text-ink-700">
              KRA
            </label>
            <input
              className="input border-violet-700 font-medium shadow-[0_0_0_3px_rgb(var(--violet-700)/0.14)] focus:border-violet-700"
              value={row.kra}
              onChange={e => onChange({ kra: e.target.value })}
              placeholder="e.g. Response time"
              aria-label={`KRA for row ${index}`}
            />
          </div>

          <div className="sm:col-span-8">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-label text-ink-700">
              KPI
            </label>
            <input
              className="input border-violet-700 font-medium shadow-[0_0_0_3px_rgb(var(--violet-700)/0.14)] focus:border-violet-700"
              value={row.kpi_description ?? ''}
              onChange={e => onChange({ kpi_description: e.target.value })}
              placeholder="e.g. BD calls assigned to be attended within 48 hours"
              aria-label={`KPI for row ${index}`}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-12 sm:pl-9">

        {/* The same treatment as the KRA and KPI above. These two are the
            other half of what a row says -- how much it is worth and what
            counts as hitting it -- and they were the plain grey labels the
            pair above used to be. */}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-label text-ink-700">
            Weightage <span className="font-normal normal-case tracking-normal text-ink-400">— % of 100</span>
          </label>
          <NumberInput
            min={0} max={100} step="any"
            className="input font-medium"
            value={row.weightage}
            onValue={v => onChange({ weightage: v ?? 0 })}
            aria-label={`Weightage for row ${index}`}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-label text-ink-700">
            {/* "— to hit" came off. Target already says what it is, and
                the gloss read as a label that had not finished — the
                weightage beside it needs its "% of 100" because the unit
                is genuinely ambiguous; a target does not. */}
            Target
          </label>
          <NumberInput
            step="any"
            className="input font-medium"
            value={row.target_value}
            onValue={v => onChange({ target_value: v })}
            aria-label={`Target for row ${index}`}
          />
        </div>

        {/*
          Boxed and tinted, because this was the quietest control on the
          form and the most consequential. It decides whether 60 out of a
          target of 50 is full marks or a bonus, and whether going over is
          good or bad — and it sat in the same grey helper text as
          everything else, so people picked whatever was already selected.

          The direction gets an arrow and a colour of its own: "higher is
          better" and "lower is better" are opposite meanings sharing a
          sentence shape, and an arrow says which one before the sentence
          is read.
        */}
        <div className="sm:col-span-8">
          <div className={clsx(
            'rounded-lg border p-3',
            row._inferred
              ? 'border-amber-300 bg-amber-50'
              : 'border-ink-200 bg-ink-50/70',
          )}>
            <label className="label mb-1.5 flex flex-wrap items-center gap-2 text-xs">
              <Calculator className="h-3.5 w-3.5 text-ink-400" />
              How is it scored?
              {ruleMeta && (
                <span className={clsx(
                  'badge gap-1 normal-case tracking-normal',
                  tone.chip, tone.ink,
                )}>
                  {(() => {
                    const Icon = DIRECTION[ruleMeta.direction].icon
                    return <Icon className="h-3 w-3" />
                  })()}
                  {DIRECTION[ruleMeta.direction].label}
                </span>
              )}
              {/* What it can do to a score: past the weightage, stopped
                  at it, or below zero and into the total. */}
              <RuleTraits
                rule={row.scoring_rule}
                weightage={row.weightage}
                params={row.rule_params}
              />
              {row._inferred && (
                <span className="font-semibold text-amber-800">
                  guessed — please check
                </span>
              )}
            </label>
            {/* The border is the colour of the rule in the box, not of the
                one still saved — while a change is pending those differ,
                and a green ring around "can go below 0 %" says the
                opposite of what the box says. */}
            <select
              className={clsx('input bg-surface border-2 transition-colors',
                toneFor(pendingRule ?? row.scoring_rule).ring)}
              value={pendingRule ?? row.scoring_rule}
              onChange={e => {
                const rule = e.target.value as ScoringRule
                // Choosing what is already set is not a change to confirm.
                if (rule === row.scoring_rule) { setPendingRule(null); return }
                setPendingRule(rule)
              }}
            >
              {rules.map(r => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>

            {/*
              Not a browser confirm(): it would have to say all of this in
              one line of unstyled text, and the thing being agreed to is
              the consequence, which needs room and the colour of the rule
              it belongs to. Inline rather than a modal, because the row it
              is about has to stay readable behind the question.
            */}
            {pendingRule && (() => {
              const to = toneFor(pendingRule)
              const toLabel = rules.find(r => r.code === pendingRule)?.label
              return (
                /*
                  On the ordinary card surface, with the colour carried by a
                  stripe and the heading only.

                  Tinting the whole panel meant the buttons sat on a green
                  or red ground they were never designed for — one of them
                  came out pale-on-pale and unreadable — and two nested
                  boxes inside it made a small question look like a form.
                  Surface underneath, so btn-primary and btn-secondary are
                  the buttons they are everywhere else in the app.
                */
                <div className="mt-2 flex overflow-hidden rounded-lg border border-ink-200 bg-surface shadow-sm">
                  <span className={clsx('w-1.5 shrink-0', to.bar)} aria-hidden />
                  <div className="min-w-0 flex-1 p-3">
                    <p className={clsx('flex items-center gap-1.5 text-sm font-semibold', to.ink)}>
                      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                      Change to {toLabel}?
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-700">
                      {RULE_WARNING[pendingRule]}
                    </p>
                    {/* What it replaces, quieter — it is context, not the
                        question being asked. */}
                    <p className="mt-1 text-xs leading-relaxed text-ink-500">
                      Replaces: {RULE_WARNING[row.scoring_rule]}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-primary whitespace-nowrap px-3 py-1 text-xs"
                        onClick={() => applyRule(pendingRule)}
                      >
                        Change it
                      </button>
                      <button
                        type="button"
                        className="btn-secondary whitespace-nowrap px-3 py-1 text-xs"
                        onClick={() => setPendingRule(null)}
                      >
                        Keep the current one
                      </button>
                    </div>
                  </div>
                </div>
              )
            })()}

            {ruleMeta && (
              <p className="mt-1.5 text-xs leading-relaxed text-ink-600">
                {ruleMeta.description}
              </p>
            )}

            {/* The figure that lets a row with no weightage of its own
                still count for something. Offered by both lower rules:
                what a unit over costs and where the score bottoms out are
                two separate decisions, and tying them together meant
                picking the floor you wanted and accepting whatever
                penalty came with it. */}
            {(row.scoring_rule === 'lower_linear' || row.scoring_rule === 'lower_penalty') && (
              <PenaltyPerUnit
                weightage={row.weightage}
                value={row.rule_params.penalty_per_unit ?? null}
                onValue={v => onChange({
                  rule_params: {
                    ...row.rule_params,
                    penalty_per_unit: v ?? undefined,
                  },
                })}
              />
            )}

            {/* Only once the row has a target. Before that there is
                nothing to compute, and a tester showing a dash while
                somebody is still typing the KRA is a row taller for no
                reason.

                The weightage is deliberately not part of the test. A
                penalty row is worth 0% on purpose, and that is precisely
                the row nobody believes until they watch it take 4% off. */}
            {row.target_value !== null && (
              <RuleTester
                weightage={row.weightage}
                target={row.target_value}
                rule={row.scoring_rule}
                params={row.rule_params}
              />
            )}
          </div>
        </div>
      </div>

      {/* ---- alternatives ---- */}
      {row.alternates.length > 0 && (
        <div className="mt-3 space-y-3 border-l-2 border-ink-200 pl-4">
          <p className="text-xs text-ink-500">
            Some months this row measures something else instead. Same{' '}
            <strong>{row.weightage}%</strong> either way — only one applies in
            any month, and the person picks which when they fill it in.
          </p>
          {row.alternates.map((alt, i) => (
            <AlternateEditor
              key={alt.id}
              alt={alt}
              rules={rules}
              index={i}
              onChange={patch => onChange({
                alternates: row.alternates.map(a =>
                  a.id === alt.id ? { ...a, ...patch } : a),
              })}
              onRemove={() => onChange({
                alternates: row.alternates.filter(a => a.id !== alt.id),
              })}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button
          onClick={onRemove}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-cyrixRed-700 hover:text-cyrixRed-800"
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove this row
        </button>
        {/* Same weight of text as Remove, deliberately: they are the two
            things you can do to a row, and one of them being a button
            would make it look like the expected next step. Five is the
            cap the column enforces. */}
        {row.alternates.length < 5 && (
          <button
            onClick={() => onChange({
              alternates: [...row.alternates, {
                id: `alt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                kra: '', kpi_description: '', target_value: null,
                scoring_rule: row.scoring_rule, rule_params: row.rule_params,
              }],
            })}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink-900"
          >
            <Shuffle className="h-3.5 w-3.5" /> Add an alternative
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * How much a row takes off the total for each one over the target.
 *
 * The rule's other setting is a proportional slice of the weightage,
 * which is a share of nothing on a row deliberately worth 0% — and worth
 * 0% is the whole point of a row like "monthly maximum one complaint".
 * It is not a share of the 80%; it exists to take something away when
 * the thing happens. So the amount is asked for in points off the total,
 * which is the number the person actually sees at the end of the month.
 */
function PenaltyPerUnit({
  weightage, value, onValue,
}: {
  weightage: number
  value: number | null
  onValue: (v: number | null) => void
}) {
  const id = `penalty-${useId()}`
  // Nought per cent off is not a small penalty, it is no penalty — the
  // row would carry a rule that can never fire. So it counts as unset
  // everywhere: here, in the marks, and in the engine.
  const idle = !(Number(value) > 0)

  return (
    <div className="mt-2.5 border-t border-ink-200/70 pt-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-600">
        <TrendingDown className="h-3.5 w-3.5 shrink-0 text-cyrixRed-500" />
        <label htmlFor={id}>Each one over the target takes</label>
        <span className="relative">
          <NumberInput
            id={id}
            min={1} step="any"
            className="input w-24 py-1 pr-6 text-xs"
            value={value}
            onValue={onValue}
            placeholder="2"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400">
            %
          </span>
        </span>
        <span>off my total</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
        {weightage === 0
          ? idle
            // The state the two live penalty rows are in, and the reason
            // neither has ever moved a total.
            ? 'This row is worth 0%, so this figure is the only thing it can do. Without it the row scores nothing whatever happens.'
            : 'Staying within the target costs nothing. This row earns no marks of its own — it only takes them off when the target is passed.'
          : idle
            ? `Leave this blank to take a proportional slice off this row's own ${weightage}% instead.`
            : `Taken off the whole score, not only this row's ${weightage}%.`}
      </p>
    </div>
  )
}

/**
 * Type a number, see what it does.
 *
 * The description under the picker carries a worked example, but it uses
 * a target of 2 and a weightage of 10, which are not this person's — so
 * the one thing it cannot answer is "what does this rule do to MY row".
 * This runs the same calc_kpi_score the database will run, against the
 * target and weightage actually on the row, so agreeing to a rule and
 * understanding it become the same moment.
 *
 * One line, and only where a target exists. Nothing is saved: it is a
 * calculator, not a field.
 */
function RuleTester({
  weightage, target, rule, params,
}: {
  weightage: number
  target: number
  rule: ScoringRule
  params: RuleParams
}) {
  const [tried, setTried] = useState('')
  const achieved = tried.trim() === '' ? null : Number(tried)
  const score = achieved === null || Number.isNaN(achieved)
    ? null
    : calcKpiScore(rule, weightage, target, achieved, params)
  const band = score === null ? null : bandFor(attainmentPct(score, weightage))

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-ink-200/70 pt-2.5 text-xs text-ink-600">
      <FlaskConical className="h-3.5 w-3.5 shrink-0 text-ink-400" />
      <span>Try it — if I achieve</span>
      <input
        type="number" inputMode="decimal" step="any"
        className="input w-24 py-1 text-xs"
        value={tried}
        onChange={e => setTried(cleanNumberText(e.target.value))}
        placeholder={String(target)}
        aria-label="A figure to try against this rule"
      />
      <span>against a target of {target},</span>
      {score === null ? (
        <span className="text-ink-300">—</span>
      ) : weightage === 0 ? (
        /*
          A row worth nothing cannot score, so "0.00 of 0" is true and
          useless. What it can do is cost, and that is the sentence: the
          figure people are trying to picture is the one that comes off
          the 90 they were expecting.
        */
        score < 0 ? (
          <span className="font-semibold tabular-nums text-cyrixRed-700">
            {(-score).toFixed(2)}% comes off my total
          </span>
        ) : (
          <span className="font-semibold text-emerald-700">nothing comes off my total</span>
        )
      ) : (
        <span className={clsx('font-semibold tabular-nums', band?.accent)}>
          I score {score.toFixed(2)}{' '}
          <span className="font-normal text-ink-400">of {weightage}</span>
        </span>
      )}
    </div>
  )
}

/**
 * A different thing the same row could measure.
 *
 * No weightage field: taking the parent's is the whole idea. If an
 * alternative could carry its own, it would be a second row, the year
 * would stop totalling 100, and the thing this exists to avoid would be
 * back.
 */
function AlternateEditor({
  alt, rules, index, onChange, onRemove,
}: {
  alt: Alternate
  rules: ScoringRuleMeta[]
  index: number
  onChange: (patch: Partial<Alternate>) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-label text-ink-400">
          Alternative {index + 1}
        </p>
        <button
          onClick={onRemove}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-cyrixRed-700 hover:text-cyrixRed-800"
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-12">
        <div className="sm:col-span-4">
          <label className="label text-xs">KRA</label>
          <input
            className="input"
            value={alt.kra}
            onChange={e => onChange({ kra: e.target.value })}
            placeholder="What is measured instead"
          />
        </div>
        <div className="sm:col-span-8">
          <label className="label text-xs">KPI — measurable parameter</label>
          <input
            className="input"
            value={alt.kpi_description ?? ''}
            onChange={e => onChange({ kpi_description: e.target.value })}
          />
        </div>
        <div className="sm:col-span-3">
          <label className="label text-xs">Target</label>
          <NumberInput
            step="any"
            value={alt.target_value}
            onValue={v => onChange({ target_value: v })}
          />
        </div>
        <div className="sm:col-span-9">
          <label className="label text-xs">How is it scored?</label>
          <select
            className="input"
            value={alt.scoring_rule}
            onChange={e => onChange({ scoring_rule: e.target.value as ScoringRule })}
          >
            {rules.map(r => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
