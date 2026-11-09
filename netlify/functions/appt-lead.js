// Αίτημα από τη landing page: «Θέλω το σύστημα».
// POST { name, business, profession, staff, city, phone, email, message, consent, website }
//  -> 200 { ok }  |  400 { error: "bad_request" }  |  429 { error: "rate_limited" }
// Αποθηκεύεται στο appt/leads/{id} και πάει email στο LEADS_EMAIL (αλλιώς info@arakronservices.gr).
const { str } = require('./_lib/core');
const { json, preflight, parseBody } = require('./_lib/respond');
const { getDb } = require('./_lib/firebase');
const { rateLimited, newId } = require('./_lib/store');
const emails = require('./_lib/emails');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STAFF = ['1', '2-5', '6+'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const b = parseBody(event);
  if (!b) return json(400, { error: 'bad_request' });
  if (b.website) return json(200, { ok: true });   // honeypot για bots

  const lead = {
    name: str(b.name, 100), business: str(b.business, 120), profession: str(b.profession, 80),
    staff: STAFF.includes(b.staff) ? b.staff : '', city: str(b.city, 80),
    phone: str(b.phone, 30), email: str(b.email, 120).toLowerCase(), message: str(b.message, 1500),
  };
  if (!lead.name || !lead.business || !EMAIL_RE.test(lead.email) || lead.phone.replace(/\D/g, '').length < 8 || b.consent !== true) {
    return json(400, { error: 'bad_request' });
  }

  try {
    const db = getDb();
    if (await rateLimited(db, event, 3)) return json(429, { error: 'rate_limited' });
    const id = newId();
    await db.ref(`appt/leads/${id}`).set({ ...lead, created: Date.now(), status: 'new', consent: true });
    await emails.leadToPlatform(process.env.LEADS_EMAIL || 'info@arakronservices.gr', lead).catch(e => console.error('[appt-lead] email', e));
    return json(200, { ok: true });
  } catch (err) {
    console.error('[appt-lead]', err);
    return json(500, { error: 'server_error' });
  }
};
