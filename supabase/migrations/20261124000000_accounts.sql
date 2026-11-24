-- passport.io – Kundenkonten, Bestellungen und gebuchte eSIMs
-- Zugriffsschutz (RLS): Jede Kundin / jeder Kunde sieht ausschließlich die eigenen Daten.
-- Schreiben von Bestellungen und eSIMs passiert nur über die Edge Functions (Service-Schlüssel),
-- damit Preise und eSIM-Daten nie aus dem Browser kommen.

-- Profil (wird bei der Registrierung automatisch angelegt)
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (char_length(full_name) <= 120),
  language    text check (char_length(language) <= 5),
  currency    text check (char_length(currency) <= 3),
  marketing   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "Profil lesen" on public.profiles;
create policy "Profil lesen" on public.profiles for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "Profil ändern" on public.profiles;
create policy "Profil ändern" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, language)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    left(coalesce(new.raw_user_meta_data ->> 'language', ''), 5)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Bestellungen (Preis wird auf dem Server aus der Preis-Schnittstelle übernommen)
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  product         text not null check (product in ('esim', 'lounge', 'fasttrack')),
  item_key        text not null,              -- z. B. country:jp
  plan_id         text not null,              -- Tarif-ID des Anbieters
  title           text,
  amount          numeric(10, 2) not null check (amount >= 0),
  currency        text not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'paid', 'fulfilled', 'failed', 'refunded', 'cancelled')),
  payment_ref     text,                       -- Referenz des Zahlungsanbieters
  test            boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.orders enable row level security;
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

drop policy if exists "Bestellungen lesen" on public.orders;
create policy "Bestellungen lesen" on public.orders for select to authenticated using ((select auth.uid()) = user_id);

-- Gebuchte eSIMs (Daten vom eSIM-Anbieter)
create table if not exists public.esims (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  order_id         uuid references public.orders (id) on delete set null,
  country          text,                      -- Ländercode oder Region
  plan_name        text,
  iccid            text,
  lpa              text,                      -- Inhalt des QR-Codes: LPA:1$smdp$code
  smdp_address     text,
  activation_code  text,
  data_total_mb    integer,
  data_used_mb     integer not null default 0,
  validity_days    integer,
  status           text not null default 'ready'
                   check (status in ('ready', 'installed', 'active', 'depleted', 'expired', 'cancelled')),
  activated_at     timestamptz,
  expires_at       timestamptz,
  provider_ref     text,                      -- ID beim eSIM-Anbieter (für Verbrauchsabfrage)
  usage_checked_at timestamptz,
  test             boolean not null default false,
  created_at       timestamptz not null default now()
);
alter table public.esims enable row level security;
create index if not exists esims_user_idx on public.esims (user_id, created_at desc);

drop policy if exists "eSIMs lesen" on public.esims;
create policy "eSIMs lesen" on public.esims for select to authenticated using ((select auth.uid()) = user_id);
