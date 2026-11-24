-- passport.io – Bülten (Newsletter) und İndirim kodları (Rabattcodes)
-- Nur die Funktionen (Service-Rolle) lesen/schreiben; RLS ohne öffentliche Regeln.

create table if not exists public.newsletter_subscribers (
  id               bigserial primary key,
  email            text not null unique check (char_length(email) <= 254),
  lang             text check (char_length(lang) <= 5),
  source           text check (char_length(source) <= 120),
  consent_text     text check (char_length(consent_text) <= 300),   -- Einwilligungstext zum Zeitpunkt der Anmeldung (KVKK/DSGVO)
  created_at       timestamptz not null default now(),
  unsubscribed_at  timestamptz
);
alter table public.newsletter_subscribers enable row level security;
create index if not exists newsletter_created_idx on public.newsletter_subscribers (created_at desc);

create table if not exists public.discount_codes (
  id          bigserial primary key,
  code        text not null unique check (code ~ '^[A-Z0-9_-]{3,32}$'),
  kind        text not null default 'percent' check (kind in ('percent', 'fixed')),
  value       numeric(10, 2) not null check (value > 0),                -- % oder EUR
  min_amount  numeric(10, 2) not null default 0,                       -- Mindestbestellwert in EUR
  starts_at   timestamptz,
  ends_at     timestamptz,
  max_uses    integer check (max_uses is null or max_uses > 0),
  used_count  integer not null default 0,
  active      boolean not null default true,
  note        text check (char_length(note) <= 200),
  created_at  timestamptz not null default now()
);
alter table public.discount_codes enable row level security;

alter table public.orders add column if not exists coupon text;
alter table public.orders add column if not exists discount numeric(10, 2) not null default 0;

-- Nutzung eines Codes atomar zählen (nur wenn noch Nutzungen frei sind)
create or replace function public.use_discount(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update public.discount_codes set used_count = used_count + 1
   where code = p_code and active and (max_uses is null or used_count < max_uses)
  returning true into ok;
  return coalesce(ok, false);
end $$;
revoke all on function public.use_discount(text) from public, anon, authenticated;
