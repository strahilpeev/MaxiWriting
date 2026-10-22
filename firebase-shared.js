// Споделен модул за връзка с Firebase (вход за възрастни + Firestore).
// Зарежда се само в app.html (хъба) и излага window.MaxiDB,
// за да може класическият (non-module) скрипт на хъба да го ползва.
//
// Данните са по акаунти:
//   accounts/{uid}                     — акаунтът на родителя/специалиста
//   accounts/{uid}/profiles/{profileId} — децата: име, аватар, статистика, история
// Всеки акаунт вижда само своите деца (виж firestore.rules).

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification,
  signInWithPopup, GoogleAuthProvider, signOut as fbSignOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB7DegzYk8B7cP3_Pot0hBAmZ0U-o-G2bI",
  authDomain: "maxiwriting.firebaseapp.com",
  projectId: "maxiwriting",
  storageBucket: "maxiwriting.firebasestorage.app",
  messagingSenderId: "266514583711",
  appId: "1:266514583711:web:3a328e55958fe77c1012aa"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = "bg"; // писмата за парола и потвърждение — на български
// Офлайн кеш на Firestore (IndexedDB), за да работи приложението и без wifi.
// persistentMultipleTabManager позволява няколко отворени раздела едновременно.
// Ако локалният кеш се повреди (Firestore дава „INTERNAL ASSERTION FAILED“,
// напр. след смяна на правилата), при следващото отваряне го изчистваме —
// данните са в облака, губи се само локалното копие.
const RESET_KEY = "maxiFirestoreReset_v1";
const IDB_NAME = "firestore/[DEFAULT]/" + firebaseConfig.projectId + "/main";
let needReset = false;
try { needReset = !!localStorage.getItem(RESET_KEY); } catch (e) {}
let db;
if (needReset) {
  // Повреден кеш: тази сесия работи с кеш в паметта (без IndexedDB), а старата
  // база се трие във фона. Ако друг раздел я държи отворена, триенето довършва,
  // щом той се затвори; знакът се маха чак при успех.
  db = initializeFirestore(app, { localCache: memoryLocalCache() });
  try {
    const req = indexedDB.deleteDatabase(IDB_NAME);
    req.onsuccess = () => { try { localStorage.removeItem(RESET_KEY); } catch (e) {} };
  } catch (e) {}
} else {
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    db = initializeFirestore(app, { localCache: memoryLocalCache() });
  }
}
const isCorrupt = (err) => /INTERNAL ASSERTION FAILED/.test(String(err && err.message || err));
function markCorrupt(err) {
  if (isCorrupt(err)) { try { localStorage.setItem(RESET_KEY, "1"); } catch (e) {} }
  throw err;
}

/* ---------- Вход ---------- */

let currentUser = null;
let resolveReady;
// ready се изпълва, щом Firebase знае дали устройството е вписано (с потребител или null).
// Firebase помни входа и офлайн, така че вписан таблет остава вписан.
const ready = new Promise((resolve) => { resolveReady = resolve; });
const authListeners = new Set();

onAuthStateChanged(auth, (user) => {
  currentUser = user || null;
  if (user) ensureAccountDoc(user).catch(() => {});
  resolveReady(currentUser);
  authListeners.forEach((cb) => { try { cb(currentUser); } catch (e) {} });
});

function onAuth(cb) {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

function userInfo() {
  return currentUser
    ? { uid: currentUser.uid, email: currentUser.email || "", verified: !!currentUser.emailVerified, anonymous: !!currentUser.isAnonymous }
    : null;
}

async function ensureAccountDoc(user) {
  const ref = doc(db, "accounts", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { email: user.email || "", createdAt: serverTimestamp() });
  }
}

// Грешките на Firebase — на разбираем български.
const AUTH_ERRORS = {
  "auth/invalid-email": "Имейлът не е въведен правилно.",
  "auth/missing-password": "Въведете парола.",
  "auth/weak-password": "Паролата трябва да е поне 6 знака.",
  "auth/email-already-in-use": "Вече има акаунт с този имейл. Изберете „Вход“.",
  "auth/invalid-credential": "Грешен имейл или парола.",
  "auth/wrong-password": "Грешен имейл или парола.",
  "auth/user-not-found": "Няма акаунт с този имейл.",
  "auth/too-many-requests": "Твърде много опити. Опитайте отново след малко.",
  "auth/network-request-failed": "Няма връзка с интернет. Първият вход изисква интернет.",
  "auth/popup-closed-by-user": "Прозорецът за вход беше затворен.",
  "auth/popup-blocked": "Браузърът спря прозореца за вход. Разрешете изскачащите прозорци.",
  "auth/operation-not-allowed": "Този начин на вход още не е включен.",
  "auth/unauthorized-domain": "Входът с Google не е разрешен за този адрес."
};
function friendly(err) {
  return (err && AUTH_ERRORS[err.code]) || "Нещо се обърка. Опитайте отново.";
}
function wrap(promise) {
  return promise.then(() => userInfo()).catch((err) => { throw new Error(friendly(err)); });
}

function signIn(email, password) {
  return wrap(signInWithEmailAndPassword(auth, String(email).trim(), password));
}

function register(email, password) {
  return wrap(
    createUserWithEmailAndPassword(auth, String(email).trim(), password).then((cred) => {
      sendEmailVerification(cred.user).catch(() => {});
      return cred;
    })
  );
}

function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return wrap(signInWithPopup(auth, provider));
}

function resetPassword(email) {
  return sendPasswordResetEmail(auth, String(email).trim())
    .catch((err) => { throw new Error(friendly(err)); });
}

function resendVerification() {
  return currentUser ? sendEmailVerification(currentUser) : Promise.resolve();
}

function signOut() {
  return fbSignOut(auth);
}

/* ---------- Профили на децата (само в текущия акаунт) ---------- */

async function requireUser() {
  await ready;
  if (!currentUser) throw new Error("not-signed-in");
  return currentUser;
}
function profilesCol(uid) { return collection(db, "accounts", uid, "profiles"); }
function profileRef(uid, id) { return doc(db, "accounts", uid, "profiles", id); }

async function listProfiles_raw() {
  const user = await requireUser();
  const snap = await getDocs(profilesCol(user.uid));
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  return out;
}

async function getProfile_raw(id) {
  const user = await requireUser();
  const snap = await getDoc(profileRef(user.uid, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function upsertProfile_raw(id, data) {
  const user = await requireUser();
  await setDoc(profileRef(user.uid, id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

async function deleteProfileRemote_raw(id) {
  const user = await requireUser();
  // "Изтриване" само маркира профила – историята не се губи случайно.
  await setDoc(profileRef(user.uid, id), { deleted: true, updatedAt: serverTimestamp() }, { merge: true });
}

async function pushSession_raw(id, appKey, record) {
  const user = await requireUser();
  const ref = profileRef(user.uid, id);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const sessions = data.sessions || {};
  const list = sessions[appKey] || [];
  list.unshift(record);
  if (list.length > 5) list.length = 5;
  sessions[appKey] = list;
  await setDoc(ref, { sessions, updatedAt: serverTimestamp() }, { merge: true });
}

/* ---------- Пренасяне от старата обща база ----------
   Преди акаунтите всички профили бяха в обща колекция "profiles".
   Правилата позволяват да се чете само от собственика на приложението;
   за всички останали listLegacyProfiles() връща празен списък. */

async function listLegacyProfiles() {
  await requireUser();
  try {
    const snap = await getDocs(collection(db, "profiles"));
    const out = [];
    snap.forEach((d) => { const p = d.data(); if (!p.deleted) out.push({ id: d.id, ...p }); });
    return out;
  } catch (e) {
    if (isCorrupt(e)) markCorrupt(e);
    return [];
  }
}

async function importLegacyProfiles_raw(ids) {
  const user = await requireUser();
  const legacy = await listLegacyProfiles();
  const chosen = legacy.filter((p) => !ids || ids.includes(p.id));
  for (const p of chosen) {
    const { id, ...data } = p;
    delete data.updatedAt;
    await setDoc(profileRef(user.uid, id), { ...data, importedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  }
  return chosen.length;
}

/* ---------- Общо класиране ----------
   leaderboard/{uid}_{profileId}: само прякор, аватар, ниво и звезди — без истинско име.
   Влиза само дете, за което родителят е включил класирането в „👤 Акаунт“. */
function rankId(uid, profileId) { return uid + "_" + profileId; }
async function publishRank_raw(profileId, entry) {
  const user = await requireUser();
  const level = Math.max(1, Math.min(1000, Math.floor(entry.level || 1)));
  const stars = Math.max(0, Math.min(1000000, Math.floor(entry.stars || 0)));
  await setDoc(doc(db, "leaderboard", rankId(user.uid, profileId)), {
    uid: user.uid,
    nick: String(entry.nick || "").slice(0, 40),
    avatar: String(entry.avatar || "🦊").slice(0, 16),
    level, stars,
    score: level * 1000000 + stars,
    updatedAt: serverTimestamp()
  });
}
async function removeRank_raw(profileId) {
  const user = await requireUser();
  await deleteDoc(doc(db, "leaderboard", rankId(user.uid, profileId)));
}
async function listRanking_raw(n) {
  const user = await requireUser();
  const snap = await getDocs(query(collection(db, "leaderboard"), orderBy("score", "desc"), limit(n || 50)));
  const out = [];
  snap.forEach((d) => { const r = d.data(); out.push({ id: d.id, nick: r.nick, avatar: r.avatar, level: r.level, stars: r.stars, mine: r.uid === user.uid }); });
  return out;
}

window.MaxiDB = {
  ready,
  onAuth,
  user: userInfo,
  signIn,
  register,
  signInGoogle,
  resetPassword,
  resendVerification,
  signOut,
  listProfiles: (...a) => listProfiles_raw(...a).catch(markCorrupt),
  getProfile: (...a) => getProfile_raw(...a).catch(markCorrupt),
  upsertProfile: (...a) => upsertProfile_raw(...a).catch(markCorrupt),
  deleteProfileRemote: (...a) => deleteProfileRemote_raw(...a).catch(markCorrupt),
  pushSession: (...a) => pushSession_raw(...a).catch(markCorrupt),
  listLegacyProfiles,
  importLegacyProfiles: (...a) => importLegacyProfiles_raw(...a).catch(markCorrupt),
  isCorrupt,
  publishRank: (...a) => publishRank_raw(...a).catch(markCorrupt),
  removeRank: (...a) => removeRank_raw(...a).catch(markCorrupt),
  listRanking: (...a) => listRanking_raw(...a).catch(markCorrupt)
};
window.dispatchEvent(new Event("maxidb-ready"));
