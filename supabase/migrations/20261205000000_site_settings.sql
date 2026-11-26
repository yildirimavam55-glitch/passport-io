-- passport.io – Einstellungen, die das Panel ohne neuen Deploy ändert (z. B. Pop-up: Newsletter oder Aktion).
-- Lesen und Schreiben nur über Edge Functions (Service-Schlüssel); der Browser bekommt nur die öffentlichen Teile.
create table if not exists public.site_settings (
  key        text primary key check (char_length(key) <= 40),
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
