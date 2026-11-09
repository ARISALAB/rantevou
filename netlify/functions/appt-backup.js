// Ημερήσιο αντίγραφο ασφαλείας: όλη η βάση των ραντεβού (εκτός από τα όρια ανά IP) σε αρχείο .json.gz,
// με email στο BACKUP_EMAIL (αλλιώς LEADS_EMAIL, αλλιώς info@arakronservices.gr).
// Τρέχει αυτόματα κάθε βράδυ (netlify.toml → schedule). Περιέχει προσωπικά δεδομένα: κρατήστε τα emails σε ασφαλές inbox.
const zlib = require('zlib');
const { getDb } = require('./_lib/firebase');
const emails = require('./_lib/emails');

async function snapshot() {
  const data = (await getDb().ref('appt').get()).val() || {};
  delete data.rate;
  const count = o => Object.values(o || {}).reduce((n, x) => n + Object.keys(x || {}).length, 0);
  return { data, stats: { businesses: Object.keys({ ...(data.biz || {}), ...(data.settings || {}) }).length, bookings: count(data.bookings), leads: Object.keys(data.leads || {}).length } };
}

async function run() {
  const { data, stats } = await snapshot();
  const day = new Date().toISOString().slice(0, 10);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), appt: data })));
  await emails.backupToPlatform(process.env.BACKUP_EMAIL || process.env.LEADS_EMAIL || 'info@arakronservices.gr', day, gz, stats);
  return { day, bytes: gz.length, ...stats };
}

exports.handler = async () => {
  try {
    const r = await run();
    console.log('[appt-backup]', r);
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (err) {
    console.error('[appt-backup]', err);
    return { statusCode: 500, body: '{}' };
  }
};
exports.run = run;
exports.snapshot = snapshot;
