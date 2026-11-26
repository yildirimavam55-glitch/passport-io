# Erzeugt tools/lina-test/sets/specific (5000 spezifische Kundenfragen in 7 Sprachen + je 714 für it/pt/nl/pl/ja/ko: Gerät, Land, Fehlermeldung, Situation).
#   python3 tools/lina-test/simple-src/gen_specific.py tools/lina-test/sets/specific
import sys, re, random, itertools, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from specific_de_en_tr import DE, EN, TR
from specific_ar_ru_fr_es import AR, RU, FR, ES
from specific_new import IT, PT, NL, PL, JA, KO
from gen_simple import PRE, SUF, FOLD
def _alts(t, i=0):
    # Liste der Varianten ab Position i bis "}" oder "|" auf gleicher Ebene; verschachtelte {a|{b|c}} erlaubt
    seqs, cur = [], [""]
    while i < len(t):
        c = t[i]
        if c == "{":
            sub, i = _group(t, i + 1); cur = [a + b for a in cur for b in sub]; continue
        if c in "|}": break
        cur = [a + c for a in cur]; i += 1
    return cur, i
def _group(t, i):
    out = []
    while True:
        alt, i = _alts(t, i); out += alt
        if i >= len(t) or t[i] == "}": return out, i + 1
        i += 1
def expand(t):
    return [re.sub(r"\s+", " ", x).strip() for x in _alts(t)[0]]
SETS = {"de": DE, "en": EN, "tr": TR, "ar": AR, "ru": RU, "fr": FR, "es": ES, "it": IT, "pt": PT, "nl": NL, "pl": PL, "ja": JA, "ko": KO}
DEV = {"latn": "iphone|iphone 15|iphone 16 pro|samsung|samsung galaxy s24|galaxy a54|pixel 8|xiaomi|redmi note 13", "ar": "ايفون|سامسونج|جالكسي|بكسل|شاومي", "ru": "iphone|айфон|самсунг|samsung galaxy|pixel|сяоми|xiaomi", "ja": "iPhone|iPhone 15|Galaxy|Pixel 8|Xiaomi|AQUOS|Xperia", "ko": "아이폰|아이폰 15|갤럭시|갤럭시 S24|픽셀|샤오미"}
LAND = {"de": "der türkei|italien|spanien|ägypten|thailand|griechenland|den usa|dubai", "en": "turkey|italy|spain|egypt|thailand|greece|the usa|dubai",
 "tr": "türkiyede|italyada|ispanyada|mısırda|taylandda|yunanistanda|amerikada|dubaide", "ar": "تركيا|إيطاليا|إسبانيا|مصر|تايلاند|اليونان|أمريكا|دبي",
 "ru": "турции|италии|испании|египте|таиланде|греции|сша|дубае", "fr": "turquie|italie|espagne|égypte|thaïlande|grèce|aux usa|à dubaï", "es": "turquía|italia|españa|egipto|tailandia|grecia|eeuu|dubái",
 "it": "turchia|italia|spagna|egitto|thailandia|grecia|america|dubai", "pt": "turquia|itália|espanha|egito|tailândia|grécia|eua|dubai",
 "nl": "turkije|italië|spanje|egypte|thailand|griekenland|amerika|dubai", "pl": "turcji|włoszech|hiszpanii|egipcie|tajlandii|grecji|usa|dubaju",
 "ja": "トルコ|イタリア|スペイン|エジプト|タイ|ギリシャ|アメリカ|ドバイ", "ko": "튀르키예|터키|이탈리아|스페인|이집트|태국|그리스|미국|두바이"}
APP = "instagram|youtube|tiktok|netflix|google maps|whatsapp|spotify"
ALT = {"install-iphone": "install-iphone,install-esim", "install-android": "install-android,install-esim", "hotspot-setup": "hotspot-setup,hotspot",
 "refund-how": "refund-how,refund", "phone-number": "phone-number,calls", "buy-when": "buy-when,when-activate", "line-on": "line-on,data-line",
 "deleted-esim": "deleted-esim,new-phone", "fasttrack-where": "fasttrack-where", "data-line": "data-line,line-on", "lounge-access": "lounge-access,lounge-what"}
def macro(t, lang):
    dev = DEV.get(lang, DEV["latn"])
    return t.replace("@dev", "{" + dev + "}").replace("@land", "{" + LAND[lang] + "}").replace("@app", "{" + APP + "}")
TOTAL = 5000; langs = list(SETS); per = [TOTAL // 7 + (1 if i < TOTAL % 7 else 0) for i in range(7)] + [714] * (len(langs) - 7)
out = sys.argv[1]; os.makedirs(out, exist_ok=True); grand = 0
for lang, n in zip(langs, per):
    rnd = random.Random(f"specific-{lang}"); S = SETS[lang]; ids = list(S)
    quota = [n // len(ids) + (1 if i < n % len(ids) else 0) for i in range(len(ids))]
    lines = [f"## Spezifische Kundenfragen ({lang}) – aus Vorlagen erzeugt (simple-src/gen_specific.py), {n} Fragen"]; spare = []
    for fid, q in zip(ids, quota):
        base = sorted({x for t in S[fid] for x in expand(macro(t, lang))}); rnd.shuffle(base)
        exp = ALT.get(fid, fid); pool, seen, k = [], set(), 0
        while len(pool) < q and k < q * 50:
            s = base[k] if k < len(base) else (rnd.choice(PRE[lang]) + rnd.choice(base) + rnd.choice(SUF[lang])).strip()
            if lang == "tr" and k >= len(base) // 2 and rnd.random() < .4: s = s.translate(FOLD)
            k += 1
            if s not in seen: seen.add(s); pool.append(s)
        lines += [f"{s} | {exp}" for s in pool]; spare.append((exp, base, seen))
    k = 0
    while len(lines) - 1 < n and k < n * 200:
        exp, base, seen = spare[k % len(spare)]; k += 1
        s = (rnd.choice(PRE[lang]) + rnd.choice(base) + rnd.choice(SUF[lang])).strip()
        if s not in seen: seen.add(s); lines.append(f"{s} | {exp}")
    open(f"{out}/{lang}.txt", "w").write("\n".join(lines) + "\n"); grand += len(lines) - 1
print("gesamt", grand)
