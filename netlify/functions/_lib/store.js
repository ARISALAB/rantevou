// Δομή στη βάση (Firebase Realtime Database):
//   appt/bookings/{biz}/{id}  -> το ραντεβού (στοιχεία πελάτη, κατάσταση, token ακύρωσης)
//   appt/days/{biz}/{date}/{id} -> {s,e,ps,pe,k}  ό,τι πιάνει χρόνο εκείνη τη μέρα
//                                   k: 'b' ραντεβού, 'x' μπλοκαρισμένο από τον διαχειριστή
//   appt/rate/{hash}           -> όριο κρατήσεων ανά IP
const crypto = require('crypto');
const { conflicts } = require('./core');

const dayRef = (db, biz, date) => db.ref(`appt/days/${biz}/${date}`);
const bookingRef = (db, biz, id) => db.ref(`appt/bookings/${biz}/${id}`);

// Atomic: γράφει το διάστημα μόνο αν δεν συγκρούεται με κάτι άλλο εκείνη τη μέρα.
async function reserve(db, biz, date, id, entry) {
  const tx = await dayRef(db, biz, date).transaction(cur => {
    const busy = Object.entries(cur || {}).filter(([k, x]) => k !== id && x && typeof x.s === 'number');
    if (busy.some(([, x]) => conflicts(entry, x))) return;   // abort -> πιάστηκε
    return { ...(cur || {}), [id]: entry };
  });
  return tx.committed;
}
const release = (db, biz, date, id) => dayRef(db, biz, date).child(id).remove();

async function rateLimited(db, event, max = 5, windowMs = 15 * 60 * 1000) {
  const h = event.headers || {};
  const ip = h['x-nf-client-connection-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim();
  if (!ip) return false;
  const key = crypto.createHash('sha256').update('appt:' + ip).digest('hex').slice(0, 32);
  const now = Date.now();
  const r = await db.ref(`appt/rate/${key}`).transaction(cur => {
    if (!cur || now - cur.start > windowMs) return { start: now, n: 1 };
    if (cur.n >= max) return;
    return { start: cur.start, n: cur.n + 1 };
  });
  return !r.committed;
}

const newId = () => Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const newToken = () => crypto.randomBytes(16).toString('hex');
const sameToken = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

module.exports = { dayRef, bookingRef, reserve, release, rateLimited, newId, newToken, sameToken };
