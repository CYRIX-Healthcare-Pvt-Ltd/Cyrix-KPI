import { useState, useId } from 'react'
import clsx from 'clsx'
import {
  Trash2, Shuffle, Calculator, ArrowUp, ArrowDown, Minus, FlaskConical, TrendingDown,
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

export const blankRow = (sortOrder: number): Draft => ({
  _key: crypto.randomUUID(),
  section: 'job_role',
  kra: '',
  kpi_description: '',
  weightage: 0,
  target_value: null,
  target_unit: null,
  scoring_rule: 'higher_capped',
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
                  DIRECTION[ruleMeta.direction].chip,
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
            <select
              className="input bg-surface"
              value={row.scoring_rule}
              onChange={e => {
                const rule = e.target.value as ScoringRule
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
              }}
            >
              {rules.map(r => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
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
