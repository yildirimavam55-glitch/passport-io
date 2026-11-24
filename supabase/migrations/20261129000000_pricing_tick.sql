-- passport.io – Preisregel: „ein Tick“ unter dem Wettbewerber = auf den nächsttieferen ,99-Preis abrunden.
-- Der Abstand ist daher nur noch 1 Cent (vor dem Abrunden), z. B. Airalo 10,06 € → 9,99 €.
alter table public.pricing_settings alter column undercut_eur set default 0.01;
update public.pricing_settings set undercut_eur = 0.01 where id = 1 and undercut_eur = 0.10;
