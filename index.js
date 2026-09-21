const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const TMDB_API_KEY = process.env.TMDB_API_KEY;

const manifest = {
    id: "community.pl.fanfilm.prosty",
    version: "2.1.2",
    name: "Polskie CDA & Vider",
    description: "Zrodla CDA i Vider: filmy, seriale, lektor PL, jakosc 1080p/720p",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// --- 1. ROZSZYFROWYWANIE CDA ---
function dekodujCdaUrl(str) {
    if (!str) return null;
    let decoded = str
        .replace(/_XDDD/g, "")
        .replace(/_CDA/g, "")
        .replace(/_ADC/g, "")
        .replace(/_CXD/g, "")
        .replace(/_QWE/g, "")
        .replace(/_Q5/g, "")
        .replace(/_IKSDE/g, "");

    try {
        decoded = decodeURIComponent(decoded);
    } catch (e) {}

    let res = "";
    for (let i = 0; i < decoded.length; i++) {
        let code = decoded.charCodeAt(i);
        if (code >= 33 && code <= 126) {
            res += String.fromCharCode(33 + ((code + 14) % 94));
        } else {
            res += decoded.charAt(i);
        }
    }
    return res;
}

async function pobierzBezposredniLinkCDA(urlStrony) {
    try {
        const res = await axios.get(urlStrony, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://www.cda.pl/"
            },
            timeout: 4500
        });

        const matchFile = res.data.match(/"file":\s*"([^"]+)"/);
        if (matchFile && matchFile[1]) {
            const rawFile = matchFile[1];
            if (rawFile.startsWith("http")) return rawFile;
            const odkodowany = dekodujCdaUrl(rawFile);
            if (odkodowany && odkodowany.startsWith("http")) return odkodowany;
        }
    } catch (err) {}
    return null;
}

// --- 2. FILTROWANIE ŚMIECI I ZWIASTUNÓW ---
function czyToZwiastunLubSmiec(tytul) {
    const t = tytul.toLowerCase();
    const czarnaLista = [
        "zwiastun", "trailer", "zapowiedź", "zapowiedz", "teaser",
        "recenzja", "scena", "wywiad", "kulisy", "making of",
        "soundtrack", "ost", "opening", "ending", "clip"
    ];
    return czarnaLista.some(slowo => t.includes(slowo));
}

function oznaczJakoscIWersje(tytul, link) {
    let jakosc = "720p";
    let score = 2;

    const tLower = tytul.toLowerCase();
    const lLower = link.toLowerCase();

    if (tLower.includes("1080p") || tLower.includes("fhd") || lLower.includes("1080p")) {
        jakosc = "1080p";
        score = 3;
    } else if (tLower.includes("480p") || tLower.includes("360p") || tLower.includes("sd")) {
        jakosc = "480p";
        score = 1;
    }

    let wersja = "";
    if (tLower.includes("dubbing") || tLower.includes("dub")) {
        wersja = " - Dubbing PL";
    } else if (tLower.includes("lektor") || tLower.includes("pl")) {
        wersja = " - Lektor PL";
    } else if (tLower.includes("napisy") || tLower.includes("sub")) {
        wersja = " - Napisy PL";
    }

    return { jakosc, wersja, score };
}

// --- 3. SCRAPER CDA ---
async function szukajNaCDA(fraza) {
    try {
        const urlSzukania = `https://www.cda.pl/info/${encodeURIComponent(fraza)}`;
        const res = await axios.get(urlSzukania, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "pl-PL,pl;q=0.9",
                "Referer": "https://www.cda.pl/"
            },
            timeout: 6500
        });

        const $ = cheerio.load(res.data);
        const znalezioneLinki = [];

        $('a[href*="/video/"]').each((i, el) => {
            const linkRel = $(el).attr("href");
            let tytul = $(el).text().trim();
            if (!tytul) {
                tytul = $(el).attr("title");
            }
            if (!tytul) {
                tytul = "";
            }

            if (linkRel && tytul && tytul.length > 4 && !linkRel.includes("#comment")) {
                if (!czyToZwiastunLubSmiec(tytul)) {
                    const pelnyLink = linkRel.startsWith("http") ? linkRel : `https://www.cda.pl${linkRel}`;
                    const juzJest = znalezioneLinki.some(w => w.pageUrl === pelnyLink);
                    if (!juzJest) {
                        znalezioneLinki.push({
                            title: tytul.replace(/\s+/g, " "),
                            pageUrl: pelnyLink
                        });
                    }
                }
            }
        });

        const doSprawdzenia = znalezioneLinki.slice(0, 8);
        const streams = [];

        for (const pozycja of doSprawdzenia) {
            const directUrl = await pobierzBezposredniLinkCDA(pozycja.pageUrl);
            if (directUrl) {
                const tagi = oznaczJakoscIWersje(pozycja.title, directUrl);
                streams.push({
                    name: `CDA [${tagi.jakosc}]`,
                    title: `${pozycja.title}${tagi.wersja}`,
                    url: directUrl,
                    qualityScore: tagi.score
                });
            }
        }
        return streams;
    } catch (err) {
        console.error("[CDA] Blad wyszukiwania:", err.message);
        return [];
    }
}

// --- 4. SCRAPER VIDER ---
async function szukajNaVider(fraza) {
    try {
        const urlSzukania = `https://vider.info/szukaj?q=${encodeURIComponent(fraza)}`;
        const res = await axios.get(urlSzukania, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://vider.info/"
            },
            timeout: 6500
        });

        const $ = cheerio.load(res.data);
        const linki = [];

        $('a[href*="/vid/"]').each((i, el) => {
            const href = $(el).attr("href");
            let tytul = $(el).text().trim();
            if (!tytul) tytul = "";

            if (href && tytul && !czyToZwiastunLubSmiec(tytul)) {
                const czyJest = linki.some(l => l.href === href);
                if (!czyJest) {
                    const pelnyHref = href.startsWith("http") ? href : `https://vider.info${href}`;
                    linki.push({
                        href: pelnyHref,
                        tytul: tytul.replace(/\s+/g, " ")
                    });
                }
            }
        });

        const streams = [];
        for (const item of linki.slice(0, 4)) {
            try {
                const vidPage = await axios.get(item.href, {
                    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
                    timeout: 4000
                });
                const matchMp4 = vidPage.data.match(/(https?:\/\/[^"']+\.mp4[^"']*)/i);
                if (matchMp4 && matchMp4[1]) {
                    const directUrl = matchMp4[1];
                    const tagi = oznaczJakoscIWersje(item.tytul, directUrl);
                    streams.push({
                        name: `Vider [${tagi.jakosc}]`,
                        title: `${item.tytul}${tagi.wersja}`,
                        url: directUrl,
                        qualityScore: tagi.score
                    });
                }
            } catch (e) {}
        }
        return streams;
    } catch (err) {
        console.error("[Vider] Blad wyszukiwania:", err.message);
        return [];
    }
}

// --- 5. TMDB TŁUMACZENIE ---
async function pobierzPolskiTytul(imdbId, type) {
    if (!TMDB_API_KEY) return null;
    try {
        const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
        const findRes = await axios.get(findUrl);

        let tmdbId = null;
        let fallbackTitle = "";
        let rok = "";

        if (type === "movie" && findRes.data.movie_results && findRes.data.movie_results.length > 0) {
            const m = findRes.data.movie_results[0];
            tmdbId = m.id;
            fallbackTitle = m.title;
            if (!fallbackTitle) fallbackTitle = m.original_title;
            rok = m.release_date ? m.release_date.split("-")[0] : "";
        } else if (type === "series" && findRes.data.tv_results && findRes.data.tv_results.length > 0) {
            const s = findRes.data.tv_results[0];
            tmdbId = s.id;
            fallbackTitle = s.name;
            if (!fallbackTitle) fallbackTitle = s.original_name;
            rok = s.first_air_date ? s.first_air_date.split("-")[0] : "";
        }

        if (!tmdbId) return null;

        const mediaEndpoint = type === "series" ? "tv" : "movie";
        const detailsUrl = `https://api.themoviedb.org/3/${mediaEndpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=pl-PL`;
        const detailsRes = await axios.get(detailsUrl);

        let plTitle = type === "series" ? detailsRes.data.name : detailsRes.data.title;
        let ostatecznyTytul = plTitle;
        if (!ostatecznyTytul) {
            ostatecznyTytul = fallbackTitle;
        }

        return {
            tytul: ostatecznyTytul,
            rok: rok
        };
    } catch (err) {
        console.error("Blad TMDB:", err.message);
        return null;
    }
}

// --- 6. GŁÓWNY OBSŁUGIWACZ ZAPYTAŃ ---
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`\n[Stremio] Zapytanie: ${type} ${id}`);

    const parts = id.split(":");
    const imdbId = parts[0];
    const season = parts[1] ? parseInt(parts[1], 10) : null;
    const episode = parts[2] ? parseInt(parts[2], 10) : null;

    const dane = await pobierzPolskiTytul(imdbId, type);
    if (!dane) return { streams: [] };

    let szukanaFraza = dane.tytul;
    if (type === "series" && season && episode) {
        const s = String(season).padStart(2, "0");
        const e = String(episode).padStart(2, "0");
        szukanaFraza = `${dane.tytul} s${s}e${e}`;
    }

    console.log(`[Szukanie] Tytul: "${dane.tytul}", fraza: "${szukanaFraza}"`);

    const [cdaStreams, viderStreams] = await Promise.all([
        szukajNaCDA(szukanaFraza),
        szukajNaVider(szukanaFraza)
    ]);

    let wszystkie = [...cdaStreams, ...viderStreams];
    wszystkie.sort((a, b) => {
        const qA = a.qualityScore ? a.qualityScore : 0;
        const qB = b.qualityScore ? b.qualityScore : 0;
        return qB - qA;
    });

    console.log(`[Sukces] Zwrocono ${wszystkie.length} streamow dla ${szukanaFraza}`);
    return { streams: wszystkie };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`Serwer wlaczony na porcie ${port}`);
