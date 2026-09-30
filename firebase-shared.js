// Споделен модул за връзка с Firebase (Firestore + анонимно вписване).
// Зарежда се само в index.html (хъба) и излага window.MaxiDB,
// за да може класическият (non-module) скрипт на хъба да го ползва.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs,
  serverTimestamp, enableIndexedDbPersistence
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
const db = getFirestore(app);

// Позволява приложението да работи офлайн (Firestore кешира локално и
// синхронизира сам, когато пак има връзка) — важно за таблет без постоянен wifi.
try { enableIndexedDbPersistence(db); } catch (e) { /* няма проблем, ако не се включи */ }

let resolveReady;
const ready = new Promise((resolve) => { resolveReady = resolve; });

onAuthStateChanged(auth, (user) => {
  if (user) resolveReady(user);
});
signInAnonymously(auth).catch((err) => {
  console.warn("Firebase анонимно вписване неуспешно:", err);
  resolveReady(null);
});

function simpleHash(str) {
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return "h" + h.toString(36);
}

async function listProfiles() {
  await ready;
  const snap = await getDocs(collection(db, "profiles"));
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  return out;
}

async function getProfile(id) {
  await ready;
  const snap = await getDoc(doc(db, "profiles", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function upsertProfile(id, data) {
  await ready;
  await setDoc(
    doc(db, "profiles", id),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

async function deleteProfileRemote(id) {
  await ready;
  // "Изтриване" само маркира профила – историята не се губи случайно;
  // административният изглед може пак да я види при нужда.
  await setDoc(doc(db, "profiles", id), { deleted: true, updatedAt: serverTimestamp() }, { merge: true });
}

async function pushSession(id, appKey, record) {
  await ready;
  const ref = doc(db, "profiles", id);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const sessions = data.sessions || {};
  const list = sessions[appKey] || [];
  list.unshift(record);
  if (list.length > 5) list.length = 5;
  sessions[appKey] = list;
  await setDoc(ref, { sessions, updatedAt: serverTimestamp() }, { merge: true });
}

async function getAdminSettings() {
  await ready;
  const snap = await getDoc(doc(db, "settings", "admin"));
  return snap.exists() ? snap.data() : null;
}

async function setAdminPassword(password) {
  await ready;
  await setDoc(doc(db, "settings", "admin"), { passwordHash: simpleHash(password) });
}

async function checkAdminPassword(password) {
  const settings = await getAdminSettings();
  if (!settings) return false;
  return settings.passwordHash === simpleHash(password);
}

window.MaxiDB = {
  ready,
  simpleHash,
  listProfiles,
  getProfile,
  upsertProfile,
  deleteProfileRemote,
  pushSession,
  getAdminSettings,
  setAdminPassword,
  checkAdminPassword
};
window.dispatchEvent(new Event("maxidb-ready"));
