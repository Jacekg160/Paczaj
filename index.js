const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const TMDB_API_KEY = process.env.TMDB_API_KEY;

const manifest = {
    id: "community.pl.cda.addon",
    version: "1.0.1",
    name: "Polskie CDA Addon",
    description: "Wyszukuje polskie zrodla i lektora na CDA",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

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
            return {
                tytul: film.title || film.original_title,
                rok: film.release_date ? film.release_date.split("-")[0] : ""
            };
        } else if (type === "series" && res.data.tv_results && res.data.tv_results.length > 0) {
            const serial = res.data.tv_results[0];
            return {
                tytul: serial.name || serial.original_name,
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
        const wyniki = [];

        // Przeszukujemy elementy z filmami na stronie CDA
        $('a[href*="/video/"]').each((i, el) => {
            const linkRel = $(el).attr("href");
            const tytul = $(el).text().trim() \vert{}\vert{}$(el).attr("title");

            // Filtrujemy tylko linki prowadzace do konkretnych filmow (omijamy duplikaty i miniatury)
            if (linkRel && tytul && tytul.length > 4 && !linkRel.includes("#comment")) {
                const pelnyLink = linkRel.startsWith("http") ? linkRel : `https://www.cda.pl${linkRel}`;
                
                // Sprawdzamy czy link juz nie istnieje w wynikach
                if (!wyniki.some(w => w.url === pelnyLink)) {
                    wyniki.push({
                        name: "CDA [Wideo]",
                        title: tytul.replace(/\s+/g, ' ').substring(0, 80),
                        url: pelnyLink
                    });
                }
            }
        });

        const przefiltrowane = wyniki.slice(0, 6);
        console.log(`[CDA] Znaleziono pasujacych pozycji: ${przefiltrowane.length}`);
        return przefiltrowane;

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

    // Szukamy po samym tytule dla wiekszej liczby trafien
    console.log(`[CDA] Szukam w CDA: "${dane.tytul}"`);
    const strumienie = await szukajNaCDA(dane.tytul);

    return { streams: strumienie };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`Serwer CDA wlaczony na porcie ${port}`);
