-- Captures: the raw text users type + the parser output.
-- Tasks and notes link back to the capture they came from, so users can trace
-- any item to its source message and see how the AI interpreted their words.

create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  raw_text text not null,
  parsed_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists captures_owner_id_created_at_idx
  on public.captures (owner_id, created_at desc);

alter table public.captures enable row level security;

create policy "captures_select_own" on public.captures for select using (auth.uid() = owner_id);
create policy "captures_insert_own" on public.captures for insert with check (auth.uid() = owner_id);
create policy "captures_update_own" on public.captures for update using (auth.uid() = owner_id);
create policy "captures_delete_own" on public.captures for delete using (auth.uid() = owner_id);

-- Provenance FKs. on delete set null: deleting a capture keeps derived items.
alter table public.tasks add column if not exists capture_id uuid
  references public.captures (id) on delete set null;
alter table public.notes add column if not exists capture_id uuid
  references public.captures (id) on delete set null;

create index if not exists tasks_capture_id_idx on public.tasks (capture_id);
create index if not exists notes_capture_id_idx on public.notes (capture_id);

-- raw_capture is redundant now that capture_id + captures.raw_text exists.
alter table public.tasks drop column if exists raw_capture;
alter table public.notes drop column if exists raw_capture;
