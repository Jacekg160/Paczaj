const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = wymagaj("cheerio");

const TMDB_API_KEY = process.env.TMDB_API_KEY;

const manifest = {
    id: "community.pl.fanfilm.prosty",
    wersja: "2.3.0",
    nazwa: "Polskie CDA & Vider | AIO-PL Edition",
    opis: "Agregator polskich zrodel z zaawansowanymi filtrami regex (styl AIOStreams)",
    zasoby: ["strumień"],
    typy: ["film", "serial"],
    idPrefixes: ["tt"],
    katalogi: []
};

const builder = new addonBuilder(manifest);

// --- 1. ZAAWANSOWANE FILTRY REGEX (Tomf AIOStreams PL) ---
const WYKLUCZONE_SŁOWA_KLUCZOWE = [
    "trailer", "zwiastun", "screener", "telesynch", "telesync",
    „cam”, „camrip”, „hdcam”, „ts”, „tc”, „scr”, „onlyfans”,
    "zapowiedş", "zapowiedz", "teaser", "recenzja"
];

niech polskieRegexy = [
    /\b(pl|lektor|dubbing|napisy|pldub|plsub|polski)\b/i,
    /(\[|\()(pl|lektor|dub)(\]|\))/i
];

funkcja asynchroniczna zaladujRegexyAIO() {
    próbować {
        const res = wait axios.get("https://raw.githubusercontent.com/tomfle18/regex-pol/refs/heads/main/regex_pol_v1.json", { timeout: 4000 });
        jeśli (Array.isArray(res.data) && res.data.length > 0) {
            polskieRegexy = res.data.map(p => new RegExp(p, "i"));
            console.log(`[AIO-PL] Zaladowano ${polskieRegexy.length} dodatkowe regul regex.`);
        }
    } złap (e) {
        console.log("[AIO-PL] Uzyto domyslnych zastosowań regul regex.");
    }
}
zaladujRegexyAIO();

funkcja czyZawieraPolski(tytuł) {
    return polskieRegexy.some(regex => regex.test(tytul));
}

funkcja czySmiec(tytuł) {
    const t = tytul.toLowerCase();
    zwróć WYKLUCZONE_SŁOWA KLUCZOWE.some(slowo => {
        const reg = nowy RegExp(`\\b${slowo}\\b`, "i");
        zwróć reg.test(t) || t.includes(slowo);
    });
}

funkcja parsujJakoscIWersje(tytuł, link) {
    niech jakosc = "720p";
    niech wynik = 20;

    const tLower = tytul.toLowerCase();
    const lLower = link.toLowerCase();

    jeśli (tLower.includes("2160p") || tLower.includes("4k")) {
        jakosc = "4K";
        wynik = 40;
    } else if (tLower.includes("1080p") || tLower.includes("fhd") || lLower.includes("1080p")) {
        jakosc = "1080p";
        wynik = 30;
    } else if (tLower.includes("480p") || tLower.includes("360p") || tLower.includes("sd")) {
        jakosc = "480p";
        wynik = 10;
    }

    niech wersja = "";
    jeśli (tLower.includes("dubbing") || tLower.includes("dub")) {
        wersja = "Dubbing PL";
    } else if (tLower.includes("lektor")) {
        wersja = "Lektor PL";
    } else if (tLower.includes("napisy") || tLower.includes("sub")) {
        wersja = "Napisy PL";
    } else if (czyZawieraPolski(tytul)) {
        wersja = "Wersja PL";
    }

    const hasPl = wersja.length > 0;
    jeśli (hasPl) wynik += 100;

    return { jakosc, wersja, score, hasPl };
}

// --- 2. DEKODOWANIE CDA ---
funkcja dekodujCdaUrl(str) {
    jeśli (!str) zwraca null;
    niech zdekodowane = str
        .replace(/_XDDD/g, "")
        .replace(/_CDA/g, "")
        .replace(/_ADC/g, "")
        .replace(/_CXD/g, "")
        .replace(/_QWE/g, "")
        .replace(/_Q5/g, "")
        .replace(/_IKSDE/g, "");

    spróbuj { zdekodowane = decodeURIComponent(zdekodowane); } złap (e) {}

    niech res = "";
    dla (let i = 0; i < zdekodowana długość; i++) {
        niech kod = zdekodowany.charCodeAt(i);
        jeśli (kod >= 33 i kod <= 126) {
            res += String.fromCharCode(33 + ((kod + 14) % 94));
        } w przeciwnym razie {
            res += zdekodowano.charAt(i);
        }
    }
    zwróć res;
}

funkcja asynchroniczna pobierzBezposredniLinkCDA(urlStrony) {
    próbować {
        const res = wait axios.get(urlStrony, {
            nagłówki: {
                „User-Agent”: „Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36”,
                „Referer”: „https://www.cda.pl/”
            },
            limit czasu: 5000
        });

        const matchFile = res.data.match(/"plik":\s*"([^"]+)"/);
        jeśli (matchFile && matchFile[1]) {
            const raw = matchFile[1];
            jeśli (raw.startsWith("http")) zwraca raw;
            const odkodowany = dekodujCdaUrl(raw);
            jeśli (odkodowany && odkodowany.startsWith("http")) return odkodowany;
        }
    } złap (e) {}
    zwróć null;
}

// --- 3. SKROBANIE ---
funkcja asynchroniczna szukajNaCDA(fraza) {
    próbować {
        const urlSzukania = `https://www.cda.pl/info/${encodeURIComponent(fraza)}`;
        const res = wait axios.get(urlSzukania, {
            nagłówki: {
                „User-Agent”: „Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36”,
                „Referer”: „https://www.cda.pl/”
            },
            limit czasu: 6500
        });

        const $ = cheerio.load(res.data);
        stały stosowany = [];

        $('a[href*="/video/"]').each((i, el) => {
            const linkRel = $(el).attr("href");
            niech tytul = $(el).text().trim() || $(el).attr("title") || "";

            jeśli (linkRel && tytul.length > 4 && !linkRel.includes("#comment")) {
                jeśli (!czySmiec(tytuł)) {
                    const pelnyLink = linkRel.startsWith("http") ? linkRel : `https://www.cda.pl${linkRel}`;
                    if (!znalezione.some(w => w.pageUrl === pelnyLink)) {
                        znalezione.push({ title: tytul.replace(/\s+/g, " "), pageUrl: pelnyLink });
                    }
                }
            }
        });

        const strumienie = [];
        for (const poz of znalezione.slice(0, 8)) {
            const directUrl = czekaj na pobierzBezposredniLinkCDA(poz.pageUrl);
            jeśli (directUrl) {
                const info = parsujJakoscIWersje(poz.title, directUrl);
                const plTag = info.hasPl? „đŸ‡ľđŸ‡ą „: „”;
                const tagWersja = info.wersja ? ` â€˘ ${info.wersja}` : "";
                
                strumienie.push({
                    nazwa: `${plTag}CDA [${info.jakosc}]`,
                    tytuł: `${poz.title}${tagWerssji}`,
                    url: directUrl,
                    qualityScore: info.score
                });
            }
        }
        strumienie powrotne;
    } złapać (błąd) {
        powrót [];
    }
}

funkcja asynchroniczna szukajNaVider(fraza) {
    próbować {
        const urlSzukania = `https://vider.info/szukaj?q=${encodeURIComponent(fraza)}`;
        const res = wait axios.get(urlSzukania, {
            nagłówki: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
            limit czasu: 6500
        });

        const $ = cheerio.load(res.data);
        stały stosowany = [];

        $('a[href*="/vid/"]').each((i, el) => {
            const href = $(el).attr("href");
            niech tytul = $(el).text().trim() || „”;

            if (href && tytul && !czySmiec(tytul)) {
                const pelnyHref = href.startsWith("http") ? href : `https://vider.info${href}`;
                if (!znalezione.some(l => l.href === pelnyHref)) {
                    znalezione.push({ href: pelnyHref, tytul: tytul.replace(/\s+/g, " ") });
                }
            }
        });

        const strumienie = [];
        for (stała pozycja znalezione.slice(0, 5)) {
            próbować {
                const vidPage = czekaj na axios.get(item.href, {
                    nagłówki: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
                    limit czasu: 4000
                });
                const matchMp4 = vidPage.data.match(/(https?:\/\/[^"']+\.mp4[^"']*)/i);
                jeśli (matchMp4 && matchMp4[1]) {
                    const directUrl = matchMp4[1];
                    const info = parsujJakoscIWersje(item.tytul, directUrl);
                    const plTag = info.hasPl? „đŸ‡ľđŸ‡ą „: „”;
                    const tagWersja = info.wersja ? ` â€˘ ${info.wersja}` : "";

                    strumienie.push({
                        nazwa: `${plTag}Vider [${info.jakosc}]`,
                        tytuł: `${item.tytul}${tagWerssji}`,
                        url: directUrl,
                        qualityScore: info.score
                    });
                }
            } złap (e) {}
        }
        strumienie powrotne;
    } złapać (błąd) {
        powrót [];
    }
}

// --- 4. Baza danych TMDB ---
funkcja asynchroniczna pobierzPolskiTytul(imdbId, type) {
    jeśli (!TMDB_API_KEY) zwróć wartość null;
    próbować {
        const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
        const findRes = czekaj na axios.get(findUrl);

        niech tmdbId = null;
        niech fallbackTitle = "";
        niech rok = "";

        jeśli (typ === "film" && findRes.data.movie_results && findRes.data.movie_results.length > 0) {
            const m = findRes.data.movie_results[0];
            tmdbId = m.id;
            fallbackTitle = m.title || m.original_title;
            rok = m.release_date ? m.release_date.split("-")[0] : "";
        } else if (typ === "seria" && findRes.data.tv_results && findRes.data.tv_results.length > 0) {
            stała s = findRes.data.tv_results[0];
            tmdbId = s.id;
            fallbackTitle = s.name || s.original_name;
            rok = s.first_air_date ? s.first_air_date.split("-")[0] : "";
        }

        jeśli (!tmdbId) zwraca null;

        const mediaEndpoint = type === "series" ? "tv" : "movie";
        const detailsUrl = `https://api.themoviedb.org/3/${mediaEndpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=pl-PL`;
        const detailsRes = czekaj na axios.get(detailsUrl);

        niech plTitle = type === "seria" ? detailsRes.data.name : detailsRes.data.title;
        powrót {
            tytul: plTitle || fallbackTitle,
            rok: rok
        };
    } złapać (błąd) {
        zwróć null;
    }
}

// --- 5. STRUMIENIE ---
builder.defineStreamHandler(async ({typ, id}) => {
    console.log(`\n[AIO-PL] Zapytanie: ${type} ${id}`);

    const części = id.split(":");
    const imdbId = części[0];
    const sezon = części[1] ? parseInt(części[1], 10) : null;
    const episode = części[2] ? parseInt(części[2], 10) : null;

    const dane = czekaj na pobierzPolskiTytul(imdbId, typ);
    jeśli (!dane) zwróć { strumienie: [] };

    stała fraza = [];
    jeśli (typ === "seria" && sezon && odcinek) {
        const s = String(sezon).padStart(2, "0");
        const e = String(episode).padStart(2, "0");
        frazy.push(`${dane.tytul} s${s}e${e}`);
        frazy.push(`${dane.tytul} sezon ${season} odcinek ${episode}`);
    } w przeciwnym razie {
        frazy.push(dane.tytul);
        if (dane.rok) frazy.push(`${dane.tytul} ${dane.rok}`);
    }

    console.log(`[AIO-PL] Szukam: "${frazy[0]}"`);

    niech zebrane = [];
    dla (const fraza frazy) {
        const [cda, vider] = czekaj na Promise.all([
            szukajNaCDA(fraza),
            szukajNaVider(fraza)
        ]);

        dla (const st z [...cda, ...vider]) {
            jeśli (!zebrane.some(x => x.url === st.url)) {
                zebrane.push(st);
            }
        }
        jeśli (zebrane.length > 0) przerwa;
    }

    zebrane.sort((a, b) => b.qualityScore - a.qualityScore);

    console.log(`[AIO-PL] Zwrocono ${zebrane.length} zrodel`);
    zwróć { strumienie: zebrane };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`Serwer AIO-PL działał na porcie ${port}`);
