-- passport.io – Zahlungen, Retouren, Support-Anfragen, Admin-Protokoll
-- Sicherheitskorrektur: Bestellungen bleiben bei Kontolöschung erhalten (gesetzliche Aufbewahrung
-- von Rechnungsdaten), werden aber vom Konto getrennt. Die E-Mail wird zur Bestellung gespeichert.

-- Bestellungen: Aufbewahrung + Zahlungsdaten
alter table public.orders add column if not exists customer_email text;
alter table public.orders alter column user_id drop not null;
alter table public.orders drop constraint if exists orders_user_id_fkey;
alter table public.orders add constraint orders_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;
alter table public.orders add column if not exists payment_provider text;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists refunded_amount numeric(10, 2) not null default 0;
-- Eine Zahlung darf nur einmal verbucht werden (Schutz vor doppelt eintreffenden Webhooks)
create unique index if not exists orders_payment_ref_uidx on public.orders (payment_ref) where payment_ref is not null;
update public.orders o set customer_email = u.email from auth.users u where o.user_id = u.id and o.customer_email is null;

-- Retouren / Erstattungsanträge (je Bestellung höchstens einer)
create table if not exists public.refund_requests (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null unique references public.orders (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete set null,
  customer_email  text,
  reason          text check (char_length(reason) <= 1000),
  status          text not null default 'open' check (status in ('open', 'approved', 'rejected')),
  admin_note      text check (char_length(admin_note) <= 1000),
  decided_by      text,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.refund_requests enable row level security;
drop policy if exists "Eigene Retouren lesen" on public.refund_requests;
create policy "Eigene Retouren lesen" on public.refund_requests for select to authenticated using ((select auth.uid()) = user_id);

-- Support-Anfragen (aus dem Kundenkonto und von Lina „Mit einem Menschen sprechen“)
create table if not exists public.support_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete set null,
  email       text not null check (char_length(email) <= 254),
  name        text check (char_length(name) <= 120),
  subject     text check (char_length(subject) <= 160),
  message     text not null check (char_length(message) between 5 and 4000),
  order_id    uuid references public.orders (id) on delete set null,
  page        text check (char_length(page) <= 120),
  status      text not null default 'open' check (status in ('open', 'answered', 'closed')),
  admin_note  text check (char_length(admin_note) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.support_requests enable row level security;
create index if not exists support_requests_open_idx on public.support_requests (created_at desc) where status = 'open';
drop policy if exists "Eigene Anfragen lesen" on public.support_requests;
create policy "Eigene Anfragen lesen" on public.support_requests for select to authenticated using ((select auth.uid()) = user_id);

-- Admin-Protokoll: wer hat wann was geändert (nur über die Funktion „admin“ beschreibbar)
create table if not exists public.admin_audit (
  id           bigint generated always as identity primary key,
  admin_email  text not null,
  action       text not null,
  target       text,
  details      jsonb,
  created_at   timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);
