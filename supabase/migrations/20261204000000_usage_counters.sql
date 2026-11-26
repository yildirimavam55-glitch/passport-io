-- passport.io – Tageszähler (z. B. Lina-KI-Anfragen), damit die Kosten auch bei Missbrauch gedeckelt bleiben.
-- Nur die Edge Functions (Service-Schlüssel) zählen; aus dem Browser ist nichts lesbar oder schreibbar.
create table if not exists public.usage_counters (
  day   date not null default current_date,
  name  text not null check (char_length(name) <= 40),
  count integer not null default 0,
  primary key (day, name)
);
alter table public.usage_counters enable row level security;

create or replace function public.bump_usage(p_name text, p_max integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.usage_counters (day, name, count) values (current_date, p_name, 1)
  on conflict (day, name) do update set count = public.usage_counters.count + 1
  returning count into n;
  return n <= p_max;
end $$;
revoke all on function public.bump_usage(text, integer) from public, anon, authenticated;
