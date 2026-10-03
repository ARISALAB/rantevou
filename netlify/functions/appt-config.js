// GET /.netlify/functions/appt-config?b=arakron  -> δημόσιες ρυθμίσεις (υπηρεσίες, ώρες, εμφάνιση)
const { loadBusiness, publicConfig } = require('./_lib/core');
const { json, preflight } = require('./_lib/respond');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  const biz = loadBusiness((event.queryStringParameters || {}).b);
  if (!biz) return json(404, { error: 'not_found' });
  return json(200, publicConfig(biz));
};
