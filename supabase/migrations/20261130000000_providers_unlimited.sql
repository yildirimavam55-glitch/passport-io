-- passport.io – zwei eSIM-Anbieter (eSIM Access: Datenvolumen, eSIM Go: Unlimited)
-- Bestellungen merken sich Volumen/Laufzeit des Tarifs, eSIMs ihren Anbieter und ob sie unbegrenzt sind.
alter table public.orders add column if not exists plan_meta jsonb;
alter table public.esims add column if not exists provider text;
alter table public.esims add column if not exists unlimited boolean not null default false;

-- Neuer Status „processing“: Anbieter erzeugt das Profil noch (bei eSIM Access bis ca. 30 Sekunden)
alter table public.esims drop constraint if exists esims_status_check;
alter table public.esims add constraint esims_status_check
  check (status in ('processing', 'ready', 'installed', 'active', 'depleted', 'expired', 'cancelled'));

-- Wettbewerbspreise: gb = 0 bedeutet „Unlimited“ (gb leer = gilt für jedes Volumen)
comment on column public.competitor_prices.gb is 'Datenvolumen in GB; 0 = Unlimited; leer = beliebig';
