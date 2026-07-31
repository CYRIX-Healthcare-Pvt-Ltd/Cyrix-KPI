# Cyrix KPI

Monthly KPI submission and appraisal scoring for Cyrix Healthcare.
React + Vite PWA on Supabase — one responsive codebase for desktop and mobile.

Team members submit what they achieved each month, their reporting manager
reviews and scores it, and the blended result feeds appraisal and PIP decisions.

---

## How KPIs are stored

Every team member's KPI has the **same shape** — a list of scored rows split
into *Job Role (80%)* and *Alignment To Core Values (20%)*. Only the rows differ
from person to person. So KPIs are stored as **rows in a child table**, never as
a column per KPI and never as an opaque JSON blob.

```
job_roles
  kpi_templates            reusable per-role starting point
    kpi_template_items

  kpi_assignments          ONE employee, ONE financial year — a SNAPSHOT
    kpi_assignment_items   this person's actual rows, freely editable

      kpi_submissions        one per employee per month
        kpi_submission_items achieved values + computed scores
        core_value_ratings   the five qualitative ratings
```

Two snapshots protect history:

- **assignment items** are copied from the template, so editing next year's
  template cannot retroactively change a past appraisal
- **submission items** freeze the definition when the month opens, so a
  mid-year change to someone's KPI cannot rewrite a month already scored

## Scoring

`calc_kpi_score()` in `supabase/migrations/0004_scoring.sql` is the single
source of truth. `src/lib/scoring.ts` mirrors it exactly so the form can show a
live score while typing; `src/lib/scoring.test.ts` and the self-test block at
the end of migration `0007` assert the two never drift.

A KRA's behaviour is **data**, not code — `scoring_rule` plus a `rule_params`
JSON blob. A new job role with unusual maths is a data change.

| Rule | Behaviour |
|---|---|
| `higher_capped` | Rises to the weightage and stops. Hitting target = full marks. |
| `higher_uncapped` | May exceed the weightage. `max_multiplier` caps it. |
| `lower_penalty` | At/under target = full; over target decays as `wt × target/achieved`. |
| `lower_linear` | Every unit over cuts proportionally. Can go negative. |
| `banded` | Stepped thresholds from `rule_params.bands`. |
| `boolean` | Done / not done. |
| `rating_scale` | 0–100 qualitative input scaled onto the weightage. |

The first three were recovered directly from the formulas in
*KPI 26-27 Template.xlsx*; the rest cover the other job roles.

**Final score** = `average(self, manager)` per row, matching the sheet's
`AVERAGE(G,K)`. Configurable via the `score_blend` row in `app_settings` —
set `self_weight` to 0 for manager-only scoring.

### Differences from the spreadsheet

The app deliberately does not reproduce three bugs in the original file:

- `D11` "Job Role Score" was `SUM(D6:D6)` — counted only the first KRA
- `P11` annual Job Role was `SUM(P4:P10)` — swept core values into the job-role subtotal
- `P12` annual Core Value was `SUM(P5:P10)` — summed nearly the whole sheet

Also, `AVERAGE(G,K)` silently halved a row's score while the manager column was
still blank. Here the final score stays empty until the manager actually scores.

And `J8=F8` forced the manager's core-value rating to copy the team member's.
Managers now rate independently — set `core_values_mirror_self` to `true` in
`app_settings` to restore the old behaviour.

## Workflows

**KPI setup** — the TM uploads their Excel (or starts from their role's
template), the reporting manager approves it:

```
draft ──▶ pending_approval ──▶ active
             └──▶ rejected ──▶ draft
```

Weightages must total 80/20 before it can be submitted or approved.

**Monthly** — no month can be opened until the KPI is `active`:

```
draft ──▶ submitted ──▶ scored ──▶ finalized
   ▲          └──▶ returned ──┘
   └──────────────────┘
```

## Security

Row-Level Security, enforced in the database rather than the UI:

- **TM** — own record, own manager, own KPI and submissions
- **Manager** — the above, plus direct reports
- **HR admin** — everything

RLS is row-level only, so column rules (a TM may write `self_achieved` but
never `manager_achieved`) are enforced by guard triggers in migration `0006`.
Without them a TM could `PATCH` their own manager score straight through
PostgREST. Scores are always recomputed server-side and never accepted from a
client.

---

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Where to find it |
|---|---|
| `VITE_SUPABASE_URL` | already set — the project URL |
| `VITE_SUPABASE_ANON_KEY` | Settings → API → `anon` `public` |
| `SUPABASE_DB_URL` | Settings → Database → Connection string → URI |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → `service_role` |

`SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` are **server-side only** —
never prefix them with `VITE_`, which would bundle them into the browser build
and expose every appraisal record. `.env.local` is gitignored.

Apply the schema:

```bash
npm run db:push
```

Import the team list — creates logins with the ecode as the initial password:

```bash
node scripts/import-employees.mjs "Emp Data.xlsx" --hr-admin HR_Admin --dry-run
```

Drop `--dry-run` once the preview looks right, then check the result:

```bash
node scripts/verify-import.mjs
```

Re-running the import is safe: existing ecodes are updated, never duplicated,
and an existing password is never reset.

Columns are matched loosely and case-insensitively. Recognised:

```
Employee_Code / Ecode        (required)
Employee_Name / Name         (required)
Employee_Status / Status     leavers are skipped
ReportingManager_Code
Designation | Department | Location | Job Role | Email | Date of Joining | HR Admin
```

**Leavers never get a login.** Any status matching `fnf`, `resign`, `exit`,
`terminat`, `abscond`, `left`, `retire`, `deceas`, `separat`, `relieved` is
treated as a leaver and skipped. Being generous here is deliberate — wrongly
creating a login for someone who has left is far worse than missing one, which
is a sheet edit and a re-run. `--include-inactive` imports them as
`is_active=false` with no login, for historical continuity.

Other options: `--limit n` for a trial run, `--sheet <name>` to pick a sheet,
`--hr-admin <CODE>` to create or flag an HR administrator.

Run it:

```bash
npm run dev
```

## Logging in

User id is the **ecode**; the initial password is the **ecode itself**. The app
forces a real password on first login before anything else is reachable.

Ecodes map to internal Supabase Auth emails (`e1042@cyrix.local`) that never
receive mail — this buys real JWTs and working RLS while keeping the ecode as
the only thing anyone types.

### Testing phase — currently active

Two settings in `app_settings` relax login while the system is being trialled:

| Setting | Now | Effect |
|---|---|---|
| `force_password_change` | `false` | No forced password change — sign in with ecode/ecode and go straight in |
| `self_service_password_reset` | `true` | Anyone can reset an account back to ecode-as-password from the login screen |

**Before go-live, tighten both.** No deployment needed — the app reads them at
runtime:

```sql
update app_settings set value = 'true'  where key = 'force_password_change';
update app_settings set value = 'false' where key = 'self_service_password_reset';
```

Self-service reset is anonymous-callable by design, since the person using it
is locked out. That means **anyone who knows a colleague's employee code can
reset that colleague's password**. Fine for test data, not fine once real
appraisal and PIP records are in here — hence the flag, checked on every call
rather than something to remember to remove.

Employee codes are stored in capitals, so the password is too: `E551` / `E551`,
`HR_ADMIN` / `HR_ADMIN`. The login form uppercases the code field automatically.

Reset everyone back to ecode-as-password at any time:

```bash
node scripts/user-admin.mjs reset-all
```

### Passwords cannot be looked up

Supabase stores a bcrypt hash in `auth.users.encrypted_password`. It is
one-way — there is no column, view or API that returns the plaintext, and a
database superuser cannot read one back either. That is the point: a database
leak does not hand over everyone's password.

So the answerable questions are "have they signed in?" and "reset it for them":

```bash
node scripts/user-admin.mjs status E551    # signed in? still on the default?
node scripts/user-admin.mjs pending        # never signed in — chase these
node scripts/user-admin.mjs reset E551     # back to ecode, forced change re-armed
```

`reset` also accepts `--to "SomePassword"` if you need to set a specific one.

## Commands

| | |
|---|---|
| `npm run dev` | dev server on :5173 |
| `npm run build` | production build |
| `npm test` | scoring + parser tests |
| `npm run db:push` | apply pending migrations |
| `npm run db:verify` | show pending migrations, change nothing |
| `node scripts/verify-db.mjs` | check schema, RLS, seed and the live scoring engine |
| `node scripts/verify-import.mjs` | check org data: logins, reporting tree, cycles |
| `node scripts/user-admin.mjs status\|pending\|reset` | login status and password resets |
| `node scripts/make-icons.mjs` | regenerate PWA icons |

Migrations are immutable — `db:push` warns if an already-applied file has
changed. Add a new numbered file instead of editing an old one.
