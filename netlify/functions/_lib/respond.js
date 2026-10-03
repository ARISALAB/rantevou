const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const preflight = () => ({ statusCode: 204, headers: HEADERS, body: '' });

function parseBody(event) {
  try { return JSON.parse(event.body || '{}'); } catch (e) { return null; }
}

// Βάση για links στα emails (το Netlify δίνει αυτόματα το URL του site)
const siteUrl = () => (process.env.SITE_URL || process.env.URL || 'http://localhost:8888').replace(/\/$/, '');

module.exports = { json, preflight, parseBody, siteUrl };
