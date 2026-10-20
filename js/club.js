// NOSTOP. RUN CLUB — disegna appuntamenti settimanali ed eventi da js/eventi.js

(() => {
  const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  const TIPI = { uscita: 'uscita di gruppo', evento: 'evento', gara: 'gara insieme', workshop: 'workshop' };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const sett = document.getElementById('settimana');
  if (sett) {
    sett.innerHTML = (window.NOSTOP_SETTIMANA || []).map(u => `
      <div class="goal">
        <div class="km">${esc(u.giorno)}</div>
        <h3>${esc(u.titolo)}</h3>
        <p>${esc(u.desc)}</p>
        <p class="ev-meta">${esc(u.ora)} · ${esc(u.luogo)}</p>
      </div>`).join('');
  }

  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const eventi = (window.NOSTOP_EVENTI || [])
    .map(e => ({ ...e, d: new Date(e.data + 'T00:00:00') }))
    .filter(e => e.d >= oggi)
    .sort((a, b) => a.d - b.d);

  const list = document.getElementById('eventi');
  if (list) {
    list.innerHTML = eventi.length ? eventi.map((e, i) => `
      <div class="event">
        <div class="ev-date"><b>${e.d.getDate()}</b><span>${MESI[e.d.getMonth()]}</span><small>${GIORNI[e.d.getDay()]}</small></div>
        <div class="ev-body">
          <span class="cat">${esc(TIPI[e.tipo] || e.tipo)}</span>
          <h3>${esc(e.titolo)}</h3>
          <p>${esc(e.desc)}</p>
          <p class="ev-meta">${e.ora ? esc(e.ora) + ' · ' : ''}${esc(e.luogo)}${e.posti ? ' · ' + e.posti + ' posti' : ''}</p>
        </div>
        <a class="btn btn-black" href="#partecipa" data-ev="${i}">partecipo</a>
      </div>`).join('')
      : '<div class="empty">Nuovi eventi in arrivo. Seguici su Instagram per non perderli.</div>';
  }

  const label = e => `${e.d.getDate()} ${MESI[e.d.getMonth()]} — ${e.titolo}`;
  const sel = document.getElementById('evento');
  if (sel) {
    const settimanali = (window.NOSTOP_SETTIMANA || []).map(u => `uscita di ${u.giorno} — ${u.titolo}`);
    sel.innerHTML = [...eventi.map(label), ...settimanali].map(t => `<option>${esc(t)}</option>`).join('');
  }
  document.querySelectorAll('[data-ev]').forEach(a => a.addEventListener('click', () => {
    if (sel) sel.value = label(eventi[+a.dataset.ev]);
  }));
})();
