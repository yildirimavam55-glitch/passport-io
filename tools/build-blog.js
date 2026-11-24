// Baut aus content/posts/*.json die Artikelübersicht content/blog.json
// und – wenn eine Adresse übergeben wird – sitemap.xml und robots.txt für Suchmaschinen.
//   node tools/build-blog.js                       → nur content/blog.json
//   node tools/build-blog.js <ausgabe> <seiten-url> → zusätzlich <ausgabe>/sitemap.xml und robots.txt
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const dir = path.join(ROOT, "content", "posts");
const langs = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "languages.json"), "utf8"));
const codes = langs.languages.map((l) => l.code), def = langs.default;
const META = ["category", "title", "excerpt", "readTime"]; // übersetzbare Felder der Übersicht
const SHARED = ["date", "image", "country", "cta"];        // gemeinsame Felder (nur in der Standardsprache)

const posts = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
  const id = f.replace(/\.json$/, "");
  return { id, data: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) };
}).filter((p) => p.data[def] && p.data[def].draft !== true)
  .sort((a, b) => String(b.data[def].date || "").localeCompare(String(a.data[def].date || "")));

const out = {};
for (const l of codes) {
  out[l] = {
    posts: posts.map(({ id, data }) => {
      const src = data[l] || {}, item = { id };
      if (l === def) SHARED.forEach((k) => data[def][k] !== undefined && (item[k] = data[def][k]));
      META.forEach((k) => src[k] !== undefined && src[k] !== "" && (item[k] = src[k]));
      return item;
    }),
  };
}
fs.writeFileSync(path.join(ROOT, "content", "blog.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`blog.json: ${posts.length} Artikel in ${codes.length} Sprachen`);

const [, , outDir, siteUrl] = process.argv;
if (outDir && siteUrl) {
  const base = siteUrl.replace(/\/?$/, "/");
  const today = new Date().toISOString().slice(0, 10);
  const pages = [
    { loc: "", lastmod: today },
    { loc: "install.html", lastmod: today },
    { loc: "blog.html", lastmod: today },
    ...posts.map(({ id, data }) => ({ loc: `blog.html?p=${encodeURIComponent(id)}`, lastmod: data[def].date || today })),
  ];
  const url = (loc, l) => base + loc + (l ? (loc.includes("?") ? "&amp;" : "?") + "lang=" + l : "");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.flatMap((p) => codes.map((l) => `  <url>
    <loc>${url(p.loc, l)}</loc>
    <lastmod>${p.lastmod}</lastmod>
${codes.map((x) => `    <xhtml:link rel="alternate" hreflang="${x}" href="${url(p.loc, x)}"/>`).join("\n")}
    <xhtml:link rel="alternate" hreflang="x-default" href="${url(p.loc, null)}"/>
  </url>`)).join("\n")}
</urlset>
`;
  fs.writeFileSync(path.join(outDir, "sitemap.xml"), xml);
  fs.writeFileSync(path.join(outDir, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${base}sitemap.xml\n`);
  console.log(`sitemap.xml: ${pages.length * codes.length} Adressen`);
}
