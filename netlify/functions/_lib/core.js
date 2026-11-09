// Κοινή λογική: ρυθμίσεις επιχείρησης, ώρες, ελεύθερα slots, επικαλύψεις.
// Όλες οι ώρες είναι «ώρα τοίχου» στη ζώνη της επιχείρησης (π.χ. Europe/Athens),
// αποθηκευμένες ως λεπτά από τα μεσάνυχτα (0–1440) και ημερομηνίες "YYYY-MM-DD".

// Η φόρτωση επιχείρησης (με τις ρυθμίσεις του admin) είναι στο settings.js.

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// Ό,τι βλέπει ο επισκέπτης (χωρίς email ιδιοκτήτη κ.λπ.)
function publicConfig(biz) {
  const { id, name, tagline, site, privacy, logo, icons, phone, theme, modes, services, maxDaysAhead, hours } = biz;
  return {
    id, name, tagline, site, privacy, logo, icons: icons || null, phone, theme, modes, maxDaysAhead, hours,
    services: services.filter(s => s.active !== false).map(s => ({
      id: s.id, name: s.name, desc: s.desc, price: s.price, duration: s.duration,
      modes: s.modes, approval: !!s.approval, extra: s.extra || null,
      staff: (biz.staff || []).filter(p => p.active !== false && (!Array.isArray(p.services) || p.services.includes(s.id))).map(p => p.id),
    })),
    staff: (biz.staff || []).filter(p => p.active !== false).map(p => ({ id: p.id, name: p.name })),
    askCompany: !!biz.askCompany,
  };
}

const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const fromMin = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

// Τρέχουσα ημερομηνία/ώρα στη ζώνη της επιχείρησης
function nowLocal(tz, nowMs = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(nowMs)).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayKey = dateStr => DAYS[(new Date(dateStr + 'T12:00:00Z').getUTCDay() + 6) % 7];
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);

// Διάστημα ραντεβού: core = το ίδιο το ραντεβού, pad = μαζί με χρόνο μετακίνησης/προετοιμασίας
function interval(service, startMin) {
  const s = startMin, e = startMin + service.duration;
  return { s, e, ps: s - (service.bufferBefore || 0), pe: e + (service.bufferAfter || 0) };
}
const overlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
// Σύγκρουση: το ένα ραντεβού δεν μπορεί να πέφτει πάνω στο άλλο ή στον χρόνο μετακίνησής του
function conflicts(c, x) {
  return overlap(c.s, c.e, x.ps, x.pe) || overlap(c.ps, c.pe, x.s, x.e);
}

// Ελεύθερες ώρες μιας ημέρας. dayEntries = { id: {s,e,ps,pe} } από τη βάση.
function slotsForDay(biz, service, dateStr, dayEntries, now) {
  const ranges = (biz.hours || {})[dayKey(dateStr)] || [];
  if (!ranges.length) return [];
  const today = now.date;
  if (dateStr < today) return [];
  if (daysBetween(today, dateStr) > (biz.maxDaysAhead || 60)) return [];
  // Νωρίτερη επιτρεπτή στιγμή = τώρα + ελάχιστη προειδοποίηση (μπορεί να πέφτει σε επόμενη μέρα)
  const total = now.min + (biz.minNoticeHours || 0) * 60;
  const earliest = { date: addDays(today, Math.floor(total / 1440)), min: total % 1440 };
  const step = biz.slotStep || 30;
  const busy = Object.values(dayEntries || {}).filter(x => x && typeof x.s === 'number');
  const out = [];
  for (const [o, c] of ranges) {
    for (let t = toMin(o); t + service.duration <= toMin(c); t += step) {
      if (dateStr < earliest.date || (dateStr === earliest.date && t < earliest.min)) continue;
      const cand = interval(service, t);
      if (busy.some(x => conflicts(cand, x))) continue;
      out.push(fromMin(t));
    }
  }
  return out;
}

// ---------- Προσωπικό (πολλά ημερολόγια) ----------
// Χωρίς προσωπικό στις ρυθμίσεις, η επιχείρηση έχει ένα «σιωπηλό» ημερολόγιο με id ''.
// Στη βάση κάθε διάστημα μιας ημέρας μπορεί να έχει st (το άτομο). Διάστημα χωρίς st (μπλοκάρισμα
// για όλους ή παλιό ραντεβού) πιάνει όλα τα ημερολόγια.
function staffList(biz) {
  const list = (biz.staff || []).filter(p => p && p.active !== false);
  return list.length ? list : [{ id: '', name: '', hours: null, services: null }];
}
const doesService = (p, svcId) => !Array.isArray(p.services) || p.services.includes(svcId);
// Ποια άτομα κάνουν την υπηρεσία (και, αν ζητήθηκε, μόνο το συγκεκριμένο)
function eligibleStaff(biz, svc, wanted) {
  const all = staffList(biz).filter(p => doesService(p, svc.id));
  if (!wanted) return all;
  return all.filter(p => p.id === wanted);
}
const entriesFor = (dayEntries, staffId) =>
  Object.fromEntries(Object.entries(dayEntries || {}).filter(([, x]) => x && (!staffId || !x.st || x.st === staffId)));
function staffSlots(biz, svc, dateStr, dayEntries, now, person) {
  const b = person.hours ? { ...biz, hours: person.hours } : biz;
  return slotsForDay(b, svc, dateStr, entriesFor(dayEntries, person.id), now);
}
// Ελεύθερες ώρες για ένα άτομο ή για «οποιονδήποτε» (ένωση)
function slotsForStaff(biz, svc, dateStr, dayEntries, now, people) {
  const set = new Set();
  people.forEach(p => staffSlots(biz, svc, dateStr, dayEntries, now, p).forEach(t => set.add(t)));
  return [...set].sort();
}

const str = (v, max) => (typeof v === 'string' ? v.trim() : '').slice(0, max);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = {
  DAYS, publicConfig, toMin, fromMin, nowLocal, addDays, dayKey, daysBetween,
  interval, conflicts, slotsForDay, str, esc,
  staffList, eligibleStaff, entriesFor, staffSlots, slotsForStaff,
};
