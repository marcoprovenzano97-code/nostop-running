// NOSTOP. RUNNING — menu mobile + invio moduli (lista d'attesa, iscrizione uscite del club)

// Invia una riga allo script Google, che la scrive nella scheda del foglio corrispondente a "table".
// Corpo in text/plain per evitare il preflight CORS, che Apps Script non gestisce.
async function nostopInsert(table, row) {
  const url = (window.NOSTOP_CONFIG || {}).FORM_ENDPOINT;
  if (!url) throw new Error('FORM_ENDPOINT mancante in js/config.js');
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ table, row }) });
  const out = await res.json().catch(() => ({ ok: false, error: 'risposta non valida' }));
  if (!out.ok) throw new Error(out.error);
  return true;
}

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => nav.classList.toggle('open'));
    nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => nav.classList.remove('open')));
  }

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // Ogni <form data-table="..."> salva i suoi campi in quella tabella.
  // Campi: tutti quelli con name, tranne "privacy" (diventa privacy_ok) e "sito" (trappola anti-spam).
  document.querySelectorAll('form[data-table]').forEach(form => {
    const ok = document.getElementById(form.dataset.ok);
    const err = form.querySelector('.form-err');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form).entries());
      if (fd.sito) return; // compilato da un bot
      const row = {};
      for (const [k, v] of Object.entries(fd)) {
        if (k === 'sito') continue;
        if (k === 'privacy') row.privacy_ok = true;
        else row[k] = String(v).trim();
      }
      row.pagina = location.pathname;

      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      if (err) err.style.display = 'none';
      try {
        await nostopInsert(form.dataset.table, row);
        form.style.display = 'none';
        const nm = ok.querySelector('.name');
        if (nm) nm.textContent = row.nome ? ', ' + row.nome.split(' ')[0] : '';
        ok.style.display = 'block';
      } catch (ex) {
        console.error('[NOSTOP] invio fallito', ex);
        if (err) err.style.display = 'block';
        btn.disabled = false;
      }
    });
  });
});
