/* Bekannte Netzbetreiber für das Laufband auf der Startseite.
   Die Liste nennt nur, welche Marken als „bekannt“ gelten (Reihenfolge = Wichtigkeit).
   Angezeigt wird eine Marke nur, wenn die Anbieter-API sie im genannten Land wirklich liefert. */

type Brand = { n: string; c: string; re: RegExp };
const BRANDS: Brand[] = [
  { n: "Turkcell", c: "tr", re: /turkcell/i },
  { n: "Telekom", c: "de", re: /telekom|t-mobile/i },
  { n: "Vodafone", c: "de", re: /vodafone/i },
  { n: "Türk Telekom", c: "tr", re: /t[üu]rk ?telekom|avea/i },
  { n: "Orange", c: "fr", re: /orange/i },
  { n: "AT&T", c: "us", re: /at ?& ?t/i },
  { n: "NTT Docomo", c: "jp", re: /docomo/i },
  { n: "TIM", c: "it", re: /\btim\b|telecom italia/i },
  { n: "Movistar", c: "es", re: /movistar|telef[oó]nica/i },
  { n: "EE", c: "gb", re: /^ee\b|everything everywhere/i },
  { n: "SK Telecom", c: "kr", re: /sk ?telecom|\bskt\b/i },
  { n: "T-Mobile", c: "us", re: /t-mobile/i },
  { n: "Swisscom", c: "ch", re: /swisscom/i },
  { n: "Etisalat", c: "ae", re: /etisalat|^e&/i },
  { n: "Verizon", c: "us", re: /verizon/i },
  { n: "SoftBank", c: "jp", re: /softbank/i },
  { n: "O2", c: "gb", re: /\bo2\b/i },
  { n: "KPN", c: "nl", re: /\bkpn\b/i },
  { n: "A1", c: "at", re: /^a1\b/i },
  { n: "KDDI au", c: "jp", re: /kddi|^au\b/i },
  { n: "Singtel", c: "sg", re: /singtel/i },
  { n: "Telstra", c: "au", re: /telstra/i },
  { n: "KT", c: "kr", re: /^kt\b|olleh/i },
  { n: "STC", c: "sa", re: /^stc\b|saudi telecom/i },
  { n: "AIS", c: "th", re: /^ais\b|advanced info/i },
  { n: "SFR", c: "fr", re: /^sfr\b/i },
  { n: "Three", c: "gb", re: /^three\b|^3\b|hutchison/i },
  { n: "Telcel", c: "mx", re: /telcel/i },
  { n: "Rogers", c: "ca", re: /rogers/i },
  { n: "Vivo", c: "br", re: /^vivo\b/i },
  { n: "Claro", c: "br", re: /claro/i },
  { n: "du", c: "ae", re: /^du\b/i },
];
const MAX = 20;

// deno-lint-ignore no-explicit-any
export function knownNetworks(esim: any): { n: string; c: string }[] {
  const names = (cc: string): string[] => {
    // deno-lint-ignore no-explicit-any
    const plans: any[] = esim?.countries?.[cc]?.plans ?? [];
    // deno-lint-ignore no-explicit-any
    return plans.flatMap((p) => (p?.meta?.net ?? []).map((o: any) => String(o?.n ?? "")));
  };
  const cache = new Map<string, string[]>();
  const out: { n: string; c: string }[] = [], seen = new Set<string>();
  for (const b of BRANDS) {
    if (out.length >= MAX || seen.has(b.n)) continue;
    if (!cache.has(b.c)) cache.set(b.c, names(b.c));
    if (cache.get(b.c)!.some((x) => b.re.test(x))) { out.push({ n: b.n, c: b.c }); seen.add(b.n); }
  }
  return out;
}
