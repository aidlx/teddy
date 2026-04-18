-- Teddy — initial schema
-- Creates: profiles (mirrors auth.users), files (metadata for user uploads),
-- RLS policies, and a trigger that auto-creates a profile on sign-up.

-- ─────────────────────────────────────────────────────────────
-- profiles
-- ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- files (metadata; actual bytes live in storage bucket "user-files")
-- ─────────────────────────────────────────────────────────────
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  mime_type text not null,
  size bigint not null check (size >= 0),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists files_owner_id_idx on public.files (owner_id);

alter table public.files enable row level security;

create policy "files_select_own"
  on public.files for select
  using (auth.uid() = owner_id);

create policy "files_insert_own"
  on public.files for insert
  with check (auth.uid() = owner_id);

create policy "files_update_own"
  on public.files for update
  using (auth.uid() = owner_id);

create policy "files_delete_own"
  on public.files for delete
  using (auth.uid() = owner_id);

-- ─────────────────────────────────────────────────────────────
-- Storage bucket: user-files
-- Each user can only read/write under their own user-id prefix.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('user-files', 'user-files', false)
on conflict (id) do nothing;

create policy "user_files_select_own"
  on storage.objects for select
  using (
    bucket_id = 'user-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "user_files_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'user-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "user_files_update_own"
  on storage.objects for update
  using (
    bucket_id = 'user-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "user_files_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'user-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
