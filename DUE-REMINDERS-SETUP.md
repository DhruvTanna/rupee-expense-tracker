# Overdue reimbursement email reminders

The tracker supports an optional due date for each person on a shared expense. If the owner enables **Email me about overdue amounts** in Settings, the scheduled job emails a daily summary after the due date (starting the following day) while an amount remains unpaid. It stops once linked and unallocated reimbursements cover the outstanding shares. The reminder contains the person's name, expense description, due date, and pending amount; these details are sent through the configured email provider.

## What is included

- `supabase/functions/send-due-reminders/index.ts`: scheduled Supabase Edge Function; sends a single daily digest per user, and does not expose provider credentials to the browser.
- `supabase/due-reminders.sql`: private per-user send log table (one email per user per day).
- `supabase/config.toml`: disables platform JWT checking for this cron-only function; the function checks its own `x-reminder-secret` header.
- Website source: `index.html` (single-file app).

## One-time setup still required

Email delivery requires a Resend account with an approved sender address and an API key. Supabase's built-in email sender is intended for authentication emails and is not used for these reminders. Create a Resend API key and verify a sender domain/address in Resend; add the key and sender address only to Supabase Edge Function secrets. Never put either in the HTML app or GitHub.

### 1. Create the send log

In Supabase Dashboard → SQL Editor, run the contents of `supabase/due-reminders.sql`.

### 2. Add Edge Function secrets

In Supabase Dashboard → Edge Functions → Secrets, add:

- `RESEND_API_KEY`: the API key from Resend.
- `REMINDER_FROM`: the verified sender, for example `Rupee Tracker <reminders@your-verified-domain>`.
- `REMINDER_CRON_SECRET`: a new, long random secret used only by the scheduled job.

Supabase supplies `SUPABASE_URL` and the service role/secret key to the function runtime. Never expose those values in the app or a public file.

### 3. Deploy the function

Deploy `send-due-reminders` from this folder with the Supabase CLI (linked to project `bczqlmyswuucdiycodey`), or create it under Edge Functions in the Supabase Dashboard. Ensure **Verify JWT** is off for this function only. The handler authenticates the scheduler using `x-reminder-secret`; it does not accept browser-triggered sends.

### 4. Enable Cron and pg_net

In Supabase Dashboard → Database → Extensions, enable `pg_cron` and `pg_net`. In SQL Editor, store the scheduler values in Vault. Replace the three placeholders with your project URL, browser-safe publishable key, and the same `REMINDER_CRON_SECRET` you added to Edge Function secrets, then run once:

```sql
select vault.create_secret('https://bczqlmyswuucdiycodey.supabase.co', 'project_url');
select vault.create_secret('YOUR_SUPABASE_PUBLISHABLE_KEY', 'publishable_key');
select vault.create_secret('YOUR_REMINDER_CRON_SECRET', 'reminder_cron_secret');
```

Then schedule the daily 9:00 AM India-time check (03:30 UTC):

```sql
select cron.schedule(
  'rupee-overdue-email-reminders',
  '30 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-due-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key'),
      'x-reminder-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Supabase Cron can schedule HTTP calls to Edge Functions using `pg_cron` and `pg_net`, with sensitive request values stored in Vault. If you need to change a Vault value, update the existing secret rather than creating duplicate names. View `cron.job_run_details` and the Edge Function logs to check execution and delivery failures.

### 5. Turn reminders on

In the tracker, open **Settings → Email reminders** and enable **Email me about overdue amounts**. When adding or editing a split expense, enter a due date on each person's share. An amount without a due date is never emailed.

If Resend or its sender domain has not been configured, the website can still record due dates, but automatic emails will not be sent. Resend may also restrict sending until your sender domain is verified.

