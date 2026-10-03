// POST { b, service } -> { today, days: { "2026-10-06": ["09:00","09:30",...], ... } }
// Υπολογίζει τις ελεύθερες ώρες για όλο το διάστημα κρατήσεων (π.χ. 60 μέρες) με μία ανάγνωση.
const { loadBusiness, nowLocal, addDays, slotsForDay } = require('./_lib/core');
const { json, preflight, parseBody } = require('./_lib/respond');
const { getDb } = require('./_lib/firebase');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const body = parseBody(event);
  if (!body) return json(400, { error: 'bad_request' });

  const biz = loadBusiness(body.b);
  if (!biz) return json(404, { error: 'not_found' });
  const svc = biz.services.find(s => s.id === body.service);
  if (!svc) return json(400, { error: 'bad_service' });

  try {
    const now = nowLocal(biz.timezone);
    const last = addDays(now.date, biz.maxDaysAhead || 60);
    const snap = await getDb().ref(`appt/days/${biz.id}`).orderByKey().startAt(now.date).endAt(last).get();
    const byDay = snap.val() || {};
    const days = {};
    for (let d = now.date; d <= last; d = addDays(d, 1)) {
      const slots = slotsForDay(biz, svc, d, byDay[d], now);
      if (slots.length) days[d] = slots;
    }
    return json(200, { today: now.date, days });
  } catch (err) {
    console.error('[appt-availability]', err);
    return json(500, { error: 'server_error' });
  }
};
