// Δικό του Firebase project (rantevou), Realtime Database. Τα στοιχεία σύνδεσης είναι στις μεταβλητές του Netlify.
// Όλα τα δεδομένα ζουν κάτω από τον κόμβο /appt.
const admin = require('firebase-admin');

let db = null;

function getDb() {
  if (db) return db;
  if (global.__APPT_TEST_DB__) return (db = global.__APPT_TEST_DB__);   // για τις δοκιμές
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  db = admin.database();
  return db;
}

module.exports = { getDb };
