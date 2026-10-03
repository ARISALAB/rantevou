// Emails μέσω Resend (ίδιο κλειδί με το TableReserve).
// EMAIL_FROM: π.χ. "AR Akron Services <rantevou@arakronservices.gr>" — το domain πρέπει να είναι επαληθευμένο στο Resend.
const { esc, fromMin } = require('./core');
const { siteUrl } = require('./respond');

const T = {
  el: {
    when: 'Πότε', how: 'Πώς', where: 'Πού', service: 'Υπηρεσία', notes: 'Σημειώσεις',
    hello: n => `Γεια σας ${n},`,
    confirmed: 'Το ραντεβού σας κλείστηκε.',
    pending: 'Λάβαμε το αίτημά σας. Θα επικοινωνήσουμε μαζί σας σύντομα για να το επιβεβαιώσουμε.',
    approved: 'Το ραντεβού σας επιβεβαιώθηκε.',
    cancelled: 'Το ραντεβού σας ακυρώθηκε.',
    subj: { confirmed: 'Επιβεβαίωση ραντεβού', pending: 'Λάβαμε το αίτημά σας', approved: 'Επιβεβαίωση ραντεβού', cancelled: 'Ακύρωση ραντεβού' },
    addCal: 'Προσθήκη στο Google Calendar',
    cancelQ: 'Δεν μπορείτε να έρθετε; Μπορείτε να ακυρώσετε εδώ:',
    cancelBtn: 'Ακύρωση ραντεβού',
    rebook: 'Κλείστε νέο ραντεβού',
    days: ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'],
    months: ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'],
  },
  en: {
    when: 'When', how: 'How', where: 'Where', service: 'Service', notes: 'Notes',
    hello: n => `Hello ${n},`,
    confirmed: 'Your appointment is booked.',
    pending: 'We received your request. We will contact you shortly to confirm it.',
    approved: 'Your appointment is confirmed.',
    cancelled: 'Your appointment has been cancelled.',
    subj: { confirmed: 'Appointment confirmed', pending: 'We received your request', approved: 'Appointment confirmed', cancelled: 'Appointment cancelled' },
    addCal: 'Add to Google Calendar',
    cancelQ: "Can't make it? You can cancel here:",
    cancelBtn: 'Cancel appointment',
    rebook: 'Book a new appointment',
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  },
};

function niceDate(dateStr, lang) {
  const t = T[lang], d = new Date(dateStr + 'T12:00:00Z');
  return `${t.days[d.getUTCDay()]} ${d.getUTCDate()} ${t.months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const stamp = (date, min) => date.replace(/-/g, '') + 'T' + fromMin(min).replace(':', '') + '00';

function calendarLink(biz, svc, b, lang) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${svc.name[lang]} – ${biz.name}`,
    dates: `${stamp(b.date, b.s)}/${stamp(b.date, b.e)}`,
    ctz: biz.timezone,
    details: `${biz.name} · ${biz.phone || ''}`,
    location: b.mode === 'onsite' ? (b.address || '') : biz.modes[b.mode][lang],
  });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}

function ics(biz, svc, b, lang, cancelled) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//rantevou//EN', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${b.id}@rantevou`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=${biz.timezone}:${stamp(b.date, b.s)}`, `DTEND;TZID=${biz.timezone}:${stamp(b.date, b.e)}`,
    `SUMMARY:${svc.name[lang]} – ${biz.name}`.replace(/[,;]/g, ' '),
    `LOCATION:${(b.mode === 'onsite' ? b.address || '' : biz.modes[b.mode][lang]).replace(/[,;]/g, ' ')}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

function shell(biz, inner) {
  const gold = (biz.theme && biz.theme.accent) || '#c9a24a';
  return `<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#1b1b1b">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0b0b0c;padding:22px 28px;color:#fff;font-size:18px;font-weight:bold;border-bottom:3px solid ${gold}">${esc(biz.name)}</td></tr>
<tr><td style="padding:28px">${inner}</td></tr>
<tr><td style="padding:16px 28px;background:#faf8f4;color:#777;font-size:12px">${esc(biz.name)} · ${esc(biz.phone || '')} · <a href="${esc(biz.site || '')}" style="color:#777">${esc((biz.site || '').replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></td></tr>
</table></td></tr></table></body></html>`;
}

function detailsTable(biz, svc, b, lang, forOwner) {
  const t = T[lang];
  const row = (k, v) => v ? `<tr><td style="padding:6px 12px 6px 0;color:#777;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:6px 0;font-weight:bold">${v}</td></tr>` : '';
  return `<table cellpadding="0" cellspacing="0" style="margin:18px 0;font-size:15px">
${row(t.service, esc(svc.name[lang]))}
${row(t.when, `${niceDate(b.date, lang)}, ${fromMin(b.s)}–${fromMin(b.e)}`)}
${row(t.how, forOwner && b.mode === 'onsite' ? 'Στο κατάστημα του πελάτη' : esc(biz.modes[b.mode][lang]))}
${b.mode === 'onsite' ? row(t.where, esc(b.address)) : ''}
${b.extra && svc.extra ? row(esc(svc.extra.label[lang]), esc(b.extra)) : ''}
</table>`;
}

const btn = (href, label, gold) =>
  `<a href="${href}" style="display:inline-block;background:${gold};color:#111;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:8px;margin:4px 6px 4px 0">${label}</a>`;

async function send(msg) {
  if (global.__APPT_TEST_DB__) { (global.__APPT_SENT__ = global.__APPT_SENT__ || []).push(msg); return; }
  if (!process.env.RESEND_API_KEY) { console.warn('[appt] RESEND_API_KEY λείπει, email δεν στάλθηκε:', msg.subject); return; }
  const { Resend } = require('resend');
  const r = await new Resend(process.env.RESEND_API_KEY).emails.send(msg);
  if (r && r.error) console.error('[appt] resend error', r.error);
}
const from = biz => process.env.EMAIL_FROM || `${biz.name} <noreply@tablereserve.gr>`;
const ownerTo = biz => process.env.OWNER_EMAIL || biz.ownerEmail;

// kind: confirmed | pending | approved | cancelled
async function toCustomer(kind, biz, svc, b) {
  const lang = b.lang === 'en' ? 'en' : 'el', t = T[lang];
  const gold = (biz.theme && biz.theme.accent) || '#c9a24a';
  const cancelUrl = `${siteUrl()}/cancel.html?b=${biz.id}&id=${b.id}&t=${b.token}&lang=${lang}`;
  const live = kind !== 'cancelled';
  const inner = `<p style="margin:0 0 6px">${t.hello(esc(b.name))}</p>
<p style="margin:0;font-size:17px;font-weight:bold">${t[kind]}</p>
${detailsTable(biz, svc, b, lang)}
${live && kind !== 'pending' ? btn(calendarLink(biz, svc, b, lang), t.addCal, gold) : ''}
${live ? `<p style="margin:22px 0 6px;color:#555;font-size:14px">${t.cancelQ}</p>${btn(cancelUrl, t.cancelBtn, '#e9e5dc')}` : btn(`${siteUrl()}/${biz.id}?lang=${lang}`, t.rebook, gold)}`;
  const msg = {
    from: from(biz), to: b.email, reply_to: ownerTo(biz),
    subject: `${t.subj[kind]} · ${biz.name} · ${niceDate(b.date, lang)} ${fromMin(b.s)}`,
    html: shell(biz, inner),
  };
  if (kind === 'confirmed' || kind === 'approved') {
    msg.attachments = [{ filename: 'rantevou.ics', content: Buffer.from(ics(biz, svc, b, lang, kind === 'cancelled')).toString('base64') }];
  }
  return send(msg);
}

// kind: new | cancelled
async function toOwner(kind, biz, svc, b) {
  const gold = (biz.theme && biz.theme.accent) || '#c9a24a';
  const status = b.status === 'pending' ? ' (θέλει επιβεβαίωση)' : '';
  const head = kind === 'new' ? `Νέο ραντεβού${status}` : 'Ο πελάτης ακύρωσε ραντεβού';
  const contact = `<p style="margin:0;font-size:15px;line-height:1.6"><b>${esc(b.name)}</b>${b.company ? ' · ' + esc(b.company) : ''}<br>
<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a> · <a href="mailto:${esc(b.email)}">${esc(b.email)}</a></p>
${b.notes ? `<p style="margin:14px 0 0;padding:12px;background:#faf8f4;border-radius:8px;font-size:14px">${esc(b.notes)}</p>` : ''}`;
  const inner = `<p style="margin:0 0 4px;font-size:18px;font-weight:bold">${head}</p>
${detailsTable(biz, svc, b, 'el', true)}${contact}
<p style="margin-top:22px">${btn(`${siteUrl()}/admin.html?b=${biz.id}`, 'Άνοιγμα διαχείρισης', gold)}</p>`;
  const msg = {
    from: from(biz), to: ownerTo(biz), reply_to: b.email,
    subject: `${kind === 'new' ? '🗓️ ' : '❌ '}${head}: ${svc.name.el} · ${niceDate(b.date, 'el')} ${fromMin(b.s)} · ${b.name}`,
    html: shell(biz, inner),
  };
  if (kind === 'new' && b.status === 'confirmed') {
    msg.attachments = [{ filename: 'rantevou.ics', content: Buffer.from(ics(biz, svc, b, 'el', false)).toString('base64') }];
  }
  return send(msg);
}

module.exports = { toCustomer, toOwner, niceDate, calendarLink };
