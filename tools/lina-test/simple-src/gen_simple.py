# Erzeugt tools/lina-test/sets/simple (5000 einfache Kundenfragen, 7 Sprachen) aus den Vorlagen hier.
#   python3 tools/lina-test/simple-src/gen_simple.py tools/lina-test/sets/simple
import sys, re, random, itertools, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from simple_de_en_tr import DE, EN, TR
from simple_ar_ru_fr_es import AR, RU, FR, ES
SETS = {"de": DE, "en": EN, "tr": TR, "ar": AR, "ru": RU, "fr": FR, "es": ES}
PRE = {"de": ["", "", "", "hallo ", "hi lina ", "kurze frage ", "hey "], "en": ["", "", "", "hi ", "hello ", "quick question ", "hey lina "],
 "tr": ["", "", "", "merhaba ", "selam ", "bir sorum var ", "lina "], "ar": ["", "", "", "مرحبا ", "سؤال ", "السلام عليكم "],
 "ru": ["", "", "", "здравствуйте ", "привет ", "вопрос "], "fr": ["", "", "", "bonjour ", "salut ", "petite question "], "es": ["", "", "", "hola ", "una pregunta ", "buenas "]}
SUF = {"de": ["", "", "?", " bitte", " danke"], "en": ["", "", "?", " please", " thanks"], "tr": ["", "", "?", " acaba", " lütfen"],
 "ar": ["", "", "؟", " من فضلك"], "ru": ["", "", "?", " пожалуйста"], "fr": ["", "", " ?", " svp", " merci"], "es": ["", "", "?", " por favor", " gracias"]}
FOLD = str.maketrans("şŞıİğĞüÜöÖçÇ", "sSiIgGuUoOcC")
def expand(t):
    parts = re.split(r"(\{[^}]*\})", t)
    opts = [p[1:-1].split("|") if p.startswith("{") else [p] for p in parts]
    return [re.sub(r"\s+", " ", "".join(c)).strip() for c in itertools.product(*opts)]
def main():
    TOTAL = 5000; langs = list(SETS); per_lang = [TOTAL // len(langs) + (1 if i < TOTAL % len(langs) else 0) for i in range(len(langs))]
    out = sys.argv[1]; os.makedirs(out, exist_ok=True); grand = 0
    for lang, n in zip(langs, per_lang):
        rnd = random.Random(f"simple-{lang}")
        S = SETS[lang]; ids = list(S); quota = [n // len(ids) + (1 if i < n % len(ids) else 0) for i in range(len(ids))]
        spare = []
        lines = [f"## Einfache Kundenfragen ({lang}) – aus Vorlagen erzeugt (tools: gen_simple.py), {n} Fragen"]
        for fid, q in zip(ids, quota):
            base = sorted({x for t in S[fid] for x in expand(t)}); rnd.shuffle(base)
            pool, seen, tries = [], set(), 0
            while len(pool) < q and tries < q * 50:
                b = base[tries % len(base)] if tries < len(base) else rnd.choice(base)
                s = b if tries < len(base) else (rnd.choice(PRE[lang]) + b + rnd.choice(SUF[lang])).strip()
                if lang == "tr" and tries >= len(base) and rnd.random() < .4: s = s.translate(FOLD)
                tries += 1
                if s not in seen: seen.add(s); pool.append(s)
            lines += [f"{s} | {fid}" for s in pool]
            spare.append((fid, base, seen))
        # Fehlende Fragen (zu wenige Varianten bei einzelnen Themen) mit weiteren Varianten anderer Themen auffüllen
        k = 0
        while len(lines) - 1 < n and k < n * 200:
            fid, base, seen = spare[k % len(spare)]; k += 1
            s = (rnd.choice(PRE[lang]) + rnd.choice(base) + rnd.choice(SUF[lang])).strip()
            if s not in seen: seen.add(s); lines.append(f"{s} | {fid}")
        open(f"{out}/{lang}.txt", "w").write("\n".join(lines) + "\n"); grand += len(lines) - 1
        print(lang, len(lines) - 1)
    print("gesamt", grand)


if __name__ == "__main__":
    main()
