-- passport.io – Lounge & Fast Track ohne Anbieter-API: Zustellung über Partner (Kontaktperson)
-- Ablauf: Kunde bucht → Buchung geht per E-Mail/WhatsApp mit geschütztem Link an den Partner →
-- Partner lädt im Partner-Portal (partner.html) den QR-Code/Voucher hoch → Kunde bekommt ihn im Konto.
-- Alle Tabellen nur über Edge Functions (Service-Schlüssel); keine Browser-Zugriffe (RLS ohne Policies).

-- Partner (z. B. Kontaktperson, die Lounge-Zugänge kauft)
create table if not exists public.airport_partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) <= 120),
  email       text check (char_length(email) <= 200),
  whatsapp    text check (char_length(whatsapp) <= 30),      -- internationale Nummer, nur Ziffern, z. B. 905321234567
  language    text not null default 'tr' check (char_length(language) <= 5),
  active      boolean not null default true,
  notes       text check (char_length(notes) <= 2000),
  created_at  timestamptz not null default now()
);
alter table public.airport_partners enable row level security;

-- Preisliste des Partners (Einkauf). Verkaufspreis = Preisregel (siehe _shared/airport.ts), nie fest im Code.
create table if not exists public.airport_offers (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid references public.airport_partners (id) on delete set null,
  product       text not null check (product in ('lounge', 'fasttrack')),
  airport       text not null check (airport ~ '^[A-Z]{3}$'),  -- IATA-Code, z. B. IST
  airport_name  text check (char_length(airport_name) <= 120),
  terminal      text check (char_length(terminal) <= 60),
  title         text not null check (char_length(title) <= 160),
  details       text check (char_length(details) <= 1000),
  cost          numeric(10, 2) not null check (cost > 0),      -- Einkauf pro Person
  cost_currency text not null default 'EUR' check (cost_currency ~ '^[A-Z]{3}$'),
  max_persons   integer not null default 8 check (max_persons between 1 and 20),
  lead_hours    integer not null default 24 check (lead_hours between 0 and 720), -- Mindestvorlauf vor Abflug
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.airport_offers enable row level security;
create index if not exists airport_offers_airport_idx on public.airport_offers (airport, product) where active;

-- Buchungen / Zustellung
create table if not exists public.airport_bookings (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid references public.orders (id) on delete set null,
  user_id         uuid references auth.users (id) on delete set null,
  offer_id        uuid references public.airport_offers (id) on delete set null,
  partner_id      uuid references public.airport_partners (id) on delete set null,
  product         text not null check (product in ('lounge', 'fasttrack')),
  airport         text not null,
  title           text,
  travel_date     date not null,
  travel_time     text check (char_length(travel_time) <= 5),   -- Abflugzeit HH:MM (Ortszeit Flughafen)
  flight          text check (char_length(flight) <= 12),
  persons         integer not null default 1 check (persons between 1 and 20),
  names           text[] not null default '{}',
  customer_email  text,
  customer_phone  text check (char_length(customer_phone) <= 30),
  customer_note   text check (char_length(customer_note) <= 1000),
  status          text not null default 'new'
                  check (status in ('new', 'sent', 'accepted', 'delivered', 'declined', 'failed', 'cancelled')),
  token           text unique,                                  -- Zugang zum Partner-Portal (geheimer Link)
  cost            numeric(10, 2),                               -- Einkauf gesamt (intern)
  cost_currency   text,
  test            boolean not null default false,
  sent_at         timestamptz,
  due_at          timestamptz,                                  -- bis wann der Partner liefern soll
  accepted_at     timestamptz,
  delivered_at    timestamptz,
  reminded_at     timestamptz,
  reminders       integer not null default 0,
  alerted_at      timestamptz,                                  -- Warnung an das Team verschickt
  files           jsonb not null default '[]'::jsonb,           -- [{path, name, type, size, at}]
  partner_note    text check (char_length(partner_note) <= 1000),
  admin_note      text check (char_length(admin_note) <= 2000),
  log             jsonb not null default '[]'::jsonb,           -- Verlauf [{at, who, what}]
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.airport_bookings enable row level security;
create index if not exists airport_bookings_status_idx on public.airport_bookings (status, created_at desc);
create index if not exists airport_bookings_user_idx on public.airport_bookings (user_id, created_at desc);
create index if not exists airport_bookings_order_idx on public.airport_bookings (order_id);

-- Privater Speicher für QR-Codes / Voucher (Zugriff nur über signierte, kurzlebige Links)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vouchers', 'vouchers', false, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
