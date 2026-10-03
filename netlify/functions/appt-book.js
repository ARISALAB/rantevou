// POST { b, service, date, time, mode, name, phone, email, company, address, extra, notes, lang, consent, website }
//  -> 200 { ok, id, status: "confirmed" | "pending" }
//  -> 4xx { error: "bad_request" | "bad_time" | "slot_taken" | "rate_limited" | "not_found" }
const { loadBusiness, nowLocal, slotsForDay, toMin, interval, str } = require('./_lib/core');
const { json, preflight, parseBody } = require('./_lib/respond');
const { getDb } = require('./_lib/firebase');
const { bookingRef, reserve, release, rateLimited, newId, newToken } = require('./_lib/store');
const emails = require('./_lib/emails');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const b = parseBody(event);
  if (!b) return json(400, { error: 'bad_request' });
  if (b.website) return json(200, { ok: true, id: 'x', status: 'confirmed' });   // honeypot για bots

  const biz = loadBusiness(b.b);
  if (!biz) return json(404, { error: 'not_found' });
  const svc = biz.services.find(s => s.id === b.service);

  const date = String(b.date || ''), time = String(b.time || ''), mode = String(b.mode || '');
  const name = str(b.name, 100), phone = str(b.phone, 30), email = str(b.email, 120).toLowerCase();
  const company = str(b.company, 120), address = str(b.address, 200), notes = str(b.notes, 1500);
  const extra = str(b.extra, 60);
  const lang = b.lang === 'en' ? 'en' : 'el';

  if (!svc || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) ||
      !svc.modes.includes(mode) || !name || phone.replace(/\D/g, '').length < 8 || !EMAIL_RE.test(email) ||
      (mode === 'onsite' && !address) || (svc.extra && !svc.extra.options.includes(extra)) || b.consent !== true) {
    return json(400, { error: 'bad_request' });
  }

  // Η ώρα πρέπει να είναι μέσα στο ωράριο, με την ελάχιστη προειδοποίηση κ.λπ.
  const now = nowLocal(biz.timezone);
  if (!slotsForDay(biz, svc, date, {}, now).includes(time)) return json(400, { error: 'bad_time' });

  try {
    const db = getDb();
    if (await rateLimited(db, event)) return json(429, { error: 'rate_limited' });

    const id = newId();
    const span = interval(svc, toMin(time));
    if (!(await reserve(db, biz.id, date, id, { ...span, k: 'b' }))) return json(409, { error: 'slot_taken' });

    const booking = {
      service: svc.id, date, time, s: span.s, e: span.e, mode,
      name, phone, email, company, address: mode === 'onsite' ? address : '', extra: svc.extra ? extra : '', notes,
      lang, status: svc.approval ? 'pending' : 'confirmed', token: newToken(), created: Date.now(), consent: true,
    };
    try {
      await bookingRef(db, biz.id, id).set(booking);
    } catch (e) {
      await release(db, biz.id, date, id).catch(() => {});
      throw e;
    }

    const full = { ...booking, id };
    const sent = await Promise.allSettled([
      emails.toCustomer(booking.status, biz, svc, full),
      emails.toOwner('new', biz, svc, full),
    ]);
    sent.forEach(r => r.status === 'rejected' && console.error('[appt-book] email', r.reason));

    return json(200, { ok: true, id, status: booking.status });
  } catch (err) {
    console.error('[appt-book]', err);
    return json(500, { error: 'server_error' });
  }
};
