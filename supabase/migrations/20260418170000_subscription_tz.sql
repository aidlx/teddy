-- Per-subscription IANA timezone. Times in the DB are canonical UTC, but
-- UI rendering needs to know which zone to display them in — the user's
-- browser tz is unreliable (system clocks lie). Default to Europe/Vienna
-- because the only real user so far is on a TU Graz feed; new subscriptions
-- will be created with the browser-detected tz.
alter table public.calendar_subscriptions
  add column if not exists tz text not null default 'Europe/Vienna';
