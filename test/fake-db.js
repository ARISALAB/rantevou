// Ελάχιστη μίμηση του Firebase Realtime Database (admin SDK) για τοπικές δοκιμές.
class Snap {
  constructor(v) { this.v = v === undefined ? null : JSON.parse(JSON.stringify(v)); }
  val() { return this.v; }
  exists() { return this.v !== null; }
}
class FakeDb {
  constructor() { this.data = {}; }
  ref(p) { return new Ref(this, p.split('/').filter(Boolean)); }
  _get(parts) { let n = this.data; for (const k of parts) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : n; }
  _set(parts, v) {
    if (!parts.length) { this.data = v || {}; return; }
    let n = this.data;
    for (const k of parts.slice(0, -1)) { if (typeof n[k] !== 'object' || n[k] === null) n[k] = {}; n = n[k]; }
    const last = parts[parts.length - 1];
    if (v === null || v === undefined) delete n[last]; else n[last] = JSON.parse(JSON.stringify(v));
  }
}
class Ref {
  constructor(db, parts, q = {}) { this.db = db; this.parts = parts; this.q = q; }
  child(k) { return new Ref(this.db, [...this.parts, ...String(k).split('/')]); }
  async get() {
    let v = this.db._get(this.parts);
    if (v && (this.q.startAt !== undefined || this.q.endAt !== undefined)) {
      v = Object.fromEntries(Object.entries(v).filter(([k]) =>
        (this.q.startAt === undefined || k >= this.q.startAt) && (this.q.endAt === undefined || k <= this.q.endAt)));
    }
    return new Snap(v);
  }
  orderByKey() { return this; }
  startAt(x) { return new Ref(this.db, this.parts, { ...this.q, startAt: x }); }
  endAt(x) { return new Ref(this.db, this.parts, { ...this.q, endAt: x }); }
  async set(v) { this.db._set(this.parts, v); }
  async update(v) { const cur = this.db._get(this.parts) || {}; this.db._set(this.parts, { ...cur, ...v }); }
  async remove() { this.db._set(this.parts, null); }
  async transaction(fn) {
    const cur = this.db._get(this.parts);
    const next = fn(cur === null ? null : JSON.parse(JSON.stringify(cur)));
    if (next === undefined) return { committed: false, snapshot: new Snap(cur) };
    this.db._set(this.parts, next);
    return { committed: true, snapshot: new Snap(next) };
  }
}
module.exports = { FakeDb };
