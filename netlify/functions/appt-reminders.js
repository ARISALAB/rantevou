// Υπενθυμίσεις με email στους πελάτες, Χ ώρες πριν το ραντεβού (Ρυθμίσεις → «Υπενθύμιση στον πελάτη»).
// Τρέχει αυτόματα κάθε 15 λεπτά (netlify.toml → schedule). Κάθε ραντεβού παίρνει μία υπενθύμιση το πολύ.
// Δεν στέλνεται αν ο πελάτης έκλεισε λίγο πριν (μέσα στο διάστημα της υπενθύμισης + 30').
const { nowLocal, addDays } = require('./_lib/core');
const { loadBusiness, remindHoursOf } = require('./_lib/settings');
const { getDb } = require('./_lib/firebase');
const BUSINESSES = require('./_lib/businesses');
const emails = require('./_lib/emails');

async function run() {
  const db = getDb();
  const dyn = (await db.ref('appt/biz').get()).val() || {};
  const ids = [...new Set([...Object.keys(BUSINESSES), ...Object.keys(dyn)])];
  let sent = 0, skipped = 0;
  for (const id of ids) {
    const biz = await loadBusiness(id);
    if (!biz) continue;                       // δεν υπάρχει ή σε παύση
    const rh = remindHoursOf(biz);
    if (!rh) continue;
    const now = nowLocal(biz.timezone);
    for (let off = 0; off <= 1; off++) {      // σήμερα και αύριο (για τις 24 ώρες ή όταν περνάει τα μεσάνυχτα)
      const date = addDays(now.date, off);
      const day = (await db.ref(`appt/days/${id}/${date}`).get()).val() || {};
      for (const [bid, x] of Object.entries(day)) {
        if (!x || x.k !== 'b') continue;
        const until = off * 1440 + x.s - now.min;            // λεπτά μέχρι την έναρξη
        if (until <= 0 || until > rh * 60) continue;
        const ref = db.ref(`appt/bookings/${id}/${bid}`);
        const bk = (await ref.get()).val();
        if (!bk || bk.status !== 'confirmed' || bk.remindedAt) continue;
        const lead = Date.now() + until * 60000 - (bk.created || 0);   // πόσο νωρίτερα έκλεισε
        if (lead < (rh * 60 + 30) * 60000) { await ref.update({ remindedAt: 'skip' }); skipped++; continue; }
        await ref.update({ remindedAt: Date.now() });                 // πρώτα σημάδι, για να μη σταλεί δύο φορές
        const svc = biz.services.find(s => s.id === bk.service) || biz.services[0];
        try { await emails.toCustomer('reminder', biz, svc, { ...bk, id: bid }); sent++; }
        catch (e) { console.error('[appt-reminders] email', id, bid, e); }
      }
    }
  }
  return { sent, skipped };
}

exports.handler = async () => {
  try {
    const r = await run();
    console.log('[appt-reminders]', r);
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (err) {
    console.error('[appt-reminders]', err);
    return { statusCode: 500, body: '{}' };
  }
};
exports.run = run;
