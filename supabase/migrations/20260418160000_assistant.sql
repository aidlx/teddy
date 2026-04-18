-- Agent chat threads. Messages preserve the full OpenAI-style record
-- including tool calls and tool results, so the UI can replay the
-- assistant's reasoning after reload.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_owner_updated_idx
  on public.conversations (owner_id, updated_at desc);

alter table public.conversations enable row level security;

create policy "conversations_select_own"
  on public.conversations for select
  using (auth.uid() = owner_id);

create policy "conversations_insert_own"
  on public.conversations for insert
  with check (auth.uid() = owner_id);

create policy "conversations_update_own"
  on public.conversations for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "conversations_delete_own"
  on public.conversations for delete
  using (auth.uid() = owner_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content text,
  tool_calls jsonb,
  tool_call_id text,
  name text,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

alter table public.messages enable row level security;

create policy "messages_select_own"
  on public.messages for select
  using (auth.uid() = owner_id);

create policy "messages_insert_own"
  on public.messages for insert
  with check (auth.uid() = owner_id);

create policy "messages_update_own"
  on public.messages for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "messages_delete_own"
  on public.messages for delete
  using (auth.uid() = owner_id);
