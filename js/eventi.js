// NOSTOP. RUN CLUB — calendario uscite ed eventi
// Per aggiungere un evento: copia un blocco { ... }, cambia i campi, salva.
// tipo: 'uscita' (settimanale), 'evento' (speciale), 'gara' (andiamo insieme), 'workshop'
// Gli eventi passati spariscono da soli dalla pagina.
// ATTENZIONE: date, luoghi e orari qui sotto sono ESEMPI da sostituire con quelli reali.

window.NOSTOP_SETTIMANA = [
  { giorno: 'martedì',  ora: '19:00', titolo: 'qualità in gruppo', desc: 'Riscaldamento insieme, poi ripetute divise per gruppo di passo.', luogo: 'luogo da definire' },
  { giorno: 'giovedì',  ora: '19:00', titolo: 'lento sociale',     desc: '8–10 km a ritmo di chiacchiera. Nessuno resta indietro.',      luogo: 'luogo da definire' },
  { giorno: 'domenica', ora: '08:30', titolo: 'lungo + colazione', desc: 'Lungo per gruppi di passo e poi tutti al bar per il post corsa.', luogo: 'luogo da definire' },
];

window.NOSTOP_EVENTI = [
  { data: '2026-11-08', ora: '08:30', tipo: 'evento',   titolo: 'prima uscita ufficiale NOSTOP. Run Club', luogo: 'luogo da definire', desc: '5 o 10 km per gruppi di passo, foto di gruppo e colazione offerta.', posti: 60 },
  { data: '2026-11-21', ora: '10:00', tipo: 'workshop', titolo: 'forza per runner: prova pratica',          luogo: 'luogo da definire', desc: "Un'ora con i coach: gli esercizi che proteggono tendini e ginocchia.", posti: 25 },
  { data: '2026-12-13', ora: '09:00', tipo: 'evento',   titolo: 'christmas run',                            luogo: 'luogo da definire', desc: 'Corsa di Natale a ritmo libero, cappelli rossi e panettone al traguardo.', posti: 100 },
  { data: '2027-03-22', ora: '',      tipo: 'gara',     titolo: 'mezza di primavera — andiamo insieme',     luogo: 'gara da scegliere', desc: 'Preparazione di gruppo da gennaio, viaggio e tifo insieme.', posti: null },
];
