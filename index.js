const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

const manifest = {
    id: 'community.pl.fanfilm.prosty',
    version: '2.3.1',
    name: 'Polskie CDA & Vider | AIO-PL Edition',
    description: 'Agregator polskich zrodel z filtrami AIO-PL',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: []
};

const builder = new addonBuilder(manifest);

const EXCLUDED_KEYWORDS = [
    'trailer', 'zwiastun', 'screener', 'telesynch', 'telesync', 
    'cam', 'camrip', 'hdcam', 'ts', 'tc', 'scr', 'onlyfans', 
    'zapowiedz', 'teaser', 'recenzja'
];

let polskieRegexy = [
    /\b(pl|lektor|dubbing|napisy|pldub|plsub|polish)\b/i,
    /(\[|\()(pl|lektor|dub)(\]|\))/i
];

async function zaladujRegexyAIO() {
    try {
        const res = await axios.get('https://raw.githubusercontent.com/tomfle18/regex-pol/refs/heads/main/regex_pol_v1.json', { timeout: 4000 });
        if (Array.isArray(res.data) && res.data.length > 0) {
            polskieRegexy = res.data.map(function(p) { return new RegExp(p, 'i'); });
            console.log('[AIO-PL] Zaladowano baze regexow.');
        }
    } catch (e) {
        console.log('[AIO-PL] Uzyto domyslnych regexow.');
    }
}
zaladujRegexyAIO();

function czyZawieraPolski(tytul) {
    return polskieRegexy.some(function(regex) { return regex.test(tytul); });
}

function czySmiec(tytul) {
    const t = tytul.toLowerCase();
    return EXCLUDED_KEYWORDS.some(function(slowo) { return t.includes(slowo); });
}

function parsujJakoscIWersje(tytul, link) {
    let jakosc = '720p';
    let score = 20;

    const tLower = tytul.toLowerCase();
    const lLower = link.toLowerCase();

    if (tLower.includes('2160p') || tLower.includes('4k')) {
        jakosc = '4K';
        score = 40;
    } else if (tLower.includes('1080p') || tLower.includes('fhd') || lLower.includes('1080p')) {
        jakosc = '1080p';
        score = 30;
    } else if (tLower.includes('480p') || tLower.includes('360p') || tLower.includes('sd')) {
        jakosc = '480p';
        score = 10;
    }

    let wersja = '';
    if (tLower.includes('dubbing') || tLower.includes('dub')) {
        wersja = 'Dubbing PL';
    } else if (tLower.includes('lektor')) {
        wersja = 'Lektor PL';
    } else if (tLower.includes('napisy') || tLower.includes('sub')) {
        wersja = 'Napisy PL';
    } else if (czyZawieraPolski(tytul)) {
        wersja = 'Wersja PL';
    }

    const hasPl = wersja.length > 0;
    if (hasPl) score += 100;

    return { jakosc: jakosc, wersja: wersja, score: score, hasPl: hasPl };
}

function dekodujCdaUrl(str) {
    if (!str) return null;
    let decoded = str
        .replace(/_XDDD/g, '')
        .replace(/_CDA/g, '')
        .replace(/_ADC/g, '')
        .replace(/_CXD/g, '')
        .replace(/_QWE/g, '')
        .replace(/_Q5/g, '')
        .replace(/_IKSDE/g, '');

    try { decoded = decodeURIComponent(decoded); } catch (e) {}

    let res = '';
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
                'Referer': 'https://www.cda.pl/'
            },
            timeout: 5000
        });

        const matchFile = res.data.match(/"file":\s*"([^"]+)"/);
        if (matchFile && matchFile[1]) {
            const raw = matchFile[1];
            if (raw.startsWith('http')) return raw;
            const odkodowany = dekodujCdaUrl(raw);
            if (odkodowany && odkodowany.startsWith('http')) return odkodowany;
        }
    } catch (e) {}
    return null;
}

async function szukajNaCDA(fraza) {
    try {
        const urlSzukania = 'https://www.cda.pl/info/' + encodeURIComponent(fraza);
        const res = await axios.get(urlSzukania, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
                'Referer': 'https://www.cda.pl/'
            },
            timeout: 6500
        });

        const $ = cheerio.load(res.data);
        const znalezione = [];

        $('a[href*="/video/"]').each(function(i, el) {
            const linkRel = $(el).attr('href');
            let tytul = $(el).text().trim();
            if (!tytul) {
                tytul = $(el).attr('title') || '';
            }

            if (linkRel && tytul.length > 4 && !linkRel.includes('#comment')) {
                if (!czySmiec(tytul)) {
                    const pelnyLink = linkRel.startsWith('http') ? linkRel : ('https://www.cda.pl' + linkRel);
                    const juzJest = znalezione.some(function(w) { return w.pageUrl === pelnyLink; });
                    if (!juzJest) {
                        znalezione.push({ title: tytul.replace(/\s+/g, ' '), pageUrl: pelnyLink });
                    }
                }
            }
        });

        const streams = [];
        for (const poz of znalezione.slice(0, 8)) {
            const directUrl = await pobierzBezposredniLinkCDA(poz.pageUrl);
            if (directUrl) {
                const info = parsujJakoscIWersje(poz.title, directUrl);
                const plTag = info.hasPl ? '🇵🇱 ' : '';
                const tagWersji = info.wersja ? (' • ' + info.wersja) : '';
                
                streams.push({
                    name: plTag + 'CDA [' + info.jakosc + ']',
                    title: poz.title + tagWersji,
                    url: directUrl,
                    qualityScore: info.score
                });
            }
        }
        return streams;
    } catch (err) {
        return [];
    }
}

async function szukajNaVider(fraza) {
    try {
        const urlSzukania = 'https://vider.info/szukaj?q=' + encodeURIComponent(fraza);
        const res = await axios.get(urlSzukania, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 6500
        });

        const $ = cheerio.load(res.data);
        const znalezione = [];

        $('a[href*="/vid/"]').each(function(i, el) {
            const href = $(el).attr('href');
            let tytul = $(el).text().trim();
            if (!tytul) {
                tytul = '';
            }

            if (href && tytul && !czySmiec(tytul)) {
                const pelnyHref = href.startsWith('http') ? href : ('https://vider.info' + href);
                const juzJest = znalezione.some(function(l) { return l.href === pelnyHref; });
                if (!juzJest) {
                    znalezione.push({ href: pelnyHref, tytul: tytul.replace(/\s+/g, ' ') });
                }
            }
        });

        const streams = [];
        for (const item of znalezione.slice(0, 5)) {
            try {
                const vidPage = await axios.get(item.href, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                    timeout: 4000
                });
                const matchMp4 = vidPage.data.match(/(https?:\/\/[^"']+\.mp4[^"']*)/i);
                if (matchMp4 && matchMp4[1]) {
                    const directUrl = matchMp4[1];
                    const info = parsujJakoscIWersje(item.tytul, directUrl);
                    const plTag = info.hasPl ? '🇵🇱 ' : '';
                    const tagWersji = info.wersja ? (' • ' + info.wersja) : '';

                    streams.push({
                        name: plTag + 'Vider [' + info.jakosc + ']',
                        title: item.tytul + tagWersji,
                        url: directUrl,
                        qualityScore: info.score
                    });
                }
            } catch (e) {}
        }
        return streams;
    } catch (err) {
        return [];
    }
}

async function pobierzPolskiTytul(imdbId, type) {
    if (!TMDB_API_KEY) return null;
    try {
        const findUrl = 'https://api.themoviedb.org/3/find/' + imdbId + '?api_key=' + TMDB_API_KEY + '&external_source=imdb_id';
        const findRes = await axios.get(findUrl);

        let tmdbId = null;
        let fallbackTitle = '';
        let rok = '';

        if (type === 'movie' && findRes.data.movie_results && findRes.data.movie_results.length > 0) {
            const m = findRes.data.movie_results[0];
            tmdbId = m.id;
            fallbackTitle = m.title || m.original_title;
            rok = m.release_date ? m.release_date.split('-')[0] : '';
        } else if (type === 'series' && findRes.data.tv_results && findRes.data.tv_results.length > 0) {
            const s = findRes.data.tv_results[0];
            tmdbId = s.id;
            fallbackTitle = s.name || s.original_name;
            rok = s.first_air_date ? s.first_air_date.split('-')[0] : '';
        }

        if (!tmdbId) return null;

        const mediaEndpoint = type === 'series' ? 'tv' : 'movie';
        const detailsUrl = 'https://api.themoviedb.org/3/' + mediaEndpoint + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&language=pl-PL';
        const detailsRes = await axios.get(detailsUrl);

        let plTitle = type === 'series' ? detailsRes.data.name : detailsRes.data.title;
        return {
            tytul: plTitle || fallbackTitle,
            rok: rok
        };
    } catch (err) {
        return null;
    }
}

builder.defineStreamHandler(async function(args) {
    const type = args.type;
    const id = args.id;
    console.log('\n[AIO-PL] Zapytanie: ' + type + ' ' + id);

    const parts = id.split(':');
    const imdbId = parts[0];
    const season = parts[1] ? parseInt(parts[1], 10) : null;
    const episode = parts[2] ? parseInt(parts[2], 10) : null;

    const dane = await pobierzPolskiTytul(imdbId, type);
    if (!dane) return { streams: [] };

    const frazy = [];
    if (type === 'series' && season && episode) {
        const s = String(season).padStart(2, '0');
        const e = String(episode).padStart(2, '0');
        frazy.push(dane.tytul + ' s' + s + 'e' + e);
        frazy.push(dane.tytul + ' sezon ' + season + ' odcinek ' + episode);
    } else {
        frazy.push(dane.tytul);
        if (dane.rok) frazy.push(dane.tytul + ' ' + dane.rok);
    }

    console.log('[AIO-PL] Szukam: "' + frazy[0] + '"');

    let zebrane = [];
    for (const fraza of frazy) {
        const wyniki = await Promise.all([
            szukajNaCDA(fraza),
            szukajNaVider(fraza)
        ]);
        const cda = wyniki[0];
        const vider = wyniki[1];

        const polaczone = cda.concat(vider);
        for (const st of polaczone) {
            const juzJest = zebrane.some(function(x) { return x.url === st.url; });
            if (!juzJest) {
                zebrane.push(st);
            }
        }
        if (zebrane.length > 0) break;
    }

    zebrane.sort(function(a, b) { return b.qualityScore - a.qualityScore; });

    console.log('[AIO-PL] Zwrocono ' + zebrane.length + ' zrodel');
    return { streams: zebrane };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log('Serwer AIO-PL dziala na porcie ' + port);
