// Κλειδιά πρόσβασης: admin κάθε επιχείρησης και superadmin της πλατφόρμας.
const crypto = require('crypto');
const { sameToken } = require('./store');

const hashKey = k => crypto.createHash('sha256').update('appt-admin:' + String(k || '')).digest('hex');
const newKey = () => crypto.randomBytes(16).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Επιχειρήσεις από αρχείο -> μεταβλητή ADMIN_KEY_<ID>, επιχειρήσεις του superadmin -> hash στη βάση
function adminKeyOk(biz, key) {
  if (typeof key !== 'string' || key.length < 12) return false;
  const env = process.env['ADMIN_KEY_' + biz.id.toUpperCase().replace(/-/g, '_')];
  if (env && env.length >= 12) return sameToken(env, key);
  if (biz._keyHash) return sameToken(biz._keyHash, hashKey(key));
  return false;
}

// Superadmin: μεταβλητή SUPERADMIN_KEY στο Netlify (τουλάχιστον 16 χαρακτήρες)
function superKeyOk(key) {
  const env = process.env.SUPERADMIN_KEY || '';
  return env.length >= 16 && typeof key === 'string' && sameToken(env, key);
}

module.exports = { hashKey, newKey, sleep, adminKeyOk, superKeyOk };
