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

## Roles

| Role | Sees | Can do |
|---|---|---|
| Team member | Own record, own manager | Define Job Role KRAs, submit each month |
| Manager | Direct reports too | Approve KPIs (and edit them in place), score months, request removals and deletions |
| `HR_ADMIN` | Everything | Org dashboards, employees, reports, approves removals and the final deletion stage |
| `SW_ADMIN` | Every login's state | Login administration, password resets from the CLI |

`SW_ADMIN` **cannot see passwords** — nobody can. They are one-way bcrypt
hashes; there is no column, view or API that returns the plaintext, and a
database superuser cannot read one back either. What the screen shows is
whether each person is still on the code we issued or has set their own.

### Deleting a wrongly submitted month

Two approvals, in order:

```
requested ──▶ reporting manager ──▶ HR ──▶ deleted
                   └──▶ rejected      └──▶ rejected
```

The reporting manager knows whether the month is genuinely wrong; HR owns the
appraisal record. Neither alone can erase a scored month, and the figures are
written to `audit_log` before the row goes.

## Security

Row-Level Security, enforced in the database rather than the UI:

- **TM** — own record, own manager, own KPI and submissions
- **Manager** — the above, plus direct reports
- **HR admin / SW admin** — everything

RLS is row-level only, so column rules (a TM may write `self_achieved` but
never `manager_achieved`) are enforced by guard triggers in migration `0006`.
Without them a TM could `PATCH` their own manager score straight through
PostgREST. Scores are always recomputed server-side and never accepted from a
client.

---

## Deploying

The app is a static build; Supabase is already hosted, so only the frontend
needs somewhere to live. `vercel.json` and `netlify.toml` are both committed,
so Vercel, Netlify and Cloudflare Pages all work with no further setup.

**Before sharing the URL outside the building**, take the app out of testing
mode:

```bash
node scripts/go-live.mjs
```

That switch used to be the only thing standing between a public URL and
anybody's account: the login screen reset any account back to
ecode-as-password for whoever typed that employee code, and the codes run
`E1`, `E2`, `E3`… Migration `0051` took the grant away from anonymous and
signed-in callers, so the route now goes through an emailed one-time code
(below) and the switch no longer decides anything on its own.

Still worth running before go-live. `--check` shows the current state,
`--revert` puts it back.

### Vercel (recommended)

1. Sign in at [vercel.com](https://vercel.com) with the GitHub account that
   owns `Kevi47/Cyrix-KPI`.
2. **Add New → Project**, import the repo. Framework auto-detects as Vite.
3. Under **Environment Variables**, add these three:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://emuvmihfbnndhbpsndvc.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | your `sb_publishable_…` key |
   | `VITE_AUTH_EMAIL_DOMAIN` | `cyrix.local` |

4. **Deploy.** Every push to `main` redeploys. Vercel gives the project a
   `*.vercel.app` URL; this one is served from **https://app.cyrix.in**.

**Only `VITE_`-prefixed variables belong here.** They are compiled into the
JavaScript that ships to the browser, so anyone can read them — which is fine
for the publishable key, and is why the `sb_secret_…` key and
`SUPABASE_DB_URL` must never be added. Those stay on the machine that runs the
admin scripts.

No Supabase auth configuration is needed: sign-in uses the password grant
directly, with no redirect URLs to allowlist.

### Custom domain

Live on **`app.cyrix.in`**, added under **Settings → Domains** with a CNAME
pointed at the Vercel host. HTTPS is issued automatically.

Nothing in the app knows its own address — every link, redirect, manifest
entry and service worker path is relative — so moving the domain needs no
code change and no redeploy.

What does not move is anything the *browser* files under the old origin.
Both of these are one-time costs of the move, not bugs:

- **Everyone is signed out.** The Supabase session lives in `localStorage`,
  which is per-origin, so the session from the old host is invisible here.
  Everybody signs in once more.
- **Per-person preferences reset**, for the same reason: the chosen language
  (`src/lib/i18n.ts`), the alert on/off setting (`src/lib/alerts.ts`) and the
  "has read the manual" flag (`src/lib/seenHelp.ts`). Harmless — the manual
  card simply offers itself again.
- **An already-installed PWA still points at the old host.** It was installed
  against that origin and keeps its own service worker there. Anyone who
  added the app to their home screen from the old address has to remove it
  and install again from this one.

And one place outside this repo will care later: **Supabase → Authentication
→ URL Configuration**. Nothing today needs it — sign-in is the password grant
with no redirects — but it matters the day password reset moves to an emailed
link or OTP.

## Running it locally

First time on a machine:

```bash
git clone https://github.com/Kevi47/Cyrix-KPI.git
```

```bash
cd Cyrix-KPI && npm install
```

Create `.env.local` (it is gitignored — never commit it):

```
VITE_SUPABASE_URL=https://emuvmihfbnndhbpsndvc.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
VITE_AUTH_EMAIL_DOMAIN=cyrix.local
SUPABASE_DB_URL=postgresql://postgres.emuvmihfbnndhbpsndvc:PASSWORD@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

Then every time:

```bash
npm run dev
```

Open **http://localhost:5173** and sign in with your employee code as both
the id and the password (in capitals) while the system is in testing.

Stop the server with `Ctrl+C`.

> **Connection note.** The direct `db.<ref>.supabase.co` host no longer
> resolves for this project — Supabase moved direct connections to IPv6-only.
> Use the **pooler** host above (`aws-0-ap-northeast-1.pooler.supabase.com`,
> port 5432, user `postgres.<project-ref>`). Percent-encode any `@` in the
> password as `%40`.

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

### Password reset and change codes

Both flows send a six-digit code to the address on the employee's record.
The code is generated in the `password-otp` edge function, hashed by
Postgres, and never stored, logged or returned.

```bash
supabase functions deploy password-otp
```

Then set the two secrets it needs. **These are function secrets, not
`VITE_` variables** — they must never reach the hosting provider, where
everything is compiled into the JavaScript the browser downloads:

```bash
supabase secrets set RESEND_API_KEY=re_xxx OTP_FROM='Cyrix KPI <no-reply@cyrix.in>'
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected by the platform. Resend needs `cyrix.in` verified first, which is
one DNS record on their dashboard.

Nobody can use any of this until employee records carry an address.
`work_email` exists on the table and the **bulk employee import already
reads an `email` or `work email` column**, so HR can load them from the
same spreadsheet they use for the roster — but note that the import also
stamps `must_change_password` on every row it touches, so an
email-only re-upload forces a password change company-wide.

Somebody with no address on record is not locked out. The change-password
page falls back to its old behaviour and says so, the first-login forced
change never asks for a code, and HR's own reset (`admin_reset_password`)
is untouched.

### Edge functions deploy themselves

`.github/workflows/deploy-functions.yml` deploys everything under
`supabase/functions/` on every push to `main` that touches them.

This exists because Vercel and Supabase are separate systems and only one
of them watches this repository. The site rebuilt on every push while the
edge function stayed on whatever build somebody last ran the CLI for —
which is how the Send test button spent a day answering "Unknown action"
from a function that predated it.

One secret is needed on the repository, under **Settings → Secrets and
variables → Actions**:

| Name | Where from |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens |

The project ref is in the workflow rather than in a secret — it is in the
URL of every request the browser already makes.

**Migrations are deliberately not automated.** Applying them needs
`SUPABASE_DB_URL`, which carries the database password and full write
access to every appraisal in the company; putting that in a CI secret to
save a command is a poor trade. They also run a schema change against
production the moment somebody merges, where today each one is a
deliberate act at a keyboard with a self-test that fails the whole
transaction. Keep using `npm run db:push`.

### Knowing whether a code actually arrived

A code went to a real address, Resend returned 2xx, and nothing landed —
not the inbox, not spam. Accepting a message is not delivering it, and
there was no way to tell "delivered", "bounced" and "quietly discarded"
apart.

The `mail-events` function records what the provider says happened after
it accepted a message. To switch it on:

1. **Resend → Webhooks → Add endpoint**, pointed at
   `https://<project>.supabase.co/functions/v1/mail-events`
2. Subscribe to at least `email.delivered`, `email.bounced` and
   `email.complained`
3. Copy the signing secret Resend shows (`whsec_…`) and set it:

```bash
supabase secrets set RESEND_WEBHOOK_SECRET=whsec_xxx
```

Until that secret exists the endpoint refuses everything with a 500, which
is deliberate: an unsigned "delivered" from a stranger is worse than no
record, because somebody would trust it.

The endpoint is deployed with `--no-verify-jwt` — Resend has no Supabase
token, and the Svix signature is what authenticates it. Verified before
anything is written, along with the timestamp, so a captured request
cannot be replayed later.

Each code carries the provider's message id (`password_otp.provider_id`),
so "he says he never got it" is a join rather than a guess:

```sql
select e.ecode, o.created_at, s.status
from password_otp o
join employees e on e.id = o.employee_id
left join v_mail_status s on s.provider_id = o.provider_id
order by o.created_at desc;
```
