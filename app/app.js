/* NOSTOP. RUNNING — app coach e atleta (Supabase + motore dei piani)
 * Stesse schermate del prototipo, con login e dati salvati nel database.
 * Il coach: invita atleti, compila i loro dati, genera e modifica i piani, li assegna, segue pianificato vs fatto, applica gli adattamenti.
 * L'atleta: vede solo il piano assegnato, segna le sedute con il feedback, scrive al coach.
 */
(() => {
'use strict';
const N = window.NostopPiani;
const C = window.NOSTOP_APP;
const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
const URL_APP = location.origin + location.pathname;

const GIORNI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const ZNOME = { E: 'facile', ST: 'sotto soglia', ST2: 'sotto soglia alta', T: 'soglia', I: 'VO2max', R: 'veloce', M: 'ritmo maratona', HM: 'passo mezza', G10: 'passo 10 km', G5: 'passo 5 km', W: 'cammino' };
const GARA_NOME = { maratona: 'maratona', mezza: 'mezza maratona', '10k': '10 km', '5k': '5 km', start: 'percorso start' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = id => document.getElementById(id);
const dt = s => new Date(s + 'T12:00:00');
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = dt(s); d.setDate(d.getDate() + n); return iso(d); };
const fmtD = s => { const [, m, d] = s.split('-'); return `${d}/${m}`; };
const giornoDi = s => GIORNI[(dt(s).getDay() + 6) % 7];
const giorniTra = (a, b) => Math.round((dt(b) - dt(a)) / 864e5);
const OGGI = iso(new Date());

let ME = null;          // profilo dell'utente collegato
let COACH = null;       // per l'atleta: il suo coach
let ATL = [];           // atleti (per il coach) o [me] (per l'atleta)
let INVITI = [];
const S = { vista: 'coach', sel: null, tabCoach: 'settimana', settCoach: null, tabAtleta: 'oggi', giornoAtleta: OGGI };

const toast = t => { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { el.hidden = true; }, 3500); };
const errore = (e, cosa) => { console.error(cosa, e); toast(`${cosa}: ${e.message || e}`); };

/* ================= dati ================= */
const eta = dn => { if (!dn) return null; const d = dt(dn), o = new Date(); let a = o.getFullYear() - d.getFullYear(); if (o < new Date(o.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };
const bmi = p => (p.peso_kg && p.altezza_cm ? Math.round(p.peso_kg / ((p.altezza_cm / 100) ** 2) * 10) / 10 : undefined);
const datiAtleta = p => ({ eta: eta(p.data_nascita) || undefined, bmi: bmi(p), infortunio: !!p.infortunio_6m, profilo: p.profilo_start || undefined, club: p.club && Object.keys(p.club).length ? p.club : undefined });

function mappaEsecuzioni(righe) {
  const m = {};
  for (const r of righe) m[r.seduta_id] = { fatta: r.fatta, km: r.km != null ? +r.km : null, min: r.minuti, rpe: r.rpe, sensazioni: r.sensazioni || [], dolore: r.dolore_zona ? { zona: r.dolore_zona, intensita: r.dolore_int } : null, nota: r.nota || '' };
  return m;
}
function costruisci(p, piani, esecuzioni, messaggi, adattamenti) {
  const ass = piani.find(x => x.atleta_id === p.id && x.stato === 'assegnato');
  const boz = piani.find(x => x.atleta_id === p.id && x.stato === 'bozza');
  const row = (ME.ruolo === 'coach' ? boz || ass : ass) || null;
  const ad = row && adattamenti.find(x => x.piano_id === row.id);
  return {
    id: p.id, nome: p.nome || p.email, email: p.email, profilo: p, eta: eta(p.data_nascita),
    stato: row ? row.stato : 'nessuno', pianoId: row ? row.id : null, assegnatoInCorso: !!(boz && ass),
    input: row ? row.input : null, piano: row ? row.piano : null, note: row ? row.note || {} : {}, modificato: row ? row.modificato_dal_coach : false,
    esecuzioni: row ? mappaEsecuzioni(esecuzioni.filter(e => e.piano_id === row.id)) : {},
    messaggi: messaggi.filter(m => m.atleta_id === p.id).map(m => ({ da: m.autore_id === p.id ? 'atleta' : 'coach', testo: m.testo, quando: m.creato.slice(0, 10) })),
    adattamento: ad ? { il: ad.il, esito: ad.esito } : null,
  };
}

async function caricaTutto() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return mostraLogin();
  const { data: me, error } = await sb.from('profili').select('*').eq('id', user.id).maybeSingle();
  if (error || !me) { $('app').innerHTML = `<div class="auth"><div class="err">Profilo non trovato. Contatta il tuo coach NOSTOP.</div></div>`; return; }
  ME = me;
  $('chi').textContent = `${ME.nome || ME.email} · ${ME.ruolo}`;
  $('esci').hidden = false; $('aggiorna').hidden = false; $('segVista').hidden = ME.ruolo !== 'coach';
  if (ME.ruolo === 'coach') await caricaCoach(); else await caricaAtleta();
  render();
}

async function caricaCoach() {
  const [a, i, p] = await Promise.all([
    sb.from('profili').select('*').eq('coach_id', ME.id).order('nome'),
    sb.from('inviti').select('*').order('creato'),
    sb.from('piani').select('*').in('stato', ['bozza', 'assegnato']).order('creato', { ascending: false }),
  ]);
  for (const r of [a, i, p]) if (r.error) throw r.error;
  const ids = a.data.map(x => x.id), pid = p.data.map(x => x.id);
  const [e, m, ad] = await Promise.all([
    pid.length ? sb.from('esecuzioni').select('*').in('piano_id', pid) : { data: [] },
    ids.length ? sb.from('messaggi').select('*').in('atleta_id', ids).order('creato') : { data: [] },
    pid.length ? sb.from('adattamenti').select('piano_id,il,esito').in('piano_id', pid).eq('il', OGGI) : { data: [] },
  ]);
  ATL = a.data.map(x => costruisci(x, p.data, e.data || [], m.data || [], ad.data || []));
  INVITI = i.data;
  if (!S.sel || !ATL.find(x => x.id === S.sel)) S.sel = ATL.length ? ATL[0].id : null;
}

async function caricaAtleta() {
  const [p, m, c] = await Promise.all([
    sb.from('piani').select('*').eq('stato', 'assegnato'),
    sb.from('messaggi').select('*').eq('atleta_id', ME.id).order('creato'),
    ME.coach_id ? sb.from('profili').select('id,nome,email').eq('id', ME.coach_id).maybeSingle() : { data: null },
  ]);
  COACH = c.data;
  const pid = (p.data || []).map(x => x.id);
  const e = pid.length ? await sb.from('esecuzioni').select('*').in('piano_id', pid) : { data: [] };
  ATL = [costruisci(ME, p.data || [], e.data || [], m.data || [], [])];
  S.vista = 'atleta'; S.sel = ME.id;
}

/* ---------- scritture ---------- */
async function salvaPiano(a) {
  const { error } = await sb.from('piani').update({ piano: a.piano, note: a.note, modificato_dal_coach: true }).eq('id', a.pianoId);
  if (error) throw error;
  a.modificato = true;
}
async function inviaMessaggio(a, testo) {
  const { error } = await sb.from('messaggi').insert({ atleta_id: a.id, testo });
  if (error) throw error;
  a.messaggi.push({ da: ME.id === a.id ? 'atleta' : 'coach', testo, quando: OGGI });
}

/* ================= calcoli (come nel prototipo) ================= */
const tutte = a => (a.piano ? a.piano.settimane.flatMap(w => w.sedute.map(s => ({ ...s, w }))) : []);
const settDi = (a, data) => a.piano && a.piano.settimane.find(w => data >= w.lunedi && data < addDays(w.lunedi, 7));
function semaforo(a) {
  if (a.stato === 'nessuno') return { c: 'grigio', t: 'piano da creare', perche: [] };
  if (a.stato === 'bozza') return { c: 'bozza', t: 'bozza da approvare', perche: [] };
  const primo = a.piano.settimane[0].lunedi;
  if (primo > OGGI) return { c: 'grigio', t: `parte il ${fmtD(primo)}`, perche: [] };
  const da = addDays(OGGI, -7);
  const recenti = tutte(a).filter(s => s.data >= da && s.data < OGGI);
  const perche = []; let c = 'verde';
  for (const s of recenti) {
    const e = a.esecuzioni[s.id]; if (!e) continue;
    if (e.dolore && e.dolore.intensita >= 4) { c = 'rosso'; perche.push(`dolore ${e.dolore.zona} ${e.dolore.intensita}/10 (${giornoDi(s.data)} ${fmtD(s.data)})`); }
    if (e.fatta && s.km >= 5 && (e.km > s.km * 1.3 || (e.km > s.km * 1.2 && e.km - s.km >= 3))) { c = 'rosso'; perche.push(`${giornoDi(s.data)} ${fmtD(s.data)}: ${e.km} km invece di ${s.km}`); }
  }
  const saltate = recenti.filter(s => a.esecuzioni[s.id] && !a.esecuzioni[s.id].fatta).length;
  const nonSegnate = recenti.filter(s => !a.esecuzioni[s.id]).length;
  const rpe = recenti.map(s => a.esecuzioni[s.id]).filter(e => e && e.fatta && e.rpe).slice(-3);
  const rpeM = rpe.length ? rpe.reduce((x, e) => x + e.rpe, 0) / rpe.length : 0;
  if (saltate) { if (c === 'verde') c = 'giallo'; perche.push(`${saltate} sedut${saltate > 1 ? 'e saltate' : 'a saltata'} in 7 giorni`); }
  if (nonSegnate >= 2) { if (c === 'verde') c = 'giallo'; perche.push(`${nonSegnate} sedute non segnate`); }
  if (rpeM >= 7.5) { if (c === 'verde') c = 'giallo'; perche.push(`fatica media ${rpeM.toFixed(1)}/10`); }
  return { c, t: { verde: 'tutto regolare', giallo: 'da tenere d\'occhio', rosso: 'intervenire' }[c], perche };
}
function ricalcola(a) {
  const v = a.piano.vdot || 30;
  for (const w of a.piano.settimane) { w.sedute.sort((x, y) => x.data.localeCompare(y.data)); Object.assign(w, N.riepilogoSettimana(w.sedute, v)); }
  a.piano.segnalazioniLive = N.controlla(a.piano.settimane, a.input.lungoAttuale);
}
const segnalazioni = a => (a.piano ? [...a.piano.segnalazioni.filter(s => !s.settimana), ...(a.piano.segnalazioniLive || a.piano.segnalazioni.filter(s => s.settimana))] : []);
function passoTesto(st, P) {
  if (st.tipo === 'ripeti') return `${st.n}× [ ${st.passi.map(x => passoTesto(x, P)).join(' + ')} ]`;
  const q = st.km != null ? `${String(+st.km.toFixed(2)).replace('.', ',')} km` : st.min >= 1 ? `${+st.min.toFixed(1)}'` : `${Math.round(st.min * 60)}"`;
  const tipo = ['lavoro', 'corsa', 'recupero', 'gara', 'cammino'].includes(st.tipo) ? '' : st.tipo + ' ';
  const z = st.passo === 'REC' ? 'recupero' : st.passo === 'W' ? 'cammino' : st.passo === 'R' && /allungo|sprint/.test(st.tipo) ? (P.R || '') : `${ZNOME[st.passo] || st.passo} ${P[st.passo] || ''}`;
  return `${q} ${tipo}${z}${st.nota ? ' (' + st.nota + ')' : ''}`.replace(/\s+/g, ' ').trim();
}
const clubChip = s => (s.club ? `<br><span class="chip club">con il club · ${esc(s.club.nome)} · ${s.club.ora} · gruppo ${esc(s.club.gruppo)}</span>` : '');

function grafico(a) {
  const ws = a.piano.settimane;
  const fatto = ws.map(w => w.sedute.reduce((x, s) => x + (a.esecuzioni[s.id] && a.esecuzioni[s.id].fatta ? a.esecuzioni[s.id].km || 0 : 0), 0));
  const W = 760, H = 220, L = 34, R = 8, T = 14, B = 26;
  const top = Math.ceil(Math.max(10, ...ws.map(w => w.km), ...fatto) / 10) * 10;
  const y = v => T + (H - T - B) * (1 - v / top);
  const bw = (W - L - R) / ws.length;
  let o = '';
  for (let v = 0; v <= top; v += top > 40 ? 20 : 10) o += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"></line><text x="${L - 5}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  ws.forEach((w, i) => {
    const x = L + i * bw, half = Math.max(2, bw * 0.34);
    const bar = (cls, xx, v) => { const h = y(0) - y(v); if (h <= 0) return ''; const r = Math.min(3, half / 2, h); return `<path class="${cls}" d="M${xx},${y(0)} V${y(v) + r} Q${xx},${y(v)} ${xx + r},${y(v)} H${xx + half - r} Q${xx + half},${y(v)} ${xx + half},${y(v) + r} V${y(0)} Z"><title>sett. ${w.n} · previsti ${w.km} km · fatti ${fatto[i].toFixed(1)} km</title></path>`; };
    o += bar('pl', x + bw * 0.14, w.km) + bar('dn', x + bw * 0.14 + half + 2, fatto[i]);
    if (OGGI >= w.lunedi && OGGI < addDays(w.lunedi, 7)) o += `<line class="now" x1="${x + bw / 2}" x2="${x + bw / 2}" y1="${T - 6}" y2="${y(0)}"></line>`;
    if (i % Math.ceil(ws.length / 10) === 0) o += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${fmtD(w.lunedi)}</text>`;
  });
  return `<div class="legend"><span><i style="background:var(--bar-soft)"></i>previsti</span><span><i style="background:var(--bar)"></i>fatti</span><span><i style="border-top:2px dashed var(--ink);height:0;width:14px;border-radius:0"></i>settimana corrente</span></div>
    <div class="chartbox"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chilometri previsti e fatti per settimana">${o}</svg></div>`;
}

/* ================= LOGIN ================= */
let modoAuth = 'accedi';
function mostraLogin(msg = '', tipo = 'err') {
  $('esci').hidden = true; $('aggiorna').hidden = true; $('segVista').hidden = true; $('chi').textContent = '';
  const tab = (k, t) => `<button type="button" role="tab" data-auth="${k}" aria-selected="${modoAuth === k}">${t}</button>`;
  $('app').innerHTML = `<div class="auth">
    <h2>${modoAuth === 'registrati' ? 'crea il tuo account' : modoAuth === 'reset' ? 'recupera la password' : modoAuth === 'nuova' ? 'nuova password' : 'accedi'}</h2>
    ${modoAuth === 'nuova' ? '' : `<div class="tabs" role="tablist">${tab('accedi', 'accedi')}${tab('registrati', 'registrati')}${tab('reset', 'password dimenticata')}</div>`}
    ${msg ? `<div class="${tipo === 'ok' ? 'okmsg' : 'err'}">${esc(msg)}</div>` : ''}
    <form class="card" id="authForm">
      ${modoAuth === 'registrati' ? '<label for="aNome">Nome e cognome<input id="aNome" autocomplete="name" required></label>' : ''}
      ${modoAuth !== 'nuova' ? '<label for="aEmail">Email<input id="aEmail" type="email" autocomplete="email" required></label>' : ''}
      ${modoAuth !== 'reset' ? `<label for="aPw">Password<input id="aPw" type="password" minlength="8" autocomplete="${modoAuth === 'accedi' ? 'current-password' : 'new-password'}" required></label>` : ''}
      <button class="btn" type="submit">${{ accedi: 'accedi', registrati: 'registrati', reset: 'mandami il link', nuova: 'salva la password' }[modoAuth]}</button>
      ${modoAuth === 'registrati' ? '<p class="small muted">La registrazione è su invito: usa la stessa email a cui il tuo coach NOSTOP. ha mandato l\'invito.</p>' : ''}
    </form></div>`;
}
async function submitAuth() {
  const email = $('aEmail') ? $('aEmail').value.trim().toLowerCase() : '';
  const pw = $('aPw') ? $('aPw').value : '';
  try {
    if (modoAuth === 'accedi') {
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) throw new Error(/confirm/i.test(error.message) ? 'Devi prima confermare l\'email: controlla la posta.' : 'Email o password non corrette.');
      await caricaTutto();
    } else if (modoAuth === 'registrati') {
      const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: URL_APP, data: { nome: $('aNome').value.trim() } } });
      if (error) throw new Error(/database|saving new user/i.test(error.message) ? 'Registrazione possibile solo su invito: usa l\'email a cui il tuo coach NOSTOP. ti ha invitato.' : error.message);
      if (data.session) await caricaTutto();
      else { modoAuth = 'accedi'; mostraLogin('Ti abbiamo mandato un\'email: clicca il link per confermare l\'account, poi accedi.', 'ok'); }
    } else if (modoAuth === 'reset') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: URL_APP });
      if (error) throw error;
      modoAuth = 'accedi'; mostraLogin('Se l\'email è registrata ti arriva un link per scegliere una nuova password.', 'ok');
    } else if (modoAuth === 'nuova') {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;
      modoAuth = 'accedi'; toast('Password aggiornata.'); await caricaTutto();
    }
  } catch (e) { mostraLogin(e.message); }
}

/* ================= COACH ================= */
function vistaCoach() {
  const a = ATL.find(x => x.id === S.sel);
  const lista = ATL.map(x => {
    const s = semaforo(x); const w = x.piano && settDi(x, OGGI);
    return `<button type="button" class="ath" data-sel="${x.id}" aria-current="${x.id === S.sel}">
      <span class="row1"><b>${esc(x.nome)}</b><span class="chip ${s.c}"><i></i>${s.t}</span></span>
      <span class="small muted">${x.input ? esc(GARA_NOME[x.input.gara]) + (x.input.dataGara ? ' · ' + fmtD(x.input.dataGara) : '') : 'nessun piano'}${w ? ` · sett. ${w.n}/${x.piano.settimane.length}` : ''}</span>
      ${s.perche.length ? `<span class="why">${esc(s.perche.join(' · '))}</span>` : ''}</button>`;
  }).join('');
  const inviti = INVITI.map(i => `<div class="invite"><span><b>${esc(i.nome || i.email)}</b><br><span class="muted small">${esc(i.email)} · in attesa di registrazione</span></span><button class="btn ghost small" type="button" data-copia="${esc(i.email)}">copia invito</button></div>`).join('');
  return `<div class="coach"><nav class="list" aria-label="Atleti"><h3>i tuoi atleti</h3>${lista || '<p class="small muted">Nessun atleta ancora. Invita il primo qui sotto.</p>'}
      <div class="card"><h4>invita un atleta</h4>
        <label class="f" for="invNome">Nome<input class="f" id="invNome" placeholder="Nome e cognome"></label>
        <label class="f" for="invEmail">Email<input class="f" id="invEmail" type="email" placeholder="email dell'atleta"></label>
        <button class="btn small" type="button" data-act="invita">invita</button></div>
      ${inviti}</nav>
    <section class="detail">${a ? dettaglio(a) : '<div class="empty">Invita il tuo primo atleta: quando si registra compare qui.</div>'}</section></div>`;
}

function dettaglio(a) {
  const s = semaforo(a);
  const head = `<div class="dhead"><div><h2>${esc(a.nome)}</h2><div class="meta">
      <span class="chip ${s.c}"><i></i>${s.t}</span>
      <span class="small muted">${a.eta ? a.eta + ' anni · ' : ''}${a.input ? `${esc(GARA_NOME[a.input.gara])}${a.input.dataGara ? ' il ' + fmtD(a.input.dataGara) : ''} · ${a.input.giorni} giorni` : esc(a.email)}</span>
      ${a.modificato ? '<span class="chip">modificato dal coach</span>' : ''}</div></div>
    <div class="meta">${a.stato === 'bozza' ? '<button class="btn" type="button" data-act="assegna">approva e assegna</button>' : ''}
      ${a.stato !== 'nessuno' ? '<button class="btn ghost small" type="button" data-act="nuovo">nuovo piano</button>' : ''}</div></div>`;
  const tabs = a.stato === 'nessuno' || S.tabCoach === 'nuovo'
    ? [['nuovo', 'nuovo piano'], ['dati', 'dati atleta'], ['chat', 'chat']]
    : [['settimana', 'settimana'], ['piano', 'piano e modifiche'], ['segnalazioni', `segnalazioni (${segnalazioni(a).length})`], ['dati', 'dati atleta'], ['chat', 'chat']];
  if (!tabs.find(t => t[0] === S.tabCoach)) S.tabCoach = tabs[0][0];
  const tabBar = `<div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${S.tabCoach === k}">${t}</button>`).join('')}</div>`;
  const corpo = { nuovo: nuovoPiano, settimana: tabSettimana, piano: tabPiano, segnalazioni: tabSegnalazioni, dati: tabDati, chat: tabChat }[S.tabCoach](a);
  const avvisi = (a.stato === 'bozza' ? `<div class="flag controllo"><strong>bozza</strong><span>L'atleta non vede ancora questo piano.${a.assegnatoInCorso ? ' C\'è un piano assegnato in corso: assegnando la bozza lo sostituisci.' : ''} Controlla le segnalazioni, modifica se serve e premi "approva e assegna".</span></div>` : '');
  return head + avvisi + tabBar + corpo;
}

function nuovoPiano(a) {
  const i = a.input || { gara: 'mezza', giorni: 3, livello: 'intermedio', dataInizio: addDays(OGGI, (8 - dt(OGGI).getDay()) % 7 || 7) };
  const opt = (v, list) => list.map(([k, t]) => `<option value="${k}"${String(v) === String(k) ? ' selected' : ''}>${t}</option>`).join('');
  const d = datiAtleta(a.profilo);
  return `<div class="card"><h3>nuovo piano</h3><p class="small">Il motore genera una bozza: la puoi modificare prima di assegnarla. Peso, altezza, età, infortuni e club si impostano in "dati atleta".</p>
    <p class="small muted">Dai dati atleta: ${d.eta ? d.eta + ' anni' : 'età non indicata'} · ${d.bmi ? 'BMI ' + d.bmi : 'BMI non indicato'} · ${d.infortunio ? 'infortunio negli ultimi 6 mesi' : 'nessun infortunio recente'} · ${d.club ? 'corre con il club' : 'non corre con il club'}</p>
    <div class="form">
      <label for="nGara">Gara<select id="nGara">${opt(i.gara, [['maratona', 'Maratona'], ['mezza', 'Mezza'], ['10k', '10 km'], ['5k', '5 km'], ['start', 'Percorso start']])}</select></label>
      <label for="nData">Data gara<input id="nData" type="date" value="${i.dataGara || ''}"></label>
      <label for="nInizio">Inizio<input id="nInizio" type="date" value="${i.dataInizio || ''}"></label>
      <label for="nLiv">Livello<select id="nLiv">${opt(i.livello, [['principiante', 'Principiante'], ['intermedio', 'Intermedio'], ['avanzato', 'Avanzato']])}</select></label>
      <label for="nGiorni">Giorni<select id="nGiorni">${opt(i.giorni, [[2, 2], [3, 3], [4, 4], [5, 5], [6, 6]])}</select></label>
      <label for="nVdot">VDOT<input id="nVdot" type="number" step="0.5" value="${i.vdot || ''}"></label>
      <label for="nKm">Km/settimana ora<input id="nKm" type="number" value="${i.kmAttuali || ''}"></label>
      <label for="nLungo">Lungo più lungo (30 gg)<input id="nLungo" type="number" value="${i.lungoAttuale || ''}"></label>
    </div>
    <div><button class="btn" type="button" data-act="genera">genera bozza</button></div></div>`;
}

function tabDati(a) {
  const p = a.profilo; const c = p.club || {};
  return `<div class="card"><h3>dati di ${esc(a.nome)}</h3>
    <div class="form">
      <label for="dNasc">Data di nascita<input id="dNasc" type="date" value="${p.data_nascita || ''}"></label>
      <label for="dPeso">Peso (kg)<input id="dPeso" type="number" step="0.1" value="${p.peso_kg || ''}"></label>
      <label for="dAlt">Altezza (cm)<input id="dAlt" type="number" step="0.5" value="${p.altezza_cm || ''}"></label>
      <label for="dProf">Profilo (percorso start)<select id="dProf"><option value="">—</option><option value="sedentario"${p.profilo_start === 'sedentario' ? ' selected' : ''}>Sedentario</option><option value="sportivo"${p.profilo_start === 'sportivo' ? ' selected' : ''}>Fa già sport</option></select></label>
    </div>
    <div class="checks"><label><input type="checkbox" id="dInf"${p.infortunio_6m ? ' checked' : ''}> infortunio negli ultimi 6 mesi</label></div>
    <h4>uscite del club</h4>
    <div class="checks"><label><input type="checkbox" id="dC1"${c['1'] ? ' checked' : ''}> martedì qualità</label><label><input type="checkbox" id="dC3"${c['3'] ? ' checked' : ''}> giovedì lento</label><label><input type="checkbox" id="dC6"${c['6'] ? ' checked' : ''}> domenica lungo</label></div>
    <p class="small muted">${p.consenso_salute_il ? `Consenso al trattamento dei dati sanitari dato il ${fmtD(p.consenso_salute_il.slice(0, 10))}.` : 'L\'atleta non ha ancora dato il consenso al trattamento dei dati sanitari: glielo chiede l\'app al primo accesso.'}</p>
    <div><button class="btn" type="button" data-act="salvaDati">salva</button></div></div>`;
}

function propostaAdattamento(a) {
  if (a.stato !== 'assegnato') return '';
  if (a.adattamento && a.adattamento.il === OGGI) return `<div class="flag ok"><strong>${a.adattamento.esito}</strong><span>${a.adattamento.esito === 'applicato' ? 'Adattamento applicato oggi.' : 'Proposta di adattamento scartata oggi.'}</span></div>`;
  const r = N.adatta(a.piano, a.esecuzioni, OGGI);
  if (!r.modifiche.length && !r.suggerimenti.length) return r.motivi.length ? `<div class="flag controllo"><strong>motore</strong><span>${esc(r.motivi.join(' · '))}</span></div>` : '';
  return `<div class="adapt"><h4>il motore propone di adattare i prossimi giorni</h4>
    <ul>${r.motivi.map(m => `<li>${esc(m)}</li>`).join('')}${r.suggerimenti.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
    ${r.modifiche.length ? `<div class="tbl"><table><thead><tr><th>Giorno</th><th>Ora nel piano</th><th>Proposta</th></tr></thead><tbody>${r.modifiche.map(m => `<tr><td><b>${m.giorno}</b> ${fmtD(m.data)}</td><td>${esc(m.prima)}</td><td><span class="t">${esc(m.dopo)}</span></td></tr>`).join('')}</tbody></table></div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap">${r.modifiche.length ? '<button class="btn" type="button" data-act="adatta">applica le modifiche</button>' : ''}<button class="btn ghost" type="button" data-act="scarta">scarta</button></div></div>`;
}

function tabSettimana(a) {
  const ws = a.piano.settimane;
  const corrente = settDi(a, OGGI) || (OGGI < ws[0].lunedi ? ws[0] : ws[ws.length - 1]);
  const n = S.settCoach && ws.find(w => w.n === S.settCoach) ? S.settCoach : corrente.n;
  const w = ws.find(x => x.n === n);
  const righe = w.sedute.map(s => {
    const e = a.esecuzioni[s.id];
    let ader = '<span class="chip grigio">da fare</span>', fatto = '<span class="muted">—</span>';
    if (s.data < OGGI || (e && e.fatta)) {
      if (!e) ader = '<span class="chip giallo"><i></i>non segnata</span>';
      else if (!e.fatta) ader = '<span class="chip rosso"><i></i>saltata</span>';
      else {
        const r = s.km && e.km ? e.km / s.km : 1;
        ader = r > 1.3 || r < 0.7 ? '<span class="chip rosso"><i></i>molto diverso</span>' : r > 1.15 || r < 0.85 ? '<span class="chip giallo"><i></i>diverso</span>' : '<span class="chip verde"><i></i>in linea</span>';
        fatto = `<span class="num">${e.km ?? '—'} km${e.min ? ` · ${e.min}'` : ''}</span><br><span class="small">fatica ${e.rpe ?? '—'}/10${e.sensazioni.length ? ' · ' + esc(e.sensazioni.join(', ')) : ''}</span>${e.dolore ? `<br><span class="chip rosso">dolore ${esc(e.dolore.zona)} ${e.dolore.intensita}/10</span>` : ''}${e.nota ? `<br><span class="small">"${esc(e.nota)}"</span>` : ''}`;
      }
    }
    return { data: s.data, html: `<tr><td><b>${s.giorno}</b><br><span class="small muted">${fmtD(s.data)}</span></td><td><span class="t"><i class="int ${s.intensita}"></i>${esc(s.titolo)}</span><br><span class="small num">${s.km} km · ${s.min}'</span>${clubChip(s)}${a.note[s.id] ? `<br><span class="small">nota: ${esc(a.note[s.id])}</span>` : ''}</td><td>${fatto}</td><td>${ader}</td></tr>` };
  }).concat((w.forza || []).map(f => {
    const e = a.esecuzioni[f.id];
    const ader = e && e.fatta ? '<span class="chip verde"><i></i>fatta</span>' : f.data < OGGI ? '<span class="chip giallo"><i></i>non segnata</span>' : '<span class="chip grigio">da fare</span>';
    return { data: f.data + 'z', html: `<tr><td><b>${f.giorno}</b><br><span class="small muted">${fmtD(f.data)}</span></td><td><span class="t">🏋 ${esc(f.titolo)}</span><br><span class="small num">${f.min}'</span></td><td>${e && e.fatta ? 'fatta' : '<span class="muted">—</span>'}</td><td>${ader}</td></tr>` };
  })).sort((x, y) => x.data.localeCompare(y.data)).map(r => r.html).join('');
  const ex = w.sedute.map(s => a.esecuzioni[s.id]).filter(Boolean);
  const fatte = ex.filter(e => e.fatta);
  const kmF = fatte.reduce((x, e) => x + (e.km || 0), 0);
  const rpe = fatte.length ? (fatte.reduce((x, e) => x + (e.rpe || 0), 0) / fatte.length).toFixed(1) : '—';
  return `<div class="weeknav">
      <button class="icon" type="button" data-wk="${n - 1}" ${n <= 1 ? 'disabled' : ''} aria-label="Settimana precedente">‹</button>
      <h3>settimana ${n} di ${ws.length} · ${fmtD(w.lunedi)}–${fmtD(addDays(w.lunedi, 6))}</h3>
      <button class="icon" type="button" data-wk="${n + 1}" ${n >= ws.length ? 'disabled' : ''} aria-label="Settimana successiva">›</button>
      <span class="chip">${w.fase}${w.recupero ? ' · recupero' : ''}</span>${n === corrente.n && OGGI >= ws[0].lunedi ? '<span class="chip verde">in corso</span>' : ''}</div>
    <div class="kpis">
      <div class="kpi"><span>previsti</span><b>${w.km} km</b><small>${w.sedute.length} sedute · ${w.quotaFacile}% facile</small></div>
      <div class="kpi"><span>fatti</span><b>${kmF.toFixed(1)} km</b><small>${fatte.length} sedute fatte</small></div>
      <div class="kpi"><span>saltate</span><b>${ex.length - fatte.length}</b><small>finora</small></div>
      <div class="kpi"><span>fatica media</span><b>${rpe}</b><small>su 10</small></div></div>
    ${n === corrente.n ? propostaAdattamento(a) : ''}
    <div class="tbl"><table><thead><tr><th>Giorno</th><th>Previsto</th><th>Fatto</th><th>Aderenza</th></tr></thead><tbody>${righe}</tbody></table></div>
    <div class="card"><h4>commento per ${esc(a.nome.split(' ')[0])}</h4>
      <div class="send"><input id="cmt" placeholder="Es. ottimo lavoro, la prossima settimana accorciamo il lungo" aria-label="Commento"><button class="btn" type="button" data-act="commento">invia</button></div></div>`;
}

function tabPiano(a) {
  const lib = N.libreria({ vdot: a.piano.vdot || 30, gara: a.input.gara === 'start' ? 'maratona' : a.input.gara, livello: a.input.livello || 'principiante' });
  const libOpt = `<option value="">sostituisci con…</option>` + ['facile', 'sotto soglia', 'soglia', 'VO2max', 'velocità', 'passo gara'].map(g => `<optgroup label="${g}">${lib.filter(x => x.gruppo === g).map(x => `<option value="${x.id}">${esc(x.titolo)} · ${x.km} km</option>`).join('')}</optgroup>`).join('')
    + `<optgroup label="lungo">${[8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30].map(k => `<option value="LUNGO${k}">lungo ${k} km facile</option>`).join('')}</optgroup>`;
  const P = a.piano.passi;
  const settimane = a.piano.settimane.map(w => {
    const passata = addDays(w.lunedi, 7) <= OGGI;
    const corrente = OGGI >= w.lunedi && OGGI < addDays(w.lunedi, 7);
    const sedute = w.sedute.map(s => {
      const futura = s.data >= OGGI;
      const dayOpt = GIORNI.map((g, k) => `<option value="${k}"${g === s.giorno ? ' selected' : ''}>${g}</option>`).join('');
      return `<div class="sess${futura ? '' : ' past'}"><span><b>${s.giorno}</b> <span class="small muted">${fmtD(s.data)}</span></span>
        <div><span class="t"><i class="int ${s.intensita}"></i>${esc(s.titolo)}</span>${clubChip(s)}
          <ol>${s.passi.map(x => `<li>${esc(passoTesto(x, P))}</li>`).join('')}</ol>
          ${futura ? `<div class="edit">
            <select data-giorno="${w.n}|${s.id}" aria-label="Sposta al giorno">${dayOpt}</select>
            <select data-sost="${w.n}|${s.id}" aria-label="Sostituisci la seduta">${libOpt}</select>
            <input data-nota="${s.id}" value="${esc(a.note[s.id] || '')}" placeholder="nota per l'atleta" aria-label="Nota per l'atleta">
            <button class="btn ghost small" type="button" data-elimina="${w.n}|${s.id}">elimina</button></div>` : ''}</div>
        <span class="small num">${s.km} km<br>${s.min}'</span></div>`;
    }).join('') + (w.forza || []).map(f => `<div class="sess${f.data >= OGGI ? '' : ' past'}"><span><b>${f.giorno}</b> <span class="small muted">${fmtD(f.data)}</span></span><div><span class="t">🏋 ${esc(f.titolo)}</span><ol>${f.esercizi.map(([n, d]) => `<li>${esc(n)} · ${esc(d)}</li>`).join('')}</ol></div><span class="small num">${f.min}'</span></div>`).join('');
    const add = !passata ? `<div class="addrow"><select data-agg="${w.n}" aria-label="Aggiungi seduta">${libOpt.replace('sostituisci con…', '+ aggiungi seduta…')}</select>
      <select data-aggday="${w.n}" aria-label="Giorno della nuova seduta">${GIORNI.map((g, k) => `<option value="${k}">${g}</option>`).join('')}</select></div>` : '';
    return `<details class="wk"${corrente || (w.n === 1 && OGGI < w.lunedi) ? ' open' : ''}><summary><span class="wk-n"><b>sett. ${w.n}</b><small>${fmtD(w.lunedi)} · ${w.fase}${w.recupero ? ' · rec.' : ''}</small></span>
      <span class="wk-s">${w.sedute.map(s => esc(s.titolo)).join(' · ')}</span><span class="num small">${w.km} km · ${w.quotaFacile}%</span></summary>${sedute}${add}</details>`;
  }).join('');
  return `<div class="card">${grafico(a)}</div><p class="small muted">Le sedute passate non si modificano. Ogni modifica viene salvata e ricalcola km, quota facile e segnalazioni${a.stato === 'assegnato' ? '; l\'atleta la vede subito' : ''}.</p><div style="display:grid;gap:8px">${settimane}</div>`;
}

function tabSegnalazioni(a) {
  const f = segnalazioni(a); const s = semaforo(a);
  return `${s.perche.length ? `<div class="card"><h4>dagli allenamenti degli ultimi 7 giorni</h4><div class="flags">${s.perche.map(t => `<div class="flag attenzione"><strong>${s.c}</strong><span>${esc(t)}</span></div>`).join('')}</div></div>` : ''}
    <div class="card"><h4>dal motore (piano)</h4><div class="flags">${f.length ? f.map(x => `<div class="flag ${x.livello}"><strong>${x.livello}${x.settimana ? ' · sett. ' + x.settimana : ''}</strong><span>${esc(x.testo)}</span></div>`).join('') : '<div class="flag ok"><strong>ok</strong><span>Nessuna segnalazione sul piano.</span></div>'}</div></div>`;
}

const chatHtml = (a, chi) => `<div class="chat">${a.messaggi.length ? a.messaggi.map(m => `<div class="msg ${m.da}">${esc(m.testo)}<small>${m.da === 'coach' ? (ME.ruolo === 'coach' ? 'tu' : esc(COACH ? COACH.nome || 'coach' : 'coach')) : esc(a.nome.split(' ')[0])} · ${fmtD(m.quando)}</small></div>`).join('') : '<p class="muted small">Nessun messaggio.</p>'}</div>
  <div class="send"><input id="msg-${chi}" placeholder="Scrivi un messaggio" aria-label="Messaggio"><button class="btn" type="button" data-msg="${chi}">invia</button></div>`;
const tabChat = a => `<div class="card">${chatHtml(a, 'coach')}</div>`;

/* ================= ATLETA ================= */
function vistaAtleta() {
  const a = ATL.find(x => x.id === S.sel);
  if (!a) return '<div class="empty">Seleziona un atleta nella vista coach.</div>';
  const anteprima = ME.ruolo === 'coach';
  let body;
  if (!anteprima && !ME.consenso_salute_il) body = consenso();
  else if (a.stato !== 'assegnato') body = `<div class="rest"><h3>il tuo piano è in preparazione</h3><p>${COACH ? esc(COACH.nome || 'Il tuo coach') : 'Il tuo coach'} sta preparando il piano su misura. Lo trovi qui appena è pronto.</p></div>`;
  else body = { oggi: aOggi, settimana: aSettimana, piano: aPiano, coach: x => `<h3>il tuo coach${COACH && COACH.nome ? ' · ' + esc(COACH.nome) : ''}</h3>${chatHtml(x, 'atleta')}` }[S.tabAtleta](a);
  const nav = [['oggi', 'oggi'], ['settimana', 'settimana'], ['piano', 'il mio piano'], ['coach', 'coach']].map(([k, t]) => `<button type="button" data-atab="${k}" ${S.tabAtleta === k ? 'aria-current="page"' : ''}>${t}</button>`).join('');
  return `<div class="athwrap">${anteprima ? `<p class="small muted" style="text-align:center">Anteprima di come ${esc(a.nome)} vede l'app. Il feedback lo inserisce solo l'atleta.</p>` : ''}
    <div class="phone"><div class="screen"><div class="shead"><b>NOSTOP.</b><span class="small muted">ciao ${esc(a.nome.split(' ')[0])}</span></div>
    <div class="sbody">${body}</div><nav class="snav" aria-label="Sezioni app">${nav}</nav></div></div></div>`;
}
const consenso = () => `<div class="consenso"><h3>prima di iniziare</h3>
  <p>Per seguire il tuo piano l'app raccoglie fatica, sensazioni ed eventuali dolori dopo ogni allenamento. Sono dati relativi alla salute: li vedete solo tu e il tuo coach NOSTOP., servono solo a gestire il tuo allenamento e puoi chiedere di cancellarli in qualsiasi momento.</p>
  <label><input type="checkbox" id="okConsenso"> Acconsento al trattamento dei miei dati relativi alla salute per la gestione del piano di allenamento.</label>
  <div><button class="btn" type="button" data-act="consenso">continua</button></div></div>`;

function aOggi(a) {
  const g = S.giornoAtleta;
  const sedute = tutte(a).filter(s => s.data === g);
  const forza = a.piano.settimane.flatMap(w => w.forza || []).filter(f => f.data === g);
  const nav = `<div class="daynav"><button class="icon" type="button" data-day="-1" aria-label="Giorno prima">‹</button><b>${g === OGGI ? 'oggi' : giornoDi(g)} ${fmtD(g)}</b><button class="icon" type="button" data-day="1" aria-label="Giorno dopo">›</button></div>`;
  const puoSegnare = ME.ruolo === 'atleta' && g <= OGGI;
  const forzaHtml = forza.map(f => { const e = a.esecuzioni[f.id]; return `<div class="forza"><h4>🏋 ${esc(f.titolo)} · ${f.min}'</h4><ul>${f.esercizi.map(([n, d]) => `<li><b>${esc(n)}</b> · ${esc(d)}</li>`).join('')}</ul><p class="small muted">${esc(f.nota)}</p>${e && e.fatta ? '<div class="done">fatta ✓</div>' : puoSegnare ? `<div><button class="btn small" type="button" data-act="forzafatta" data-id="${f.id}" data-data="${f.data}">fatta</button></div>` : ''}</div>`; }).join('');
  if (!sedute.length) {
    const prossima = tutte(a).find(s => s.data > g);
    return nav + (forza.length ? '' : `<div class="rest"><h3>giorno di riposo</h3><p class="small">Il recupero è allenamento: è qui che il corpo si adatta.</p>${prossima ? `<p class="small">Prossima: <b>${giornoDi(prossima.data)} ${fmtD(prossima.data)}</b> · ${esc(prossima.titolo)}</p>` : ''}</div>`) + forzaHtml;
  }
  const P = a.piano.passi;
  return nav + sedute.map(s => {
    const e = a.esecuzioni[s.id]; const w = s.w;
    return `<div class="today"><span class="sub">${esc(GARA_NOME[a.input.gara])} · sett. ${w.n}/${a.piano.settimane.length} · ${w.fase}</span>
      <h3>${esc(s.titolo)}</h3><span class="num small">${s.km} km · ${s.min}'</span>
      <ol>${s.passi.map(x => `<li>${esc(passoTesto(x, P))}</li>`).join('')}</ol>
      ${s.club ? `<div class="note"><b>con il club:</b> ${esc(s.club.nome)} alle ${s.club.ora} · gruppo ${esc(s.club.gruppo)}. ${esc(s.club.nota)}</div>` : ''}
      ${a.note[s.id] ? `<div class="note"><b>dal coach:</b> ${esc(a.note[s.id])}</div>` : ''}
      <details class="note"><summary class="small">come arriva sull'orologio (formato intervals.icu)</summary><pre style="white-space:pre-wrap;font:12px/1.5 var(--mono);margin:8px 0 0">${esc(N.testoIntervals(s, a.piano.vdot))}</pre></details></div>
    ${e ? (e.fatta ? `<div class="done">fatta ✓ · ${e.km ?? '—'} km · fatica ${e.rpe ?? '—'}/10${e.dolore ? ` · dolore ${esc(e.dolore.zona)} ${e.dolore.intensita}/10` : ''}</div>` : '<div class="done" style="background:var(--bad-bg);color:var(--bad)">non fatta</div>') : puoSegnare ? feedbackForm(s) : ''}`;
  }).join('') + forzaHtml;
}

const SENS = ['fresco', 'normale', 'gambe pesanti', 'affaticato', 'motivato'];
const ZONE = ['nessuno', 'piede', 'caviglia', 'polpaccio', 'tibia', 'ginocchio', 'coscia', 'anca', 'schiena'];
const feedbackForm = s => `<form class="fb" data-fb="${s.id}" data-data="${s.data}">
    <h4>com'è andata?</h4>
    <label for="km-${s.id}">km fatti<input id="km-${s.id}" type="number" step="0.1" min="0" value="${s.km}"></label>
    <label for="rpe-${s.id}">fatica <span class="num" id="rpev-${s.id}">5</span>/10<input id="rpe-${s.id}" type="range" min="1" max="10" value="5"></label>
    <label>sensazioni<span class="chips" data-chips="sens">${SENS.map(x => `<button type="button" aria-pressed="false" data-v="${x}">${x}</button>`).join('')}</span></label>
    <label>dolore o fastidio<span class="chips" data-chips="zona" data-single="1">${ZONE.map(x => `<button type="button" aria-pressed="${x === 'nessuno'}" data-v="${x}">${x}</button>`).join('')}</span></label>
    <label for="dol-${s.id}">intensità del dolore <span class="num" id="dolv-${s.id}">0</span>/10<input id="dol-${s.id}" type="range" min="0" max="10" value="0"></label>
    <label for="nota-${s.id}">nota per il coach<textarea id="nota-${s.id}" rows="2" placeholder="facoltativa"></textarea></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">salva</button><button class="btn ghost" type="button" data-nonfatta="${s.id}" data-data="${s.data}">non l'ho fatta</button></div></form>`;

function aSettimana(a) {
  const w = settDi(a, S.giornoAtleta) || a.piano.settimane[0];
  const righe = [];
  for (let k = 0; k < 7; k++) {
    const d = addDays(w.lunedi, k);
    const ss = w.sedute.filter(s => s.data === d);
    const forzaOggi = (w.forza || []).some(f => f.data === d);
    const stato = s => { const e = a.esecuzioni[s.id]; return e ? (e.fatta ? '<span class="chip verde"><i></i>fatta</span>' : '<span class="chip rosso"><i></i>saltata</span>') : d < OGGI ? '<span class="chip giallo"><i></i>da segnare</span>' : '<span class="chip grigio">da fare</span>'; };
    righe.push(ss.length ? ss.map(s => `<button type="button" class="dayrow${d === OGGI ? ' oggi' : ''}" data-goto="${d}" style="border:0;text-align:left;width:100%"><span class="d">${GIORNI[k]}<small>${fmtD(d)}</small></span><span class="t">${esc(s.titolo)}<br><span class="small muted num">${s.km} km${s.club ? ' · con il club' : ''}${forzaOggi ? ' · + forza' : ''}</span></span>${stato(s)}</button>`).join('')
      : `<div class="dayrow${d === OGGI ? ' oggi' : ''}"><span class="d">${GIORNI[k]}<small>${fmtD(d)}</small></span><span class="muted small">${forzaOggi ? '🏋 forza' : 'riposo'}</span><span></span></div>`);
  }
  return `<h3>settimana ${w.n} · ${w.fase}</h3><p class="small muted">${w.km} km previsti${w.recupero ? ' · settimana di recupero' : ''}</p>${righe.join('')}`;
}

function aPiano(a) {
  const ws = a.piano.settimane;
  const cur = settDi(a, OGGI) || ws[0];
  const giorni = a.input.dataGara ? giorniTra(OGGI, a.input.dataGara) : null;
  const P = a.piano.passi;
  const zoneK = a.input.gara === 'start' ? [] : ['E', 'ST', 'T', 'I', { maratona: 'M', mezza: 'HM', '10k': 'G10', '5k': 'G5' }[a.input.gara]];
  return `<h3>${esc(GARA_NOME[a.input.gara])}${giorni != null && giorni >= 0 ? ` · tra ${giorni} giorni` : ''}</h3>
    <div class="phases" aria-label="Avanzamento">${ws.map(w => `<i class="${w.n < cur.n ? 'fatto' : w.n === cur.n ? 'ora' : ''}" title="sett. ${w.n} · ${w.fase}"></i>`).join('')}</div>
    <p class="small">settimana <b>${cur.n}</b> di ${ws.length} · fase <b>${cur.fase}</b></p>
    <div style="overflow-x:auto">${grafico(a)}</div>
    ${zoneK.length ? `<h4>i tuoi passi</h4><div class="chips">${zoneK.map(k => `<span class="chip">${ZNOME[k]} <span class="num">${P[k]}</span></span>`).join('')}</div>` : ''}`;
}

/* ================= render ed eventi ================= */
function render() {
  if (!ME) return;
  $('vCoach').setAttribute('aria-pressed', S.vista === 'coach');
  $('vAtleta').setAttribute('aria-pressed', S.vista === 'atleta');
  $('app').innerHTML = ME.ruolo === 'coach' && S.vista === 'coach' ? vistaCoach() : vistaAtleta();
}
const aCorrente = () => ATL.find(x => x.id === S.sel);

$('vCoach').onclick = () => { S.vista = 'coach'; render(); };
$('vAtleta').onclick = () => { S.vista = 'atleta'; S.giornoAtleta = OGGI; render(); };
$('esci').onclick = async () => { await sb.auth.signOut(); ME = null; ATL = []; modoAuth = 'accedi'; mostraLogin(); };
$('aggiorna').onclick = async () => { try { await caricaTutto(); toast('Aggiornato.'); } catch (e) { errore(e, 'Aggiornamento non riuscito'); } };

$('app').addEventListener('submit', async e => {
  if (e.target.id === 'authForm') { e.preventDefault(); return submitAuth(); }
  const f = e.target.closest('form[data-fb]'); if (!f) return;
  e.preventDefault();
  const a = aCorrente(); const id = f.dataset.fb;
  const sens = [...f.querySelectorAll('[data-chips="sens"] [aria-pressed="true"]')].map(b => b.dataset.v);
  const zb = f.querySelector('[data-chips="zona"] [aria-pressed="true"]'); const zona = zb ? zb.dataset.v : 'nessuno';
  const dol = +$('dol-' + id).value, km = +$('km-' + id).value || 0, nota = $('nota-' + id).value.trim();
  const s = tutte(a).find(x => x.id === id);
  const riga = { piano_id: a.pianoId, seduta_id: id, data: f.dataset.data, fatta: true, km, minuti: Math.round(s.min * (s.km ? km / s.km : 1)), rpe: +$('rpe-' + id).value, sensazioni: sens, dolore_zona: zona !== 'nessuno' && dol > 0 ? zona : null, dolore_int: zona !== 'nessuno' && dol > 0 ? dol : null, nota: nota || null };
  try {
    const { error } = await sb.from('esecuzioni').upsert(riga, { onConflict: 'piano_id,seduta_id' }); if (error) throw error;
    a.esecuzioni[id] = mappaEsecuzioni([riga])[id];
    if (nota) await inviaMessaggio(a, nota);
    render(); toast('Salvato. Il tuo coach lo vede subito.');
  } catch (err) { errore(err, 'Salvataggio non riuscito'); }
});

$('app').addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.auth) { modoAuth = t.dataset.auth; mostraLogin(); return; }
  const a = aCorrente();
  try {
    if (t.dataset.sel) { S.sel = t.dataset.sel; S.settCoach = null; const x = aCorrente(); S.tabCoach = x.stato === 'nessuno' ? 'nuovo' : x.stato === 'bozza' ? 'piano' : 'settimana'; render(); return; }
    if (t.dataset.tab) { S.tabCoach = t.dataset.tab; render(); return; }
    if (t.dataset.wk) { S.settCoach = +t.dataset.wk; render(); return; }
    if (t.dataset.atab) { S.tabAtleta = t.dataset.atab; render(); return; }
    if (t.dataset.day) { S.giornoAtleta = addDays(S.giornoAtleta, +t.dataset.day); render(); return; }
    if (t.dataset.goto) { S.giornoAtleta = t.dataset.goto; S.tabAtleta = 'oggi'; render(); return; }
    if (t.dataset.copia) {
      const testo = `Ciao! Ti ho invitato su NOSTOP. RUNNING. Registrati qui con questa email (${t.dataset.copia}): ${URL_APP}`;
      try { await navigator.clipboard.writeText(testo); toast('Messaggio di invito copiato: incollalo in WhatsApp o email.'); } catch (err) { prompt('Copia il messaggio:', testo); }
      return;
    }
    if (t.closest('[data-chips]') && t.dataset.v) {
      const box = t.closest('[data-chips]');
      if (box.dataset.single) box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === t)));
      else t.setAttribute('aria-pressed', String(t.getAttribute('aria-pressed') !== 'true'));
      return;
    }
    if (t.dataset.elimina) { const [n, id] = t.dataset.elimina.split('|'); const w = a.piano.settimane.find(x => x.n === +n); w.sedute = w.sedute.filter(s => s.id !== id); ricalcola(a); await salvaPiano(a); render(); toast('Seduta eliminata.'); return; }
    if (t.dataset.nonfatta) {
      const { error } = await sb.from('esecuzioni').upsert({ piano_id: a.pianoId, seduta_id: t.dataset.nonfatta, data: t.dataset.data, fatta: false }, { onConflict: 'piano_id,seduta_id' }); if (error) throw error;
      a.esecuzioni[t.dataset.nonfatta] = { fatta: false, sensazioni: [], dolore: null }; render(); toast('Segnata come non fatta.'); return;
    }
    if (t.dataset.msg) { const inp = $('msg-' + t.dataset.msg); const testo = inp.value.trim(); if (!testo) return; await inviaMessaggio(a, testo); render(); return; }
    switch (t.dataset.act) {
      case 'invita': {
        const email = $('invEmail').value.trim().toLowerCase(), nome = $('invNome').value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Email non valida.'); return; }
        const { error } = await sb.from('inviti').insert({ email, nome, coach_id: ME.id }); if (error) throw error;
        INVITI.push({ email, nome }); render(); toast('Invito creato: premi "copia invito" e mandalo all\'atleta.'); return;
      }
      case 'salvaDati': {
        const club = {}; if ($('dC1').checked) club['1'] = true; if ($('dC3').checked) club['3'] = true; if ($('dC6').checked) club['6'] = true;
        const upd = { data_nascita: $('dNasc').value || null, peso_kg: +$('dPeso').value || null, altezza_cm: +$('dAlt').value || null, profilo_start: $('dProf').value || null, infortunio_6m: $('dInf').checked, club };
        const { error } = await sb.from('profili').update(upd).eq('id', a.id); if (error) throw error;
        Object.assign(a.profilo, upd); a.eta = eta(upd.data_nascita); render(); toast('Dati salvati: valgono per i prossimi piani.'); return;
      }
      case 'nuovo': S.tabCoach = 'nuovo'; render(); return;
      case 'genera': {
        const input = { gara: $('nGara').value, dataGara: $('nData').value || undefined, dataInizio: $('nInizio').value, livello: $('nLiv').value, giorni: +$('nGiorni').value, vdot: +$('nVdot').value || undefined, kmAttuali: +$('nKm').value || 0, lungoAttuale: +$('nLungo').value || 0, ...datiAtleta(a.profilo) };
        if (input.gara !== 'start' && (!input.dataGara || !input.vdot)) { toast('Servono data della gara e VDOT.'); return; }
        const piano = N.genera(input);
        piano.settimane.forEach(w => { w.sedute.forEach((s, k) => { s.id = `w${w.n}s${k}`; }); (w.forza || []).forEach((f, k) => { f.id = `w${w.n}f${k}`; }); });
        const riga = { atleta_id: a.id, coach_id: ME.id, stato: 'bozza', input, piano, note: {}, versione_motore: N.versione, modificato_dal_coach: false };
        const esistente = a.stato === 'bozza' ? a.pianoId : null;
        const r = esistente ? await sb.from('piani').update(riga).eq('id', esistente).select().single() : await sb.from('piani').insert(riga).select().single();
        if (r.error) throw r.error;
        Object.assign(a, { stato: 'bozza', pianoId: r.data.id, input, piano, note: {}, modificato: false, esecuzioni: {}, assegnatoInCorso: a.stato === 'assegnato' || a.assegnatoInCorso });
        S.tabCoach = 'piano'; render(); toast('Bozza salvata: controlla le segnalazioni e assegnala.'); return;
      }
      case 'assegna': {
        const old = await sb.from('piani').update({ stato: 'archiviato' }).eq('atleta_id', a.id).eq('stato', 'assegnato'); if (old.error) throw old.error;
        const r = await sb.from('piani').update({ stato: 'assegnato', assegnato_il: new Date().toISOString() }).eq('id', a.pianoId); if (r.error) throw r.error;
        a.stato = 'assegnato'; a.assegnatoInCorso = false;
        await inviaMessaggio(a, 'Il tuo piano è pronto! Lo trovi nella sezione "il mio piano".');
        S.tabCoach = 'settimana'; render(); toast('Piano assegnato: ora l\'atleta lo vede.'); return;
      }
      case 'commento': { const v = $('cmt').value.trim(); if (!v) return; await inviaMessaggio(a, v); render(); toast('Commento inviato in chat.'); return; }
      case 'adatta': {
        const r = N.adatta(a.piano, a.esecuzioni, OGGI);
        a.piano = r.piano; ricalcola(a); await salvaPiano(a);
        await sb.from('adattamenti').insert({ piano_id: a.pianoId, il: OGGI, esito: 'applicato', motivi: r.motivi, modifiche: r.modifiche });
        a.adattamento = { il: OGGI, esito: 'applicato' };
        await inviaMessaggio(a, `Ho aggiornato i prossimi giorni. Motivo: ${r.motivi.join(' · ')}`);
        render(); toast(`${r.modifiche.length} sedute aggiornate e messaggio inviato.`); return;
      }
      case 'scarta': {
        await sb.from('adattamenti').insert({ piano_id: a.pianoId, il: OGGI, esito: 'scartato', motivi: [], modifiche: [] });
        a.adattamento = { il: OGGI, esito: 'scartato' }; render(); return;
      }
      case 'forzafatta': {
        const { error } = await sb.from('esecuzioni').upsert({ piano_id: a.pianoId, seduta_id: t.dataset.id, data: t.dataset.data, fatta: true }, { onConflict: 'piano_id,seduta_id' }); if (error) throw error;
        a.esecuzioni[t.dataset.id] = { fatta: true, sensazioni: [], dolore: null }; render(); toast('Forza segnata come fatta.'); return;
      }
      case 'consenso': {
        if (!$('okConsenso').checked) { toast('Per usare l\'app serve il consenso.'); return; }
        const ora = new Date().toISOString();
        const { error } = await sb.from('profili').update({ consenso_salute_il: ora }).eq('id', ME.id); if (error) throw error;
        ME.consenso_salute_il = ora; render(); return;
      }
    }
  } catch (err) { errore(err, 'Operazione non riuscita'); }
});

$('app').addEventListener('change', async e => {
  const el = e.target; const a = aCorrente();
  if (!a || !a.piano) return;
  try {
    if (el.dataset.nota) { a.note[el.dataset.nota] = el.value.trim(); await salvaPiano(a); toast('Nota salvata: l\'atleta la vede nella seduta.'); return; }
    const v = a.piano.vdot || 30;
    if (el.dataset.giorno) {
      const [n, id] = el.dataset.giorno.split('|'); const w = a.piano.settimane.find(x => x.n === +n);
      const s = w.sedute.find(x => x.id === id); const d = addDays(w.lunedi, +el.value);
      if (d < OGGI) { toast('Non si può spostare una seduta nel passato.'); render(); return; }
      s.data = d; s.giorno = GIORNI[+el.value]; ricalcola(a); await salvaPiano(a); render(); toast('Seduta spostata.'); return;
    }
    const scegli = val => {
      if (val.startsWith('LUNGO')) return { ...N.lungoLibero(+val.slice(5), v), ruolo: 'LUNGO' };
      const x = N.libreria({ vdot: v, gara: a.input.gara === 'start' ? 'maratona' : a.input.gara, livello: a.input.livello || 'principiante' }).find(y => y.id === val);
      return x && { titolo: x.titolo, passi: JSON.parse(JSON.stringify(x.passi)), intensita: x.intensita, km: x.km, min: x.min, ruolo: x.intensita === 'facile' ? 'FACILE' : 'Q' };
    };
    if (el.dataset.sost && el.value) {
      const [n, id] = el.dataset.sost.split('|'); const w = a.piano.settimane.find(x => x.n === +n);
      const s = w.sedute.find(x => x.id === id); const nuova = scegli(el.value); if (!nuova) return;
      Object.assign(s, nuova); delete s.club; ricalcola(a); await salvaPiano(a); render(); toast('Seduta sostituita.'); return;
    }
    if (el.dataset.agg && el.value) {
      const w = a.piano.settimane.find(x => x.n === +el.dataset.agg);
      const day = +document.querySelector(`[data-aggday="${el.dataset.agg}"]`).value; const d = addDays(w.lunedi, day);
      if (d < OGGI) { toast('Scegli un giorno da oggi in poi.'); render(); return; }
      const nuova = scegli(el.value); if (!nuova) return;
      w.sedute.push({ ...nuova, id: `w${w.n}x${Date.now() % 1e6}`, giorno: GIORNI[day], data: d }); ricalcola(a); await salvaPiano(a); render(); toast('Seduta aggiunta.'); return;
    }
  } catch (err) { errore(err, 'Modifica non salvata'); }
});

$('app').addEventListener('input', e => {
  const el = e.target;
  if (el.id && el.id.startsWith('rpe-')) $('rpev-' + el.id.slice(4)).textContent = el.value;
  if (el.id && el.id.startsWith('dol-')) $('dolv-' + el.id.slice(4)).textContent = el.value;
});

sb.auth.onAuthStateChange((evento) => { if (evento === 'PASSWORD_RECOVERY') { modoAuth = 'nuova'; mostraLogin('Scegli la nuova password.', 'ok'); } });
caricaTutto().catch(e => { console.error(e); $('app').innerHTML = `<div class="auth"><div class="err">Impossibile caricare l'app: ${esc(e.message)}</div></div>`; });
})();
