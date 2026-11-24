-- passport.io – Startdaten Wettbewerbspreise (öffentliche Preisseiten von Nomad, abgerufen am 24.11.2026)
-- Nur Tarife mit festem Volumen und eindeutigem Preis; unklare Aktionspreise wurden weggelassen.
-- Preise ändern sich – im Verwaltungspanel unter „Preise & Wettbewerb“ regelmäßig prüfen und aktualisieren.
insert into public.competitor_prices (item_key, gb, days, price, currency, competitor, url, checked_at)
select v.item_key, v.gb, v.days, v.price, 'USD', 'Nomad', v.url, '2026-11-24T12:00:00Z'::timestamptz
from (values
  ('country:tr', 1, 7, 4.00, 'https://www.nomadesim.com/turkey-esim'),
  ('country:tr', 3, 30, 6.00, 'https://www.nomadesim.com/turkey-esim'),
  ('country:tr', 5, 30, 9.00, 'https://www.nomadesim.com/turkey-esim'),
  ('country:tr', 20, 30, 26.00, 'https://www.nomadesim.com/turkey-esim'),
  ('country:tr', 50, 30, 40.30, 'https://www.nomadesim.com/turkey-esim'),
  ('country:jp', 1, 7, 4.00, 'https://www.nomadesim.com/japan-esim'),
  ('country:jp', 3, 30, 7.00, 'https://www.nomadesim.com/japan-esim'),
  ('country:jp', 5, 30, 10.00, 'https://www.nomadesim.com/japan-esim'),
  ('country:jp', 50, 30, 45.50, 'https://www.nomadesim.com/japan-esim'),
  ('country:us', 1, 7, 4.00, 'https://www.nomadesim.com/united-states-esim'),
  ('country:us', 3, 30, 4.00, 'https://www.nomadesim.com/united-states-esim'),
  ('country:us', 5, 30, 7.20, 'https://www.nomadesim.com/united-states-esim'),
  ('country:us', 10, 30, 10.40, 'https://www.nomadesim.com/united-states-esim'),
  ('country:us', 20, 30, 16.80, 'https://www.nomadesim.com/united-states-esim'),
  ('country:us', 50, 30, 24.00, 'https://www.nomadesim.com/united-states-esim'),
  ('country:th', 1, 7, 5.00, 'https://www.nomadesim.com/thailand-esim'),
  ('country:th', 3, 30, 6.00, 'https://www.nomadesim.com/thailand-esim'),
  ('country:th', 5, 30, 8.00, 'https://www.nomadesim.com/thailand-esim'),
  ('country:th', 10, 30, 13.00, 'https://www.nomadesim.com/thailand-esim'),
  ('country:th', 50, 10, 15.00, 'https://www.nomadesim.com/thailand-esim'),
  ('country:ae', 1, 7, 4.00, 'https://www.nomadesim.com/united-arab-emirates-esim'),
  ('country:ae', 3, 30, 8.50, 'https://www.nomadesim.com/united-arab-emirates-esim'),
  ('country:ae', 5, 30, 11.00, 'https://www.nomadesim.com/united-arab-emirates-esim'),
  ('country:ae', 10, 30, 18.50, 'https://www.nomadesim.com/united-arab-emirates-esim'),
  ('country:ae', 20, 30, 29.00, 'https://www.nomadesim.com/united-arab-emirates-esim'),
  ('country:it', 1, 7, 4.00, 'https://www.nomadesim.com/italy-esim'),
  ('country:it', 3, 30, 7.00, 'https://www.nomadesim.com/italy-esim'),
  ('country:it', 5, 30, 11.00, 'https://www.nomadesim.com/italy-esim'),
  ('country:it', 10, 30, 18.50, 'https://www.nomadesim.com/italy-esim'),
  ('country:it', 20, 30, 25.00, 'https://www.nomadesim.com/italy-esim'),
  ('country:it', 50, 30, 35.00, 'https://www.nomadesim.com/italy-esim')
) as v(item_key, gb, days, price, url)
where not exists (select 1 from public.competitor_prices c where c.competitor = 'Nomad' and c.item_key = v.item_key and c.gb = v.gb and c.days = v.days);
