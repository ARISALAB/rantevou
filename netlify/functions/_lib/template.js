// Αρχική εικόνα κάθε νέας επιχείρησης (από το superadmin ή το tools/new-business.js).
// Όλα αλλάζουν μετά από το admin → Ρυθμίσεις.
const RESERVED = ['admin', 'superadmin', 'landing', 'index', 'cancel', 'robots', 'sitemap', 'favicon', 'icons',
  'apple-touch-icon', 'netlify', 'api', 'www', 'app', 'help', 'login', 'signup'];
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const validId = id => typeof id === 'string' && id.length >= 2 && id.length <= 40 && ID_RE.test(id) && !RESERVED.includes(id);

// «Κομμωτήριο Μαρία» -> «kommotirio-maria»
const GR = { α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o' };
function slugify(name) {
  let s = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/ου/g, 'ou').replace(/αι/g, 'ai').replace(/ει/g, 'ei').replace(/οι/g, 'oi').replace(/μπ/g, 'b').replace(/ντ/g, 'nt').replace(/γκ/g, 'gk');
  s = s.replace(/[α-ω]/g, c => GR[c] || '');
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

function newBusinessBase(id, name, email, siteUrl) {
  const weekday = [['09:00', '17:00']];
  return {
    id, name,
    tagline: { el: '', en: '' },
    site: `${siteUrl}/${id}`,
    privacy: { el: 'https://www.arakronservices.gr/privacy', en: 'https://www.arakronservices.gr/en/privacy' },
    logo: '', phone: '', ownerEmail: String(email).toLowerCase(), address: '',
    timezone: 'Europe/Athens',
    theme: { mode: 'light', accent: '#2a3dd1' },
    hours: { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: [], sun: [] },
    slotStep: 30, minNoticeHours: 2, maxDaysAhead: 60,
    modes: {
      inshop: { el: 'Στον χώρο μας', en: 'At our place' },
      online: { el: 'Online (βιντεοκλήση)', en: 'Online (video call)' },
      phone: { el: 'Τηλεφωνικά', en: 'By phone' },
      onsite: { el: 'Στον δικό σας χώρο', en: 'At your place' },
    },
    services: [{
      id: 'rantevou', name: { el: 'Ραντεβού', en: 'Appointment' }, desc: { el: '', en: '' }, price: null,
      duration: 30, bufferBefore: 0, bufferAfter: 0, modes: ['inshop'], approval: false,
    }],
  };
}

module.exports = { RESERVED, validId, slugify, newBusinessBase };
