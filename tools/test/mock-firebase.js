// Имитация на firebase-shared.js за тестове без интернет.
// Същият интерфейс (window.MaxiDB); „облакът“ и входът се пазят в localStorage
// под ключове __mock*, за да преживяват презареждане като истинския Firebase.

const CLOUD = '__mockCloud', AUTH = '__mockAuth', USERS = '__mockUsers';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

let currentUser = read(AUTH, null);
const listeners = new Set();
let resolveReady;
const ready = new Promise((r) => { resolveReady = r; });
setTimeout(() => resolveReady(currentUser), 30);

function setUser(u) {
  currentUser = u; write(AUTH, u);
  listeners.forEach((cb) => cb(u));
}
const fail = (m) => Promise.reject(new Error(m));
function cloud() { return read(CLOUD, { accounts: {} }); }
function mine() {
  if (!currentUser) throw new Error('not-signed-in');
  const c = cloud();
  c.accounts[currentUser.uid] = c.accounts[currentUser.uid] || { profiles: {} };
  return c;
}

window.MaxiDB = {
  ready,
  onAuth(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  user() { return currentUser; },
  signIn(email, pass) {
    const users = read(USERS, {});
    const u = users[email];
    if (!u || u.pass !== pass) return fail('Грешен имейл или парола.');
    setUser({ uid: u.uid, email, verified: true });
    return Promise.resolve(currentUser);
  },
  register(email, pass) {
    const users = read(USERS, {});
    if (users[email]) return fail('Вече има акаунт с този имейл. Изберете „Вход“.');
    users[email] = { uid: 'u' + Object.keys(users).length + 1, pass };
    write(USERS, users);
    setUser({ uid: users[email].uid, email, verified: false });
    return Promise.resolve(currentUser);
  },
  signInGoogle() { return fail('Този начин на вход още не е включен.'); },
  resetPassword() { return Promise.resolve(); },
  resendVerification() { return Promise.resolve(); },
  signOut() { setUser(null); return Promise.resolve(); },
  idToken() { return currentUser ? Promise.resolve('mock-token-' + currentUser.uid) : fail('not-signed-in'); },
  async listProfiles() {
    await ready; const c = mine();
    return Object.entries(c.accounts[currentUser.uid].profiles).map(([id, p]) => ({ id, ...p }));
  },
  async getProfile(id) { await ready; const c = mine(); const p = c.accounts[currentUser.uid].profiles[id]; return p ? { id, ...p } : null; },
  async upsertProfile(id, data) {
    await ready; const c = mine(); const ps = c.accounts[currentUser.uid].profiles;
    ps[id] = Object.assign(ps[id] || {}, data); write(CLOUD, c);
  },
  async deleteProfileRemote(id) { return this.upsertProfile(id, { deleted: true }); },
  async pushSession(id, appKey, record) {
    await ready; const c = mine(); const p = c.accounts[currentUser.uid].profiles[id] = c.accounts[currentUser.uid].profiles[id] || {};
    p.sessions = p.sessions || {}; (p.sessions[appKey] = p.sessions[appKey] || []).unshift(record); write(CLOUD, c);
  },
  async publishRank(id, e) {
    await ready; mine();
    const r = read('__mockRank', {});
    r[currentUser.uid + '_' + id] = { uid: currentUser.uid, nick: e.nick, avatar: e.avatar, level: e.level, stars: e.stars, score: e.level * 1e6 + e.stars };
    write('__mockRank', r);
  },
  async removeRank(id) { await ready; mine(); const r = read('__mockRank', {}); delete r[currentUser.uid + '_' + id]; write('__mockRank', r); },
  async listRanking(n) {
    await ready; mine();
    return Object.entries(read('__mockRank', {})).map(([id, r]) => ({ id, ...r, mine: r.uid === currentUser.uid }))
      .sort((a, b) => b.score - a.score).slice(0, n || 50);
  },
  async listLegacyProfiles() { await ready; return read('__mockLegacy', []); },
  async importLegacyProfiles() {
    const legacy = read('__mockLegacy', []);
    for (const { id, ...d } of legacy) await this.upsertProfile(id, d);
    return legacy.length;
  }
};
window.dispatchEvent(new Event('maxidb-ready'));
