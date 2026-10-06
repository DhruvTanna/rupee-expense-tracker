# Overdue reimbursement email reminders

The tracker has separate opt-in switches for the signed-in user's own daily digest and for emailing people who owe them. Each person can have an optional email address in **People & Dues → Edit**. Emailing those people is off by default. When enabled, each receives a daily digest containing only their own overdue shared-expense items. Reminders start the day after the due date at 9:00 AM India time and stop once recorded payments cover the share.

Emails include person names, expense descriptions, due dates, and pending amounts. Delivery uses the configured email provider (Resend). The debtor does not need a tracker account and receives no login access.

## Included files

- `supabase/functions/send-due-reminders/index.ts`: scheduled Supabase Edge Function. Sends owner and debtor emails according to their separate settings, with no provider secrets in the browser.
- `supabase/due-reminders.sql`: private per-recipient send log table. Safe to run for a fresh setup or to upgrade the earlier owner-only log table.
- `supabase/config.toml`: disables platform JWT checking for this cron-only function; the handler checks its own `x-reminder-secret` header.
- Website: `index.html`.

## One-time setup still required

Email delivery requires a Resend account with an approved sender address and an API key. Create a Resend API key and verify a sender domain/address in Resend; add the key and sender address only to Supabase Edge Function secrets. Never put either in the HTML app or GitHub.

### 1. Create or upgrade the send log

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

Supabase Cron can schedule Edge Function calls using `pg_cron` and `pg_net`, with sensitive request values stored in Vault. View `cron.job_run_details` and the Edge Function logs to check execution and delivery failures.

### 5. Choose who receives reminders

In the tracker **Settings → Email reminders**, switch on **Email me about overdue amounts** for your own digest. Separately switch on **Also email people who owe me** to notify debtors. Both start off. For a debtor notice, add that person's address using **People & Dues → Edit** and enter a due date on their share in the expense form. People without a saved email or shares without a due date receive no email.

If Resend or its sender domain has not been configured, the app can still save preferences and due dates, but automatic emails will not be sent. Resend may restrict sending until your sender domain is verified.

