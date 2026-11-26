# Erzeugt tools/lina-test/sets/simple (5000 einfache Kundenfragen in 7 Sprachen + je 714 für it/pt/nl/pl/ja/ko) aus den Vorlagen hier.
#   python3 tools/lina-test/simple-src/gen_simple.py tools/lina-test/sets/simple
import sys, re, random, itertools, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from simple_de_en_tr import DE, EN, TR
from simple_ar_ru_fr_es import AR, RU, FR, ES
from simple_new import IT, PT, NL, PL, JA, KO
SETS = {"de": DE, "en": EN, "tr": TR, "ar": AR, "ru": RU, "fr": FR, "es": ES, "it": IT, "pt": PT, "nl": NL, "pl": PL, "ja": JA, "ko": KO}
PRE = {"de": ["", "", "", "hallo ", "hi lina ", "kurze frage ", "hey "], "en": ["", "", "", "hi ", "hello ", "quick question ", "hey lina "],
 "tr": ["", "", "", "merhaba ", "selam ", "bir sorum var ", "lina "], "ar": ["", "", "", "مرحبا ", "سؤال ", "السلام عليكم "],
 "ru": ["", "", "", "здравствуйте ", "привет ", "вопрос "], "fr": ["", "", "", "bonjour ", "salut ", "petite question "], "es": ["", "", "", "hola ", "una pregunta ", "buenas "],
 "it": ["", "", "", "ciao ", "salve ", "una domanda "], "pt": ["", "", "", "oi ", "olá ", "uma dúvida "], "nl": ["", "", "", "hoi ", "hallo ", "even een vraag "],
 "pl": ["", "", "", "dzień dobry ", "cześć ", "pytanie "], "ja": ["", "", "", "すみません、", "質問です。", "こんにちは。"], "ko": ["", "", "", "안녕하세요 ", "질문이요 ", "저기요 "]}
SUF = {"de": ["", "", "?", " bitte", " danke"], "en": ["", "", "?", " please", " thanks"], "tr": ["", "", "?", " acaba", " lütfen"],
 "ar": ["", "", "؟", " من فضلك"], "ru": ["", "", "?", " пожалуйста"], "fr": ["", "", " ?", " svp", " merci"], "es": ["", "", "?", " por favor", " gracias"],
 "it": ["", "", "?", " per favore", " grazie"], "pt": ["", "", "?", " por favor", " obrigado"], "nl": ["", "", "?", " alstublieft", " bedankt"],
 "pl": ["", "", "?", " proszę", " dzięki"], "ja": ["", "", "？", "？", "。"], "ko": ["", "", "?", "?", " 감사합니다"]}
FOLD = str.maketrans("şŞıİğĞüÜöÖçÇ", "sSiIgGuUoOcC")
def expand(t):
    parts = re.split(r"(\{[^}]*\})", t)
    opts = [p[1:-1].split("|") if p.startswith("{") else [p] for p in parts]
    return [re.sub(r"\s+", " ", "".join(c)).strip() for c in itertools.product(*opts)]
def main():
    TOTAL = 5000; langs = list(SETS); per_lang = [TOTAL // 7 + (1 if i < TOTAL % 7 else 0) for i in range(7)] + [714] * (len(langs) - 7)
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
