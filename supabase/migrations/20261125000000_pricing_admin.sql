-- passport.io – Preisregeln, Wettbewerbspreise und Admin-Rollen
-- Alle Tabellen sind von außen gesperrt (RLS an, keine öffentlichen Regeln).
-- Lesen und Schreiben nur über die Edge Functions (Service-Schlüssel), Admin-Zugriff nur für ADMIN_EMAILS.

-- Preisregel (genau eine Zeile)
create table if not exists public.pricing_settings (
  id              integer primary key default 1 check (id = 1),
  markup_factor   numeric(6, 3) not null default 2      check (markup_factor >= 1),   -- ohne Wettbewerbspreis: Einkauf × Faktor
  undercut_eur    numeric(8, 2) not null default 0.10   check (undercut_eur >= 0),    -- „ein Tick“ unter dem günstigsten Wettbewerber
  min_price_eur   numeric(8, 2) not null default 2.99   check (min_price_eur >= 0),   -- absolute Untergrenze
  min_margin_pct  numeric(6, 2) not null default 10     check (min_margin_pct >= 0),  -- nie weniger als Einkauf + Marge
  round_99        boolean not null default true,                                      -- Faktorpreise auf ,99 runden
  updated_at      timestamptz not null default now()
);
alter table public.pricing_settings enable row level security;
insert into public.pricing_settings (id) values (1) on conflict (id) do nothing;

-- Wettbewerbspreise (manuell im Verwaltungspanel oder per CSV-Import)
create table if not exists public.competitor_prices (
  id          bigint generated always as identity primary key,
  item_key    text not null,                 -- country:jp, region:europe, global, lounge, fasttrack
  gb          numeric(8, 2),                 -- leer = gilt für jedes Volumen (z. B. Lounge)
  days        integer,                       -- leer = gilt für jede Laufzeit
  price       numeric(10, 2) not null check (price > 0),
  currency    text not null default 'EUR',
  competitor  text not null,
  url         text,
  active      boolean not null default true,
  checked_at  timestamptz not null default now()
);
alter table public.competitor_prices enable row level security;
create index if not exists competitor_prices_item_idx on public.competitor_prices (item_key, gb, days) where active;
