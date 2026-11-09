// Superadmin της πλατφόρμας. Κλειδί: μεταβλητή SUPERADMIN_KEY στο Netlify.
// POST { key, action: "list" }                         -> επιχειρήσεις (αρχεία + βάση) και αιτήματα
// POST { key, action: "create", name, email, id? }     -> νέα επιχείρηση στη βάση, επιστρέφει το κλειδί admin ΜΙΑ φορά
// POST { key, action: "resetKey", id }                 -> νέο κλειδί admin (μόνο για επιχειρήσεις της βάσης)
// POST { key, action: "setActive", id, active }        -> παύση / ενεργοποίηση (σε παύση: η σελίδα κράτησης δεν ανοίγει)
// POST { key, action: "setLead", id, status }          -> κατάσταση αιτήματος: new | contacted | won | lost
// POST { key, action: "backup" }                       -> όλη η βάση των ραντεβού σε JSON (λήψη από το superadmin)
const { json, preflight, parseBody, siteUrl } = require('./_lib/respond');
const { getDb } = require('./_lib/firebase');
const { str } = require('./_lib/core');
const { fileBusiness } = require('./_lib/settings');
const { validId, slugify, newBusinessBase } = require('./_lib/template');
const { hashKey, newKey, sleep, superKeyOk } = require('./_lib/auth');
const BUSINESSES = require('./_lib/businesses');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LEAD_STATUS = ['new', 'contacted', 'won', 'lost'];

function links(id) {
  const base = siteUrl();
  return {
    booking: `${base}/${id}`,
    admin: `${base}/admin.html?b=${id}`,
    google: `${base}/${id}?utm_source=google&utm_medium=gbp`,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const body = parseBody(event);
  if (!body) return json(400, { error: 'bad_request' });
  if (!superKeyOk(body.key)) { await sleep(800); return json(401, { error: 'unauthorized' }); }

  const db = getDb();
  try {
    switch (body.action) {
      case 'list': {
        const [bizSnap, setSnap, leadSnap, bookSnap] = await Promise.all([
          db.ref('appt/biz').get(), db.ref('appt/settings').get(), db.ref('appt/leads').get(), db.ref('appt/bookings').get(),
        ]);
        const dyn = bizSnap.val() || {}, settings = setSnap.val() || {}, bookings = bookSnap.val() || {};
        const today = new Date().toISOString().slice(0, 10);
        const stats = id => {
          const all = Object.values(bookings[id] || {}).filter(Boolean);
          return {
            upcoming: all.filter(b => b.status !== 'cancelled' && b.date >= today).length,
            last30: all.filter(b => b.created >= Date.now() - 30 * 864e5).length,
            google30: all.filter(b => b.source === 'google' && b.created >= Date.now() - 30 * 864e5).length,
          };
        };
        const row = (id, base, extra) => ({
          id, name: (settings[id] && settings[id].name) || base.name,
          email: (settings[id] && settings[id].ownerEmail) || base.ownerEmail || '',
          staff: ((settings[id] && settings[id].staff) || []).filter(p => p && p.active !== false).length,
          ...stats(id), links: links(id), ...extra,
        });
        const businesses = [
          ...Object.keys(BUSINESSES).map(id => row(id, BUSINESSES[id], { source: 'file', active: true, created: null })),
          ...Object.entries(dyn).filter(([, r]) => r && r.base).map(([id, r]) => row(id, r.base, { source: 'db', active: r.active !== false, created: r.created || null })),
        ].sort((a, b) => (b.created || 0) - (a.created || 0));
        const leads = Object.entries(leadSnap.val() || {}).map(([id, l]) => ({ id, ...l }))
          .sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 200);
        return json(200, { businesses, leads, site: siteUrl() });
      }

      case 'create': {
        const name = str(body.name, 80), email = str(body.email, 120).toLowerCase();
        const id = String(body.id || '').trim().toLowerCase() || slugify(name);
        if (!name || !EMAIL_RE.test(email)) return json(400, { error: 'invalid', field: !name ? 'name' : 'email' });
        if (!validId(id)) return json(400, { error: 'invalid', field: 'id' });
        if (fileBusiness(id)) return json(409, { error: 'exists' });
        const key = newKey();
        const rec = { base: newBusinessBase(id, name, email, siteUrl()), keyHash: hashKey(key), active: true, created: Date.now() };
        // Atomic: δημιουργείται μόνο αν δεν υπάρχει ήδη επιχείρηση με αυτό το id
        const tx = await db.ref(`appt/biz/${id}`).transaction(cur => (cur ? undefined : rec));
        if (!tx.committed) return json(409, { error: 'exists' });
        if (body.leadId && /^[a-z0-9]{6,40}$/.test(String(body.leadId))) {
          await db.ref(`appt/leads/${body.leadId}`).update({ status: 'won', business: id }).catch(() => {});
        }
        return json(200, { ok: true, id, name, key, links: links(id) });
      }

      case 'resetKey': {
        const id = String(body.id || '');
        if (!validId(id)) return json(400, { error: 'bad_request' });
        if (fileBusiness(id)) return json(400, { error: 'file_business' });
        const ref = db.ref(`appt/biz/${id}`);
        if (!(await ref.child('base').get()).exists()) return json(404, { error: 'not_found' });
        const key = newKey();
        await ref.update({ keyHash: hashKey(key), keyResetAt: Date.now() });
        return json(200, { ok: true, id, key, links: links(id) });
      }

      case 'setActive': {
        const id = String(body.id || '');
        if (!validId(id) || fileBusiness(id)) return json(400, { error: 'bad_request' });
        const ref = db.ref(`appt/biz/${id}`);
        if (!(await ref.child('base').get()).exists()) return json(404, { error: 'not_found' });
        await ref.update({ active: body.active !== false });
        return json(200, { ok: true, active: body.active !== false });
      }

      case 'setLead': {
        const id = String(body.id || '');
        if (!/^[a-z0-9]{6,40}$/.test(id) || !LEAD_STATUS.includes(body.status)) return json(400, { error: 'bad_request' });
        const ref = db.ref(`appt/leads/${id}`);
        if (!(await ref.get()).exists()) return json(404, { error: 'not_found' });
        await ref.update({ status: body.status });
        return json(200, { ok: true });
      }

      case 'backup': {
        const { snapshot } = require('./appt-backup');
        const { data, stats } = await snapshot();
        return json(200, { exportedAt: new Date().toISOString(), stats, appt: data });
      }

      default:
        return json(400, { error: 'bad_action' });
    }
  } catch (err) {
    console.error('[appt-super]', err);
    return json(500, { error: 'server_error' });
  }
};
