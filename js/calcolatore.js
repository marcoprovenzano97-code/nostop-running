// Calcolatore zone NOSTOP. — modello VDOT di Jack Daniels
// VO2 richiesto a velocità v (m/min) e frazione di VO2max sostenibile per t minuti.

const vo2At = v => -4.60 + 0.182258 * v + 0.000104 * v * v;
const pctMax = t => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
const vdotFrom = (meters, minutes) => vo2At(meters / minutes) / pctMax(minutes);

// velocità (m/min) a cui il VO2 richiesto è pari a frac * VDOT
const speedAt = (vdot, frac) => {
  const c = 4.60 + frac * vdot;
  return (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * c)) / (2 * 0.000104);
};

// tempo previsto (min) su una distanza per un dato VDOT (bisezione)
const predict = (vdot, meters) => {
  let lo = meters / 600, hi = meters / 60;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (vdotFrom(meters, mid) > vdot) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
};

const fmtPace = v => { // m/min -> mm:ss /km
  let s = Math.round(1000 / v * 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtTime = min => {
  let s = Math.round(min * 60);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return (h ? `${h}h ${String(m).padStart(2, '0')}'` : `${m}'`) + ` ${String(s).padStart(2, '0')}"`;
};

const ZONES = [
  { z: 'Z1', name: 'Lento', code: 'E', lo: 0.62, hi: 0.70, color: '#d6d6d6', use: 'Corsa facile, lunghi, recupero. La base: 75–80% dei km.' },
  { z: 'Z2', name: 'Medio / ritmo maratona', code: 'M', color: '#b8e26a', use: 'Ritmo gara maratona, lunghi progressivi.' },
  { z: 'Z3', name: 'Soglia', code: 'T', frac: 0.88, color: '#97d700', use: 'Ripetute lunghe e tempo run da 20–40\'.' },
  { z: 'Z4', name: 'VO₂max', code: 'I', frac: 0.975, color: '#5e8a00', use: 'Ripetute da 3–5\' con recupero simile.' },
  { z: 'Z5', name: 'Ripetute veloci', code: 'R', frac: 1.045, color: '#141414', use: 'Ripetute brevi (200–400 m), tecnica ed economia.' },
];

const RACES = [
  { name: '5 km', m: 5000 }, { name: '10 km', m: 10000 },
  { name: 'Mezza maratona', m: 21097.5 }, { name: 'Maratona', m: 42195 },
];

function calc() {
  const meters = parseFloat(document.getElementById('dist').value);
  const h = +document.getElementById('h').value || 0;
  const m = +document.getElementById('m').value || 0;
  const s = +document.getElementById('s').value || 0;
  const minutes = h * 60 + m + s / 60;
  const out = document.getElementById('out');

  if (!minutes || minutes * 60 < meters / 1000 * 120 || minutes * 60 > meters / 1000 * 720) {
    out.innerHTML = '<div class="empty">Controlla il tempo inserito: deve essere tra 2:00 e 12:00 al km.</div>';
    return;
  }

  const vdot = vdotFrom(meters, minutes);
  const mPace = meters_ => meters_ / predict(vdot, meters_);

  const rows = ZONES.map(zn => {
    let pace;
    if (zn.code === 'E') pace = `${fmtPace(speedAt(vdot, zn.hi))} – ${fmtPace(speedAt(vdot, zn.lo))}`;
    else if (zn.code === 'M') pace = fmtPace(mPace(42195));
    else pace = fmtPace(speedAt(vdot, zn.frac));
    return `<tr><td><span class="zdot" style="background:${zn.color}"></span><b>${zn.z}</b> ${zn.name}</td><td class="pace">${pace} /km</td><td>${zn.use}</td></tr>`;
  }).join('');

  const preds = RACES.map(r => {
    const t = predict(vdot, r.m);
    return `<tr><td><b>${r.name}</b></td><td class="pace">${fmtTime(t)}</td><td>${fmtPace(r.m / t)} /km</td></tr>`;
  }).join('');

  out.innerHTML = `
    <div class="vdot">
      <div><div style="font-size:.85rem;color:#aeafb5;font-weight:700">IL TUO INDICE NOSTOP. (VDOT)</div><div class="v">${vdot.toFixed(1)}</div></div>
      <p>È una stima della tua forma attuale. Ripeti il test ogni 6–8 settimane: con un piano NOSTOP. i passi si aggiornano da soli.</p>
    </div>
    <h3 style="margin:8px 0 12px">le tue zone di passo</h3>
    <table class="zones"><thead><tr><th>Zona</th><th>Passo</th><th>A cosa serve</th></tr></thead><tbody>${rows}</tbody></table>
    <h3 style="margin:28px 0 12px">tempi previsti in gara</h3>
    <table class="zones"><thead><tr><th>Distanza</th><th>Tempo</th><th>Passo medio</th></tr></thead><tbody>${preds}</tbody></table>
    <p class="note" style="text-align:left">Previsioni valide se ti sei allenato in modo specifico per quella distanza. Su mezza e maratona servono volume e lunghi adeguati.</p>
  `;
}

document.getElementById('calc-form').addEventListener('submit', e => { e.preventDefault(); calc(); });
