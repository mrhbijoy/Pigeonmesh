/* PigeonMesh -- application logic.
 *
 * The whole app is one offline-first replica of the mesh's record log.
 * Nothing is "fetched on demand": every record the phone has ever seen is
 * kept locally, so the app is fully usable with the router switched off,
 * and so the phone can hand records to the next node it meets.
 *
 * The sync model has three parts, in order of latency:
 *
 *   1. Server-Sent Events  -- a record posted anywhere in the mesh appears
 *                             here within a poll tick.
 *   2. Sequence catch-up   -- on connect, pull everything past our last
 *                             known local sequence for that node.
 *   3. Bloom reconciliation -- every 20 s, exchange summaries so that records
 *                             we hold and the node does not (because we
 *                             carried them from somewhere else) flow uphill.
 *
 * Step 3 is what makes a person a data mule without them doing anything.
 */

'use strict';

/* ------------------------------------------------------------------ state */

const S = {
  identity: null,
  records: new Map(),      // id -> record
  seqByNode: {},           // node id -> last local sequence we pulled
  node: null,              // whatever node we are currently attached to
  peers: [],
  topology: [],
  online: false,
  es: null,                // EventSource
  view: 'chat',
  channel: 'public',
  peopleTab: 'safe',
  verifyCache: new Map(),  // record id -> boolean
  outbox: [],              // records composed while offline
  carry: localStorage.getItem('pm_carry') !== '0',
  mapCentre: null,
  mapZoom: 15,
  pendingPin: null,
  photoData: null,
  sosNeed: 'rescue',
  carriedThisSession: 0,
};

const API = ''; // same origin as the page

/* ---------------------------------------------------------------- storage
 *
 * IndexedDB rather than localStorage: a missing-person report carries a
 * thumbnail, map tiles are binary, and localStorage's ~5 MB ceiling is both
 * small and synchronous. Three stores: records keyed by record id, tiles
 * keyed by "z/x/y", and a scratch store for sync bookkeeping.
 */

const DB = (() => {
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('pigeonmesh', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('records')) {
          db.createObjectStore('records', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
        if (!db.objectStoreNames.contains('tiles')) {
          db.createObjectStore('tiles');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      try { out = fn(s); } catch (e) { reject(e); return; }
      // fn either returns an IDBRequest or nothing. Unwrap a request by
      // reading .result, and decide that by whether it *is* a request rather
      // than by whether the result is undefined: a miss has an undefined
      // result, and handing back the request object instead makes every miss
      // look like a hit to the caller.
      t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => reject(t.error);
    });
  }

  return {
    putRecords: (recs) => tx('records', 'readwrite', (s) => { recs.forEach((r) => s.put(r)); }),
    allRecords: () => tx('records', 'readonly', (s) => s.getAll()),
    deleteAll: async () => {
      await tx('records', 'readwrite', (s) => s.clear());
      await tx('meta', 'readwrite', (s) => s.clear());
      // Which areas someone downloaded a map for says where they have been
      // or where they were going. A wipe that leaves that behind is not one.
      await tx('tiles', 'readwrite', (s) => s.clear());
    },
    setMeta: (k, v) => tx('meta', 'readwrite', (s) => s.put(v, k)),
    getMeta: (k) => tx('meta', 'readonly', (s) => s.get(k)),
    putTile: (k, blob) => tx('tiles', 'readwrite', (s) => { s.put(blob, k); }),
    getTile: (k) => tx('tiles', 'readonly', (s) => s.get(k)),
    countTiles: () => tx('tiles', 'readonly', (s) => s.count()),
  };
})();

/* -------------------------------------------------------------- utilities */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function nowSec() { return Math.floor(Date.now() / 1000); }

function timeAgo(ts) {
  const d = nowSec() - ts;
  if (d < 60) return t('now');
  if (d < 3600) return num(Math.floor(d / 60)) + ' ' + t('ago_m');
  if (d < 86400) return num(Math.floor(d / 3600)) + ' ' + t('ago_h');
  return num(Math.floor(d / 86400)) + ' ' + t('ago_d');
}

// Numbers and their units both go through the language, so a Bangla screen
// never reads "১২০ m". Everything user-facing formats through these.
function distance(m) {
  return m >= 1000
    ? num((m / 1000).toFixed(m >= 10000 ? 0 : 1)) + ' ' + t('unit_km')
    : num(Math.round(m)) + ' ' + t('unit_m');
}

function bytesShort(b) {
  return b >= 1048576
    ? num((b / 1048576).toFixed(1)) + ' ' + t('unit_mb')
    : num(Math.round(b / 1024)) + ' ' + t('unit_kb');
}

let toastTimer = null;
function toast(msg, kind) {
  const el0 = $('#toast');
  el0.textContent = msg;
  el0.className = 'toast' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el0.classList.add('hidden'), 3200);
}

function buzz(pattern) {
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* ignore */ } }
}

/* ---------------------------------------------------------------- records */

function verified(rec) {
  if (S.verifyCache.has(rec.id)) return S.verifyCache.get(rec.id);
  // Records injected by a router via the CLI are unsigned on purpose: the
  // router cannot prove who typed the command, only which node it came from.
  const v = rec.sig ? PM.verifyRecord(rec) : null;
  S.verifyCache.set(rec.id, v);
  return v;
}

function addRecords(list, opts = {}) {
  let fresh = 0;
  const toStore = [];
  for (const r of list) {
    if (!r || !r.id || S.records.has(r.id)) continue;
    S.records.set(r.id, r);
    toStore.push(r);
    fresh++;
    if (r.kind === 'sos' && !opts.silent && nowSec() - r.ts < 300) alertSOS(r);
  }
  if (toStore.length) DB.putRecords(toStore).catch(() => {});
  if (fresh) render();
  return fresh;
}

function byKind(kind, chan) {
  const out = [];
  for (const r of S.records.values()) {
    if (r.kind !== kind) continue;
    if (chan && r.chan !== chan) continue;
    out.push(r);
  }
  out.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  return out;
}

// Later records of kind `k` that reference an earlier record id, e.g. an
// SOS response or a "found" marker. Keeps the log append-only: nothing is
// ever edited, only annotated, which is what makes replication trivial.
function annotations(targetId, kind) {
  const out = [];
  for (const r of S.records.values()) {
    if (r.kind === kind && r.body && r.body.ref === targetId) out.push(r);
  }
  return out;
}

async function publish(kind, body, opts = {}) {
  const rec = {
    id: PM.newRecordId(),
    kind,
    ts: nowSec(),
    chan: opts.chan || (kind === 'sos' ? 'sos' : 'public'),
    nick: S.identity.nick,
    body,
  };
  PM.signRecord(rec, S.identity);

  // Show it immediately, mark it pending until a node has taken it. A person
  // who has just pressed SOS must see that something happened.
  rec._pending = true;
  S.records.set(rec.id, rec);
  DB.putRecords([rec]).catch(() => {});
  render();

  const ok = await pushRecords([rec]);
  if (ok) {
    delete rec._pending;
    render();
  } else {
    S.outbox.push(rec.id);
  }
  return rec;
}

async function pushRecords(recs) {
  try {
    const res = await fetch(API + '/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: recs.map(stripLocal) }),
    });
    if (!res.ok) return false;
    const j = await res.json();
    return Array.isArray(j.accepted);
  } catch (e) {
    return false;
  }
}

function stripLocal(r) {
  const c = {};
  for (const k of ['id', 'kind', 'ts', 'exp', 'chan', 'nick', 'author', 'pk', 'sig', 'body']) {
    if (r[k] !== undefined) c[k] = r[k];
  }
  return c;
}

/* ----------------------------------------------------------------- bloom
 *
 * Must match store.lua byte for byte: FNV-1a with two seeds, k probes via
 * Kirsch-Mitzenmacher, a byte array serialised as lowercase hex.
 */

function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function bloomBuild(ids) {
  let bits = 1024;
  while (bits < ids.length * 10 && bits < 65536) bits *= 2;
  const k = 6;
  const bytes = new Uint8Array(bits / 8);
  for (const id of ids) {
    const h1 = fnv1a(id, 2166136261);
    let h2 = fnv1a(id, 40389);
    if (h2 % 2 === 0) h2 += 1;
    for (let i = 0; i < k; i++) {
      // Mirror Lua's exact double arithmetic rather than 32-bit wrapping:
      // (h1 + i*h2) is computed as a plain number on both sides.
      const pos = (h1 + i * h2) % bits;
      bytes[Math.floor(pos / 8)] |= 1 << (pos % 8);
    }
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return { bits, k, data: hex };
}

/* ------------------------------------------------------------------ sync */

function setLink(state, detail) {
  S.online = state === 'on';
  const pill = $('#link-pill');
  pill.className = 'pill ' + state;
  $('#link-text').textContent = detail
    || (state === 'on' ? t('connected') : state === 'carry' ? t('carrying') : t('offline'));
}

async function catchUp() {
  if (!S.node) return;
  const since = S.seqByNode[S.node.node] || 0;
  try {
    const res = await fetch(`${API}/api/records?since=${since}&limit=500`);
    if (!res.ok) return;
    const j = await res.json();
    addRecords(j.records || [], { silent: since === 0 });
    S.seqByNode[S.node.node] = j.seq || since;
    DB.setMeta('seq', S.seqByNode).catch(() => {});
  } catch (e) { /* stay offline */ }
}

// The reconciliation that turns a phone into a carrier. We tell the node
// what we hold, hand over anything it is missing, and take back anything we
// are missing. Runs whenever we are attached to any node.
async function reconcile() {
  if (!S.carry) return;
  const ids = Array.from(S.records.keys());
  const digest = bloomBuild(ids);

  // Records this node has never acknowledged. On a first meeting with a node
  // that is a whole island's worth of history; cap it so a weak link is not
  // saturated in one request.
  const give = [];
  const knownHere = S.nodeDigest;
  for (const r of S.records.values()) {
    if (r._pending) { give.push(stripLocal(r)); continue; }
    if (knownHere && !bloomContains(knownHere, r.id)) give.push(stripLocal(r));
    if (give.length >= 48) break;
  }

  try {
    const res = await fetch(API + '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ digest, records: give, max_count: 128 }),
    });
    if (!res.ok) return;
    const j = await res.json();
    S.nodeDigest = j.digest;

    if (j.took > 0) {
      S.carriedThisSession += j.took;
      toast(`${t('carrying')}: ${num(j.took)}`);
    }
    // Anything we handed over successfully is no longer pending.
    if (j.took > 0 || give.length) {
      for (const g of give) {
        const r = S.records.get(g.id);
        if (r && r._pending) delete r._pending;
      }
      S.outbox = [];
    }
    const fresh = addRecords(j.records || []);
    if (fresh) render();
  } catch (e) { /* offline; try again next tick */ }
}

function bloomContains(bloom, id) {
  if (!bloom || typeof bloom.data !== 'string') return false;
  const bits = bloom.bits, k = bloom.k;
  if (bloom.data.length !== bits / 4) return false;
  const h1 = fnv1a(id, 2166136261);
  let h2 = fnv1a(id, 40389);
  if (h2 % 2 === 0) h2 += 1;
  for (let i = 0; i < k; i++) {
    const pos = (h1 + i * h2) % bits;
    const byte = parseInt(bloom.data.substr(Math.floor(pos / 8) * 2, 2), 16);
    if (!(byte & (1 << (pos % 8)))) return false;
  }
  return true;
}

function openStream() {
  if (S.es) { S.es.close(); S.es = null; }
  try {
    const es = new EventSource(API + '/api/stream');
    S.es = es;
    es.onopen = () => { setLink('on'); refreshState(); };
    es.addEventListener('rec', (ev) => {
      try { addRecords([JSON.parse(ev.data)]); } catch (e) { /* ignore */ }
    });
    es.addEventListener('state', () => refreshState());
    es.addEventListener('peers', () => refreshState());
    es.onerror = () => {
      // EventSource retries on its own; reflect the gap in the UI and fall
      // back to carrying mode so the user knows the phone is still useful.
      setLink(S.records.size ? 'carry' : 'off');
    };
  } catch (e) {
    setLink('off');
  }
}

async function refreshState() {
  try {
    const res = await fetch(API + '/api/state');
    if (!res.ok) throw new Error('bad');
    const j = await res.json();
    const firstContact = !S.node || S.node.node !== j.node.node;
    S.node = j.node;
    S.peers = j.peers || [];
    S.meshStats = j.mesh || {};
    S.storeStats = j.store || {};
    setLink('on');
    $('#clock-warn').classList.toggle('hidden', !j.node.clock_derived);
    if (firstContact) {
      // A different node than last time: pull its whole log, then reconcile
      // so it gets everything we carried here.
      S.seqByNode[j.node.node] = S.seqByNode[j.node.node] || 0;
      await catchUp();
      await reconcile();
    }
    fetch(API + '/api/topology').then((r) => r.json()).then((tp) => {
      S.topology = tp.nodes || [];
      if (S.view === 'mesh') render();
    }).catch(() => {});
    render();
  } catch (e) {
    setLink(S.records.size ? 'carry' : 'off');
  }
}

/* ---------------------------------------------------------------- alerts */

function alertSOS(rec) {
  const b = $('#sos-banner');
  const txt = (rec.body && rec.body.text) || t('sos_title');
  b.textContent = `${rec.nick || '?'}: ${txt}`;
  b.classList.remove('hidden');
  buzz([220, 90, 220, 90, 420]);
  toast(t('sos_title') + ': ' + txt, 'sos');
  setTimeout(() => b.classList.add('hidden'), 20000);
}

/* -------------------------------------------------------------- rendering */

function render() {
  if (!S.identity) return;
  renderBadges();
  switch (S.view) {
    case 'chat': renderChat(); break;
    case 'sos': renderSOS(); break;
    case 'people': renderPeople(); break;
    case 'map': renderMap(); break;
    case 'mesh': renderMesh(); break;
  }
}

function renderBadges() {
  const active = byKind('sos').filter((r) =>
    nowSec() - r.ts < 86400 && annotations(r.id, 'ack').every((a) => a.body.state !== 'resolved'));
  const badge = $('#sos-badge');
  badge.textContent = num(active.length);
  badge.classList.toggle('hidden', active.length === 0);
}

function authorBadge(rec) {
  const v = verified(rec);
  const s = el('span', 'vbadge ' + (v === null ? 'node' : v ? 'ok' : 'bad'));
  s.textContent = v === null ? t('from_node') : v ? t('verified') : t('unverified');
  s.title = v === null ? '' : v ? t('trust_note') : t('untrusted_note');
  return s;
}

/* chat ------------------------------------------------------------------ */

function renderChannels() {
  const strip = $('#chan-strip');
  strip.innerHTML = '';
  for (const c of ['public', 'relief', 'medical']) {
    const b = el('button', 'chip' + (S.channel === c ? ' on' : ''), t('ch_' + c));
    b.onclick = () => { S.channel = c; render(); };
    strip.appendChild(b);
  }
}

function renderChat() {
  renderChannels();
  const list = $('#chat-list');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
  list.innerHTML = '';

  const msgs = byKind('chat', S.channel);
  if (!msgs.length) {
    list.appendChild(el('div', 'empty', t('no_messages')));
    return;
  }
  for (const m of msgs) {
    const mine = m.author === S.identity.fp;
    const wrap = el('div', 'msg' + (mine ? ' mine' : '') + (m._pending ? ' pending' : ''));
    const head = el('div', 'msg-head');
    head.appendChild(el('span', '', m.nick || '?'));
    head.appendChild(authorBadge(m));
    head.appendChild(el('span', 'muted', timeAgo(m.ts)));
    if (m._pending) head.appendChild(el('span', 'muted', '· ' + t('queued')));
    wrap.appendChild(head);
    wrap.appendChild(el('div', 'msg-body', (m.body && m.body.text) || ''));
    list.appendChild(wrap);
  }
  if (atBottom) list.scrollTop = list.scrollHeight;
}

/* sos ------------------------------------------------------------------- */

function renderSOS() {
  const holder = $('#sos-list');
  holder.innerHTML = '';
  const alerts = byKind('sos').reverse();
  if (!alerts.length) {
    holder.appendChild(el('div', 'empty', t('sos_none')));
    return;
  }
  for (const a of alerts) {
    const acks = annotations(a.id, 'ack');
    const isResolved = acks.some((x) => x.body.state === 'resolved');
    const responders = acks.filter((x) => x.body.state === 'responding');

    const card = el('div', 'alert' + (isResolved ? ' resolved' : ''));
    card.appendChild(el('h3', '', (a.body && a.body.text) || t('sos_title')));

    const meta = el('div', 'meta');
    meta.appendChild(el('span', '', a.nick || '?'));
    meta.appendChild(authorBadge(a));
    meta.appendChild(el('span', '', timeAgo(a.ts)));
    if (a.body && a.body.need) meta.appendChild(el('span', '', t('need_' + a.body.need) || a.body.need));
    if (a.body && a.body.lat) {
      const g = el('span', '', `${a.body.lat.toFixed(4)}, ${a.body.lon.toFixed(4)}`);
      meta.appendChild(g);
    }
    if (responders.length) {
      meta.appendChild(el('span', 'tagline-safe',
        `${num(responders.length)} ${t('responders')}`));
    }
    if (isResolved) meta.appendChild(el('span', 'tagline-safe', t('resolved')));
    card.appendChild(meta);

    if (!isResolved) {
      const acts = el('div', 'acts');
      const mineAck = responders.some((x) => x.author === S.identity.fp);
      const rb = el('button', 'btn btn-sm' + (mineAck ? '' : ' btn-primary'), t('respond'));
      rb.disabled = mineAck;
      rb.onclick = () => {
        publish('ack', { ref: a.id, state: 'responding' }, { chan: 'sos' });
        buzz(40);
      };
      acts.appendChild(rb);

      const done = el('button', 'btn btn-sm', t('resolve'));
      done.onclick = () => publish('ack', { ref: a.id, state: 'resolved' }, { chan: 'sos' });
      acts.appendChild(done);
      card.appendChild(acts);
    }
    holder.appendChild(card);
  }
}

/* people ---------------------------------------------------------------- */

function renderPeople() {
  $('#pane-safe').classList.toggle('hidden', S.peopleTab !== 'safe');
  $('#pane-missing').classList.toggle('hidden', S.peopleTab !== 'missing');

  const ci = $('#checkin-list');
  ci.innerHTML = '';
  const checkins = byKind('checkin').reverse();
  if (!checkins.length) ci.appendChild(el('div', 'empty', t('no_checkins')));
  for (const c of checkins) {
    const row = el('div', 'person');
    const av = el('div', 'avatar', (c.nick || '?').slice(0, 1).toUpperCase());
    row.appendChild(av);
    const info = el('div', 'info');
    info.appendChild(el('h4', '', c.nick || '?'));
    const p = el('p');
    p.textContent = (c.body && c.body.where) || '';
    info.appendChild(p);
    const line = el('p');
    line.appendChild(el('span', 'tagline-safe', t('im_safe')));
    line.appendChild(document.createTextNode(' · ' + timeAgo(c.ts) + ' '));
    line.appendChild(authorBadge(c));
    info.appendChild(line);
    row.appendChild(info);
    ci.appendChild(row);
  }

  const ml = $('#missing-list');
  ml.innerHTML = '';
  const q = ($('#mp-search').value || '').trim().toLowerCase();
  let missing = byKind('missing').reverse();
  if (q) missing = missing.filter((m) => ((m.body && m.body.name) || '').toLowerCase().includes(q));
  if (!missing.length) ml.appendChild(el('div', 'empty', t('no_missing')));
  for (const m of missing) {
    const isFound = annotations(m.id, 'ack').some((x) => x.body.state === 'found');
    const row = el('div', 'person');
    if (m.body && m.body.photo) {
      const img = new Image();
      img.src = m.body.photo;
      img.alt = '';
      row.appendChild(img);
    } else {
      row.appendChild(el('div', 'avatar', '?'));
    }
    const info = el('div', 'info');
    const h = el('h4', '', (m.body && m.body.name) || '?');
    info.appendChild(h);
    if (m.body && m.body.age) info.appendChild(el('p', '', t('missing_age') + ': ' + num(m.body.age)));
    if (m.body && m.body.desc) info.appendChild(el('p', '', m.body.desc));
    if (m.body && m.body.contact) info.appendChild(el('p', '', m.body.contact));
    const foot = el('p');
    foot.appendChild(document.createTextNode(timeAgo(m.ts) + ' '));
    foot.appendChild(authorBadge(m));
    info.appendChild(foot);
    if (isFound) {
      info.appendChild(el('p', 'tagline-safe', t('found')));
    } else {
      const b = el('button', 'btn btn-sm mt', t('mark_found'));
      b.onclick = () => publish('ack', { ref: m.id, state: 'found' });
      info.appendChild(b);
    }
    row.appendChild(info);
    ml.appendChild(row);
  }
}

/* map -------------------------------------------------------------------
 *
 * Two layers, in order of preference.
 *
 *   1. Real OpenStreetMap tiles. A phone often still has mobile data when
 *      the router's uplink is gone, so tiles are fetched when they can be
 *      and kept in IndexedDB, which means a map looked at once stays usable
 *      after the data stops. "Save this area" pulls the surrounding tiles
 *      deliberately -- the thing to do before walking somewhere with no
 *      signal.
 *
 *   2. A metric grid. Nothing cached and no network: fall back to drawing
 *      relative geography with a scale bar. Less useful than a map, far
 *      more useful than a blank rectangle.
 *
 * There is no map library. The whole point is that a 6 MB router serves
 * this and a phone runs it with the radio off, so it is one canvas, the
 * standard slippy-map projection, and about two hundred lines.
 */

const PIN_KINDS = {
  shelter: '#4d8bff', water: '#22d3ee', medical: '#f472b6',
  food: '#facc15', danger: '#ff3b47', blocked: '#fb923c', boat: '#a78bfa',
};

const TILE_PX = 256;
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MIN_ZOOM = 3, MAX_ZOOM = 18;

// Where the map opens when there is nothing else to go on: no pins, no GPS.
// Somewhere is a better starting point than nowhere, because a map you can
// drag is a map you can use; a blank one is not.
const HOME = { lat: 23.8103, lon: 90.4125 };

/* Web Mercator, in tile units. One unit = one tile at that zoom. */
function lonToX(lon, z) { return ((lon + 180) / 360) * Math.pow(2, z); }
function latToY(lat, z) {
  const r = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
}
function xToLon(x, z) { return (x / Math.pow(2, z)) * 360 - 180; }
function yToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function metresPerPixel(lat, z) {
  return (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, z);
}

const Tiles = (() => {
  const mem = new Map();      // "z/x/y" -> decoded image
  const inflight = new Set();
  const failed = new Map();   // key -> when it failed, so it can be retried
  const RETRY_MS = 30000;
  let redrawTimer = null;

  const key = (z, x, y) => z + '/' + x + '/' + y;

  function scheduleRedraw() {
    if (redrawTimer) return;
    redrawTimer = setTimeout(() => {
      redrawTimer = null;
      if (S.view === 'map') renderMap();
    }, 60);
  }

  function decode(blob) {
    if (window.createImageBitmap) return createImageBitmap(blob);
    return new Promise((res, rej) => {
      const img = new Image();
      const u = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(u); res(img); };
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('decode')); };
      img.src = u;
    });
  }

  // Returns the blob, from IndexedDB if it is there and from the network if
  // not. Network failure is entirely expected -- that is the normal state of
  // this app -- so it resolves to null rather than throwing.
  async function fetchTile(z, x, y, k) {
    let blob = await DB.getTile(k).catch(() => null);
    if (blob) return blob;
    try {
      const url = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) return null;
      blob = await res.blob();
      if (!blob || blob.size === 0) return null;
      DB.putTile(k, blob).catch(() => {});
      return blob;
    } catch (e) {
      return null;
    }
  }

  async function pull(z, x, y) {
    const k = key(z, x, y);
    if (mem.has(k) || inflight.has(k)) return;
    const bad = failed.get(k);
    if (bad && Date.now() - bad < RETRY_MS) return;
    inflight.add(k);
    try {
      const blob = await fetchTile(z, x, y, k);
      if (!blob) { failed.set(k, Date.now()); return; }
      mem.set(k, await decode(blob));
      failed.delete(k);
      S.tilesEverSeen = true;
      scheduleRedraw();
    } catch (e) {
      failed.set(k, Date.now());
    } finally {
      inflight.delete(k);
    }
  }

  return {
    // Synchronous for the draw loop: hand back what is in memory and start
    // fetching what is not. The redraw when it lands fills in the gaps.
    get(z, x, y) {
      const k = key(z, x, y);
      if (mem.has(k)) return mem.get(k);
      pull(z, x, y);
      return null;
    },

    // Deliberate prefetch of everything on screen, plus one zoom level in,
    // which is what someone is actually asking for when they say "save this".
    async saveArea(view, onProgress) {
      const jobs = [];
      for (let z = view.z; z <= Math.min(MAX_ZOOM, view.z + 1); z++) {
        const s = Math.pow(2, z - view.z);
        const n = Math.pow(2, z);
        for (let x = Math.floor(view.x0 * s); x <= Math.floor(view.x1 * s); x++) {
          for (let y = Math.floor(view.y0 * s); y <= Math.floor(view.y1 * s); y++) {
            if (x < 0 || y < 0 || x >= n || y >= n) continue;
            jobs.push([z, x, y]);
          }
        }
      }
      // A cap, because a wide view at low zoom is thousands of tiles and
      // nobody meant to ask for that.
      jobs.length = Math.min(jobs.length, 400);

      let done = 0, ok = 0;
      const worker = async () => {
        while (jobs.length) {
          const j = jobs.shift();
          if (!j) break;
          const k = key(j[0], j[1], j[2]);
          const blob = await fetchTile(j[0], j[1], j[2], k);
          if (blob) {
            ok++;
            if (!mem.has(k)) {
              try { mem.set(k, await decode(blob)); } catch (e) { /* keep the bytes */ }
            }
          }
          done++;
          if (onProgress && done % 10 === 0) onProgress(done);
        }
      };
      // Four at a time: enough to be quick, few enough to stay polite to a
      // free tile server and to a phone on one bar of signal.
      await Promise.all([worker(), worker(), worker(), worker()]);
      scheduleRedraw();
      return ok;
    },
  };
})();

// The centre the map is currently showing, falling back through what we know.
function mapCentre() {
  if (S.mapCentre) return S.mapCentre;
  if (S.myPos) return S.myPos;
  const pins = livePins();
  if (pins.length) return { lat: pins[0].body.lat, lon: pins[0].body.lon };
  return HOME;
}

function livePins() {
  return byKind('pin').filter((p) =>
    p.body && typeof p.body.lat === 'number' &&
    !annotations(p.id, 'ack').some((a) => a.body.state === 'removed'));
}

// Everything the draw and the hit-testing both need, worked out once.
function mapView() {
  const cv = $('#map-canvas');
  const w = cv.clientWidth, h = cv.clientHeight;
  const z = S.mapZoom;
  const c = mapCentre();
  const cx = lonToX(c.lon, z), cy = latToY(c.lat, z);
  return {
    cv, w, h, z, centre: c, cx, cy,
    // tile-space bounds of what is on screen
    x0: cx - (w / 2) / TILE_PX, x1: cx + (w / 2) / TILE_PX,
    y0: cy - (h / 2) / TILE_PX, y1: cy + (h / 2) / TILE_PX,
    toPx: (lat, lon) => ({
      x: w / 2 + (lonToX(lon, z) - cx) * TILE_PX,
      y: h / 2 + (latToY(lat, z) - cy) * TILE_PX,
    }),
    toLatLon: (px, py) => ({
      lat: yToLat(cy + (py - h / 2) / TILE_PX, z),
      lon: xToLon(cx + (px - w / 2) / TILE_PX, z),
    }),
  };
}

function renderMap() {
  const cv = $('#map-canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const v = mapView();
  const pins = livePins();

  g.fillStyle = '#0d1830';
  g.fillRect(0, 0, w, h);

  // ------------------------------------------------------------- tiles
  const n = Math.pow(2, v.z);
  let drawn = 0, wanted = 0;
  for (let tx = Math.floor(v.x0); tx <= Math.floor(v.x1); tx++) {
    for (let ty = Math.floor(v.y0); ty <= Math.floor(v.y1); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wrapped = ((tx % n) + n) % n;   // the world repeats east-west
      wanted++;
      const img = Tiles.get(v.z, wrapped, ty);
      if (!img) continue;
      const px = w / 2 + (tx - v.cx) * TILE_PX;
      const py = h / 2 + (ty - v.cy) * TILE_PX;
      try {
        g.drawImage(img, Math.round(px), Math.round(py), TILE_PX, TILE_PX);
        drawn++;
      } catch (e) { /* a bitmap that failed to decode; skip it */ }
    }
  }
  const haveMap = drawn > 0;

  // Tiles are bright and the rest of the app is dark. Knock them back so the
  // pins stay the loudest thing on the screen, which is the point of it.
  if (haveMap) {
    g.fillStyle = 'rgba(11,18,32,.34)';
    g.fillRect(0, 0, w, h);
  }

  const mpp = metresPerPixel(v.centre.lat, v.z);

  // ------------------------------------------------- fallback distance grid
  if (!haveMap) {
    g.strokeStyle = '#1a2a4d';
    g.lineWidth = 1;
    const cell = 100 / mpp;
    if (cell > 12 && cell < 400) {
      for (let x = (w / 2) % cell; x < w; x += cell) {
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      }
      for (let y = (h / 2) % cell; y < h; y += cell) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      }
    }
  }

  // ------------------------------------------------------------ overlays
  // SOS first, under the pins, so a pin is never hidden by an alert blob.
  for (const a of byKind('sos')) {
    if (!a.body || typeof a.body.lat !== 'number') continue;
    if (annotations(a.id, 'ack').some((x) => x.body.state === 'resolved')) continue;
    const p = v.toPx(a.body.lat, a.body.lon);
    g.fillStyle = 'rgba(255,59,71,.28)';
    g.beginPath(); g.arc(p.x, p.y, 16, 0, 7); g.fill();
    g.fillStyle = '#ff3b47';
    g.beginPath(); g.arc(p.x, p.y, 7, 0, 7); g.fill();
  }

  for (const pin of pins) {
    const p = v.toPx(pin.body.lat, pin.body.lon);
    if (p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) continue;
    g.fillStyle = PIN_KINDS[pin.body.kind] || '#94a3c4';
    g.beginPath(); g.arc(p.x, p.y, 8, 0, 7); g.fill();
    g.strokeStyle = '#0b1220'; g.lineWidth = 2; g.stroke();
    const label = (pin.body.name || '').slice(0, 16);
    if (label) {
      g.font = '11px system-ui, sans-serif';
      g.textAlign = 'center';
      // A dark plate behind the text: white on a pale map tile is unreadable.
      const tw = g.measureText(label).width;
      g.fillStyle = 'rgba(11,18,32,.72)';
      g.fillRect(p.x - tw / 2 - 3, p.y - 24, tw + 6, 14);
      g.fillStyle = '#e8eef9';
      g.fillText(label, p.x, p.y - 13);
    }
  }

  if (S.myPos) {
    const p = v.toPx(S.myPos.lat, S.myPos.lon);
    g.fillStyle = 'rgba(77,139,255,.22)';
    g.beginPath(); g.arc(p.x, p.y, 22, 0, 7); g.fill();
    g.fillStyle = '#4d8bff';
    g.beginPath(); g.arc(p.x, p.y, 6, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
  }

  // The spot a tap chose, before it becomes a pin.
  if (S.pendingPin) {
    const p = v.toPx(S.pendingPin.lat, S.pendingPin.lon);
    g.strokeStyle = '#facc15'; g.lineWidth = 2;
    g.beginPath(); g.arc(p.x, p.y, 11, 0, 7); g.stroke();
    g.beginPath();
    g.moveTo(p.x - 17, p.y); g.lineTo(p.x - 5, p.y);
    g.moveTo(p.x + 5, p.y); g.lineTo(p.x + 17, p.y);
    g.moveTo(p.x, p.y - 17); g.lineTo(p.x, p.y - 5);
    g.moveTo(p.x, p.y + 5); g.lineTo(p.x, p.y + 17);
    g.stroke();
  }

  // ------------------------------------------------------------ furniture
  // Kept clear of the button row along the bottom edge.
  const BASE = h - 58;

  // Scale bar, so "how far is that" has an answer.
  const rough = (w / 4) * mpp;
  const step = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
  const barM = Math.max(step, Math.round(rough / step) * step);
  const barPx = barM / mpp;
  g.strokeStyle = '#e8eef9'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(14, BASE); g.lineTo(14 + barPx, BASE); g.stroke();
  g.fillStyle = '#e8eef9'; g.textAlign = 'left';
  g.font = '11px system-ui, sans-serif';
  g.fillText(distance(barM), 14, BASE - 6);

  if (haveMap) {
    // Required by the tile licence, and it tells a reader where the map came
    // from, which matters when the map is the thing being trusted.
    g.font = '10px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillStyle = 'rgba(232,238,249,.8)';
    g.fillText('© OpenStreetMap', w - 8, BASE);
  }

  const note = $('#map-note');
  if (!haveMap && wanted > 0) {
    note.textContent = t('map_sketch');
    note.classList.remove('hidden');
  } else if (haveMap && drawn < wanted && !navigator.onLine) {
    note.textContent = t('map_saved_only');
    note.classList.remove('hidden');
  } else {
    // Clear as well as hide: a hidden element that still holds last
    // language's sentence is text a screen reader can still reach.
    note.textContent = '';
    note.classList.add('hidden');
  }

  renderPinList(pins, v.centre);
  renderLegend();
}

function setZoom(z, anchor) {
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  if (next === S.mapZoom) return;
  // Zoom about a point rather than the middle, so pinching keeps whatever
  // was under the fingers under the fingers.
  if (anchor) {
    const before = mapView();
    const at = before.toLatLon(anchor.x, anchor.y);
    S.mapZoom = next;
    // Still the old centre, so this is where the anchored point drifted to.
    const after = mapView();
    const now = after.toPx(at.lat, at.lon);
    // Move the centre towards that drift, not away from it: the new centre is
    // the point currently sitting one drift-vector from the middle.
    S.mapCentre = after.toLatLon(
      after.w / 2 + (now.x - anchor.x),
      after.h / 2 + (now.y - anchor.y));
  } else {
    S.mapCentre = mapCentre();
    S.mapZoom = next;
  }
  renderMap();
}

function renderLegend() {
  const lg = $('#map-legend');
  if (lg.childElementCount) return;
  for (const k of Object.keys(PIN_KINDS)) {
    const s = el('span');
    const i = el('i');
    i.style.background = PIN_KINDS[k];
    s.appendChild(i);
    s.appendChild(document.createTextNode(t('pin_' + k)));
    lg.appendChild(s);
  }
}

function distanceM(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function renderPinList(pins, centre) {
  const list = $('#pin-list');
  list.innerHTML = '';
  if (!pins.length) {
    list.appendChild(el('div', 'empty', t('no_pins')));
    return;
  }
  const from = S.myPos || centre;
  const sorted = pins.slice();
  if (from) {
    sorted.sort((a, b) => distanceM(from, a.body) - distanceM(from, b.body));
  }
  for (const p of sorted) {
    const row = el('div', 'pin-row');
    const dot = el('div', 'pin-dot');
    dot.style.background = PIN_KINDS[p.body.kind] || '#94a3c4';
    row.appendChild(dot);
    const info = el('div', 'info');
    info.style.flex = '1';
    info.appendChild(el('div', '', p.body.name || t('pin_' + p.body.kind)));
    const sub = el('div', 'muted tiny');
    let txt = t('pin_' + p.body.kind);
    if (from) txt += ' · ' + distance(distanceM(from, p.body));
    if (p.body.detail) txt += ' · ' + p.body.detail;
    sub.textContent = txt;
    info.appendChild(sub);
    row.appendChild(info);
    // Tapping a place in the list centres the map on it. Reading a distance
    // and then having to find the dot by hand is the sort of thing that only
    // seems fine when you already know where everything is.
    row.onclick = () => {
      S.mapCentre = { lat: p.body.lat, lon: p.body.lon };
      renderMap();
      $('#map-canvas').scrollIntoView({ block: 'nearest' });
    };
    list.appendChild(row);
  }
}

/* mesh ------------------------------------------------------------------ */

function renderMesh() {
  const nc = $('#node-card');
  nc.innerHTML = '';
  if (!S.node) {
    nc.appendChild(el('div', 'empty', t('offline')));
  } else {
    const kv = (k, v) => {
      const r = el('div', 'kv');
      r.appendChild(el('span', '', k));
      r.appendChild(el('b', '', v));
      nc.appendChild(r);
    };
    nc.appendChild(el('h3', '', S.node.name + '  ·  ' + S.node.node));
    kv(t('records'), num(S.storeStats.records || 0));
    const used = S.storeStats.bytes || 0, cap = S.storeStats.max_bytes || 1;
    kv(t('storage'), bytesShort(used) + ' / ' + bytesShort(cap));
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = Math.min(100, (used / cap) * 100) + '%';
    bar.appendChild(fill);
    nc.appendChild(bar);
    kv(t('uptime'), timeAgo(nowSec() - (S.node.uptime || 0)).replace(t('now'), '—'));
    if (S.node.battery != null) kv(t('battery'), num(S.node.battery) + '%');
    if (S.meshStats) {
      kv(t('carried_in'), num(S.meshStats.carried_in || 0));
      kv(t('carried_out'), num(S.meshStats.carried_out || 0));
    }
  }

  const tp = $('#topology');
  tp.innerHTML = '';
  const nodes = S.topology.length ? S.topology : S.peers;
  if (!nodes.length) {
    tp.appendChild(el('div', 'empty', '—'));
  }
  for (const n of nodes) {
    const row = el('div', 'node-row');
    const d = el('span', 'dot');
    d.style.background = n.self ? '#4d8bff' : (n.hops > 1 ? '#f5a524' : '#2fbf71');
    d.style.width = d.style.height = '10px';
    d.style.borderRadius = '50%';
    row.appendChild(d);
    const info = el('div');
    info.style.flex = '1';
    info.appendChild(el('div', '', (n.name || n.node) + (n.self ? ' · ' + t('this_node') : '')));
    const sub = [];
    sub.push(n.node);
    if (!n.self) sub.push(n.hops ? num(n.hops) + ' ' + t('hops') : t('peers_direct'));
    if (n.records != null) sub.push(num(n.records) + ' ' + t('records'));
    if (n.battery != null) sub.push(num(n.battery) + '%');
    info.appendChild(el('div', 'nid', sub.join('  ·  ')));
    row.appendChild(info);
    tp.appendChild(row);
  }

  const ic = $('#identity-card');
  ic.innerHTML = '';
  ic.appendChild(el('div', '', S.identity.nick));
  ic.appendChild(el('div', 'fp-words mt', S.identity.words));
  ic.appendChild(el('small', 'muted', t('fp_note')));
  ic.appendChild(el('div', 'fp mt', S.identity.fp));

  // The version comes from the node rather than a literal in this file, so a
  // phone cannot claim to be a build it is not.
  const ver = (S.node && S.node.version) || t('unknown');
  $('#build-info').textContent =
    `PigeonMesh · ${t('version')} ${num(ver)} · ${num(S.records.size)} ${t('records')}` +
    ` · ${t('carried_in')} ${num(S.carriedThisSession)}`;
}

/* ------------------------------------------------------------------- i18n */

function applyStrings() {
  $$('[data-t]').forEach((e) => { e.textContent = t(e.dataset.t); });
  $$('[data-tp]').forEach((e) => { e.placeholder = t(e.dataset.tp); });
  $$('[data-ta]').forEach((e) => { e.setAttribute('aria-label', t(e.dataset.ta)); });
  $('#chat-input').placeholder = t('type_message');

  // The switch names where it goes, not where you are. "বাং/EN" was the one
  // place in the app that always showed both scripts at once.
  const other = Object.keys(I18N).find((c) => c !== LANG);
  const toggle = $('#lang-toggle');
  if (other) {
    toggle.textContent = I18N[other]._name;
    toggle.dataset.to = other;
  }

  buildLangRows();
  buildNeedChips();
  $('#map-legend').innerHTML = '';
  render();
}

function buildLangRows() {
  for (const id of ['#ob-lang', '#settings-lang']) {
    const row = $(id);
    if (!row) continue;
    row.innerHTML = '';
    for (const code of Object.keys(I18N)) {
      const b = el('button', 'chip' + (LANG === code ? ' on' : ''), I18N[code]._name);
      b.onclick = () => setLang(code);
      row.appendChild(b);
    }
  }
}

function buildNeedChips() {
  const row = $('#sos-needs');
  row.innerHTML = '';
  for (const n of ['rescue', 'medical', 'food', 'shelter', 'other']) {
    const b = el('button', 'chip' + (S.sosNeed === n ? ' on' : ''), t('need_' + n));
    b.type = 'button';
    b.onclick = () => { S.sosNeed = n; buildNeedChips(); };
    row.appendChild(b);
  }
}

/* ------------------------------------------------------------------ views */

function showView(v) {
  S.view = v;
  $$('.view').forEach((e) => e.classList.toggle('active', e.id === 'view-' + v));
  $$('.tab').forEach((e) => e.classList.toggle('active', e.dataset.view === v));
  render();
  if (v === 'map') setTimeout(renderMap, 30);
}

/* -------------------------------------------------------------- map input
 *
 * One pointer drags, two pinch, and a tap that did not turn into a drag
 * chooses a spot. The tap has to survive a shaking hand, so the threshold is
 * generous; a drag of a few pixels is still a tap.
 */

function wireMapGestures() {
  const cv = $('#map-canvas');
  const pts = new Map();       // pointerId -> {x, y}
  let last = null;             // last position of the dragging pointer
  let startAt = 0, moved = 0;
  let pinchBase = 0;           // finger distance when the current step began
  let lastTap = 0;

  const local = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const spread = () => {
    const [a, b] = Array.from(pts.values());
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const middle = () => {
    const [a, b] = Array.from(pts.values());
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  function panBy(dx, dy) {
    const v = mapView();
    S.mapCentre = v.toLatLon(v.w / 2 - dx, v.h / 2 - dy);
    renderMap();
  }

  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    if (pts.size === 1) {
      last = local(e);
      startAt = performance.now();
      moved = 0;
    } else if (pts.size === 2) {
      pinchBase = spread();
    }
  });

  cv.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e);
    pts.set(e.pointerId, p);

    if (pts.size >= 2) {
      // Integer zoom levels, so step when the fingers have travelled far
      // enough to mean it and re-baseline from there.
      const now = spread();
      if (pinchBase > 0) {
        const ratio = now / pinchBase;
        if (ratio > 1.6) { setZoom(S.mapZoom + 1, middle()); pinchBase = now; }
        else if (ratio < 0.625) { setZoom(S.mapZoom - 1, middle()); pinchBase = now; }
      }
      return;
    }

    if (!last) return;
    const dx = p.x - last.x, dy = p.y - last.y;
    moved += Math.hypot(dx, dy);
    last = p;
    if (moved > 3) panBy(dx, dy);
  });

  function release(e) {
    if (!pts.has(e.pointerId)) return;
    const p = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (pts.size === 1) { last = Array.from(pts.values())[0]; moved = 999; }
    if (pts.size > 0) return;

    const quick = performance.now() - startAt < 500;
    if (moved <= 8 && quick) {
      const now = performance.now();
      if (now - lastTap < 300) {
        lastTap = 0;
        setZoom(S.mapZoom + 1, p);
        return;
      }
      lastTap = now;
      const v = mapView();
      S.pendingPin = v.toLatLon(p.x, p.y);
      buzz(20);
      renderMap();
      toast(t('selected_spot') + ' · ' + t('add_pin'));
    }
    last = null;
  }

  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);

  // Desktop and anything with a scroll wheel.
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(S.mapZoom + (e.deltaY < 0 ? 1 : -1), local(e));
  }, { passive: false });
}

async function saveMapArea() {
  const btn = $('#map-save');
  if (btn.disabled) return;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = t('saving_area');
  toast(t('saving_area'));
  try {
    const got = await Tiles.saveArea(mapView(), (done) => {
      btn.textContent = t('saving_area') + ' ' + num(done);
    });
    toast(got > 0 ? t('area_saved') + ' · ' + num(got) : t('area_failed'),
          got > 0 ? '' : 'sos');
  } catch (e) {
    toast(t('area_failed'), 'sos');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
    renderMap();
  }
}

/* ------------------------------------------------------------- geolocation */

function locate(cb) {
  // Browsers refuse geolocation outside a secure context, and a mesh node on
  // plain http is exactly that. Saying "location unavailable" sends people
  // looking for a GPS problem they do not have, so name the real reason and
  // point at the way round it.
  if (!navigator.geolocation) { toast(t('no_gps'), 'sos'); return; }
  if (window.isSecureContext === false) {
    toast(t('gps_insecure'), 'sos');
    return;
  }
  toast(t('locating'));
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      S.myPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (!S.mapCentre) S.mapCentre = S.myPos;
      if (cb) cb(S.myPos);
      render();
    },
    (err) => toast(err && err.code === 1 ? t('gps_insecure') : t('no_gps'), 'sos'),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

/* -------------------------------------------------------------- SOS button */

function wireSOS() {
  const btn = $('#sos-btn');
  const ring = btn.querySelector('.sos-ring');
  const label = btn.querySelector('.sos-label');
  let start = 0, raf = 0, fired = false;
  const HOLD_MS = 1500;   // long enough that a pocket press cannot fire it

  function tick() {
    const p = Math.min(1, (performance.now() - start) / HOLD_MS);
    ring.style.setProperty('--p', (p * 100) + '%');
    if (p >= 1 && !fired) { fired = true; fire(); return; }
    if (!fired) raf = requestAnimationFrame(tick);
  }

  function begin(e) {
    e.preventDefault();
    if (fired) return;
    start = performance.now();
    btn.classList.add('holding');
    label.textContent = t('sos_holding');
    buzz(30);
    raf = requestAnimationFrame(tick);
  }

  function end() {
    cancelAnimationFrame(raf);
    btn.classList.remove('holding');
    ring.style.setProperty('--p', '0%');
    label.textContent = t('sos_hold');
    fired = false;
  }

  async function fire() {
    buzz([90, 60, 90, 60, 260]);
    const body = {
      text: ($('#sos-text').value || '').trim() || t('sos_title'),
      need: S.sosNeed,
      source: 'app',
    };
    if ($('#sos-geo').checked && S.myPos) {
      body.lat = +S.myPos.lat.toFixed(5);
      body.lon = +S.myPos.lon.toFixed(5);
    }
    await publish('sos', body, { chan: 'sos' });
    toast(t('sos_sent'), 'sos');
    $('#sos-text').value = '';
    end();
  }

  btn.addEventListener('pointerdown', begin);
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
  btn.addEventListener('pointerleave', end);
  // A screen reader or keyboard user cannot "hold"; give them a direct path.
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
  });
}

/* ------------------------------------------------------------------ photo
 *
 * A photo is downscaled to 96px and re-encoded as a low-quality JPEG before
 * it ever enters a record. A missing-person report has to cross a mesh where
 * the slowest link may be a 2 Mbit Wi-Fi hop shared by a whole shelter, and
 * has to fit in a router with 6 MB of flash. ~4 KB is the budget.
 */

function shrinkPhoto(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size = 96;
      const cv = $('#mp-canvas');
      const g = cv.getContext('2d');
      const s = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.55));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  document.documentElement.lang = LANG;
  applyStrings();

  const saved = localStorage.getItem('pm_identity');
  if (saved) {
    try { S.identity = JSON.parse(saved); } catch (e) { S.identity = null; }
  }

  if (!S.identity) {
    $('#onboard').classList.remove('hidden');
    $('#ob-start').onclick = () => {
      const nick = ($('#ob-name').value || '').trim().slice(0, 32);
      if (!nick) { $('#ob-name').focus(); return; }
      // Key generation is ~1 ms, but say so anyway: silence after a tap
      // reads as a broken app.
      S.identity = PM.newIdentity(nick);
      localStorage.setItem('pm_identity', JSON.stringify(S.identity));
      $('#onboard').classList.add('hidden');
      $('#app').classList.remove('hidden');
      toast(t('identity_made'));
      start();
    };
    $('#ob-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#ob-start').click();
    });
    return;
  }

  $('#app').classList.remove('hidden');
  start();
}

async function start() {
  // Local records first: the app must be usable before any network call
  // resolves, including when there is no network at all.
  try {
    const recs = await DB.allRecords();
    addRecords(recs || [], { silent: true });
    S.seqByNode = (await DB.getMeta('seq')) || {};
  } catch (e) { /* first run */ }

  render();
  setLink(S.records.size ? 'carry' : 'off');

  refreshState();
  openStream();
  reconcile();

  setInterval(reconcile, 20000);
  setInterval(() => { if (!S.online) refreshState(); }, 8000);
  setInterval(render, 30000);   // keep relative timestamps honest

  // Coming back from a locked screen is exactly when a carrier has just
  // walked into range of a new node.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { refreshState(); reconcile(); }
  });
  window.addEventListener('online', () => { refreshState(); openStream(); });

  wireEvents();
  wireSOS();
  locate();

  if ('serviceWorker' in navigator) {
    // Registration only succeeds in a secure context. Over plain http on a
    // mesh node it will not, and that is fine -- the app still works, it
    // just cannot launch while out of range of every node.
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function wireEvents() {
  $('#tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) showView(b.dataset.view);
  });

  $('#lang-toggle').onclick = (e) =>
    setLang(e.currentTarget.dataset.to || (LANG === 'bn' ? 'en' : 'bn'));
  document.addEventListener('pm:lang', applyStrings);

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#chat-input');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    publish('chat', { text }, { chan: S.channel });
  });

  $('#people-seg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    S.peopleTab = b.dataset.seg;
    $$('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    render();
  });

  $('#safe-btn').onclick = async () => {
    const where = ($('#safe-where').value || '').trim();
    await publish('checkin', { where, status: 'safe' });
    toast(t('checkin_sent'));
    buzz(60);
  };

  $('#mp-search').addEventListener('input', renderPeople);

  $('#mp-photo').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    S.photoData = await shrinkPhoto(f);
  });

  $('#mp-submit').onclick = async () => {
    const name = ($('#mp-name').value || '').trim();
    if (!name) { $('#mp-name').focus(); return; }
    const body = {
      name,
      age: +$('#mp-age').value || undefined,
      desc: ($('#mp-desc').value || '').trim(),
      contact: ($('#mp-contact').value || '').trim(),
    };
    if (S.photoData) body.photo = S.photoData;
    await publish('missing', body);
    ['#mp-name', '#mp-age', '#mp-desc', '#mp-contact'].forEach((s) => { $(s).value = ''; });
    S.photoData = null;
    toast(t('submit'));
  };

  $('#map-locate').onclick = () => locate((p) => { S.mapCentre = p; renderMap(); });
  $('#map-add').onclick = openPinSheet;
  $('#map-in').onclick = () => setZoom(S.mapZoom + 1);
  $('#map-out').onclick = () => setZoom(S.mapZoom - 1);
  $('#map-save').onclick = saveMapArea;
  wireMapGestures();

  $('#carry-toggle').checked = S.carry;
  $('#carry-toggle').onchange = (e) => {
    S.carry = e.target.checked;
    localStorage.setItem('pm_carry', S.carry ? '1' : '0');
  };

  $('#wipe-btn').onclick = async () => {
    if (!confirm(t('panic_confirm'))) return;
    await DB.deleteAll();
    localStorage.removeItem('pm_identity');
    localStorage.removeItem('pm_carry');
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
      for (const r of regs) r.unregister();
    }
    if (window.caches) {
      const keys = await caches.keys().catch(() => []);
      for (const k of keys) caches.delete(k);
    }
    location.reload();
  };

  $('#sos-banner').onclick = () => { showView('sos'); $('#sos-banner').classList.add('hidden'); };

  window.addEventListener('resize', () => { if (S.view === 'map') renderMap(); });
}

function openPinSheet() {
  const sheet = $('#sheet');
  const inner = $('#sheet-inner');
  inner.innerHTML = '';

  inner.appendChild(el('h3', '', t('add_pin')));

  let kind = 'shelter';
  const chips = el('div', 'chips');
  const rebuild = () => {
    chips.innerHTML = '';
    for (const k of Object.keys(PIN_KINDS)) {
      const b = el('button', 'chip' + (kind === k ? ' on' : ''), t('pin_' + k));
      b.type = 'button';
      b.onclick = () => { kind = k; rebuild(); };
      chips.appendChild(b);
    }
  };
  rebuild();
  inner.appendChild(chips);

  const nameF = el('label', 'field mt');
  nameF.appendChild(el('span', '', t('pin_name')));
  const nameI = el('input');
  nameI.type = 'text'; nameI.maxLength = 60;
  nameF.appendChild(nameI);
  inner.appendChild(nameF);

  const detF = el('label', 'field');
  detF.appendChild(el('span', '', t('pin_detail')));
  const detI = el('input');
  detI.type = 'text'; detI.maxLength = 120;
  detF.appendChild(detI);
  inner.appendChild(detF);

  const where = el('p', 'muted tiny',
    S.pendingPin ? `${S.pendingPin.lat.toFixed(5)}, ${S.pendingPin.lon.toFixed(5)}`
      : t('tap_map'));
  inner.appendChild(where);

  const useMine = el('button', 'btn btn-ghost', t('use_my_location'));
  useMine.onclick = () => locate((p) => {
    S.pendingPin = p;
    where.textContent = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
  });
  inner.appendChild(useMine);

  const row = el('div', 'row-between mt');
  const cancel = el('button', 'btn', t('cancel'));
  cancel.onclick = () => sheet.classList.add('hidden');
  const save = el('button', 'btn btn-primary', t('save'));
  save.onclick = async () => {
    // A tap, a GPS fix, or a map the person deliberately dragged somewhere.
    // Never the default opening view: a pin dropped on a city someone has
    // never been to is worse than no pin.
    const at = S.pendingPin || S.myPos || S.mapCentre;
    if (!at) { toast(t('tap_map')); return; }
    await publish('pin', {
      kind,
      name: nameI.value.trim() || t('pin_' + kind),
      detail: detI.value.trim(),
      lat: +at.lat.toFixed(5),
      lon: +at.lon.toFixed(5),
    });
    S.pendingPin = null;
    sheet.classList.add('hidden');
    if (!S.mapCentre) S.mapCentre = at;
    renderMap();
  };
  row.appendChild(cancel);
  row.appendChild(save);
  inner.appendChild(row);

  sheet.classList.remove('hidden');
  sheet.onclick = (e) => { if (e.target === sheet) sheet.classList.add('hidden'); };
}

document.addEventListener('DOMContentLoaded', boot);
