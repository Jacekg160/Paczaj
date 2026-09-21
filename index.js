const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const TMDB_API_KEY = process.env.TMDB_API_KEY;

const manifest = {
    id: "community.pl.cda.addon",
    version: "1.0.0",
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
        const res = await axios.get(urlSzukania, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
        });

        const $ = cheerio.load(res.data);
        const wyniki = [];

        $(".elem-wraper").slice(0, 5).each((i, el) => {
            const linkRel = $(el).find("a.link-title-visit").attr("href");
            const tytul = $(el).find("a.link-title-visit").text().trim();
            const jakosc = $(el).find(".vinfo .quality").text().trim() || "SD";

            if (linkRel && tytul) {
                wyniki.push({
                    name: `CDA [${jakosc}]`,
                    title: tytul,
                    url: `https://www.cda.pl${linkRel}`
                });
            }
        });

        return wyniki;
    } catch (err) {
        console.error("Blad CDA:", err.message);
        return [];
    }
}

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[Stremio] Zapytanie: ${type} ${id}`);
    const imdbId = id.split(":")[0];
    const dane = await pobierzPolskiTytul(imdbId, type);

    if (!dane) {
        return { streams: [] };
    }

    const szukanaFraza = `${dane.tytul} ${dane.rok}`.trim();
    console.log(`[CDA] Szukam w CDA: ${szukanaFraza}`);

    const strumienie = await szukajNaCDA(szukanaFraza);

    return { streams: strumienie };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`Serwer CDA wlaczony na porcie ${port}`);
