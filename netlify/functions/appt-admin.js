// Διαχείριση ραντεβού. Κλειδί πρόσβασης: μεταβλητή περιβάλλοντος ADMIN_KEY_<ID> (π.χ. ADMIN_KEY_ARAKRON).
// POST { b, key, action: "list" }
// POST { b, key, action: "confirm" | "cancel", id }
// POST { b, key, action: "block", date, from?, to?, note? }   (χωρίς from/to = όλη η μέρα)
// POST { b, key, action: "unblock", date, id }
const { loadBusiness, nowLocal, addDays, toMin, fromMin, str } = require('./_lib/core');
const { json, preflight, parseBody } = require('./_lib/respond');
const { getDb } = require('./_lib/firebase');
const { bookingRef, dayRef, release, newId, sameToken } = require('./_lib/store');
const emails = require('./_lib/emails');

const sleep = ms => new Promise(r => setTimeout(r, ms));

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const body = parseBody(event);
  if (!body) return json(400, { error: 'bad_request' });
  const biz = loadBusiness(body.b);
  if (!biz) return json(404, { error: 'not_found' });

  const expected = process.env['ADMIN_KEY_' + biz.id.toUpperCase().replace(/-/g, '_')];
  if (!expected || expected.length < 12 || !sameToken(expected, body.key)) {
    await sleep(600);
    return json(401, { error: 'unauthorized' });
  }

  const db = getDb();
  const now = nowLocal(biz.timezone);
  const svcOf = id => biz.services.find(s => s.id === id) || biz.services[0];

  try {
    switch (body.action) {
      case 'list': {
        const from = addDays(now.date, -14);
        const all = (await db.ref(`appt/bookings/${biz.id}`).get()).val() || {};
        const bookings = Object.entries(all)
          .filter(([, b]) => b && b.date >= from)
          .map(([id, b]) => {
            const { token, ...rest } = b;
            return { id, ...rest, end: fromMin(b.e) };
          })
          .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        const days = (await db.ref(`appt/days/${biz.id}`).orderByKey().startAt(now.date).get()).val() || {};
        const blocks = [];
        Object.entries(days).forEach(([date, entries]) => Object.entries(entries || {}).forEach(([id, x]) => {
          if (x && x.k === 'x') blocks.push({ id, date, from: fromMin(x.s), to: fromMin(Math.min(x.e, 1439)), allDay: x.s === 0 && x.e >= 1440, note: x.note || '' });
        }));
        blocks.sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from));
        return json(200, { name: biz.name, today: now.date, bookings, blocks, services: biz.services.map(s => ({ id: s.id, name: s.name.el })), modes: biz.modes });
      }

      case 'confirm':
      case 'cancel': {
        const id = String(body.id || '');
        const ref = bookingRef(db, biz.id, id);
        const bk = (await ref.get()).val();
        if (!bk) return json(404, { error: 'not_found' });
        const svc = svcOf(bk.service);
        if (body.action === 'confirm') {
          if (bk.status !== 'pending') return json(200, { ok: true, status: bk.status });
          await ref.update({ status: 'confirmed', confirmedAt: Date.now() });
          await emails.toCustomer('approved', biz, svc, { ...bk, id, status: 'confirmed' }).catch(e => console.error(e));
          return json(200, { ok: true, status: 'confirmed' });
        }
        if (bk.status === 'cancelled') return json(200, { ok: true, status: 'cancelled' });
        await ref.update({ status: 'cancelled', cancelledAt: Date.now(), cancelledBy: 'admin' });
        await release(db, biz.id, bk.date, id);
        if (body.notify !== false) {
          await emails.toCustomer('cancelled', biz, svc, { ...bk, id, status: 'cancelled' }).catch(e => console.error(e));
        }
        return json(200, { ok: true, status: 'cancelled' });
      }

      case 'block': {
        const date = String(body.date || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < now.date) return json(400, { error: 'bad_request' });
        let s = 0, e = 1440;
        if (body.from || body.to) {
          if (!/^\d{2}:\d{2}$/.test(body.from) || !/^\d{2}:\d{2}$/.test(body.to)) return json(400, { error: 'bad_request' });
          s = toMin(body.from); e = toMin(body.to);
          if (!(e > s)) return json(400, { error: 'bad_request' });
        }
        const id = 'x' + newId();
        await dayRef(db, biz.id, date).child(id).set({ s, e, ps: s, pe: e, k: 'x', note: str(body.note, 120) });
        return json(200, { ok: true, id });
      }

      case 'unblock': {
        const date = String(body.date || ''), id = String(body.id || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^x[a-z0-9]+$/.test(id)) return json(400, { error: 'bad_request' });
        await release(db, biz.id, date, id);
        return json(200, { ok: true });
      }

      default:
        return json(400, { error: 'bad_action' });
    }
  } catch (err) {
    console.error('[appt-admin]', err);
    return json(500, { error: 'server_error' });
  }
};
