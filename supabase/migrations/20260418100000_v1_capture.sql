-- Teddy V1 — courses, tasks, notes
--
-- Core model: users define courses; every capture (parsed by the AI) lands as
-- either a task (with due_at) or a note. Both can optionally link to a course.
-- Everything is per-user via RLS.

-- ─────────────────────────────────────────────────────────────
-- courses
-- ─────────────────────────────────────────────────────────────
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  code text,
  color text,
  schedule_text text,
  created_at timestamptz not null default now()
);

create index if not exists courses_owner_id_idx on public.courses (owner_id);

alter table public.courses enable row level security;

create policy "courses_select_own" on public.courses for select using (auth.uid() = owner_id);
create policy "courses_insert_own" on public.courses for insert with check (auth.uid() = owner_id);
create policy "courses_update_own" on public.courses for update using (auth.uid() = owner_id);
create policy "courses_delete_own" on public.courses for delete using (auth.uid() = owner_id);

-- ─────────────────────────────────────────────────────────────
-- tasks
-- ─────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  title text not null,
  description text,
  due_at timestamptz,
  completed_at timestamptz,
  raw_capture text,
  created_at timestamptz not null default now()
);

create index if not exists tasks_owner_id_idx on public.tasks (owner_id);
create index if not exists tasks_due_at_idx on public.tasks (owner_id, due_at) where completed_at is null;

alter table public.tasks enable row level security;

create policy "tasks_select_own" on public.tasks for select using (auth.uid() = owner_id);
create policy "tasks_insert_own" on public.tasks for insert with check (auth.uid() = owner_id);
create policy "tasks_update_own" on public.tasks for update using (auth.uid() = owner_id);
create policy "tasks_delete_own" on public.tasks for delete using (auth.uid() = owner_id);

-- ─────────────────────────────────────────────────────────────
-- notes
-- ─────────────────────────────────────────────────────────────
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  title text,
  content text not null,
  raw_capture text,
  created_at timestamptz not null default now()
);

create index if not exists notes_owner_id_idx on public.notes (owner_id);
create index if not exists notes_created_at_idx on public.notes (owner_id, created_at desc);

alter table public.notes enable row level security;

create policy "notes_select_own" on public.notes for select using (auth.uid() = owner_id);
create policy "notes_insert_own" on public.notes for insert with check (auth.uid() = owner_id);
create policy "notes_update_own" on public.notes for update using (auth.uid() = owner_id);
create policy "notes_delete_own" on public.notes for delete using (auth.uid() = owner_id);
