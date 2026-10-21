/* NOSTOP. RUNNING — motore dei piani di allenamento (v0.1)
 *
 * Genera un piano settimana per settimana a partire da: gara, data, forma attuale (VDOT),
 * giorni disponibili, volume attuale e livello. Il piano è una BOZZA per il coach:
 * insieme alle sedute restituisce le "segnalazioni" da controllare prima di assegnarlo.
 *
 * Razionale (vedi metodo.html):
 *  - fasi: fondo -> specifico -> scarico (taper), con settimana di recupero ogni 3-4
 *  - settimana "hard-easy": 2 sedute di qualità non consecutive + lungo + facili
 *  - fondo: qualità sotto soglia (base aerobica senza costo di recupero), allunghi e salite
 *  - specifico: VO2max + soglia + lungo con blocchi a ritmo gara
 *  - taper: volume -40/60% in modo progressivo, intensità e frequenza mantenute
 *  - progressione: settimana max +10%, uscita singola max +10% rispetto al lungo dei 30 giorni prima
 *
 * Funzione pura, nessuna dipendenza: usabile nel browser (window.NostopPiani) e in Node.
 */
(function (root) {
  'use strict';

  /* ---------- fisiologia: modello VDOT (Daniels) ---------- */
  const vo2At = v => -4.60 + 0.182258 * v + 0.000104 * v * v;
  const pctMax = t => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  const vdotDa = (metri, minuti) => vo2At(metri / minuti) / pctMax(minuti);
  const velocita = (vdot, f) => { // m/min a cui il VO2 richiesto è f * VDOT
    const c = 4.60 + f * vdot;
    return (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * c)) / (2 * 0.000104);
  };
  const tempoGara = (vdot, metri) => { // minuti previsti, bisezione
    let lo = metri / 600, hi = metri / 60;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (vdotDa(metri, m) > vdot) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const sKm = v => 60000 / v; // m/min -> secondi al km

  const DIST = { maratona: 42195, mezza: 21097.5, '10k': 10000, '5k': 5000 };

  // Zone di passo NOSTOP. come frazioni di VDOT. Tarate sui target che TrainingPeaks
  // assegnava a Marco (VDOT ~48): lento 5:03-6:09, sotto soglia 4:32-4:47, soglia 4:18-4:32,
  // VO2max 3:50-4:01, allunghi 3:35-3:55.
  function zone(vdot) {
    const band = (lo, hi) => [sKm(velocita(vdot, hi)), sKm(velocita(vdot, lo))]; // [veloce, lento] s/km
    const gp = d => tempoGara(vdot, DIST[d]) * 60 / (DIST[d] / 1000);
    return {
      E: band(0.60, 0.72),
      ST: band(0.82, 0.85),       // sotto soglia
      ST2: band(0.845, 0.87),     // sotto soglia "alta"
      T: band(0.87, 0.90),        // soglia
      I: band(0.97, 1.02),        // VO2max
      R: band(1.05, 1.12),        // allunghi / ripetute brevi
      M: [gp('maratona') - 6, gp('maratona') + 6],
      HM: [gp('mezza') - 4, gp('mezza') + 4],
      G10: [gp('10k') - 3, gp('10k') + 3],
      G5: [gp('5k') - 3, gp('5k') + 3],
      W: [540, 720],              // cammino veloce (percorso start)
    };
  }
  const fmtPasso = s => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtBanda = b => `${fmtPasso(b[0])}–${fmtPasso(b[1])}`;

  /* ---------- parametri per gara e livello ---------- */
  const GARA = {
    //            taper  lungo max per livello (km)        picco km/sett per livello      passo gara
    maratona: { taper: 3, lungo: { principiante: 28, intermedio: 30, avanzato: 32 }, picco: { principiante: 50, intermedio: 70, avanzato: 95 }, gp: 'M', minSett: 12 },
    mezza:    { taper: 2, lungo: { principiante: 18, intermedio: 21, avanzato: 24 }, picco: { principiante: 35, intermedio: 50, avanzato: 75 }, gp: 'HM', minSett: 8 },
    '10k':    { taper: 2, lungo: { principiante: 13, intermedio: 16, avanzato: 19 }, picco: { principiante: 28, intermedio: 42, avanzato: 65 }, gp: 'G10', minSett: 6 },
    '5k':     { taper: 2, lungo: { principiante: 10, intermedio: 13, avanzato: 16 }, picco: { principiante: 22, intermedio: 35, avanzato: 55 }, gp: 'G5', minSett: 6 },
  };
  // scarico: volume rispetto al picco recente (Bosquet 2007: 8-14 giorni e -41/60% i più efficaci)
  const TAPER_SCALA = { maratona: [0.8, 0.6, 0.45], mezza: [0.75, 0.55], '10k': [0.8, 0.6], '5k': [0.85, 0.65] };
  const LUNGO_MAX_MIN = { principiante: 165, intermedio: 180, avanzato: 190 }; // limite in minuti
  // quota massima del volume settimanale nel lungo: con meno uscite il lungo pesa di più
  const QUOTA_LUNGO = { 2: 0.55, 3: 0.5, 4: 0.47, 5: 0.45, 6: 0.4 };

  // Microciclo (0 = lunedì). Qualità mai in giorni consecutivi; prima del lungo solo facile.
  const SETTIMANA = {
    2: { 2: 'Q1', 6: 'LUNGO' },
    3: { 1: 'Q1', 3: 'FACILE_ALLUNGHI', 6: 'LUNGO' },
    4: { 1: 'Q1', 3: 'Q2', 5: 'FACILE_SALITE', 6: 'LUNGO' },
    5: { 1: 'Q1', 2: 'MEDIO_LUNGO', 4: 'Q2', 5: 'FACILE_SALITE', 6: 'LUNGO' },
    6: { 0: 'FACILE', 1: 'Q1', 2: 'MEDIO_LUNGO', 4: 'Q2', 5: 'FACILE_SALITE', 6: 'LUNGO' },
  };
  const GIORNI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

  /* ---------- costruzione sedute ---------- */
  // passo: chiave di zona; durata in minuti (min) o km (km)
  const st = (tipo, passo, q, nota) => ({ tipo, passo, ...q, nota });
  const rip = (n, passi) => ({ tipo: 'ripeti', n, passi });

  function kmMinPassi(passi, Z) {
    let km = 0, min = 0;
    const mid = p => (Z[p] ? (Z[p][0] + Z[p][1]) / 2 : (Z.E[0] + Z.E[1]) / 2);
    const recPasso = (Z.E[1] + 60); // recupero: corsa lentissima o cammino
    for (const s of passi) {
      if (s.tipo === 'ripeti') { const r = kmMinPassi(s.passi, Z); km += r.km * s.n; min += r.min * s.n; continue; }
      const sec = s.passo === 'REC' ? recPasso : mid(s.passo);
      if (s.km != null) { km += s.km; min += s.km * sec / 60; } else { min += s.min; km += s.min * 60 / sec; }
    }
    return { km, min };
  }

  const RISC = () => [st('riscaldamento', 'E', { min: 12 }, 'progressivo'), rip(2, [st('allungo', 'R', { min: 0.33 }), st('recupero', 'REC', { min: 1 })])];
  const DEFAT = () => [st('defaticamento', 'E', { min: 10 })];

  // Ogni funzione riceve p = avanzamento nella fase (0..1) e restituisce {titolo, passi, intensita}
  const SEDUTE = {
    // FONDO: sotto soglia continuo che cresce (20' -> 40') ...
    ST_CONTINUO: (p, lv) => {
      const tot = Math.round((lv === 'principiante' ? 15 : 20) + p * (lv === 'principiante' ? 15 : 20));
      const blocchi = p < 0.34 ? [3, Math.round(tot / 3)] : p < 0.67 ? [2, Math.round(tot / 2)] : [1, tot];
      const corpo = blocchi[0] === 1 ? [st('lavoro', 'ST', { min: tot })]
        : [rip(blocchi[0], [st('lavoro', 'ST', { min: blocchi[1] }), st('recupero', 'REC', { min: 2 })])];
      return { titolo: blocchi[0] === 1 ? `${tot}' sotto soglia` : `${blocchi[0]}×${blocchi[1]}' sotto soglia`, passi: [st('riscaldamento', 'E', { min: 10 }), ...corpo, ...DEFAT()], intensita: 'media' };
    },
    // ... e sotto soglia "alto" a intervalli (medium -> upper sub-threshold)
    ST_INTERVALLI: (p, lv) => {
      const schemi = lv === 'principiante' ? [[5, 4], [4, 6], [3, 8]] : [[6, 5], [5, 7], [4, 9], [3, 12]];
      const [n, m] = schemi[Math.min(schemi.length - 1, Math.floor(p * schemi.length))];
      return { titolo: `${n}×${m}' sotto soglia alta`, passi: [...RISC(), rip(n, [st('lavoro', 'ST2', { min: m }), st('recupero', 'REC', { min: 1 })]), ...DEFAT()], intensita: 'media' };
    },
    // SPECIFICO
    VO2: (p, lv) => {
      const schemi = [
        { t: 'piramide 4-3-2 ×2', b: [[4, 2], [3, 1.5], [2, 2], [4, 2], [3, 1.5], [2, 1]] },
        { t: "5×3'", b: Array(5).fill([3, 1.5]) },
        { t: "6×2'", b: Array(6).fill([2, 1]) },
      ];
      const s = schemi[Math.min(2, Math.floor(p * 3))];
      const b = lv === 'principiante' ? s.b.slice(0, Math.max(3, s.b.length - 2)) : s.b;
      const uguali = b.every(x => x[0] === b[0][0] && x[1] === b[0][1]);
      const corpo = uguali ? [rip(b.length, [st('lavoro', 'I', { min: b[0][0] }), st('recupero', 'REC', { min: b[0][1] })])]
        : b.flatMap(([w, r]) => [st('lavoro', 'I', { min: w }), st('recupero', 'REC', { min: r })]);
      return { titolo: `VO2max ${uguali ? b.length + '×' + b[0][0] + "'" : s.t}`, passi: [...RISC(), ...corpo, ...DEFAT()], intensita: 'alta' };
    },
    SOGLIA: (p, lv) => {
      const schemi = lv === 'principiante' ? [[6, 3, 1], [4, 5, 1.5], [3, 7, 2]] : [[10, 3, 1], [6, 5, 1.67], [4, 6, 2], [3, 8, 2]];
      const [n, m, r] = schemi[Math.min(schemi.length - 1, Math.floor(p * schemi.length))];
      return { titolo: `soglia ${n}×${m}'`, passi: [...RISC(), rip(n, [st('lavoro', 'T', { min: m }), st('recupero', 'REC', { min: r })]), ...DEFAT()], intensita: 'alta' };
    },
    PASSO_GARA: (p, lv, gp) => { // mezza / 10k / 5k: lavoro al passo gara
      const schemi = { M: lv === 'principiante' ? [[3, 1.5], [3, 2], [2, 3]] : [[3, 2], [3, 3], [2, 5]], HM: [[3, 3], [3, 4], [2, 6]], G10: [[5, 1], [4, 1.5], [3, 2]], G5: [[6, 0.8], [5, 1], [4, 1.2]] }[gp];
      const [n, km] = schemi[Math.min(2, Math.floor(p * 3))];
      const nome = { M: 'ritmo maratona', HM: 'passo mezza', G10: 'passo 10 km', G5: 'passo 5 km' }[gp];
      return { titolo: `${n}×${km} km ${nome}`, passi: [...RISC(), rip(n, [st('lavoro', gp, { km }), st('recupero', 'REC', { min: gp === 'HM' ? 2 : 1.5 })]), ...DEFAT()], intensita: 'alta' };
    },
    // 10 km: soglia a intervalli lunghi ("cruise intervals")
    SOGLIA_LUNGA: (p, lv) => {
      const schemi = lv === 'principiante' ? [[4, 5, 1.5], [3, 8, 2], [2, 12, 3]] : [[3, 8, 2], [4, 8, 2], [3, 10, 2], [2, 15, 3]];
      const [n, m, r] = schemi[Math.min(schemi.length - 1, Math.floor(p * schemi.length))];
      return { titolo: `soglia ${n}×${m}'`, passi: [...RISC(), rip(n, [st('lavoro', 'T', { min: m }), st('recupero', 'REC', { min: r })]), ...DEFAT()], intensita: 'alta' };
    },
    // 5-10 km: VO2max a distanza (3-5' per ripetuta), recupero simile al lavoro
    VO2_KM: (p, lv) => {
      const schemi = lv === 'principiante' ? [[4, 0.6], [5, 0.8], [4, 1]] : [[5, 0.8], [5, 1], [4, 1.2], [6, 1]];
      const [n, km] = schemi[Math.min(schemi.length - 1, Math.floor(p * schemi.length))];
      return { titolo: `VO2max ${n}×${Math.round(km * 1000)} m`, passi: [...RISC(), rip(n, [st('lavoro', 'I', { km }), st('recupero', 'REC', { min: 2.5 })]), ...DEFAT()], intensita: 'alta' };
    },
    // 5 km: ripetute brevi e veloci con recupero completo (velocità ed economia)
    RIPETUTE_BREVI: (p, lv) => {
      const schemi = lv === 'principiante' ? [[8, 0.2], [6, 0.3], [6, 0.4]] : [[10, 0.2], [8, 0.3], [6, 0.4], [8, 0.4]];
      const [n, km] = schemi[Math.min(schemi.length - 1, Math.floor(p * schemi.length))];
      return { titolo: `${n}×${Math.round(km * 1000)} m veloci`, passi: [...RISC(), rip(n, [st('lavoro', 'R', { km }), st('recupero', 'REC', { min: km < 0.3 ? 1.5 : 2.5 }, 'recupero completo')]), ...DEFAT()], intensita: 'alta' };
    },
    TAPER_BREVE_Q1: (p, lv, gp) => ({ titolo: `4×1 km ${gp === 'G5' ? 'passo 5 km' : 'passo 10 km'}`, passi: [...RISC(), rip(4, [st('lavoro', gp, { km: 1 }), st('recupero', 'REC', { min: 2 })]), ...DEFAT()], intensita: 'alta' }),
    TAPER_BREVE_Q2: () => ({ titolo: '6×200 m veloci', passi: [...RISC(), rip(6, [st('lavoro', 'R', { km: 0.2 }), st('recupero', 'REC', { min: 1.5 })]), ...DEFAT()], intensita: 'alta' }),
    SALITE: (p) => { // fondo per 5k/10k: ripetute in salita brevi
      const n = Math.round(6 + p * 4);
      return { titolo: `${n}×60" in salita`, passi: [...RISC(), rip(n, [st('salita', 'I', { min: 1 }, 'in salita, sforzo forte e controllato'), st('recupero', 'REC', { min: 1.5 }, 'discesa al passo')]), ...DEFAT()], intensita: 'alta' };
    },
    // TAPER: stessa intensità, meno volume
    TAPER_Q1: () => ({ titolo: "VO2max 5×2' (richiamo)", passi: [...RISC(), rip(5, [st('lavoro', 'I', { min: 2 }), st('recupero', 'REC', { min: 1.5 })]), ...DEFAT()], intensita: 'alta' }),
    TAPER_Q2: (p, lv, gp) => ({ titolo: `3×2 km ${gp === 'M' ? 'ritmo maratona' : 'passo gara'}`, passi: [...RISC(), rip(3, [st('lavoro', gp, { km: 2 }), st('recupero', 'REC', { min: 2 })]), ...DEFAT()], intensita: 'alta' }),
    RIFINITURA: (p, lv, gp) => ({ titolo: `richiamo: 2×1,5 km ${gp === 'M' ? 'ritmo maratona' : 'passo gara'}`, passi: [st('riscaldamento', 'E', { min: 15 }), rip(2, [st('lavoro', gp, { km: 1.5 }), st('recupero', 'REC', { min: 2 })]), ...DEFAT()], intensita: 'media' }),
  };

  const facile = (min, titolo = `${min}' facile`) => ({ titolo, passi: [st('corsa', 'E', { min })], intensita: 'facile' });
  const facileAllunghi = min => ({ titolo: `${min}' facile + 4 allunghi`, passi: [st('corsa', 'E', { min }), rip(4, [st('allungo', 'R', { min: 0.25 }), st('recupero', 'REC', { min: 1 })])], intensita: 'facile' });
  const facileSalite = min => ({ titolo: `${min}' facile + allunghi e sprint in salita`, passi: [st('corsa', 'E', { min }), rip(4, [st('allungo in salita', 'R', { min: 0.33 }), st('recupero', 'REC', { min: 1 }, 'discesa al passo')]), rip(3, [st('sprint in salita', 'R', { min: 0.13 }), st('recupero', 'REC', { min: 1.5 }, 'discesa al passo')])], intensita: 'facile' });

  function lungo(km, gpKm, gp, nota) {
    if (!gpKm) return { titolo: `lungo ${km} km facile`, passi: [st('corsa', 'E', { km })], intensita: 'facile', nota };
    const pre = Math.round((km - gpKm) * 0.55), post = km - gpKm - pre;
    const blocchi = gpKm >= 10 && gpKm < 14 ? [rip(2, [st('lavoro', gp, { km: gpKm / 2 }), st('recupero', 'E', { km: 1 })])] : [st('lavoro', gp, { km: gpKm })];
    const extra = gpKm >= 10 && gpKm < 14 ? 2 : 0;
    return { titolo: `lungo ${km} km con ${gpKm} km ${gp === 'M' ? 'a ritmo maratona' : 'a passo gara'}`, passi: [st('corsa', 'E', { km: pre - extra / 2 }), ...blocchi, st('corsa', 'E', { km: post - extra / 2 })], intensita: 'media', nota };
  }

  /* ---------- generazione ---------- */
  const r05 = x => Math.round(x * 2) / 2;
  const isoGiorno = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const lunediDi = d => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

  function genera(input) {
    const cfg = Object.assign({ livello: 'intermedio', giorni: 5, recuperoOgni: null }, input);
    const G = GARA[cfg.gara];
    if (!G) throw new Error('gara non valida');
    const lv = cfg.livello;
    const avvisi = [];
    const richiesti = cfg.giorni | 0;
    let giorni = Math.max(2, Math.min(6, richiesti || 5));
    if (richiesti && richiesti !== giorni) avvisi.push(`Richiesti ${richiesti} giorni a settimana: il motore gestisce da 2 a 6, il piano usa ${giorni} giorni.`);
    // maratona con 2 uscite: non si arriva in sicurezza al volume necessario, il piano usa 3 giorni e lo dice
    if (giorni === 2 && cfg.gara === 'maratona') { giorni = 3; avvisi.push('Maratona con 2 uscite a settimana sconsigliata: il volume necessario non si raggiunge in sicurezza. Il piano usa 3 giorni.'); }
    const vdot = cfg.vdot || vdotDa(cfg.testMetri, cfg.testMinuti);
    const Z = zone(vdot);
    const breve = cfg.gara === '5k' || cfg.gara === '10k';
    const recOgni = cfg.recuperoOgni || (lv === 'principiante' || cfg.infortunio ? 3 : 4);
    const crescita = cfg.infortunio ? 1.05 : giorni === 2 ? 1.07 : 1.10; // con 2 uscite ogni seduta pesa di più: progressione più lenta

    const gara = new Date(cfg.dataGara + 'T12:00:00');
    const inizio = lunediDi(cfg.dataInizio ? new Date(cfg.dataInizio + 'T12:00:00') : new Date());
    const nSett = Math.round((lunediDi(gara) - inizio) / 6048e5) + 1; // compresa la settimana della gara
    if (giorni === 2 && cfg.gara === 'mezza') avvisi.push('Mezza maratona con 2 uscite a settimana: possibile per chi ha già una base, ma il lungo cresce lentamente. Il coach valuti se aggiungere una terza uscita facile.');
    if (nSett < G.minSett) avvisi.push(`Solo ${nSett} settimane alla gara: per questa distanza ne servono almeno ${G.minSett}. Il piano è compresso.`);

    // fasi
    const nTaper = Math.min(G.taper, Math.max(1, nSett - 2));
    const restanti = nSett - nTaper;
    const nSpec = Math.max(2, Math.round(restanti * (cfg.gara === 'maratona' ? 0.4 : 0.45)));
    const nFondo = Math.max(0, restanti - nSpec);
    const faseDi = i => (i < nFondo ? 'fondo' : i < nFondo + nSpec ? 'specifico' : 'taper');

    // volume: dal volume attuale al picco, +10% max a settimana, recupero ogni N settimane
    const picco = Math.max(cfg.kmAttuali || 0, Math.min(G.picco[lv], (cfg.kmAttuali || G.picco[lv] * 0.6) * 1.6));
    const vol = []; const recupero = [];
    let base = Math.max(cfg.kmAttuali || G.picco[lv] * 0.5, 15);
    let contatore = 0;
    for (let i = 0; i < nSett; i++) {
      const f = faseDi(i);
      if (f === 'taper') {
        const k = i - (nFondo + nSpec); // 0..nTaper-1
        const scala = TAPER_SCALA[cfg.gara].slice(-nTaper);
        vol.push(r05(Math.max(...vol.slice(-4), base) * scala[k])); recupero.push(false); continue;
      }
      contatore++;
      const rec = contatore % recOgni === 0 && i < nFondo + nSpec - 1;
      recupero.push(rec);
      if (rec) { vol.push(r05(base * 0.75)); continue; }
      if (i > 0 && !recupero[i - 1]) base = Math.min(picco, base * crescita);
      vol.push(r05(base));
    }

    // lungo: +10% max rispetto al lungo più lungo dei 30 giorni prima (Frandsen 2025)
    const capKm = Math.min(G.lungo[lv], LUNGO_MAX_MIN[lv] * 60 / ((Z.E[0] + Z.E[1]) / 2));
    let lungoMax30 = cfg.lungoAttuale || Math.max(8, (cfg.kmAttuali || 20) * 0.3);
    const storicoLunghi = [];
    const settimane = [];
    let ultimoLungoPieno = -1;

    for (let i = 0; i < nSett; i++) {
      const fase = faseDi(i), rec = recupero[i];
      const lunedi = new Date(inizio); lunedi.setDate(lunedi.getDate() + i * 7);
      const pFase = fase === 'fondo' ? (nFondo > 1 ? i / (nFondo - 1) : 1) : fase === 'specifico' ? (nSpec > 1 ? (i - nFondo) / (nSpec - 1) : 1) : (i - nFondo - nSpec) / Math.max(1, nTaper - 1);
      const settGara = i === nSett - 1;
      const template = SETTIMANA[giorni];
      const sedute = [];

      // lungo della settimana
      const max30 = Math.max(lungoMax30, ...storicoLunghi.slice(-4));
      let kmLungo;
      if (fase === 'taper') {
        const k = i - nFondo - nSpec;
        const quote = nTaper === 3 ? [0.65, 0.5] : [0.55];
        kmLungo = settGara ? 0 : r05(Math.max(...storicoLunghi) * (quote[k] ?? 0.45));
      } else if (rec) kmLungo = r05(max30 * 0.6);
      else kmLungo = r05(Math.min(capKm, max30 * (cfg.infortunio ? 1.05 : 1.1), vol[i] * QUOTA_LUNGO[giorni]));
      if (!settGara) storicoLunghi.push(kmLungo);
      if (!rec && fase !== 'taper' && kmLungo >= capKm * 0.9) ultimoLungoPieno = i;

      // km a ritmo gara nel lungo (solo maratona e mezza, in fase specifica)
      let gpKm = 0;
      if ((cfg.gara === 'maratona' || cfg.gara === 'mezza') && !rec) {
        if (fase === 'specifico') gpKm = Math.round(kmLungo * [0.2, 0.3, 0.35, 0.35, 0.3][Math.min(4, Math.floor(pFase * 4.99))]);
        else if (fase === 'taper' && !settGara) gpKm = Math.round(kmLungo * 0.35);
        if (lv === 'principiante') gpKm = Math.round(gpKm * 0.6);
      }

      for (const [d, ruolo] of Object.entries(template)) {
        const giorno = +d;
        const data = new Date(lunedi); data.setDate(data.getDate() + giorno);
        let s = null;
        if (settGara) { // settimana della gara
          if (ruolo === 'Q1') s = SEDUTE.RIFINITURA(0, lv, G.gp);
          else if (ruolo === 'LUNGO') s = { titolo: `GARA · ${({ maratona: 'maratona', mezza: 'mezza maratona', '10k': '10 km', '5k': '5 km' })[cfg.gara]}`, passi: [st('gara', G.gp, { km: DIST[cfg.gara] / 1000 })], intensita: 'gara' };
          else if (ruolo === 'FACILE_SALITE') s = facileAllunghi(20);
          else if (ruolo === 'Q2' || ruolo === 'MEDIO_LUNGO') s = facile(giorno === 2 ? 40 : 30);
          else s = null;
        } else if (ruolo === 'LUNGO') s = lungo(kmLungo, gpKm, G.gp, rec ? 'settimana di recupero' : null);
        else if (ruolo === 'Q1') {
          if (fase === 'fondo') s = SEDUTE.ST_CONTINUO(pFase, lv);
          else if (fase === 'specifico') s = breve ? SEDUTE.VO2_KM(pFase, lv) : lv !== 'principiante' ? SEDUTE.VO2(pFase, lv) : SEDUTE.SOGLIA(pFase, lv);
          else s = breve ? SEDUTE.TAPER_BREVE_Q1(0, lv, G.gp) : SEDUTE.TAPER_Q1();
          if (rec) s = facileAllunghi(40);
        } else if (ruolo === 'Q2') {
          if (fase === 'fondo' && (lv === 'principiante' || (i < 2 && lv !== 'avanzato'))) s = facileAllunghi(35);
          else if (fase === 'fondo') s = (cfg.gara === '5k' || cfg.gara === '10k') ? SEDUTE.SALITE(pFase) : SEDUTE.ST_INTERVALLI(pFase, lv);
          else if (fase === 'specifico') {
            const k = i - nFondo;
            if (cfg.gara === '10k') s = pFase < 0.5 ? SEDUTE.SOGLIA_LUNGA(pFase * 2, lv) : SEDUTE.PASSO_GARA((pFase - 0.5) * 2, lv, G.gp);
            else if (cfg.gara === '5k') s = pFase > 0.7 ? SEDUTE.PASSO_GARA(1, lv, G.gp) : k % 2 === 0 ? SEDUTE.RIPETUTE_BREVI(pFase, lv) : SEDUTE.SOGLIA_LUNGA(0, lv);
            else s = cfg.gara === 'maratona' && lv !== 'principiante' ? SEDUTE.SOGLIA(pFase, lv) : SEDUTE.PASSO_GARA(pFase, lv, G.gp);
          } else s = breve ? SEDUTE.TAPER_BREVE_Q2() : SEDUTE.TAPER_Q2(0, lv, G.gp);
          if (rec && s.intensita !== 'facile') s = SEDUTE.ST_CONTINUO(0, lv);
        } else if (ruolo === 'MEDIO_LUNGO') {
          const km = cfg.gara === 'maratona' ? r05(Math.min(16, Math.max(8, kmLungo * 0.5, vol[i] * 0.2))) : r05(Math.max(6, vol[i] * 0.16));
          s = { titolo: cfg.gara === 'maratona' ? `medio-lungo ${km} km` : `${km} km facile`, passi: [st('corsa', 'E', { km })], intensita: 'facile' };
        } else if (ruolo === 'FACILE_SALITE') s = facileSalite(fase === 'taper' ? 25 : 30);
        else if (ruolo === 'FACILE_ALLUNGHI') s = facileAllunghi(fase === 'taper' ? 30 : 40);
        else if (ruolo === 'FACILE') s = facile(40);
        if (!s) continue;
        const { km, min } = kmMinPassi(s.passi, Z);
        sedute.push(Object.assign(s, { ruolo, giorno: GIORNI[giorno], data: isoGiorno(data), km: Math.round(km * 10) / 10, min: Math.round(min) }));
      }

      // adatta le sedute facili al volume obiettivo (solo corse facili, ±)
      const tot = sedute.reduce((a, s) => a + s.km, 0);
      const scarto = vol[i] - tot;
      const facili = sedute.filter(s => s.intensita === 'facile' && s.ruolo !== 'LUNGO' && s.passi[0].min != null);
      if (!settGara && facili.length && Math.abs(scarto) > 1) {
        const passoE = (Z.E[0] + Z.E[1]) / 2;
        for (const s of facili) {
          const delta = scarto / facili.length * passoE / 60; // km in più/meno -> minuti
          const tetto = fase === 'taper' ? 45 : breve ? 60 : 75; // nello scarico niente corse facili lunghe
          const nuovo = Math.max(25, Math.min(tetto, Math.round((s.passi[0].min + delta) / 5) * 5));
          s.passi[0].min = nuovo;
          s.titolo = s.titolo.replace(/^\d+'/, `${nuovo}'`);
          const r = kmMinPassi(s.passi, Z); s.km = Math.round(r.km * 10) / 10; s.min = Math.round(r.min);
        }
      }

      const ml = sedute.find(s => s.ruolo === 'MEDIO_LUNGO' && s.passi[0].km != null);
      const sopra = sedute.reduce((a, s) => a + s.km, 0) - vol[i] * 1.08;
      if (!settGara && ml && sopra > 0) {
        const nuovo = r05(Math.max(cfg.gara === 'maratona' ? 8 : 6, ml.passi[0].km - sopra));
        ml.passi[0].km = nuovo; ml.titolo = ml.titolo.replace(/[0-9.]+ km/, `${nuovo} km`);
        const r = kmMinPassi(ml.passi, Z); ml.km = Math.round(r.km * 10) / 10; ml.min = Math.round(r.min);
      }

      const ricalcola = s => { const r = kmMinPassi(s.passi, Z); s.km = Math.round(r.km * 10) / 10; s.min = Math.round(r.min); };
      const minFacili = () => sedute.reduce((a, s) => a + (s.intensita === 'facile' ? s.min : s.passi.reduce((b, p) => b + (p.passo === 'E' || p.passo === 'REC' ? kmMinPassi([p], Z).min : p.tipo === 'ripeti' ? p.passi.filter(q => q.passo === 'REC').reduce((c, q) => c + q.min * p.n, 0) : 0), 0)), 0);
      const quota = () => { const m = sedute.reduce((a, s) => a + s.min, 0); return m ? minFacili() / m * 100 : 100; };

      // autocorrezione: se la settimana è troppo intensa accorcia prima la qualità 2, poi la 1, poi il ritmo gara nel lungo
      const minQuota = fase === 'fondo' ? 78 : 70;
      const corretta = [];
      if (!settGara && fase !== 'taper' && !rec) {
        for (let giro = 0; giro < 15 && quota() < minQuota; giro++) {
          let fatto = false;
          const qualita = sedute.filter(s => s.intensita !== 'facile' && s.ruolo !== 'LUNGO').sort((a, b) => (b.ruolo === 'Q2') - (a.ruolo === 'Q2'));
          for (const s of qualita) {
            // minimo di ripetute perché la seduta resti allenante: VO2max e velocità 4, soglia 3, passo gara 2
            const minRip = p => { const z = (p.passi.find(x => x.tipo === 'lavoro') || {}).passo; return z === 'I' || z === 'R' ? 4 : z === 'T' ? 3 : 2; };
            const r = s.passi.find(p => p.tipo === 'ripeti' && p.passi.some(x => x.tipo === 'lavoro') && p.n > minRip(p));
            if (r) { r.n--; s.titolo = s.titolo.replace(/\d+×/, `${r.n}×`); ricalcola(s); fatto = true; corretta.push(s.giorno); break; }
            const c = s.passi.find(p => p.tipo === 'lavoro' && p.min != null && p.min > 15);
            if (c) { c.min -= 5; s.titolo = s.titolo.replace(/^\d+'/, `${c.min}'`); ricalcola(s); fatto = true; corretta.push(s.giorno); break; }
          }
          if (!fatto && gpKm > 0) {
            const L = sedute.find(s => s.ruolo === 'LUNGO');
            gpKm = Math.max(0, gpKm - 2);
            const nuovo = lungo(kmLungo, gpKm, G.gp, null);
            Object.assign(L, { titolo: nuovo.titolo, passi: nuovo.passi, intensita: nuovo.intensita }); ricalcola(L);
            fatto = true; corretta.push(L.giorno);
          }
          if (!fatto) break;
        }
      }

      const km = Math.round(sedute.reduce((a, s) => a + s.km, 0) * 10) / 10;
      const min = sedute.reduce((a, s) => a + s.min, 0);
      settimane.push({
        n: i + 1, aGara: nSett - 1 - i, lunedi: isoGiorno(lunedi), fase, recupero: rec, kmObiettivo: vol[i], km, min,
        quotaFacile: Math.round(quota()), lungo: kmLungo, sedute, autocorretta: [...new Set(corretta)],
      });
    }

    // segnalazioni per il coach
    const segnalazioni = [...avvisi.map(t => ({ livello: 'attenzione', settimana: null, testo: t }))];
    if (cfg.kmAttuali && settimane[0].km > cfg.kmAttuali * 1.15) segnalazioni.push({ livello: 'attenzione', settimana: 1, testo: `La prima settimana (${settimane[0].km} km) supera di oltre il 15% il volume attuale (${cfg.kmAttuali} km). Valutare meno giorni o sedute più corte.` });
    settimane.forEach((w, i) => {
      const prev = settimane[i - 1];
      if (prev && !prev.recupero && w.fase !== 'taper' && w.km > prev.km * 1.12) segnalazioni.push({ livello: 'attenzione', settimana: w.n, testo: `Volume +${Math.round((w.km / prev.km - 1) * 100)}% rispetto alla settimana prima.` });
      // fondo: ≥ 78% facile; specifico: ≥ 70% (piramidale, cresce il lavoro a ritmo gara — Casado 2022, Haugen 2022)
      const minFacile = w.fase === 'fondo' ? 78 : 70;
      if (w.fase !== 'taper' && !w.recupero && w.quotaFacile < minFacile) segnalazioni.push({ livello: 'controllo', settimana: w.n, testo: `Solo ${w.quotaFacile}% del tempo a intensità facile (minimo ${minFacile}% in fase ${w.fase}).` });
      const lungoPrima = Math.max(lungoMax30, ...settimane.slice(Math.max(0, i - 4), i).map(x => x.lungo));
      if (w.lungo > lungoPrima * 1.1 + 0.5) segnalazioni.push({ livello: 'attenzione', settimana: w.n, testo: `Lungo di ${w.lungo} km: oltre +10% rispetto al più lungo degli ultimi 30 giorni (${lungoPrima} km).` });
    });
    if (cfg.gara === 'maratona' && ultimoLungoPieno >= 0 && nSett - 1 - ultimoLungoPieno < 3) segnalazioni.push({ livello: 'attenzione', settimana: ultimoLungoPieno + 1, testo: "L'ultimo lungo pieno cade a meno di 3 settimane dalla gara." });
    const lungoTop = Math.max(...settimane.map(w => w.lungo));
    const minimo = { maratona: 26, mezza: 15, '10k': 10, '5k': 7 }[cfg.gara];
    if (lungoTop < minimo) segnalazioni.push({ livello: 'attenzione', settimana: null, testo: `Il lungo più lungo arriva a ${lungoTop} km (riferimento ≥ ${minimo} km per questa gara): valutare più settimane di preparazione o un obiettivo prudente.` });
    if (cfg.infortunio) segnalazioni.push({ livello: 'attenzione', settimana: null, testo: 'Infortunio negli ultimi 6 mesi: è il fattore di rischio più forte (Relph 2023). Progressione ridotta al 5%, recupero ogni 3 settimane. Valutare il via libera del fisioterapista.' });
    if (cfg.gara === '5k' && lv === 'principiante' && (cfg.kmAttuali || 0) < 8) segnalazioni.push({ livello: 'attenzione', settimana: null, testo: "Volume attuale sotto 8 km/settimana: se l'atleta non corre ancora 30' senza fermarsi, partire dal percorso start corsa-cammino." });
    if (picco < G.picco[lv] * 0.8) segnalazioni.push({ livello: 'controllo', settimana: null, testo: `Volume di partenza basso: il picco arriva a ${Math.round(Math.max(...vol))} km/settimana, sotto il riferimento per il livello ${lv} (${G.picco[lv]} km). Valutare un obiettivo prudente.` });

    return {
      input: cfg, vdot: Math.round(vdot * 10) / 10,
      passi: Object.fromEntries(Object.entries(Z).map(([k, b]) => [k, fmtBanda(b)])),
      previsioni: Object.fromEntries(Object.keys(DIST).map(d => [d, tempoGara(vdot, DIST[d])])),
      fasi: { fondo: nFondo, specifico: nSpec, taper: nTaper }, settimane, segnalazioni,
    };
  }

  /* ---------- percorso START: da zero a 30' di corsa continua ----------
   * 3 uscite a settimana a giorni alterni, 10 settimane (più graduale del Couch to 5K NHS, che ne dura 9).
   * Ogni seduta: 5' di cammino, blocchi corsa/cammino, 5' di cammino. Corsa sempre "a parlare".
   * Si ripete la settimana se la fatica supera 6/10 o compare dolore: i principianti si infortunano
   * più del doppio per ora di corsa (Videbaek 2015) e chi abbandona il programma lo fa spesso per dolore (Relph 2023).
   */
  // Ogni settimana: s = le 3 uscite. Un'uscita è { c: [ripetizioni, min corsa, min cammino] } (corsa-cammino),
  // { cam: minuti } (solo camminata veloce) o { corsa: minuti, allunghi: n } (corsa continua).
  const rcw = (n, c, w) => ({ c: [n, c, w] });
  const tre = u => [u, u, u];
  const START = [ // da sedentario a 30' continui, 10 settimane
    tre(rcw(8, 1, 1.5)), tre(rcw(8, 1.5, 1.5)), tre(rcw(6, 2, 1.5)), tre(rcw(5, 3, 1.5)), tre(rcw(4, 4, 1.5)),
    tre(rcw(3, 6, 2)), tre(rcw(2, 10, 2)), [rcw(2, 12, 2), rcw(2, 12, 2), { corsa: 20 }],
    [{ corsa: 25 }, { corsa: 25 }, { corsa: 30 }], tre({ corsa: 30 }), // +18% e +12%: sotto il 20% (Damsted 2019)
  ];
  // BMI ≥ 30: 3 settimane di sola camminata, poi una prima settimana di corsa sotto i 3 km (Nielsen 2014, DANO-RUN)
  const START_CAMMINATA = [
    tre({ cam: 25 }), tre({ cam: 30 }), tre({ cam: 35 }),
    tre(rcw(6, 1, 2)), tre(rcw(8, 1, 2)), ...START.slice(1),
  ];
  // chi fa già sport: base aerobica presente, ma tendini e ossa non sono abituati agli impatti della corsa.
  // Corsa continua facile, minuti settimanali +10-15% (Damsted 2019: oltre il 20% più infortuni), recupero alla 5a.
  const START_SPORTIVI = [
    [{ corsa: 20 }, { corsa: 20 }, { corsa: 25 }], [{ corsa: 20 }, { corsa: 25 }, { corsa: 25 }],
    [{ corsa: 25 }, { corsa: 25 }, { corsa: 30 }], [{ corsa: 25 }, { corsa: 30, allunghi: 4 }, { corsa: 30 }],
    [{ corsa: 20 }, { corsa: 25, allunghi: 4 }, { corsa: 25 }], [{ corsa: 25 }, { corsa: 30, allunghi: 6 }, { corsa: 35 }],
    [{ corsa: 30 }, { corsa: 30, allunghi: 6 }, { corsa: 35 }], [{ corsa: 30 }, { corsa: 35, allunghi: 6 }, { corsa: 40 }],
  ];
  const VARIANTI = {
    standard: { nome: 'start', settimane: START, fasi: [4, 4, 2] },
    camminata: { nome: 'start camminata', settimane: START_CAMMINATA, fasi: [5, 5, 4] },
    sportivi: { nome: 'start sportivi', settimane: START_SPORTIVI, fasi: [4, 4, 0], recupero: [4] },
  };
  const varianteStart = cfg => (cfg.profilo === 'sportivo' ? 'sportivi' : cfg.bmi >= 30 ? 'camminata' : 'standard');

  function generaStart(input) {
    const cfg = Object.assign({ livello: 'principiante', giorni: 3 }, input);
    const Z = zone(cfg.profilo === 'sportivo' ? 35 : 30); // passi stimati prudenti, servono solo per i km indicativi
    const v = VARIANTI[varianteStart(cfg)];
    const inizio = lunediDi(cfg.dataInizio ? new Date(cfg.dataInizio + 'T12:00:00') : new Date());
    const seduta = u => {
      if (u.cam) return { titolo: `${u.cam}' di camminata veloce`, passi: [st('cammino', 'W', { min: u.cam }, 'passo svelto, respiro più rapido ma si parla')], intensita: 'facile', corsaMin: 0 };
      if (u.corsa) {
        const passi = [st('cammino', 'W', { min: 5 }, 'veloce'), st('corsa', 'E', { min: u.corsa })];
        if (u.allunghi) passi.push(rip(u.allunghi, [st('allungo', 'R', { min: 0.33 }, 'progressivo, non uno sprint'), st('cammino', 'W', { min: 1 })]));
        return { titolo: `${u.corsa}' di corsa continua${u.allunghi ? ` + ${u.allunghi} allunghi` : ''}`, passi, intensita: 'facile', corsaMin: u.corsa };
      }
      const [n, c, w] = u.c;
      return { titolo: `${n}× (${c}' corsa + ${w}' cammino)`, passi: [st('cammino', 'W', { min: 5 }, 'veloce'), rip(n, [st('corsa', 'E', { min: c }), st('cammino', 'W', { min: w })]), st('cammino', 'W', { min: 5 })], intensita: 'facile', corsaMin: n * c };
    };
    const [fA, fB] = v.fasi;
    const sportivi = v === VARIANTI.sportivi;
    const avvisiGiorni = [];

    // giorni a settimana: sedentari 2 o 3 (sempre un giorno di riposo tra le uscite), sportivi da 2 a 6
    const richiesti = cfg.giorni | 0 || 3;
    let giorni = Math.max(2, Math.min(sportivi ? 6 : 3, richiesti));
    if (richiesti !== giorni) avvisiGiorni.push(sportivi
      ? `Richiesti ${richiesti} giorni: il percorso sportivi va da 2 a 6 uscite, il piano usa ${giorni} giorni.`
      : `Richiesti ${richiesti} giorni: per chi parte da zero il percorso prevede al massimo 3 uscite, con un giorno di riposo tra l'una e l'altra. Il piano usa ${giorni} giorni.`);

    // ogni uscita ricorda la settimana di origine (per fasi e recupero)
    let piano = v.settimane.map((w, i) => w.map(u => ({ ...u, orig: i })));
    if (giorni === 2) {
      // stesse sedute in sequenza, 2 a settimana: ogni passaggio dura circa una settimana e mezza
      const tutte = piano.flat(); piano = [];
      for (let k = 0; k < tutte.length; k += 2) piano.push(tutte.slice(k, k + 2));
      avvisiGiorni.push(`Con 2 uscite a settimana il percorso dura ${piano.length} settimane invece di ${v.settimane.length}: ogni passaggio si ripete per circa una settimana e mezza.`);
    } else if (giorni > 3) {
      // Più uscite = stessi minuti un po' più alti (+10% per giorno oltre il terzo) divisi in uscite da almeno 20'.
      // Il numero di uscite cresce da solo con il volume: niente salti di carico e la settimana di recupero resta più leggera.
      const fattore = 1 + 0.1 * (giorni - 3);
      piano = piano.map((w, i) => {
        const lunga = w.reduce((a, u) => (u.corsa > a.corsa ? u : a));
        const allunghi = Math.max(0, ...w.map(u => u.allunghi || 0));
        const totale = Math.round(w.reduce((a, u) => a + u.corsa, 0) * fattore / 5) * 5;
        const resto = totale - lunga.corsa;
        const n = Math.max(1, Math.min(giorni - 1, Math.floor(resto / 20)));
        // divide il resto in n uscite multiple di 5', le più lunghe per prime (es. 65' -> 25+20+20)
        const blocchi = Math.max(n * 4, Math.round(resto / 5));
        const altre = [...Array(n)].map((_, k) => ({ corsa: (Math.floor(blocchi / n) + (k < blocchi % n ? 1 : 0)) * 5, orig: i }));
        if (allunghi) altre[altre.length - 1].allunghi = allunghi;
        return [...altre, { corsa: lunga.corsa, orig: i }];
      });
      avvisiGiorni.push(`Con ${giorni} uscite: stessi minuti della versione a 3 giorni aumentati del ${Math.round((fattore - 1) * 100)}% e divisi in uscite facili da almeno 20'. Le uscite in più arrivano da sole quando il volume lo permette, così il carico non cresce oltre il 15-20% a settimana.`);
    }
    const CALENDARIO = { 2: [1, 5], 3: [1, 3, 5], 4: [1, 3, 5, 6], 5: [0, 1, 3, 4, 6], 6: [0, 1, 2, 3, 5, 6] };

    const settimane = piano.map((uscite, i) => {
      const lunedi = new Date(inizio); lunedi.setDate(lunedi.getDate() + i * 7);
      const slot = CALENDARIO[uscite.length] || CALENDARIO[giorni];
      const sedute = uscite.map((u, j) => {
        const s = seduta(u);
        const g = slot[j];
        const data = new Date(lunedi); data.setDate(data.getDate() + g);
        const { km, min } = kmMinPassi(s.passi, Z);
        return Object.assign(s, { ruolo: u.extra ? 'START_EXTRA' : 'START', giorno: GIORNI[g], data: isoGiorno(data), km: Math.round(km * 10) / 10, min: Math.round(min) });
      });
      const o = uscite[0].orig;
      const recupero = (v.recupero || []).includes(o);
      return {
        n: i + 1, aGara: piano.length - 1 - i, lunedi: isoGiorno(lunedi), fase: o < fA ? 'adattamento' : o < fA + fB ? (recupero ? 'recupero' : 'costruzione') : 'consolidamento',
        recupero, kmObiettivo: null, km: Math.round(sedute.reduce((a, s) => a + s.km, 0) * 10) / 10, min: sedute.reduce((a, s) => a + s.min, 0),
        quotaFacile: 100, lungo: 0, minutiCorsa: sedute.reduce((a, s) => a + s.corsaMin, 0), sedute,
      };
    });

    const segnalazioni = [];
    const add = (livello, testo) => segnalazioni.push({ livello, settimana: null, testo });
    avvisiGiorni.forEach(t => add('controllo', t));
    if (cfg.infortunio) add('attenzione', 'Infortunio recente: è il fattore di rischio più forte nei principianti (Relph 2023). Partire solo con il via libera del fisioterapista e ripetere le prime due settimane.');
    if (cfg.bmi >= 30 && cfg.profilo !== 'sportivo') add('attenzione', `BMI ${cfg.bmi}: rischio di infortunio più alto (Nielsen 2013). Variante "start camminata": 3 settimane di sola camminata e prima settimana di corsa sotto i 3 km (Nielsen 2014).`);
    else if (cfg.bmi >= 25) add('controllo', `BMI ${cfg.bmi}: nei principianti sopra 25 gli infortuni sono più frequenti (25% contro 15%, Buist & Bredeweg). Ripetere senza esitare le settimane faticose.`);
    if (cfg.bmi >= 30 && cfg.profilo === 'sportivo') add('controllo', `BMI ${cfg.bmi} in uno sportivo: il carico sulle articolazioni è alto anche con una buona base. Valutare la variante "start" corsa-cammino.`);
    if (cfg.eta >= 45 && cfg.eta <= 65) add('controllo', 'Età 45-65 anni: associata a più infortuni nei principianti (Nielsen 2013). Progressione da rispettare, recupero completo tra le uscite.');
    if (cfg.eta >= 40) add('controllo', 'Sopra i 40 anni: consigliata una visita medica prima di iniziare. Per correre con il club serve comunque il certificato medico non agonistico.');
    add('controllo', 'Regola del percorso: ripetere la settimana se la fatica supera 6/10, se il giorno dopo restano dolori o se una seduta non viene completata.');
    add('controllo', 'Sempre un giorno di riposo tra due uscite. Il passo giusto è quello a cui si riesce a parlare.');

    return {
      input: cfg, variante: v.nome, vdot: null, passi: Object.fromEntries(Object.entries(Z).map(([k, b]) => [k, fmtBanda(b)])), previsioni: {},
      fasi: {
        adattamento: settimane.filter(w => w.fase === 'adattamento').length,
        costruzione: settimane.filter(w => w.fase === 'costruzione' || w.fase === 'recupero').length,
        consolidamento: settimane.filter(w => w.fase === 'consolidamento').length,
      }, giorni, settimane, segnalazioni,
    };
  }

  /* ---------- FORZA: circuiti NOSTOP. ----------
   * Lauersen 2014 (BJSM, 25 studi): la forza riduce gli infortuni sportivi a meno di 1/3 (RR 0,32); lo stretching no (RR 0,96).
   * Llanos-Lagos 2024: forza pesante e pliometria migliorano l'economia di corsa; 2-3 volte a settimana, pliometria dopo una base.
   * Le sedute di forza non sono corsa: stanno in settimana.forza e non entrano in km e quota facile.
   */
  const CIRCUITI = {
    base: { titolo: 'forza base (corpo libero)', min: 25, esercizi: [
      ['squat a corpo libero', '3×10'], ['affondo indietro', '3×8 per gamba'], ['ponte glutei', '3×12'],
      ['calf raise in piedi', '3×15'], ['plank', '3×30"'], ['plank laterale', '2×20" per lato']] },
    runner: { titolo: 'forza runner (con carichi)', min: 35, esercizi: [
      ['squat (bilanciere o goblet)', '3×6 pesante, 2 ripetizioni di riserva'], ['stacco rumeno', '3×6'], ['step-up su panca', '3×8 per gamba'],
      ['calf raise su gradino con carico', '3×10 + 3×30" isometrico a ginocchio piegato'], ['Copenhagen plank', '2×20" per lato'], ['dead bug', '2×10']] },
    plio: { titolo: 'pliometria + core', min: 25, esercizi: [
      ['skip A', '3×20 m'], ['pogo (saltelli sulle caviglie)', '3×15'], ['salto in alto da fermo', '3×5, recupero completo'],
      ['balzi alternati', '3×20 m'], ['pallof press', '2×10 per lato']] },
    mantenimento: { titolo: 'forza di mantenimento', min: 25, esercizi: [
      ['squat', '2×5 (carico abituale, niente fatica)'], ['stacco rumeno', '2×5'], ['calf raise su gradino', '2×10'], ['pogo', '2×10']] },
  };
  const seduteForza = (cod, data) => ({ ...CIRCUITI[cod], codice: cod, data, giorno: GIORNI[(new Date(data + 'T12:00:00').getDay() + 6) % 7], nota: 'facoltativi 5\' di mobilità alla fine: aiutano a sentirsi meglio, ma da soli non prevengono infortuni (Lauersen 2014)' });

  /* ---------- CLUB: uscite di gruppo NOSTOP. dentro il piano ----------
   * martedì 19:00 qualità in gruppo, giovedì 19:00 lento sociale, domenica 08:30 lungo + colazione.
   * Si abbina solo una seduta compatibile: qualità il martedì, facile il giovedì, lungo la domenica.
   */
  const CLUB = { 1: { tipo: 'qualità', ora: '19:00', nome: 'qualità in gruppo' }, 3: { tipo: 'facile', ora: '19:00', nome: 'lento sociale' }, 6: { tipo: 'lungo', ora: '08:30', nome: 'lungo + colazione' } };
  const gruppoPasso = sKmE => (sKmE < 300 ? 'A' : sKmE < 345 ? 'B' : sKmE < 390 ? 'C' : 'D'); // A <5:00, B 5:00-5:45, C 5:45-6:30, D oltre

  function arricchisci(p) {
    const cfg = p.input;
    const start = cfg.gara === 'start';
    const Z = zone(p.vdot || (cfg.profilo === 'sportivo' ? 35 : 30));
    const passoE = (Z.E[0] + Z.E[1]) / 2;
    const gruppo = start && cfg.profilo !== 'sportivo' ? 'start' : gruppoPasso(passoE);
    const conForza = cfg.forza !== false;
    const club = cfg.club === true ? { 1: true, 3: true, 6: true } : (cfg.club || {});
    const lv = cfg.livello || 'principiante';

    p.settimane.forEach((w, i) => {
      // --- club
      for (const s of w.sedute) {
        const d = GIORNI.indexOf(s.giorno);
        const c = club[d] && CLUB[d];
        if (!c) continue;
        const ok = (c.tipo === 'qualità' && (s.intensita === 'alta' || s.intensita === 'media') && s.ruolo !== 'LUNGO') || (c.tipo === 'facile' && s.intensita === 'facile' && s.ruolo !== 'LUNGO') || (c.tipo === 'lungo' && s.ruolo === 'LUNGO') || (start && c.tipo !== 'qualità');
        if (ok) s.club = { nome: c.nome, ora: c.ora, gruppo, nota: c.tipo === 'qualità' ? 'riscaldamento con il gruppo, poi la tua seduta ai tuoi passi' : `gruppo ${gruppo}` };
      }
      // --- forza
      w.forza = [];
      if (!conForza) return;
      const settGara = w.sedute.some(s => s.intensita === 'gara');
      if (settGara) return;
      let codici;
      if (start) {
        if (cfg.profilo === 'sportivo') codici = i < 2 ? ['base', 'base'] : ['runner', 'base'];
        else codici = i < 2 ? [] : i < 5 ? ['base'] : ['base', 'base'];
      } else if (w.fase === 'taper') codici = ['mantenimento'];
      else if (w.recupero) codici = [lv === 'principiante' ? 'base' : 'mantenimento'];
      else if (lv === 'principiante') codici = i < 3 ? ['base'] : ['base', 'base'];
      else if (w.fase === 'fondo') codici = i < 3 ? ['runner'] : ['runner', 'plio'];
      else codici = ['runner', 'plio'];
      // giorni: la prima dopo la qualità 1 (giorni duri duri), la seconda in un giorno senza qualità e non prima del lungo
      const occupati = new Map(w.sedute.map(s => [GIORNI.indexOf(s.giorno), s]));
      const lungoD = w.sedute.filter(s => s.ruolo === 'LUNGO').map(s => GIORNI.indexOf(s.giorno))[0];
      const q1 = w.sedute.find(s => s.ruolo === 'Q1' && s.intensita !== 'facile');
      const giorniOk = [3, 2, 0, 4, 1, 5, 6].filter(d => d !== lungoD && d !== (lungoD - 1) && !(occupati.get(d) && occupati.get(d).intensita === 'alta'));
      const scelti = [];
      if (q1 && !start) scelti.push(GIORNI.indexOf(q1.giorno));
      for (const d of giorniOk) { if (scelti.length >= codici.length) break; if (!scelti.some(x => Math.abs(x - d) < 2)) scelti.push(d); }
      while (scelti.length < codici.length && giorniOk.length) scelti.push(giorniOk.find(d => !scelti.includes(d)) ?? giorniOk[0]);
      codici.forEach((c, k) => { if (scelti[k] == null) return; const data = new Date(w.lunedi + 'T12:00:00'); data.setDate(data.getDate() + scelti[k]); w.forza.push(seduteForza(c, isoGiorno(data))); });
      w.forza.sort((a, b) => a.data.localeCompare(b.data));
    });
    return p;
  }

  /* ---------- ADATTAMENTO: proposta di modifica delle prossime sedute da quanto fatto davvero ----------
   * Restituisce una copia del piano modificata e l'elenco delle modifiche con il motivo: il coach la applica o la scarta.
   * Regole:
   *  - dolore ≥ 6/10, o dolore in 2 uscite: niente qualità né lungo per 7 giorni, solo facile breve; fisioterapista
   *  - dolore 4-5/10: qualità -> facile per 7 giorni, lungo al 70%. Si corre solo se durante resta ≤ 5/10 e la mattina dopo è sparito
   *    (pain monitoring model, Silbernagel 2007)
   *  - fatto molto più del previsto (+20% e ≥ 3 km, o +30%): settimana dopo -10% e lungo non oltre il previsto (Frandsen 2025)
   *  - fatica alta (media ≥ 7,5/10 nelle ultime 3 uscite) o 2+ segnali di affaticamento: prossima settimana come recupero (75%)
   *  - 2+ sedute saltate in 7 giorni o 5+ giorni senza correre: prossima settimana all'85%, nessun recupero delle sedute perse
   *  - 14+ giorni senza correre (VO2max circa -5%): prossima settimana al 60%, quella dopo all'80%, poi nuovo test
   */
  function adatta(pianoIn, esecuzioni, oggi) {
    const p = JSON.parse(JSON.stringify(pianoIn));
    const Z = zone(p.vdot || 30);
    const passoE = (Z.E[0] + Z.E[1]) / 2;
    const add = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return isoGiorno(x); };
    const tutte = p.settimane.flatMap(w => w.sedute.map(s => ({ s, w })));
    const recenti = tutte.filter(({ s }) => s.data >= add(oggi, -7) && s.data < oggi && esecuzioni[s.id]);
    const fatte = tutte.filter(({ s }) => s.data < oggi && esecuzioni[s.id] && esecuzioni[s.id].fatta);
    const ultima = fatte.length ? fatte[fatte.length - 1].s.data : null;
    const pausa = ultima ? Math.round((new Date(oggi) - new Date(ultima)) / 864e5) : 0;
    const modifiche = [], motivi = [];
    const misuraS = s => { const r = kmMinPassi(s.passi, Z); s.km = Math.round(r.km * 10) / 10; s.min = Math.round(r.min); };
    // una riga per seduta: se più regole la toccano si tiene il titolo originale, quello finale e tutti i motivi
    const registra = (w, s, prima, motivo) => {
      if (prima === s.titolo) return;
      const m = modifiche.find(x => x.id === s.id);
      if (m) { m.dopo = s.titolo; if (!m.motivi.includes(motivo)) m.motivi.push(motivo); }
      else modifiche.push({ id: s.id, settimana: w.n, data: s.data, giorno: s.giorno, prima, dopo: s.titolo, motivi: [motivo] });
    };
    const finestra = (da, giorni) => tutte.filter(({ s }) => s.data >= da && s.data < add(da, giorni) && s.intensita !== 'gara');

    const aFacile = (w, s, motivo, minuti = 30) => {
      const prima = s.titolo;
      if (s.ruolo === 'LUNGO') { const n = lungo(r05(s.km * 0.6), 0, 'M', null); Object.assign(s, { titolo: n.titolo, passi: n.passi, intensita: 'facile' }); }
      else { const n = facile(minuti); Object.assign(s, { titolo: n.titolo, passi: n.passi, intensita: 'facile' }); }
      misuraS(s); registra(w, s, prima, motivo);
    };
    const scala = (w, s, f, motivo) => {
      const prima = s.titolo;
      if (s.ruolo === 'LUNGO' || (s.passi.length === 1 && s.passi[0].km != null)) {
        const km = r05(Math.max(5, s.km * f));
        const gpStep = s.passi.find(x => x.tipo === 'lavoro');
        const gpKm = gpStep && f >= 0.8 ? Math.round(gpStep.km * f) : 0;
        const n = s.ruolo === 'LUNGO' ? lungo(km, gpKm, gpStep ? gpStep.passo : 'M', null) : { titolo: s.titolo.replace(/[0-9.]+ km/, `${km} km`), passi: [st('corsa', 'E', { km })], intensita: 'facile' };
        Object.assign(s, { titolo: n.titolo, passi: n.passi, intensita: n.intensita });
      } else if (s.intensita === 'facile' && s.passi[0].min != null) {
        const m = Math.max(20, Math.round(s.passi[0].min * f / 5) * 5); s.passi[0].min = m; s.titolo = s.titolo.replace(/^\d+'/, `${m}'`);
      } else {
        const r = s.passi.find(x => x.tipo === 'ripeti' && x.passi.some(y => y.tipo === 'lavoro'));
        if (r) { const z = r.passi.find(y => y.tipo === 'lavoro').passo; const min = z === 'I' || z === 'R' ? 4 : z === 'T' ? 3 : 2; r.n = Math.max(min, Math.round(r.n * f)); s.titolo = s.titolo.replace(/\d+×/, `${r.n}×`); }
        const c = s.passi.find(x => x.tipo === 'lavoro' && x.min != null && x.min > 15);
        if (c) { c.min = Math.max(15, Math.round(c.min * f / 5) * 5); s.titolo = s.titolo.replace(/^\d+'/, `${c.min}'`); }
      }
      misuraS(s); registra(w, s, prima, motivo);
    };

    // 1. dolore
    const dolori = recenti.map(({ s }) => esecuzioni[s.id].dolore).filter(d => d && d.intensita > 0);
    const maxDol = Math.max(0, ...dolori.map(d => d.intensita));
    if (maxDol >= 6 || dolori.length >= 2) {
      const m = `dolore ${dolori.map(d => `${d.zona} ${d.intensita}/10`).join(', ')}: 7 giorni solo corsa facile breve, valutare il fisioterapista`;
      motivi.push(m);
      finestra(oggi, 7).forEach(({ w, s }) => { if (s.intensita !== 'facile' || s.ruolo === 'LUNGO') aFacile(w, s, m, 25); else scala(w, s, 0.7, m); });
    } else if (maxDol >= 4) {
      const m = `dolore ${dolori[0].zona} ${maxDol}/10: niente qualità per 7 giorni, lungo al 70%. Correre solo se durante resta entro 5/10 e la mattina dopo è sparito`;
      motivi.push(m);
      finestra(oggi, 7).forEach(({ w, s }) => { if (s.ruolo === 'LUNGO') scala(w, s, 0.7, m); else if (s.intensita !== 'facile') aFacile(w, s, m, 35); });
    }

    // 1b. con dolore anche la forza si alleggerisce: niente salti, carichi di mantenimento
    if (maxDol >= 4 || dolori.length >= 2) {
      const m = `dolore ${dolori[0].zona}: niente pliometria per 7 giorni, forza solo di mantenimento`;
      for (const w of p.settimane) {
        w.forza = (w.forza || []).filter(f => {
          if (f.data < oggi || f.data >= add(oggi, 7)) return true;
          if (f.codice === 'plio') { modifiche.push({ id: f.id || f.data + 'plio', settimana: w.n, data: f.data, giorno: f.giorno, prima: f.titolo, dopo: 'tolta', motivi: [m] }); return false; }
          if (f.codice === 'runner') { const prima = f.titolo; Object.assign(f, { ...CIRCUITI.mantenimento, codice: 'mantenimento' }); modifiche.push({ id: f.id || f.data + 'forza', settimana: w.n, data: f.data, giorno: f.giorno, prima, dopo: f.titolo, motivi: [m] }); }
          return true;
        });
      }
    }

    // 2. fatto molto più del previsto
    const oltre = recenti.filter(({ s }) => { const e = esecuzioni[s.id]; return e.fatta && s.km >= 5 && (e.km > s.km * 1.3 || (e.km > s.km * 1.2 && e.km - s.km >= 3)); });
    if (oltre.length) {
      const o = oltre[0];
      const m = `${o.s.giorno} ${o.s.data.slice(8)}/${o.s.data.slice(5, 7)}: ${esecuzioni[o.s.id].km} km invece di ${o.s.km}. Settimana dopo -10% e lungo non oltre il previsto, per non sommare due picchi`;
      motivi.push(m);
      finestra(oggi, 7).forEach(({ w, s }) => { if (s.intensita === 'facile' || s.ruolo === 'LUNGO') scala(w, s, 0.9, m); });
    }

    // 3. fatica
    const rpe = recenti.map(({ s }) => esecuzioni[s.id]).filter(e => e.fatta && e.rpe).slice(-3);
    const rpeM = rpe.length ? rpe.reduce((a, e) => a + e.rpe, 0) / rpe.length : 0;
    const segniFatica = recenti.filter(({ s }) => (esecuzioni[s.id].sensazioni || []).some(x => /affaticato|pesanti/.test(x))).length;
    if (!motivi.length && (rpeM >= 7.5 || segniFatica >= 2)) {
      const m = `fatica alta (media ${rpeM.toFixed(1)}/10${segniFatica >= 2 ? `, ${segniFatica} uscite con gambe pesanti o affaticamento` : ''}): prossimi 7 giorni come settimana di recupero`;
      motivi.push(m);
      finestra(oggi, 7).forEach(({ w, s }) => { if (s.intensita === 'alta') scala(w, s, 0.6, m); else scala(w, s, 0.8, m); });
    }

    // 4. sedute saltate / pause
    const saltate = recenti.filter(({ s }) => !esecuzioni[s.id].fatta).length;
    if (pausa >= 14) {
      const m = `${pausa} giorni senza correre (VO2max circa -5% dopo 2 settimane): ripresa al 60% e poi all'80%, poi nuovo test per aggiornare le zone`;
      motivi.push(m);
      finestra(oggi, 7).forEach(({ w, s }) => (s.intensita === 'alta' ? aFacile(w, s, m, 30) : scala(w, s, 0.6, m)));
      finestra(add(oggi, 7), 7).forEach(({ w, s }) => scala(w, s, 0.8, m));
    } else if (!motivi.length && (saltate >= 2 || pausa >= 5)) {
      const m = `${saltate >= 2 ? `${saltate} sedute saltate in 7 giorni` : `${pausa} giorni senza correre`}: prossima settimana all'85%, le sedute perse non si recuperano`;
      motivi.push(m);
      finestra(oggi, 7).forEach(({ w, s }) => scala(w, s, 0.85, m));
    } else if (saltate === 1 && !motivi.length) motivi.push('1 seduta saltata: nessuna modifica, non va recuperata sommandola alle altre');

    // 5. qualità sempre facili: suggerisci un nuovo test
    const qFacili = recenti.filter(({ s }) => s.intensita === 'alta' && esecuzioni[s.id].fatta && esecuzioni[s.id].rpe && esecuzioni[s.id].rpe <= 4).length;
    const suggerimenti = qFacili >= 2 ? ['Le sedute di qualità risultano molto facili (fatica ≤ 4/10): proporre un nuovo test, le zone potrebbero essere salite.'] : [];

    p.settimane.forEach(w => Object.assign(w, riepilogoSettimana(w.sedute, p.vdot)));
    modifiche.sort((a, b) => a.data.localeCompare(b.data));
    return { piano: p, modifiche, motivi, suggerimenti, passoE };
  }

  /* ---------- EXPORT verso intervals.icu (ponte verso Garmin) ----------
   * intervals.icu è partner Garmin: gli allenamenti scritti sul calendario intervals.icu dell'atleta arrivano sull'orologio.
   * Sintassi del testo (workout builder): "- 10m 5:30-6:16/km Pace", distanze in km, "Nx" su una riga prima del blocco
   * da ripetere, sezioni separate da righe vuote, una sola unità per tutto l'allenamento (qui sempre il passo).
   * Evento: POST /api/v1/athlete/{id}/events/bulk?upsert=true con category WORKOUT, type Run, start_date_local ...T00:00:00.
   */
  const passoIntervals = s => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function bandaIntervals(passo, Z) {
    if (passo === 'REC') return [Z.E[1], Z.E[1] + 90];       // recupero: corsa lentissima
    if (passo === 'W') return Z.W;
    return Z[passo] || Z.E;
  }
  function durataIntervals(st) {
    if (st.km != null) return `${+st.km.toFixed(2)}km`;
    const sec = Math.round(st.min * 60);
    return sec % 60 === 0 ? `${sec / 60}m` : sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
  }
  const rigaIntervals = (st, Z) => { const [veloce, lento] = bandaIntervals(st.passo, Z); return `- ${durataIntervals(st)} ${passoIntervals(veloce)}-${passoIntervals(lento)}/km Pace`; };
  function testoIntervals(seduta, vdot) {
    const Z = zone(vdot || 30);
    const sezioni = []; let corrente = [];
    const chiudi = () => { if (corrente.length) { sezioni.push(corrente.join('\n')); corrente = []; } };
    for (const st of seduta.passi) {
      if (st.tipo === 'ripeti') { chiudi(); sezioni.push(`${st.n}x\n${st.passi.map(x => rigaIntervals(x, Z)).join('\n')}`); }
      else corrente.push(rigaIntervals(st, Z));
    }
    chiudi();
    return sezioni.join('\n\n');
  }
  function esportaIntervals(piano, { da, a } = {}) {
    const eventi = [];
    for (const w of piano.settimane) {
      for (const s of w.sedute) {
        if ((da && s.data < da) || (a && s.data > a)) continue;
        eventi.push({
          category: 'WORKOUT', type: 'Run', start_date_local: `${s.data}T00:00:00`, name: `NOSTOP. ${s.titolo}`,
          description: testoIntervals(s, piano.vdot), moving_time: s.min * 60, external_id: `nostop-${s.id || s.data + '-' + s.ruolo}`,
        });
      }
      for (const f of w.forza || []) {
        if ((da && f.data < da) || (a && f.data > a)) continue;
        eventi.push({
          category: 'WORKOUT', type: 'WeightTraining', start_date_local: `${f.data}T00:00:00`, name: `NOSTOP. ${f.titolo}`,
          description: f.esercizi.map(([n, d]) => `${n}: ${d}`).join('\n'), moving_time: f.min * 60, external_id: `nostop-${f.id || f.data + '-' + f.codice}`,
        });
      }
    }
    return eventi;
  }

  const generaPiano = input => arricchisci(input.gara === 'start' ? generaStart(input) : genera(input));

  /* ---------- strumenti per l'area coach: modificare un piano e ricontrollarlo ---------- */
  const zoneDi = vdot => zone(vdot || 30);
  // km e minuti di una seduta (lista di passi)
  const misura = (passi, vdot) => { const r = kmMinPassi(passi, zoneDi(vdot)); return { km: Math.round(r.km * 10) / 10, min: Math.round(r.min) }; };
  // tempo a intensità facile di una seduta, come nel calcolo della quota settimanale
  const minFacileSeduta = (s, Z) => (s.intensita === 'facile' ? s.min : s.passi.reduce((b, p) => b + (p.passo === 'E' || p.passo === 'REC' || p.passo === 'W' ? kmMinPassi([p], Z).min : p.tipo === 'ripeti' ? p.passi.filter(q => q.passo === 'REC' || q.passo === 'W').reduce((c, q) => c + q.min * p.n, 0) : 0), 0));
  function riepilogoSettimana(sedute, vdot) {
    const Z = zoneDi(vdot);
    const km = Math.round(sedute.reduce((a, s) => a + s.km, 0) * 10) / 10;
    const min = sedute.reduce((a, s) => a + s.min, 0);
    const lungo = Math.max(0, ...sedute.filter(s => s.ruolo === 'LUNGO').map(s => s.km));
    return { km, min, lungo, quotaFacile: min ? Math.round(sedute.reduce((a, s) => a + minFacileSeduta(s, Z), 0) / min * 100) : 100 };
  }
  // segnalazioni ricalcolate dopo le modifiche del coach (stesse regole del generatore)
  function controlla(settimane, lungoIniziale) {
    const out = [];
    settimane.forEach((w, i) => {
      const prev = settimane[i - 1];
      if (prev && !prev.recupero && !/taper|scarico/.test(w.fase) && w.km > prev.km * 1.12) out.push({ livello: 'attenzione', settimana: w.n, testo: `Volume +${Math.round((w.km / prev.km - 1) * 100)}% rispetto alla settimana prima.` });
      const minQ = w.fase === 'fondo' ? 78 : w.fase === 'specifico' ? 70 : 0;
      if (minQ && !w.recupero && w.quotaFacile < minQ) out.push({ livello: 'controllo', settimana: w.n, testo: `Solo ${w.quotaFacile}% del tempo a intensità facile (minimo ${minQ}% in fase ${w.fase}).` });
      const prima = Math.max(lungoIniziale || 0, ...settimane.slice(Math.max(0, i - 4), i).map(x => x.lungo || 0));
      if (prima && w.lungo > prima * 1.1 + 0.5) out.push({ livello: 'attenzione', settimana: w.n, testo: `Lungo di ${w.lungo} km: oltre +10% rispetto al più lungo degli ultimi 30 giorni (${prima} km).` });
    });
    return out;
  }
  // sedute che il coach può inserire o usare per sostituirne una
  function libreria({ vdot, gara = 'maratona', livello = 'intermedio' } = {}) {
    const gp = (GARA[gara] || GARA.maratona).gp;
    const voci = [
      ['facile', 'facile', facile(30)], ['facile', 'facile', facile(40)], ['facile', 'facile', facile(50)],
      ['facile', 'facile + allunghi', facileAllunghi(35)], ['facile', 'facile + salite', facileSalite(30)],
      ['sotto soglia', 'sotto soglia', SEDUTE.ST_CONTINUO(0, livello)], ['sotto soglia', 'sotto soglia', SEDUTE.ST_CONTINUO(0.5, livello)], ['sotto soglia', 'sotto soglia', SEDUTE.ST_CONTINUO(1, livello)],
      ['sotto soglia', 'sotto soglia alta', SEDUTE.ST_INTERVALLI(0.3, livello)], ['sotto soglia', 'sotto soglia alta', SEDUTE.ST_INTERVALLI(0.9, livello)],
      ['soglia', 'soglia', SEDUTE.SOGLIA(0, livello)], ['soglia', 'soglia', SEDUTE.SOGLIA(0.5, livello)], ['soglia', 'soglia lunga', SEDUTE.SOGLIA_LUNGA(0.6, livello)],
      ['VO2max', 'VO2max', SEDUTE.VO2(0.5, livello)], ['VO2max', 'VO2max', SEDUTE.VO2_KM(0.4, livello)],
      ['velocità', 'ripetute brevi', SEDUTE.RIPETUTE_BREVI(0.3, livello)], ['velocità', 'salite', SEDUTE.SALITE(0.5)],
      ['passo gara', 'passo gara', SEDUTE.PASSO_GARA(0.5, livello, gp)],
    ];
    return voci.map(([gruppo, nome, s], k) => ({ id: 'L' + k, gruppo, nome, ...s, ...misura(s.passi, vdot) }));
  }
  const lungoLibero = (km, vdot) => { const s = lungo(km, 0, 'M', null); return { ...s, ...misura(s.passi, vdot) }; };

  const NostopPiani = { genera: generaPiano, misura, riepilogoSettimana, controlla, libreria, lungoLibero, adatta, arricchisci, CIRCUITI, testoIntervals, esportaIntervals, zone, vdotDa, tempoGara, fmtPasso, fmtBanda, versione: '0.2' };
  if (typeof module !== 'undefined' && module.exports) module.exports = NostopPiani;
  else root.NostopPiani = NostopPiani;
})(typeof self !== 'undefined' ? self : this);
