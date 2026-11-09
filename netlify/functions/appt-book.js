// POST { b, service, staff?, date, time, mode, name, phone, email, company, address, extra, notes, lang, consent, website }
//  -> 200 { ok, id, status: "confirmed" | "pending" }
//  -> 4xx { error: "bad_request" | "bad_time" | "slot_taken" | "rate_limited" | "not_found" }
const { nowLocal, toMin, interval, str, eligibleStaff, staffSlots } = require('./_lib/core');
const { loadBusiness, activeServices } = require('./_lib/settings');
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

  const biz = await loadBusiness(b.b);
  if (!biz) return json(404, { error: 'not_found' });
  const svc = activeServices(biz).find(s => s.id === b.service);

  const date = String(b.date || ''), time = String(b.time || ''), mode = String(b.mode || '');
  const name = str(b.name, 100), phone = str(b.phone, 30), email = str(b.email, 120).toLowerCase();
  const company = biz.askCompany ? str(b.company, 120) : '', address = str(b.address, 200), notes = str(b.notes, 1500);
  const extra = str(b.extra, 60);
  const lang = b.lang === 'en' ? 'en' : 'el';
  // Πηγή κράτησης: "google" από το κουμπί του Google, αλλιώς το utm_source (π.χ. "instagram")
  const source = /^[a-z0-9_.-]{1,30}$/.test(String(b.source || '')) ? b.source : '';
  const rwg = /^[A-Za-z0-9_\-=.]{1,500}$/.test(String(b.rwg || '')) ? b.rwg : '';

  if (!svc || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) ||
      !svc.modes.includes(mode) || !name || phone.replace(/\D/g, '').length < 8 || !EMAIL_RE.test(email) ||
      (mode === 'onsite' && !address) || (svc.extra && !svc.extra.options.includes(extra)) || b.consent !== true) {
    return json(400, { error: 'bad_request' });
  }

  // Άτομο: συγκεκριμένο ή «οποιοσδήποτε». Η ώρα πρέπει να είναι μέσα στο ωράριό του, με την ελάχιστη προειδοποίηση κ.λπ.
  const people = eligibleStaff(biz, svc, String(b.staff || ''));
  if (!people.length) return json(400, { error: 'bad_request' });
  const now = nowLocal(biz.timezone);
  const fits = people.filter(p => staffSlots(biz, svc, date, {}, now, p).includes(time));
  if (!fits.length) return json(400, { error: 'bad_time' });

  try {
    const db = getDb();
    if (await rateLimited(db, event)) return json(429, { error: 'rate_limited' });

    const id = newId();
    const span = interval(svc, toMin(time));
    // «Οποιοσδήποτε»: πρώτα όποιος έχει τα λιγότερα ραντεβού εκείνη τη μέρα
    let order = fits;
    if (fits.length > 1) {
      const day = (await db.ref(`appt/days/${biz.id}/${date}`).get()).val() || {};
      const load = p => Object.values(day).filter(x => x && x.k === 'b' && x.st === p.id).length;
      order = fits.slice().sort((a, c) => load(a) - load(c));
    }
    let person = null;
    for (const p of order) {
      if (await reserve(db, biz.id, date, id, { ...span, k: 'b', ...(p.id ? { st: p.id } : {}) })) { person = p; break; }
    }
    if (!person) return json(409, { error: 'slot_taken' });

    const booking = {
      service: svc.id, date, time, s: span.s, e: span.e, mode,
      name, phone, email, company, address: mode === 'onsite' ? address : '', extra: svc.extra ? extra : '', notes,
      lang, status: svc.approval ? 'pending' : 'confirmed', token: newToken(), created: Date.now(), consent: true,
      source, ...(rwg ? { rwg } : {}), ...(person.id ? { staff: person.id, staffName: person.name } : {}),
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

    return json(200, { ok: true, id, status: booking.status, staffName: person.name || '' });
  } catch (err) {
    console.error('[appt-book]', err);
    return json(500, { error: 'server_error' });
  }
};
