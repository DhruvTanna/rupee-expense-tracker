create table if not exists public.due_reminder_email_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_date date not null,
  status text not null check (status in ('sending', 'sent')),
  created_at timestamptz not null default now(),
  primary key (user_id, reminder_date)
);
alter table public.due_reminder_email_log enable row level security;
revoke all on public.due_reminder_email_log from anon, authenticated;
grant all on public.due_reminder_email_log to service_role;

