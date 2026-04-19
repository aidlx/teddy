-- Temporal contract hardening:
-- - canonical per-user timezone on profiles
-- - per-event source timezone preserved from imports
-- - tasks store due-time semantics explicitly instead of only a bare instant

alter table public.profiles
  add column if not exists timezone text;

update public.profiles p
set timezone = (
  select s.tz
  from public.calendar_subscriptions s
  where s.owner_id = p.id
  order by s.created_at
  limit 1
)
where p.timezone is null;

alter table public.events
  add column if not exists source_tz text not null default 'UTC';

update public.events e
set source_tz = coalesce(s.tz, 'UTC')
from public.calendar_subscriptions s
where e.subscription_id = s.id
  and (e.source_tz is null or e.source_tz = 'UTC');

alter table public.tasks
  add column if not exists due_kind text not null default 'none'
    check (due_kind in ('none', 'date', 'datetime', 'event')),
  add column if not exists due_tz text,
  add column if not exists anchor_event_id uuid references public.events (id) on delete set null,
  add column if not exists offset_minutes integer not null default 0;

create index if not exists tasks_anchor_event_id_idx on public.tasks (anchor_event_id);

update public.tasks
set due_kind = case when due_at is null then 'none' else 'datetime' end;

update public.tasks t
set due_tz = coalesce(
  p.timezone,
  (
    select s.tz
    from public.calendar_subscriptions s
    where s.owner_id = p.id
    order by s.created_at
    limit 1
  ),
  'UTC'
)
from public.profiles p
where t.owner_id = p.id
  and t.due_at is not null
  and t.due_tz is null;
