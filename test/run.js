// Τρέξιμο: node test/run.js
// Χωρίς εγκατάσταση πακέτων: το firebase-admin αντικαθίσταται από την ψεύτικη βάση
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === 'firebase-admin' || req === 'resend') return require.resolve('./fake-db.js');
  return origResolve.call(this, req, ...rest);
};
const assert = require('assert');
const { FakeDb } = require('./fake-db');
global.__APPT_TEST_DB__ = new FakeDb();
global.__APPT_SENT__ = [];
process.env.ADMIN_KEY_ARAKRON = 'test-admin-key-123456';

// Δευτέρα 5/10/2026, 08:00 ώρα Αθήνας (05:00 UTC)
const FIXED = Date.parse('2026-10-05T05:00:00Z');
Date.now = () => FIXED;

// Οι δοκιμές ελέγχουν τη λογική με σταθερό ωράριο (Δευ–Παρ 09:00–17:00),
// ανεξάρτητα από το πραγματικό ωράριο που έχει ρυθμίσει η επιχείρηση.
const TEST_HOURS = { mon: [['09:00', '17:00']], tue: [['09:00', '17:00']], wed: [['09:00', '17:00']], thu: [['09:00', '17:00']], fri: [['09:00', '17:00']], sat: [], sun: [] };
require('../netlify/functions/_lib/businesses').arakron.hours = TEST_HOURS;

const fn = n => require('../netlify/functions/' + n).handler;
const call = async (name, body, headers = {}) => {
  const r = await fn(name)({ httpMethod: 'POST', body: JSON.stringify(body), headers, queryStringParameters: {} });
  return { code: r.statusCode, body: JSON.parse(r.body || '{}') };
};
const ip = n => ({ 'x-nf-client-connection-ip': '10.0.0.' + n });
const base = { b: 'arakron', name: 'Γιώργος Π.', phone: '6900000000', email: 'g@example.com', consent: true, lang: 'el' };
let ok = 0;
const t = async (label, f) => { await f(); ok++; console.log('✓', label); };

(async () => {
  await t('config', async () => {
    const r = await fn('appt-config')({ httpMethod: 'GET', queryStringParameters: { b: 'arakron' } });
    const c = JSON.parse(r.body);
    assert.equal(r.statusCode, 200); assert.equal(c.services.length, 4); assert(!('ownerEmail' in c));
    const r2 = await fn('appt-config')({ httpMethod: 'GET', queryStringParameters: { b: '../etc' } });
    assert.equal(r2.statusCode, 404);
  });

  await t('διαθεσιμότητα: 12ω προειδοποίηση, όχι Σαββατοκύριακα', async () => {
    const r = await call('appt-availability', { b: 'arakron', service: 'intro' });
    assert.equal(r.body.today, '2026-10-05');
    assert(!r.body.days['2026-10-05'], 'όχι σήμερα');
    assert.equal(r.body.days['2026-10-06'][0], '09:00');
    assert.equal(r.body.days['2026-10-06'].slice(-1)[0], '16:30');
    assert.equal(r.body.days['2026-10-06'].length, 16);
    assert(!r.body.days['2026-10-10'] && !r.body.days['2026-10-11'], 'κλειστά Σ/Κ');
    const last = Object.keys(r.body.days).sort().pop();
    assert(last <= '2026-12-04', 'έως 60 μέρες');
    const v = await call('appt-availability', { b: 'arakron', service: 'visit' });
    assert.equal(v.body.days['2026-10-06'].slice(-1)[0], '15:00', 'αυτοψία 2 ωρών τελειώνει έως 17:00');
  });

  let visitId;
  await t('κράτηση αυτοψίας -> σε αναμονή επιβεβαίωσης', async () => {
    const r = await call('appt-book', { ...base, service: 'visit', date: '2026-10-06', time: '10:00', mode: 'onsite', address: 'Αδριανού 1, Πλάκα' }, ip(1));
    assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'pending'); visitId = r.body.id;
  });

  await t('οι ώρες γύρω από την αυτοψία κλειδώνουν (μαζί με χρόνο μετακίνησης)', async () => {
    const r = await call('appt-availability', { b: 'arakron', service: 'intro' });
    const d = r.body.days['2026-10-06'];
    ['09:00', '09:30', '10:00', '11:30', '12:30'].forEach(x => assert(!d.includes(x), x + ' πρέπει να είναι πιασμένη'));
    assert(d.includes('13:00'), '13:00 ελεύθερη');
  });

  await t('διπλή κράτηση της ίδιας ώρας απορρίπτεται', async () => {
    const r = await call('appt-book', { ...base, email: 'x@example.com', service: 'intro', date: '2026-10-06', time: '11:00', mode: 'phone' }, ip(2));
    assert.equal(r.code, 409); assert.equal(r.body.error, 'slot_taken');
  });

  await t('έλεγχοι εισόδου', async () => {
    const cases = [
      [{ service: 'visit', date: '2026-10-07', time: '10:00', mode: 'onsite' }, 400, 'χωρίς διεύθυνση'],
      [{ service: 'intro', date: '2026-10-07', time: '10:00', mode: 'phone', consent: false }, 400, 'χωρίς συναίνεση'],
      [{ service: 'intro', date: '2026-10-07', time: '17:00', mode: 'phone' }, 400, 'εκτός ωραρίου'],
      [{ service: 'intro', date: '2026-10-05', time: '15:00', mode: 'phone' }, 400, 'μέσα στις 12 ώρες'],
      [{ service: 'intro', date: '2026-10-10', time: '10:00', mode: 'phone' }, 400, 'Σάββατο'],
      [{ service: 'intro', date: '2026-10-07', time: '10:00', mode: 'onsite', address: 'x' }, 400, 'μη επιτρεπτός τρόπος'],
      [{ service: 'demo', date: '2026-10-07', time: '10:00', mode: 'online', extra: 'Excel' }, 400, 'λάθος εφαρμογή'],
      [{ service: 'intro', date: '2026-10-07', time: '10:00', mode: 'phone', email: 'nope' }, 400, 'λάθος email'],
    ];
    for (const [extra, code, label] of cases) {
      const r = await call('appt-book', { ...base, ...extra }, ip(3));
      assert.equal(r.code, code, label + ' -> ' + JSON.stringify(r.body));
    }
  });

  let demo;
  await t('demo -> επιβεβαιώνεται αμέσως, emails σε πελάτη και ιδιοκτήτη', async () => {
    global.__APPT_SENT__ = [];
    const r = await call('appt-book', { ...base, service: 'demo', date: '2026-10-07', time: '11:00', mode: 'online', extra: 'TableReserve', notes: '<script>x</script>' }, ip(4));
    assert.equal(r.code, 200); assert.equal(r.body.status, 'confirmed'); demo = r.body.id;
    assert.equal(global.__APPT_SENT__.length, 2);
    const [cust, own] = global.__APPT_SENT__;
    assert.equal(cust.to, 'g@example.com'); assert(cust.attachments && cust.attachments.length === 1, 'ics');
    assert(cust.html.includes('calendar.google.com'));
    assert.equal(own.to, 'info@arakronservices.gr');
    assert(!own.html.includes('<script>'), 'escape HTML');
  });

  await t('ακύρωση από πελάτη: λάθος token -> 404, σωστό -> ελευθερώνει την ώρα', async () => {
    const db = global.__APPT_TEST_DB__;
    const tok = db.data.appt.bookings.arakron[demo].token;
    assert.equal((await call('appt-cancel', { b: 'arakron', id: demo, t: 'bad', action: 'info' })).code, 404);
    const info = await call('appt-cancel', { b: 'arakron', id: demo, t: tok, action: 'info' });
    assert.equal(info.code, 200); assert.equal(info.body.status, 'confirmed'); assert(!('email' in info.body));
    let a = await call('appt-availability', { b: 'arakron', service: 'demo' });
    assert(!a.body.days['2026-10-07'].includes('11:00'));
    const c = await call('appt-cancel', { b: 'arakron', id: demo, t: tok, action: 'cancel' });
    assert.equal(c.body.status, 'cancelled');
    a = await call('appt-availability', { b: 'arakron', service: 'demo' });
    assert(a.body.days['2026-10-07'].includes('11:00'), 'η ώρα ελευθερώθηκε');
  });

  await t('rate limit: 6η κράτηση από ίδια IP σε 15 λεπτά', async () => {
    const times = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00'];
    const codes = [];
    for (const time of times) codes.push((await call('appt-book', { ...base, service: 'intro', date: '2026-10-08', time, mode: 'phone' }, ip(9))).code);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
  });

  await t('admin: λάθος κλειδί, λίστα, επιβεβαίωση, μπλοκάρισμα', async () => {
    const K = { b: 'arakron', key: 'test-admin-key-123456' };
    assert.equal((await call('appt-admin', { b: 'arakron', key: 'wrong', action: 'list' })).code, 401);
    const list = await call('appt-admin', { ...K, action: 'list' });
    assert.equal(list.code, 200); assert(list.body.bookings.length >= 7); assert(!list.body.bookings.some(b => b.token));
    global.__APPT_SENT__ = [];
    const c = await call('appt-admin', { ...K, action: 'confirm', id: visitId });
    assert.equal(c.body.status, 'confirmed'); assert.equal(global.__APPT_SENT__.length, 1);
    const blk = await call('appt-admin', { ...K, action: 'block', date: '2026-10-09' });
    assert.equal(blk.code, 200);
    let a = await call('appt-availability', { b: 'arakron', service: 'intro' });
    assert(!a.body.days['2026-10-09'], 'μπλοκαρισμένη μέρα');
    const part = await call('appt-admin', { ...K, action: 'block', date: '2026-10-12', from: '09:00', to: '12:00', note: 'Γιατρός' });
    a = await call('appt-availability', { b: 'arakron', service: 'intro' });
    assert.equal(a.body.days['2026-10-12'][0], '12:00');
    const l2 = await call('appt-admin', { ...K, action: 'list' });
    assert.equal(l2.body.blocks.length, 2); assert.equal(l2.body.blocks[1].note, 'Γιατρός');
    await call('appt-admin', { ...K, action: 'unblock', date: '2026-10-09', id: blk.body.id });
    a = await call('appt-availability', { b: 'arakron', service: 'intro' });
    assert(a.body.days['2026-10-09'], 'ξεμπλοκαρίστηκε');
    void part;
  });

  await t('ρυθμίσεις: φόρτωση, έλεγχος, αποθήκευση, εφαρμογή παντού', async () => {
    const K = { b: 'arakron', key: 'test-admin-key-123456' };
    assert.equal((await call('appt-admin', { b: 'arakron', key: 'wrong', action: 'settings' })).code, 401);
    const g = await call('appt-admin', { ...K, action: 'settings' });
    assert.equal(g.code, 200);
    const st = g.body.settings;
    assert.equal(st.services.length, 4); assert.equal(st.ownerEmail, 'info@arakronservices.gr');

    // λάθος email / επικαλυπτόμενες ώρες / καμία ενεργή υπηρεσία -> 400 με το πεδίο
    const bad = async (patch, field) => {
      const r = await call('appt-admin', { ...K, action: 'saveSettings', settings: { ...st, ...patch } });
      assert.equal(r.code, 400, field); assert.equal(r.body.field, field);
    };
    await bad({ ownerEmail: 'όχι-email' }, 'ownerEmail');
    await bad({ hours: { ...st.hours, mon: [['09:00', '13:00'], ['12:00', '15:00']] } }, 'hours');
    await bad({ services: st.services.map(x => ({ ...x, active: false })) }, 'services');
    await bad({ site: 'javascript:alert(1)' }, 'site');

    // Σάββατο ανοιχτό, γνωριμία 60', demo κλειστό, νέα υπηρεσία, το «training» λείπει από την αποστολή
    const services = st.services.filter(x => x.id !== 'training').map(x =>
      x.id === 'intro' ? { ...x, duration: 60 } : x.id === 'demo' ? { ...x, active: false } : x);
    services.push({ name: { el: 'Κούρεμα', en: '' }, desc: { el: '', en: '' }, price: { el: '15 €', en: '' }, duration: 30, modes: ['onsite'] });
    const save = await call('appt-admin', { ...K, action: 'saveSettings', settings: {
      ...st, name: 'AR Akron (δοκιμή)', hours: { ...st.hours, sat: [['10:00', '14:00']] }, services } });
    assert.equal(save.code, 200, JSON.stringify(save.body));
    const sv = save.body.settings.services;
    assert.equal(sv.length, 5, 'το training μένει, απενεργοποιημένο');
    assert.equal(sv.find(x => x.id === 'training').active, false);
    const neu = sv.find(x => x.name.el === 'Κούρεμα');
    assert(/^s[0-9a-f]{8}$/.test(neu.id)); assert.equal(neu.name.en, 'Κούρεμα'); assert.equal(neu.price.en, '15 €');
    assert(sv.find(x => x.id === 'demo').hasExtra, 'το extra του demo κρατιέται από το .json');

    const r = await fn('appt-config')({ httpMethod: 'GET', queryStringParameters: { b: 'arakron' } });
    const c = JSON.parse(r.body);
    assert.equal(c.name, 'AR Akron (δοκιμή)');
    assert.deepEqual(c.services.map(x => x.id).sort(), ['intro', 'visit', neu.id].sort());
    const a = await call('appt-availability', { b: 'arakron', service: 'intro' });
    assert.equal(a.body.days['2026-10-10'].slice(-1)[0], '13:00', 'Σάββατο 10–14, γνωριμία 60\'');
    assert.equal((await call('appt-availability', { b: 'arakron', service: 'demo' })).code, 400, 'κλειστή υπηρεσία');
    const bk = await call('appt-book', { ...base, service: 'demo', date: '2026-10-14', time: '10:00', mode: 'online', extra: 'TableReserve' }, ip(20));
    assert.equal(bk.code, 400, 'δεν κλείνεται κλειστή υπηρεσία');
    const ok2 = await call('appt-book', { ...base, service: neu.id, date: '2026-10-10', time: '10:00', mode: 'onsite', address: 'Ερμού 5' }, ip(21));
    assert.equal(ok2.code, 200, JSON.stringify(ok2.body));

    // Το παλιό ραντεβού demo (ακυρωμένο) ανοίγει ακόμα με το σωστό όνομα υπηρεσίας
    const db = global.__APPT_TEST_DB__;
    const info = await call('appt-cancel', { b: 'arakron', id: demo, t: db.data.appt.bookings.arakron[demo].token, action: 'info' });
    assert.equal(info.body.service.el, 'Παρουσίαση εφαρμογής');

    // Το Firebase δεν κρατά κενούς πίνακες: κλειστές μέρες λείπουν από τη βάση -> μένουν κλειστές
    delete db.data.appt.settings.arakron.hours.sun;
    const a2 = await call('appt-availability', { b: 'arakron', service: 'intro' });
    assert(!a2.body.days['2026-10-11'], 'Κυριακή κλειστή');
    delete db.data.appt.settings;
  });

  console.log(`\nΌλες οι δοκιμές πέρασαν (${ok}).`);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
