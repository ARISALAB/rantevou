// Ρυθμίσεις επιχείρησης = βασικά στοιχεία + όσα αλλάζει ο ίδιος από την καρτέλα «Ρυθμίσεις» του admin.
// Βασικά στοιχεία: είτε αρχείο .json (businesses/) είτε εγγραφή στη βάση appt/biz/{id} (από το superadmin).
// Οι αλλαγές αποθηκεύονται στη βάση:  appt/settings/{biz}  (ολόκληρο το επεξεργάσιμο κομμάτι).
// Αν η βάση δεν απαντήσει, η επιχείρηση δουλεύει με το .json, ώστε η σελίδα κράτησης να μην πέφτει ποτέ.
const crypto = require('crypto');
const BUSINESSES = require('./businesses');
const { getDb } = require('./firebase');

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const settingsRef = (db, id) => db.ref(`appt/settings/${id}`);

const fileBusiness = id => Object.prototype.hasOwnProperty.call(BUSINESSES, id) ? BUSINESSES[id] : null;

// Βασικά στοιχεία: πρώτα από αρχείο, αλλιώς από τη βάση (επιχειρήσεις του superadmin)
async function baseBusiness(id) {
  id = String(id || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(id)) return null;
  const file = fileBusiness(id);
  if (file) return file;
  try {
    const rec = (await getDb().ref(`appt/biz/${id}`).get()).val();
    if (!rec || !rec.base) return null;
    return { ...rec.base, id, _dyn: true, _active: rec.active !== false, _keyHash: rec.keyHash || '' };
  } catch (err) {
    console.error('[settings] δεν διαβάστηκε η επιχείρηση', id, err);
    return null;
  }
}

// Συγχώνευση: ό,τι υπάρχει στις αποθηκευμένες ρυθμίσεις υπερισχύει του .json
function merge(base, s) {
  if (!s || typeof s !== 'object') return base;
  const baseSvc = id => (base.services || []).find(x => x.id === id) || {};
  const out = { ...base };
  ['name', 'phone', 'ownerEmail', 'address', 'site', 'logo', 'hours', 'slotStep', 'minNoticeHours', 'maxDaysAhead', 'remindHours', 'askCompany']
    .forEach(k => { if (s[k] !== undefined) out[k] = s[k]; });
  if (s.tagline) out.tagline = { ...(base.tagline || {}), ...s.tagline };
  if (s.accent || s.mode) out.theme = { ...(base.theme || {}), ...(s.accent ? { accent: s.accent } : {}), ...(s.mode ? { mode: s.mode } : {}) };
  if (Array.isArray(s.services) && s.services.length) {
    // Το «extra» (π.χ. «Ποια εφαρμογή;») μένει από το .json, δεν αλλάζει από το admin
    out.services = s.services.map(x => ({ ...x, extra: baseSvc(x.id).extra || null }));
  }
  // Οι μέρες χωρίς διαστήματα δεν αποθηκεύονται στη βάση (το Firebase σβήνει τους κενούς πίνακες)
  const fillHours = h => Object.fromEntries(DAYS.map(d => [d, (h || {})[d] || []]));
  out.hours = fillHours(out.hours);
  // Προσωπικό: hours null/λείπει = ωράριο της επιχείρησης, services null/λείπει = όλες οι υπηρεσίες
  if (Array.isArray(s.staff)) {
    out.staff = s.staff.filter(Boolean).map(p => ({
      id: p.id, name: p.name, active: p.active !== false,
      hours: p.ownHours ? fillHours(p.hours) : null,
      services: p.allServices === false ? (Array.isArray(p.services) ? p.services : []) : null,
    }));
  }
  return out;
}

// Επιχείρηση σε παύση (από το superadmin) δεν δέχεται κρατήσεις. Το admin της ανοίγει κανονικά.
async function loadBusiness(id, { includeSuspended = false } = {}) {
  const base = await baseBusiness(id);
  if (!base) return null;
  if (base._dyn && !base._active && !includeSuspended) return null;
  try {
    const s = (await settingsRef(getDb(), base.id).get()).val();
    return merge(base, s);
  } catch (err) {
    console.error('[settings] fallback στο .json', err);
    return base;
  }
}

// Υπενθύμιση στον πελάτη Χ ώρες πριν (0 = καμία). Προεπιλογή: 2 ώρες.
const REMIND = [0, 1, 2, 3, 24];
const remindHoursOf = biz => (REMIND.includes(biz.remindHours) ? biz.remindHours : 2);

const activeServices = biz => biz.services.filter(s => s.active !== false);

// Ό,τι βλέπει και αλλάζει ο ιδιοκτήτης στην καρτέλα «Ρυθμίσεις»
function editable(biz) {
  return {
    name: biz.name || '',
    tagline: { el: (biz.tagline || {}).el || '', en: (biz.tagline || {}).en || '' },
    phone: biz.phone || '', ownerEmail: biz.ownerEmail || '', address: biz.address || '',
    site: biz.site || '', logo: biz.logo || '', accent: (biz.theme || {}).accent || '#2a3dd1',
    mode: (biz.theme || {}).mode === 'dark' ? 'dark' : 'light',
    hours: biz.hours, slotStep: biz.slotStep || 30,
    minNoticeHours: biz.minNoticeHours || 0, maxDaysAhead: biz.maxDaysAhead || 60,
    remindHours: remindHoursOf(biz),
    askCompany: !!biz.askCompany,
    modes: Object.fromEntries(Object.entries(biz.modes || {}).map(([k, v]) => [k, v.el])),
    staff: (biz.staff || []).map(p => ({
      id: p.id, name: p.name, active: p.active !== false,
      ownHours: !!p.hours, hours: p.hours || biz.hours,
      allServices: !Array.isArray(p.services), services: Array.isArray(p.services) ? p.services : biz.services.map(x => x.id),
    })),
    services: biz.services.map(s => ({
      id: s.id, active: s.active !== false,
      name: { el: s.name.el || '', en: s.name.en || '' },
      desc: { el: (s.desc || {}).el || '', en: (s.desc || {}).en || '' },
      price: { el: (s.price || {}).el || '', en: (s.price || {}).en || '' },
      duration: s.duration, bufferBefore: s.bufferBefore || 0, bufferAfter: s.bufferAfter || 0,
      modes: s.modes, approval: !!s.approval, hasExtra: !!s.extra,
    })),
  };
}

// ---------- έλεγχος όσων στέλνει το admin ----------
const txt = (v, max) => (typeof v === 'string' ? v.trim().replace(/[\u0000-\u001f]/g, ' ') : '').slice(0, max);
const int = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const tmin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^(https:\/\/|http:\/\/localhost[:/])[^\s"'<>]+$/;   // localhost μόνο για τις δοκιμές

function fail(msg) { const e = new Error(msg); e.field = msg; throw e; }

// Ωράριο: έως 3 διαστήματα τη μέρα, σε σειρά, χωρίς επικάλυψη, τουλάχιστον μία ανοιχτή μέρα
function cleanHours(h, field) {
  h = h || {};
  const out = {};
  let open = 0;
  for (const d of DAYS) {
    const ranges = Array.isArray(h[d]) ? h[d] : [];
    if (ranges.length > 3) fail(field);
    let prevEnd = -1;
    out[d] = ranges.map(r => {
      if (!Array.isArray(r) || !TIME.test(r[0]) || !TIME.test(r[1])) fail(field);
      const a = tmin(r[0]), b = tmin(r[1]);
      if (!(b > a) || a < prevEnd) fail(field);
      prevEnd = b;
      return [r[0], r[1]];
    });
    open += out[d].length;
  }
  if (!open) fail(field);
  return out;
}

function sanitize(input, base) {
  const i = input && typeof input === 'object' ? input : {};
  const out = {};

  out.name = txt(i.name, 80) || fail('name');
  const tg = i.tagline || {};
  out.tagline = { el: txt(tg.el, 120), en: txt(tg.en, 120) };
  out.phone = txt(i.phone, 30);
  if (out.phone && out.phone.replace(/\D/g, '').length < 8) fail('phone');
  out.ownerEmail = txt(i.ownerEmail, 120).toLowerCase();
  if (!EMAIL_RE.test(out.ownerEmail)) fail('ownerEmail');
  out.address = txt(i.address, 200);
  out.site = txt(i.site, 300);
  if (out.site && !URL_RE.test(out.site)) fail('site');
  out.logo = txt(i.logo, 300);
  if (out.logo && !URL_RE.test(out.logo)) fail('logo');
  out.accent = /^#[0-9a-fA-F]{6}$/.test(i.accent) ? i.accent.toLowerCase() : fail('accent');
  out.mode = i.mode === 'dark' ? 'dark' : 'light';
  out.askCompany = !!i.askCompany;

  out.hours = cleanHours(i.hours, 'hours');

  out.slotStep = [10, 15, 20, 30, 45, 60].includes(Number(i.slotStep)) ? Number(i.slotStep) : fail('slotStep');
  out.minNoticeHours = int(i.minNoticeHours, 0, 168);
  if (out.minNoticeHours === null) fail('minNoticeHours');
  out.maxDaysAhead = int(i.maxDaysAhead, 1, 365) || fail('maxDaysAhead');
  out.remindHours = REMIND.includes(Number(i.remindHours)) ? Number(i.remindHours) : fail('remindHours');

  // Υπηρεσίες: οι παλιές δεν σβήνονται ποτέ (μόνο απενεργοποιούνται), για να βγαίνουν σωστά τα παλιά ραντεβού
  const modeKeys = Object.keys(base.modes || {});
  const list = Array.isArray(i.services) ? i.services.slice(0, 30) : [];
  const seen = new Set();
  out.services = list.map(s => {
    let id = txt(s.id, 40);
    if (!/^[a-z0-9_-]{1,40}$/.test(id)) id = 's' + crypto.randomBytes(4).toString('hex');
    if (seen.has(id)) fail('services');
    seen.add(id);
    const name = { el: txt((s.name || {}).el, 80), en: txt((s.name || {}).en, 80) };
    if (!name.el) fail('services');
    if (!name.en) name.en = name.el;
    const desc = { el: txt((s.desc || {}).el, 400), en: txt((s.desc || {}).en, 400) };
    const pel = txt((s.price || {}).el, 40), pen = txt((s.price || {}).en, 40);
    const duration = int(s.duration, 5, 600);
    const bufferBefore = int(s.bufferBefore || 0, 0, 240), bufferAfter = int(s.bufferAfter || 0, 0, 240);
    if (duration === null || bufferBefore === null || bufferAfter === null) fail('services');
    const modes = (Array.isArray(s.modes) ? s.modes : []).filter(m => modeKeys.includes(m));
    if (!modes.length) fail('services');
    return {
      id, active: s.active !== false, name, desc,
      price: pel || pen ? { el: pel || pen, en: pen || pel } : null,
      duration, bufferBefore, bufferAfter, modes: [...new Set(modes)], approval: !!s.approval,
    };
  });
  // Υπηρεσία που υπήρχε αλλά λείπει από αυτά που ήρθαν -> μένει, απενεργοποιημένη
  (base.services || []).forEach(s => {
    if (!seen.has(s.id)) {
      const { extra, ...rest } = s;
      void extra;
      out.services.push({ ...rest, active: false });
    }
  });
  if (!out.services.some(s => s.active)) fail('services');

  // Προσωπικό: όπως και οι υπηρεσίες, κανείς δεν σβήνεται (μόνο απενεργοποιείται), για τα παλιά ραντεβού
  const svcIds = out.services.map(s => s.id);
  const staffIn = Array.isArray(i.staff) ? i.staff.slice(0, 20) : [];
  const seenSt = new Set();
  out.staff = staffIn.map(p => {
    let id = txt(p.id, 40);
    if (!/^[a-z0-9_-]{1,40}$/.test(id)) id = 'p' + crypto.randomBytes(4).toString('hex');
    if (seenSt.has(id)) fail('staff');
    seenSt.add(id);
    const name = txt(p.name, 60);
    if (!name) fail('staff');
    const ownHours = !!p.ownHours;
    const allServices = p.allServices !== false;
    const services = allServices ? null : (Array.isArray(p.services) ? p.services : []).filter(x => svcIds.includes(x));
    if (!allServices && !services.length) fail('staff');
    return { id, name, active: p.active !== false, ownHours, ...(ownHours ? { hours: cleanHours(p.hours, 'staffHours') } : {}),
      allServices, ...(allServices ? {} : { services }) };
  });
  (base.staff || []).forEach(p => {
    if (!seenSt.has(p.id)) out.staff.push({ id: p.id, name: p.name, active: false, ownHours: !!p.hours,
      ...(p.hours ? { hours: p.hours } : {}), allServices: !Array.isArray(p.services), ...(Array.isArray(p.services) ? { services: p.services } : {}) });
  });
  // Κάθε ενεργή υπηρεσία πρέπει να την κάνει τουλάχιστον ένα ενεργό άτομο
  const activeSt = out.staff.filter(p => p.active);
  if (activeSt.length && out.services.some(sv => sv.active && !activeSt.some(p => p.allServices || p.services.includes(sv.id)))) fail('staffCoverage');

  return out;
}

async function saveSettings(id, input) {
  const base = await baseBusiness(id);
  // Η σύγκριση γίνεται με την τρέχουσα εικόνα (μαζί με παλιότερες αποθηκευμένες υπηρεσίες)
  const current = await loadBusiness(id, { includeSuspended: true });
  const value = sanitize(input, current);
  value.updatedAt = Date.now();
  await settingsRef(getDb(), base.id).set(value);
  return merge(base, value);
}

module.exports = { remindHoursOf, baseBusiness, fileBusiness, loadBusiness, activeServices, editable, sanitize, saveSettings, merge };
