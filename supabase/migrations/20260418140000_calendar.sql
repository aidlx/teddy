-- Calendar subscriptions (iCal feeds the user has linked) and materialized events.
-- Events come from two sources:
--   * 'ical'   — imported from a subscribed iCal feed
--   * 'manual' — created directly in Teddy (future)

create table if not exists public.calendar_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  ical_url text not null,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists calendar_subscriptions_owner_id_idx
  on public.calendar_subscriptions (owner_id);

alter table public.calendar_subscriptions enable row level security;

create policy "calendar_subscriptions_select_own"
  on public.calendar_subscriptions for select
  using (auth.uid() = owner_id);

create policy "calendar_subscriptions_insert_own"
  on public.calendar_subscriptions for insert
  with check (auth.uid() = owner_id);

create policy "calendar_subscriptions_update_own"
  on public.calendar_subscriptions for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "calendar_subscriptions_delete_own"
  on public.calendar_subscriptions for delete
  using (auth.uid() = owner_id);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  subscription_id uuid references public.calendar_subscriptions (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  source text not null default 'ical' check (source in ('ical', 'manual')),
  ical_uid text,
  title text not null,
  location text,
  description text,
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists events_owner_id_start_at_idx
  on public.events (owner_id, start_at);
create index if not exists events_subscription_id_idx
  on public.events (subscription_id);
create index if not exists events_course_id_idx
  on public.events (course_id);

alter table public.events enable row level security;

create policy "events_select_own"
  on public.events for select
  using (auth.uid() = owner_id);

create policy "events_insert_own"
  on public.events for insert
  with check (auth.uid() = owner_id);

create policy "events_update_own"
  on public.events for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "events_delete_own"
  on public.events for delete
  using (auth.uid() = owner_id);
