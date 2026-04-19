alter table public.conversations
  add column if not exists pending_action jsonb;

