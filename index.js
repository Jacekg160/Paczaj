    if (!dane) return { streams: [] };

    const frazy = [];

    if (type === "series" && season && episode) {
        const s = String(season).padStart(2, "0");
        const e = String(episode).padStart(2, "0");
        frazy.push(`${dane.tytul} s${s}e${e}`);
        frazy.push(`${dane.tytul} sezon ${season} odcinek ${episode}`);
    } else {
        frazy.push(dane.tytul);
        if (dane.rok) {
            frazy.push(`${dane.tytul} ${dane.rok}`);
        }
    }

    console.log(`[Szukanie] Tytul: "${dane.tytul}", glowne zapytanie: "${frazy[0]}"`);

    let zebraneStrumienie = [];

    for (const fraza of frazy) {
        const [cda, vider] = await Promise.all([
            szukajNaCDA(fraza),
            szukajNaVider(fraza)
        ]);

        const polaczone = [...cda, ...vider];
        for (const st of polaczone) {
            if (!zebraneStrumienie.some(istniejacy => istniejacy.url === st.url)) {
                zebraneStrumienie.push(st);
            }
        }

        // Jesli znalezlismy juz wyniki dla pierwszej precyzyjnej frazy, nie musimy odpytywac kolejnych
        if (zebraneStrumienie.length > 0) {
            break;
        }
    }

    zebraneStrumienie.sort((a, b) => {
        const qA = a.qualityScore ? a.qualityScore : 0;
        const qB = b.qualityScore ? b.qualityScore : 0;
        return qB - qA;
    });

    console.log(`[Sukces] Zwrocono ${zebraneStrumienie.length} streamow dla "${dane.tytul}"`);
    return { streams: zebraneStrumienie };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`Serwer wlaczony na porcie ${port}`);
