const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const TMDB_API_KEY = process.env.TMDB_API_KEY;

const manifest = {
    id: "community.pl.cda.addon",
    version: "1.0.3",
    name: "Polskie CDA Addon",
    description: "Wyszukuje polskie zrodla i odtwarza strumienie z CDA",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

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
            timeout: 5000
        });

        const matchFile = res.data.match(/"file":\s*"([^"]+)"/);
        if (matchFile && matchFile[1]) {
            const rawFile = matchFile[1];
            if (rawFile.startsWith("http")) {
                return rawFile;
            }
            const odkodowany = dekodujCdaUrl(rawFile);
            if (odkodowany && odkodowany.startsWith("http")) {
                return odkodowany;
            }
        }
    } catch (err) {
        console.error(`[CDA Resolver] Blad parsowania ${urlStrony}:`, err.message);
    }
    return null;
}

async function pobierzPolskiTytul(imdbId, type) {
    if (!TMDB_API_KEY) {
        console.log("Brak klucza TMDB_API_KEY w ustawieniach!");
        return null;
    }
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=pl-PL`;
        const res = await axios.get(url);

        if (type === "movie" && res.data.movie_results && res.data.movie_results.length > 0) {
            const film = res.data.movie_results[0];
            let t = film.title;
            if (!t) t = film.original_title;
            return {
                tytul: t,
                rok: film.release_date ? film.release_date.split("-")[0] : ""
            };
        } else if (type === "series" && res.data.tv_results && res.data.tv_results.length > 0) {
            const serial = res.data.tv_results[0];
            let t = serial.name;
            if (!t) t = serial.original_name;
            return {
                tytul: t,
                rok: serial.first_air_date ? serial.first_air_date.split("-")[0] : ""
            };
        }
    } catch (err) {
        console.error("Blad TMDB:", err.message);
    }
    return null;
}

async function szukajNaCDA(fraza) {
    try {
        const urlSzukania = `https://www.cda.pl/info/${encodeURIComponent(fraza)}`;
        console.log(`[CDA] URL zapytania: ${urlSzukania}`);

        const res = await axios.get(urlSzukania, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
                "Referer": "https://www.cda.pl/"
            },
            timeout: 7000
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
                const pelnyLink = linkRel.startsWith("http") ? linkRel : `https://www.cda.pl${linkRel}`;
                if (!znalezioneLinki.some(w => w.pageUrl === pelnyLink)) {
                    znalezioneLinki.push({
                        title: tytul.replace(/\s+/g, " ").substring(0, 80),
                        pageUrl: pelnyLink
                    });
                }
            }
        });

        const doSprawdzenia = znalezioneLinki.slice(0, 4);
        console.log(`[CDA] Znaleziono ${doSprawdzenia.length} kandydatow do rozkodowania streamu...`);

        const streams = [];
        for (const pozycja of doSprawdzenia) {
            const directUrl = await pobierzBezposredniLinkCDA(pozycja.pageUrl);
            if (directUrl) {
                streams.push({
                    name: "CDA [MP4]",
                    title: pozycja.title,
                    url: directUrl
                });
            }
        }

        console.log(`[CDA] Gotowe bezposrednie strumienie: ${streams.length}`);
        return streams;

    } catch (err) {
        console.error("Blad CDA:", err.message);
        return [];
    }
}

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`\n[Stremio] Zapytanie: ${type} ${id}`);
    const imdbId = id.split(":")[0];
    const dane = await pobierzPolskiTytul(imdbId, type);

    if (!dane) {
        console.log("[TMDB] Nie udalo sie pobrac polskich metadanych.");
        return { streams: [] };
    }

    console.log(`[CDA] Szukam w CDA: "${dane.tytul}"`);
    const strumienie = await szukajNaCDA(dane.tytul);

    return { streams: strumienie };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`Serwer CDA wlaczony na porcie ${port}`);
