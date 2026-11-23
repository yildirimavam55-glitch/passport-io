-- passport.io – Grundtabellen
-- Beide Tabellen sind von außen gesperrt (RLS an, keine öffentlichen Regeln).
-- Nur die Edge Functions greifen mit dem Service-Schlüssel darauf zu.

-- Zwischenspeicher der Anbieterpreise (eine Zeile "current")
create table if not exists public.price_cache (
  id          text primary key,
  body        jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.price_cache enable row level security;

-- Fragen, die Lina nicht beantworten konnte
create table if not exists public.unanswered_questions (
  id          bigint generated always as identity primary key,
  question    text not null check (char_length(question) between 3 and 300),
  page        text,
  created_at  timestamptz not null default now(),
  handled     boolean not null default false
);
alter table public.unanswered_questions enable row level security;
create index if not exists unanswered_questions_open_idx
  on public.unanswered_questions (created_at desc) where not handled;

-- Übersicht fürs Team: welche Fragen kommen am häufigsten?
create or replace view public.top_unanswered with (security_invoker = true) as
  select lower(question) as question, count(*) as times, max(created_at) as last_asked
  from public.unanswered_questions
  where not handled
  group by lower(question)
  order by times desc, last_asked desc;
