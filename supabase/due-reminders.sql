create table if not exists public.due_reminder_email_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_date date not null,
  recipient_key text not null,
  status text not null check (status in ('sending', 'sent')),
  created_at timestamptz not null default now()
);
alter table public.due_reminder_email_log add column if not exists recipient_key text not null default 'owner';
alter table public.due_reminder_email_log drop constraint if exists due_reminder_email_log_pkey;
alter table public.due_reminder_email_log add constraint due_reminder_email_log_pkey primary key (user_id, reminder_date, recipient_key);
alter table public.due_reminder_email_log enable row level security;
revoke all on public.due_reminder_email_log from anon, authenticated;
grant all on public.due_reminder_email_log to service_role;

