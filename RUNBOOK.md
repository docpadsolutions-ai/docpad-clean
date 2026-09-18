# Runbook — the things only you can do

Written 18 September 2026. Everything here needs either a credential I should not
hold, a dashboard I cannot sign into, or a decision that is yours.

Do them in this order. Each one says why it matters, then the exact clicks. Where a
step can fail in a way that is confusing, the failure and its fix are written down
with it, because most of these have already bitten us once.

Reference values you will need more than once:

| Thing | Value |
| --- | --- |
| GitHub repo | `docpadsolutions-ai/docpad-clean` |
| Supabase project ref | `hvjbzlwlqnntwxgufjkm` |
| Pooler host | `aws-1-ap-south-1.pooler.supabase.com` |
| Pooler user | `postgres.hvjbzlwlqnntwxgufjkm` |

---

## 1. Push the 32 commits

**Why first.** Nothing else matters until the code is on GitHub. The new CI workflow
only exists on your laptop, so GitHub does not yet know the clinical-safety gate
exists. Adding the secret in step 3 to a repo that has no workflow to run does
nothing.

```bash
cd ~/docpad-clean
git log --oneline -32        # read what you are about to push
git push origin main
```

**Expect CI to go red, on lint, for a reason that predates today.** `ci.yml` runs
`eslint .` and there are 144 errors in the codebase, none of them from this week's
work. ESLint exits non-zero on errors no matter what `--max-warnings` says. Roughly
24 of those errors, the `react-hooks/purity`, `refs` and `immutability` ones, look
like genuine render-time bugs and are item 31 on the plan. Typecheck and build both
pass. Do not let the red badge make you think the safety work broke something; check
which job failed.

---

## 2. Reset the database password

**Why.** You pasted the old one into a chat window some days ago, so it should be
considered public. You also need a working password for step 3, and resetting gives
you a fresh one to copy in the same visit.

1. Open `https://supabase.com/dashboard/project/hvjbzlwlqnntwxgufjkm`
2. Left sidebar, bottom: **Project Settings** (the gear).
3. **Database**.
4. Find **Database password** and choose **Reset database password**. Supabase will
   generate one, or let you set your own.
5. **Copy it before you close the dialog.** It is shown once. Put it in your password
   manager now, not later.

**Nothing in the running app breaks when you do this.** The app talks to Supabase
using the anon and service-role API keys, not the database password. The password is
only used by things that connect to Postgres directly: `psql`, `pg_dump`, and the CI
job you are about to set up.

---

## 3. Add the `SUPABASE_DB_URL` secret to GitHub

**Why this is the highest-value two minutes on the list.** There are 68 database
assertions across two suites, including every clinical-safety rule built this week.
Without this secret the CI job skips all of them and finishes green. A gate that
cannot fail is not a gate; it is a decoration that makes you feel covered. The job
now prints a warning annotation saying exactly that, so you can see the state on any
run until you fix it.

### 3a. Build the connection string

The value is one line. Take this template and replace `PASSWORD` with the password
from step 2:

```
postgresql://postgres.hvjbzlwlqnntwxgufjkm:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres
```

**If your password contains any of** `@ : / ? # [ ] % &` **you must percent-encode it
first**, or the URL parser will read your password as a hostname. This is exactly what
went wrong when we tried `pg_dump` earlier: an unencoded `@` in the middle of the
password split the string in the wrong place and produced a baffling "could not
translate host name" error.

Encode it with one command:

```bash
node -e "console.log(encodeURIComponent(process.argv[1]))" 'your-password-here'
```

Use the output in place of `PASSWORD`. Single quotes around the password matter, so
the shell does not interpret the special characters itself.

Sanity check before you paste it anywhere: the string must contain exactly one `@`,
and it must be immediately before `aws-1-`. If there are two, the encoding did not
happen.

### 3b. Put it in GitHub

1. Go to `https://github.com/docpadsolutions-ai/docpad-clean/settings/secrets/actions`
   (or: repo → **Settings** tab → left sidebar **Secrets and variables** → **Actions**).
2. Click **New repository secret**.
3. **Name:** `SUPABASE_DB_URL` — exactly that, case-sensitive, no spaces.
4. **Secret:** paste the line from 3a.
5. **Add secret**.

You will not be able to read it back afterwards. That is normal. If you think you
typed it wrong, delete and re-add rather than trying to inspect it.

### 3c. Prove it actually works

Do not trust that it is right because the form accepted it.

1. Go to the repo's **Actions** tab.
2. In the left sidebar pick **Database safety tests**.
3. Click **Run workflow** → branch `main` → **Run workflow**.
4. Wait for it, then open the run.

What you want to see: a step named **Clinical safety suite** that ran and ended with
a line like `ALL PASS: 18 clinical-safety tests`, then **Tenancy and audit suite**
with 50, then **Migration drift** reporting that the migrations agree.

If instead you see a yellow warning saying the gate is inactive, the secret name is
wrong or empty. If you see a connection error, the password or the encoding is wrong;
redo 3a.

### 3d. Optional, but this is the point of having a gate

Once you have seen it pass, make it required so a broken clinical rule cannot be
merged:

1. Repo **Settings** → **Rules** → **Rulesets** (on older repos: **Branches** →
   **Branch protection rules**).
2. Target branch `main`.
3. Enable **Require status checks to pass**, and add the check named
   **Clinical safety, tenancy and migration drift**.

The check has to have run at least once before GitHub will offer it in that list,
which is why 3c comes first.

---

## 4. Seed the demo hospital

**Why.** There is currently nothing to demonstrate, nothing to stage, and nothing for
the §5 scripted clinical scenarios to run against. This creates a realistic OPD day
inside one clearly-labelled demo hospital and touches nothing else.

**Run it on your Mac, not in my sandbox.** It needs the service-role key to create the
two sign-in accounts, and that key should not travel further than it has to.

```bash
cd ~/docpad-clean
node scripts/seed-demo-day.mjs --dry     # prints what it would write, writes nothing
node scripts/seed-demo-day.mjs           # actually writes it
```

It reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`,
both already there. It takes a few seconds.

At the end it prints two sign-in accounts and a password. Sign in at `/auth` as the
doctor and try these five things, in this order. Each one exercises a rule that
existed only in the interface until this week, so this is also your acceptance test
that the week's work is real:

1. Open **Ramesh Kumar** and prescribe **Amoxicillin**. It should be refused. His
   record says penicillin, not amoxicillin, so plain name matching never caught this.
2. Prescribe **Cefuroxime** for him instead. It should warn, and let you proceed. A
   cephalosporin after a penicillin allergy is a decision, not a refusal.
3. Open **Mohammed Iqbal**, who is already on aceclofenac, and add **Warfarin**.
   Severe interaction, refused.
4. Finalise any encounter, then try to change the diagnosis. Refused by the database
   rather than hidden by the interface.
5. Reception → **Bookings**. Four booked today, one of them a follow-up the doctor set
   at the previous visit. Check one in and confirm it becomes a token rather than
   creating a second walk-in entry.

If any of those five behaves differently from the description, tell me which number
and what happened. That is a real defect, not a demo quirk.

To start over: `node scripts/seed-demo-day.mjs --reset`.
To remove it entirely: `node scripts/seed-demo-day.mjs --destroy`.

---

## 5. Set `CRON_SECRET` in Vercel

**Why.** Without it the appointment reminder route answers 503 and sends nothing. The
seed in step 4 creates a booking for tomorrow specifically so this has something real
to act on.

1. Generate a value:

   ```bash
   openssl rand -hex 32
   ```

2. Vercel → your DocPad project → **Settings** → **Environment Variables**.
3. **Key:** `CRON_SECRET`. **Value:** the output above. **Environment:** Production.
4. Save, then **redeploy** — environment variables only reach a deployment built
   after they are set. Deployments tab → latest → **Redeploy**.

Test it without messaging a real patient:

```bash
curl -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "https://YOUR-DOMAIN/api/reminders/appointments?kind=day_before&dry=1"
```

`dry=1` means it reports how many it would have sent and sends nothing.

`vercel.json` already schedules two runs a day, in UTC: 12:30 UTC is 18:00 IST for
tomorrow's bookings, and 02:30 UTC is 08:00 IST for today's. Change the `schedule`
fields if the clinic wants different hours.

---

## 6. Rotate the two exposed API keys

**Why.** The Gemini key shipped inside the browser bundle under
`NEXT_PUBLIC_GEMINI_API_KEY`, so anyone who opened DocPad could read it. The
service-role key was hardcoded in a script on disk.

### Gemini

1. Google AI Studio → **API keys** → create a new key → delete the old one.
2. Put the new key in three places, all as `GEMINI_API_KEY`, not the `NEXT_PUBLIC_`
   name:
   - `.env.local` on your Mac
   - Vercel → Settings → Environment Variables
   - Supabase → **Edge Functions** → **Secrets** (the edge functions have their own)
3. Once the app works on the new name, delete `NEXT_PUBLIC_GEMINI_API_KEY` from
   `.env.local` and from Vercel. The code still falls back to the old name, so
   nothing breaks in between and you can do this without a window of downtime.

### Service role

1. Supabase → **Project Settings** → **API** → rotate the `service_role` key.
2. Update `.env.local` and Vercel.

Rotating this one **will** break anything running with the old value, including my
seed script, so do it at a moment when you are not mid-task.

---

## 7. Two settings that take a minute each

**Leaked password protection.** Supabase → **Authentication** → **Policies** (or
**Providers** → Email, depending on where your dashboard puts it) → enable **leaked
password protection**. It checks new passwords against HaveIBeenPwned. There is no API
for it, which is why it is on your list and not mine.

**Publish a grievance officer.** The DPDP Act requires one to be published to patients,
and the obligation attaches from your first live patient record. Until it is filled in,
the registration form tells staff none exists and the patient-facing contact line is
blank. An admin does it once at `/data-rights`: name, phone, email, and how many years
records are kept.

Two things worth knowing while you are on that page. Patients registered before the
consent register existed have no consent row, because back-filling one would be
inventing evidence; take consent at their next visit, which is a few clicks on their
privacy page. And a correction request can only change demographic fields, deliberately
not clinical content, because an amendment to a clinical record should be a new entry
rather than an overwrite.

---

## 8. Staging — a decision, then twenty minutes

**Why it is not optional.** SOW §5 says all acceptance testing is performed on staging
against scripted clinical scenarios. One environment means the acceptance mechanism
itself cannot run, whatever else is built.

What I need from you is that the two things exist. I will do the wiring.

1. **A second Supabase project.** Supabase dashboard → **New project**. Name it
   something unmistakable like `docpad-staging`. Same region, `ap-south-1`. Free tier
   is enough for now. Save the project ref, the anon key, the service-role key and the
   database password somewhere I can be told them.
2. **A Vercel target.** Simplest version: create a `staging` branch in the repo and let
   Vercel's preview deployments serve it, with staging environment variables scoped to
   Preview. You do not have to configure anything beyond adding the variables; Vercel
   builds previews by default.

Then tell me it exists and I will: apply all 377 migrations to it, run the seed into
it, point the CI secret at staging rather than production so the assertions stop
running against real data, and write the `supabase/README` note on which environment is
which.

**One caution.** Right now those 68 assertions run against your production database.
They are written to roll back, and they do, but a test suite pointed at production is a
bad habit that eventually meets a suite that forgets to roll back. Moving the CI secret
to staging is the real reason this step is worth doing sooner rather than later.
