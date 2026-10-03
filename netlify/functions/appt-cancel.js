// Ακύρωση από τον πελάτη, με το μυστικό link του email.
// POST { b, id, t, action: "info" }   -> στοιχεία ραντεβού για εμφάνιση
// POST { b, id, t, action: "cancel" } -> ακύρωση
const { loadBusiness, nowLocal } = require('./_lib/core');
const { json, preflight, parseBody } = require('./_lib/respond');
const { getDb } = require('./_lib/firebase');
const { bookingRef, release, sameToken } = require('./_lib/store');
const emails = require('./_lib/emails');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const body = parseBody(event);
  if (!body) return json(400, { error: 'bad_request' });
  const biz = loadBusiness(body.b);
  const id = String(body.id || '');
  if (!biz || !/^[a-z0-9]{6,40}$/.test(id)) return json(404, { error: 'not_found' });

  try {
    const db = getDb();
    const ref = bookingRef(db, biz.id, id);
    const bk = (await ref.get()).val();
    if (!bk || !sameToken(bk.token, body.t)) return json(404, { error: 'not_found' });
    const svc = biz.services.find(s => s.id === bk.service) || biz.services[0];

    const now = nowLocal(biz.timezone);
    const past = bk.date < now.date || (bk.date === now.date && bk.s <= now.min);
    const info = {
      service: svc.name, date: bk.date, time: bk.time, end: bk.e, mode: bk.mode, status: bk.status,
      name: bk.name, past, bizName: biz.name, phone: biz.phone, site: biz.site, modes: biz.modes,
    };
    if (body.action !== 'cancel') return json(200, info);

    if (bk.status === 'cancelled') return json(200, { ...info, ok: true });
    if (past) return json(400, { error: 'past' });

    await ref.update({ status: 'cancelled', cancelledAt: Date.now(), cancelledBy: 'customer' });
    await release(db, biz.id, bk.date, id);
    const full = { ...bk, id, status: 'cancelled' };
    await Promise.allSettled([
      emails.toCustomer('cancelled', biz, svc, full),
      emails.toOwner('cancelled', biz, svc, full),
    ]);
    return json(200, { ...info, status: 'cancelled', ok: true });
  } catch (err) {
    console.error('[appt-cancel]', err);
    return json(500, { error: 'server_error' });
  }
};
