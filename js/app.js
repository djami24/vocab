// ── Level configuration ──────────────────────────────────────────
// `target` = uzoq muddatli maqsad (to'liq so'zlar soni shu darajada bo'lishi kerak).
// Amaldagi so'zlar soni data/*.json fayllardan avtomatik o'qiladi va
// progress shu asosda hisoblanadi — shuning uchun ko'rsatkich hech qachon yolg'on bo'lmaydi.
const LEVELS = [
  { id: 'beginner', name: 'Beginner', file: 'data/beginner.json', target: 1000 },
  { id: 'elementary', name: 'Elementary', file: 'data/elementary.json', target: 2000 },
  { id: 'pre-intermediate', name: 'Pre-Intermediate', file: 'data/pre-intermediate.json', target: 3000 },
  { id: 'intermediate', name: 'Intermediate', file: 'data/intermediate.json', target: 4000 },
  { id: 'upper-intermediate', name: 'Upper-Intermediate', file: 'data/upper-intermediate.json', target: 5000 },
];

const SESSION_SIZE = 10; // bitta o'qish sessiyasidagi so'zlar soni
const REVIEW_SESSION_SIZE = 15; // bitta takrorlash sessiyasidagi so'zlar soni

// ── Pul mukofoti (so'z uchun haq) sozlamalari ───────────────────────
const EARNING_PER_WORD = 10;       // har bir YANGI o'rganilgan so'z uchun (so'm)
const MIN_WORDS_TO_WITHDRAW = 2000; // pul chiqarish uchun kerak bo'lgan eng kam o'rganilgan so'z soni
const INACTIVITY_RESET_DAYS = 3;    // shuncha kun ketma-ket kirmasa, yig'ilgan summa 0'ga tushadi

// ── Firebase auth va foydalanuvchi ma'lumotlari keshi ──────────────
// `auth` va `db` — js/firebase-config.js faylida yaratiladigan globallar.
// Sahifa ochilganda ma'lumotlar Firestore'dan bir marta o'qiladi va
// xotirada saqlanadi (_userDataCache) — barcha o'qish funksiyalari shu
// keshdan sinxron ishlaydi, yozish funksiyalari esa keshni yangilab,
// Firestore'ga fon rejimida (debounce bilan) yozadi.

let _currentUser = null;      // Firebase Auth foydalanuvchi obyekti
let _userDataCache = null;    // { progress, activity, flags }
let _userNameCache = '';      // Foydalanuvchining ismi (agar ro'yxatdan o'tishda kiritilgan bo'lsa)
let _isAdminCache = null;     // null = hali tekshirilmagan, true/false = ma'lum
let _authReadyPromise = null;
let _persistTimer = null;

function authReady() {
  if (!_authReadyPromise) {
    _authReadyPromise = new Promise((resolve) => {
      auth.onAuthStateChanged(async (user) => {
        _currentUser = user;
        if (user) {
          try { await loadUserData(user.uid); }
          catch (e) { console.error("Ma'lumotlarni yuklashda xatolik:", e); _userDataCache = emptyUserData(); }
          try { await backfillEarningsIfNeeded(user.uid); }
          catch (e) { console.error("Eski progress uchun mukofotni hisoblashda xatolik:", e); }
          try { checkEarningsReset(); }
          catch (e) { console.error("Mukofot holatini tekshirishda xatolik:", e); }
          try { await checkIsAdminStatus(user.uid); }
          catch (e) { console.error('Admin holatini tekshirishda xatolik:', e); _isAdminCache = false; }
          // Reyting yozuvini har safar (istalgan sahifa ochilganda) yangilab
          // qo'yamiz — shunda faqat login/ro'yxatdan o'tishda emas, balki
          // avvaldan tizimga kirgan (sessiyasi saqlanib qolgan) talabalar
          // ham sahifani ochishning o'zidayoq reytingda ko'rina boshlaydi.
          syncLeaderboardEntry().catch(e => console.error('Reytingni yangilashda xatolik:', e));
        } else {
          _userDataCache = null;
          _userNameCache = '';
          _isAdminCache = null;
        }
        resolve(user);
      });
    });
  }
  return _authReadyPromise;
}

async function requireAuth() {
  const user = await authReady();
  if (!user) { location.href = 'index.html'; return null; }
  return user.email || user.uid;
}

async function logout() {
  clearTimeout(_persistTimer);
  try { await flushPersist(); } catch (e) { /* e'tiborsiz */ }
  if (_currentUser) {
    try { await logActivity(_currentUser.uid, _currentUser.email, 'logout'); }
    catch (e) { console.error('Jurnalga yozishda xatolik:', e); }
  }
  try { await auth.signOut(); } finally { location.href = 'index.html'; }
}

// ── Ro'yxatdan o'tish / kirish / parolni tiklash ────────────────────
async function registerUser(email, password, name) {
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  _currentUser = cred.user; // loadUserData yangi hujjat yaratganda email shu yerdan olinadi
  await loadUserData(cred.user.uid, name);
  logActivity(cred.user.uid, cred.user.email, 'register').catch(e => console.error('Jurnalga yozishda xatolik:', e));
  syncLeaderboardEntry().catch(e => console.error('Reytingni yangilashda xatolik:', e));
  return cred.user;
}
async function loginUser(email, password) {
  const cred = await auth.signInWithEmailAndPassword(email, password);
  _currentUser = cred.user;
  await loadUserData(cred.user.uid);
  logActivity(cred.user.uid, cred.user.email, 'login').catch(e => console.error('Jurnalga yozishda xatolik:', e));
  syncLeaderboardEntry().catch(e => console.error('Reytingni yangilashda xatolik:', e));
  return cred.user;
}
async function sendPasswordReset(email) {
  await auth.sendPasswordResetEmail(email);
}
function authErrorMessage(err) {
  const map = {
    'auth/email-already-in-use': "Bu email allaqachon ro'yxatdan o'tgan. Kirish oynasidan foydalaning.",
    'auth/invalid-email': "Email manzili noto'g'ri formatda.",
    'auth/weak-password': "Parol juda oddiy — kamida 6 ta belgidan iborat bo'lishi kerak.",
    'auth/user-not-found': "Bunday foydalanuvchi topilmadi.",
    'auth/wrong-password': "Parol noto'g'ri.",
    'auth/invalid-credential': "Email yoki parol noto'g'ri.",
    'auth/missing-password': "Parolni kiriting.",
    'auth/too-many-requests': "Juda ko'p urinish. Birozdan so'ng qayta urinib ko'ring.",
  };
  return map[err.code] || ("Xatolik yuz berdi: " + (err.message || err.code || ''));
}

// ── Foydalanuvchi hujjati (Firestore) ───────────────────────────────
function userDocRef(uid) { return db.collection('users').doc(uid); }

function emptyUserData() {
  const progress = {};
  LEVELS.forEach(l => { progress[l.id] = []; });
  progress.later = {};
  progress.reviews = {};
  LEVELS.forEach(l => { progress.later[l.id] = []; progress.reviews[l.id] = {}; });
  return { progress, activity: {}, flags: {}, earnings: emptyEarnings() };
}

// Pul mukofoti uchun boshlang'ich holat.
// balance — hozir yig'ilgan, hali chiqarilmagan summa (nofaollikda 0'ga tushadi)
// lifetimeEarned — jami HECH QACHON kamaymaydigan yig'indi (admin statistikasi uchun)
// cashWithdrawn / tuitionWithdrawn — jami naqd olingan / markaz to'loviga o'tkazilgan summa
// history — oxirgi chiqarishlar/nofaollik tufayli nolga tushishlar jurnali
function emptyEarnings() {
  return {
    balance: 0,
    lifetimeEarned: 0,
    cashWithdrawn: 0,
    tuitionWithdrawn: 0,
    lastActiveDate: null,
    history: [],
  };
}

function normalizeUserData(data) {
  const out = emptyUserData();
  const p = data && typeof data.progress === 'object' ? data.progress : {};
  LEVELS.forEach(l => { if (Array.isArray(p[l.id])) out.progress[l.id] = p[l.id]; });
  if (p.later && typeof p.later === 'object') {
    LEVELS.forEach(l => { if (Array.isArray(p.later[l.id])) out.progress.later[l.id] = p.later[l.id]; });
  }
  if (p.reviews && typeof p.reviews === 'object') {
    LEVELS.forEach(l => { if (p.reviews[l.id] && typeof p.reviews[l.id] === 'object') out.progress.reviews[l.id] = p.reviews[l.id]; });
  }
  if (data && data.activity && typeof data.activity === 'object') out.activity = data.activity;
  if (data && data.flags && typeof data.flags === 'object') out.flags = data.flags;
  if (data && data.earnings && typeof data.earnings === 'object') {
    const e = data.earnings;
    out.earnings = {
      balance: typeof e.balance === 'number' ? e.balance : 0,
      lifetimeEarned: typeof e.lifetimeEarned === 'number' ? e.lifetimeEarned : 0,
      cashWithdrawn: typeof e.cashWithdrawn === 'number' ? e.cashWithdrawn : 0,
      tuitionWithdrawn: typeof e.tuitionWithdrawn === 'number' ? e.tuitionWithdrawn : 0,
      lastActiveDate: typeof e.lastActiveDate === 'string' ? e.lastActiveDate : null,
      history: Array.isArray(e.history) ? e.history : [],
    };
  }
  return out;
}

async function loadUserData(uid, name) {
  const ref = userDocRef(uid);
  const snap = await ref.get();
  if (snap.exists) {
    _userDataCache = normalizeUserData(snap.data());
    _userNameCache = (snap.data() && snap.data().name) || '';
  } else {
    _userDataCache = emptyUserData();
    _userNameCache = name || '';
    await ref.set({
      email: _currentUser ? _currentUser.email : '',
      name: name || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      progress: _userDataCache.progress,
      activity: _userDataCache.activity,
      flags: _userDataCache.flags,
    });
  }
}

// ── Admin holati ──────────────────────────────────────────────────
// Admin huquqi foydalanuvchining o'z hujjatida EMAS, balki alohida
// `admins/{uid}` kolleksiyasida saqlanadi — chunki foydalanuvchi o'z
// hujjatini o'zi yoza oladi (progressni saqlash uchun kerak), agar
// admin belgisi ham o'sha yerda bo'lsa, har kim o'zini admin qilib
// qo'yishi mumkin bo'lardi. `admins` kolleksiyasiga yozishga esa
// faqat mavjud adminlarga ruxsat berilgan (Firestore qoidalari).
async function checkIsAdminStatus(uid) {
  if (!uid) { _isAdminCache = false; return false; }
  try {
    const snap = await db.collection('admins').doc(uid).get();
    _isAdminCache = snap.exists;
  } catch (e) {
    console.error('Admin holatini tekshirishda xatolik:', e);
    _isAdminCache = false;
  }
  return _isAdminCache;
}

// Joriy foydalanuvchi admin bo'lsa true qaytaradi (kesh yuklangandan keyin ishlaydi)
function isAdmin() {
  return _isAdminCache === true;
}

// Fonda, biroz kechiktirib Firestore'ga yozadi (ketma-ket ko'p yozishlarni birlashtiradi)
function persistUserData() {
  if (!_currentUser || !_userDataCache) return;
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => { flushPersist(); }, 600);
}
async function flushPersist() {
  clearTimeout(_persistTimer);
  if (!_currentUser || !_userDataCache) return;
  try {
    const dataToSave = {
      progress: _userDataCache.progress,
      activity: _userDataCache.activity,
      flags: _userDataCache.flags,
    };
    // earnings mavjud bo'lsa, uni ham saqlash (pul mukofoti ma'lumotlari)
    if (_userDataCache.earnings && typeof _userDataCache.earnings === 'object') {
      dataToSave.earnings = _userDataCache.earnings;
    }
    await userDocRef(_currentUser.uid).set(dataToSave, { merge: true });
  } catch (e) { console.error('Saqlashda xatolik:', e); }
  // Progress saqlangach, reyting yozuvini ham fonda yangilab qo'yamiz
  // (xato bo'lsa ham asosiy saqlashga ta'sir qilmasin — shuning uchun alohida catch)
  syncLeaderboardEntry().catch(e => console.error('Reytingni yangilashda xatolik:', e));
}
window.addEventListener('beforeunload', () => { if (_persistTimer) flushPersist(); });

// ── Sayt sozlamalari (bosh sahifa matnlari, admin tahrirlaydi) ─────
const DEFAULT_SITE_SETTINGS = {
  heroTitle: "Kuniga bir nechta so'z, *Inglizcha so'zlarni o'rganing💰 mukofot yuting!*",
  heroDescription: "Beginner'dan Upper-Intermediate'gacha bosqichma-bosqich inglizcha so'z boyligingizni oshiring. Bir marta o'rgangan so'zingiz qayta chiqmaydi — faqat yangilari bilan davom etasiz.",
  footerText: "So'z boyligingiz — bulutda xavfsiz saqlanadi.",
  loginSubtitle: "Email va parolingiz bilan kiring.",
  registerSubtitle: "Progressingiz bulutda saqlanadi — istalgan qurilmadan kirishingiz mumkin.",
  authNote: "Ma'lumotlaringiz Firebase bulutida xavfsiz saqlanadi — istalgan qurilmadan kirib, davom ettirishingiz mumkin.",
  tuitionTotal: "400000", // o'quv markazi to'liq tuloviga (so'mda) — pul mukofoti shundan ayiriladi
};

// Ushbu matn maydonlari admin panelida yoqilishi/o'chirilishi mumkin —
// o'chirilgan bo'lsa, saytda YUQORIDAGI standart (default) matn ko'rinadi,
// yoqilgan bo'lsa, admin kiritgan maxsus matn ko'rinadi. `tuitionTotal`
// funksional sozlama bo'lgani uchun bu ro'yxatda yo'q — u doim faol.
const TOGGLEABLE_SETTINGS_FIELDS = [
  'heroTitle', 'heroDescription', 'footerText',
  'loginSubtitle', 'registerSubtitle', 'authNote',
];

function siteSettingsDocRef() { return db.collection('settings').doc('site'); }

async function loadSiteSettings() {
  try {
    const snap = await siteSettingsDocRef().get();
    const data = snap.exists ? snap.data() : {};
    const enabledMap = (data && typeof data.enabled === 'object' && data.enabled) || {};
    const out = { ...DEFAULT_SITE_SETTINGS };

    TOGGLEABLE_SETTINGS_FIELDS.forEach(key => {
      // Eski (enabled belgisi saqlanmagan) sozlamalar bilan moslik uchun:
      // agar `enabled` xaritasida bu maydon haqida aniq belgi bo'lmasa,
      // lekin qiymat avval saqlangan bo'lsa — faol deb hisoblanadi.
      const isEnabled = key in enabledMap
        ? !!enabledMap[key]
        : (typeof data[key] === 'string' && data[key].trim() !== '');
      if (isEnabled && typeof data[key] === 'string' && data[key].trim() !== '') {
        out[key] = data[key];
      }
    });

    if (typeof data.tuitionTotal === 'string') out.tuitionTotal = data.tuitionTotal;
    out._raw = data;      // admin panelida forma qiymatlarini to'ldirish uchun (o'chirilgan bo'lsa ham matnni yo'qotmaslik)
    out._enabled = enabledMap;
    return out;
  } catch (e) {
    console.error("Sayt sozlamalarini o'qishda xatolik:", e);
    return { ...DEFAULT_SITE_SETTINGS, _raw: {}, _enabled: {} };
  }
}

// Faqat admin chaqirishi kerak — Firestore qoidalari ham buni talab qiladi.
// `enabledMap` — { heroTitle: true/false, ... } — har bir matn maydoni
// yoqilganmi-yo'qmi.
async function saveSiteSettings(newSettings, enabledMap) {
  const payload = {};
  Object.keys(DEFAULT_SITE_SETTINGS).forEach(key => {
    if (typeof newSettings[key] === 'string') payload[key] = newSettings[key];
  });
  if (enabledMap && typeof enabledMap === 'object') {
    payload.enabled = {};
    TOGGLEABLE_SETTINGS_FIELDS.forEach(key => { payload.enabled[key] = !!enabledMap[key]; });
  }
  payload.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
  await siteSettingsDocRef().set(payload, { merge: true });
}

// "*so'z*" ko'rinishidagi bo'lakni <em>so'z</em>'ga aylantiradi (oldin HTML ekranlanadi)
function renderEmphasis(str) {
  const escaped = escapeHtmlGlobal(str);
  return escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
function escapeHtmlGlobal(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : str;
  return d.innerHTML;
}

// ── Faollik jurnali (kim qachon kirdi/chiqdi/ro'yxatdan o'tdi) ──────
async function logActivity(uid, email, type) {
  if (!uid) return;
  await db.collection('activityLog').add({
    uid,
    email: email || '',
    type, // 'login' | 'logout' | 'register'
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// Faqat admin chaqirishi kerak — Firestore qoidalari o'qishni faqat adminga ruxsat beradi
async function fetchActivityLog(limitCount) {
  const n = limitCount || 200;
  const snap = await db.collection('activityLog').orderBy('timestamp', 'desc').limit(n).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Faqat admin chaqirishi kerak — jurnalni REAL VAQTDA kuzatish (onSnapshot).
// activityLog kolleksiyasida yangi yozuv paydo bo'lgan zahoti (masalan,
// kimdir tizimga kirsa yoki chiqsa) callback yangilangan to'liq ro'yxat
// bilan qayta chaqiriladi — sahifani yangilash shart emas.
// Qaytarilgan funksiyani chaqirib, tinglashni to'xtatish mumkin.
function watchActivityLog(limitCount, callback, onError) {
  const n = limitCount || 1000;
  return db.collection('activityLog').orderBy('timestamp', 'desc').limit(n)
    .onSnapshot(
      snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => { console.error('Jurnalni kuzatishda xatolik:', err); if (onError) onError(err); }
    );
}

// Faqat admin chaqirishi kerak — barcha foydalanuvchilar ro'yxati
async function fetchAllUsersAdmin() {
  const snap = await db.collection('users').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Faqat admin chaqirishi kerak — hozirda admin bo'lgan barcha UID'lar ro'yxati
async function fetchAllAdminUids() {
  const snap = await db.collection('admins').get();
  return snap.docs.map(d => d.id);
}

// Faqat admin chaqirishi kerak — boshqa foydalanuvchiga admin huquqini berish/olish
async function setUserAdminFlag(uid, value) {
  if (value) {
    await db.collection('admins').doc(uid).set({
      grantedAt: firebase.firestore.FieldValue.serverTimestamp(),
      grantedBy: _currentUser ? _currentUser.uid : null,
    });
  } else {
    await db.collection('admins').doc(uid).delete();
  }
}

// ── Progress (keshdan sinxron o'qiladi) ─────────────────────────────
function getProgress(_user) { return _userDataCache.progress; }
function saveProgress(_user, progress) { _userDataCache.progress = progress; persistUserData(); }

function markLearned(_user, levelId, enWord) {
  const progress = getProgress();
  const key = enWord.toLowerCase();
  const wasNew = !progress[levelId].includes(key);
  if (wasNew) {
    progress[levelId].push(key);
  }
  // So'z o'rganilgach, "keyinroq" ro'yxatidan olib tashlanadi
  const li = progress.later[levelId].indexOf(key);
  if (li !== -1) progress.later[levelId].splice(li, 1);

  // Takrorlash jadvalini boshlash (spaced repetition, soddalashtirilgan)
  if (!progress.reviews[levelId][key]) {
    progress.reviews[levelId][key] = { interval: 1, due: addDays(todayStr(), 1), ease: 2.3 };
  }

  saveProgress(_user, progress);
  if (wasNew) {
    recordActivity(_user);
    addEarning(_user, EARNING_PER_WORD); // har bir yangi so'z uchun pul mukofoti
  }
  return progress;
}

// "Keyinroq" — foydalanuvchi hozircha o'tkazib yuborgan so'zlar shu yerga tushadi
function markLater(_user, levelId, enWord) {
  const progress = getProgress();
  const key = enWord.toLowerCase();
  if (!progress.later[levelId].includes(key) && !progress[levelId].includes(key)) {
    progress.later[levelId].push(key);
    saveProgress(_user, progress);
  }
  return progress;
}
function getLaterWords(_user, levelId) {
  return getProgress().later[levelId];
}

// ── Takrorlash (spaced repetition, soddalashtirilgan SM-2) ─────────
function todayStr() { return new Date().toISOString().slice(0, 10); }
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function getDueReviewWords(_user, levelId) {
  const progress = getProgress();
  const today = todayStr();
  const reviews = progress.reviews[levelId] || {};
  return Object.keys(reviews).filter(word => reviews[word].due <= today);
}
function getDueReviewCount(_user, levelId) {
  return getDueReviewWords(_user, levelId).length;
}
function reviewWord(_user, levelId, enWord, remembered) {
  const progress = getProgress();
  const key = enWord.toLowerCase();
  const entry = progress.reviews[levelId][key] || { interval: 1, due: todayStr(), ease: 2.3 };
  if (remembered) {
    entry.interval = Math.min(Math.round(entry.interval * entry.ease), 90);
    entry.due = addDays(todayStr(), entry.interval);
  } else {
    entry.interval = 1;
    entry.ease = Math.max(1.3, entry.ease - 0.2);
    entry.due = addDays(todayStr(), 1);
  }
  progress.reviews[levelId][key] = entry;
  saveProgress(_user, progress);
  return progress;
}

// ── Faoliyat tarixi va streak (kunlik ketma-ketlik) ────────────────
function getActivity(_user) { return _userDataCache.activity; }
function saveActivity(_user, activity) { _userDataCache.activity = activity; persistUserData(); }
function recordActivity(_user) {
  const activity = getActivity();
  const today = todayStr();
  activity[today] = (activity[today] || 0) + 1;
  saveActivity(_user, activity);
  return activity;
}
function getStreak(_user) {
  const activity = getActivity();
  let d = new Date();
  let key = d.toISOString().slice(0, 10);
  if (!activity[key]) {
    // bugun hali so'z o'rganilmagan bo'lsa, kechadan boshlab tekshiramiz
    d.setDate(d.getDate() - 1);
  }
  let current = 0;
  while (activity[d.toISOString().slice(0, 10)]) {
    current++;
    d.setDate(d.getDate() - 1);
  }
  // eng uzun streak
  const dates = Object.keys(activity).sort();
  let longest = 0, run = 0, prev = null;
  for (const ds of dates) {
    if (prev) {
      const diffDays = Math.round((new Date(ds) - new Date(prev)) / 86400000);
      run = diffDays === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = ds;
  }
  return { current, longest };
}
function getLast14Days(_user) {
  const activity = getActivity();
  const out = [];
  const d = new Date();
  for (let i = 13; i >= 0; i--) {
    const dd = new Date(d);
    dd.setDate(d.getDate() - i);
    const key = dd.toISOString().slice(0, 10);
    out.push({ date: key, count: activity[key] || 0 });
  }
  return out;
}

// ── Qo'shimcha bayroqlar (masalan: testda 100% natija) ─────────────
function getFlags(_user) { return _userDataCache.flags; }
function setFlag(_user, name) {
  const flags = getFlags();
  flags[name] = true;
  _userDataCache.flags = flags;
  persistUserData();
}

// ── Pul mukofoti (har bir o'rganilgan so'z uchun) ───────────────────
// Hujjat tuzilishi uchun emptyEarnings()'ga qarang. Muhim qoida:
// `balance` — talaba hozir CHIQARIB OLISHI mumkin bo'lgan summa. Agar
// talaba 3 kun ketma-ket profiliga kirmasa, shu maydon 0'ga tushadi
// (checkEarningsReset orqali) — lekin `lifetimeEarned` va o'rganilgan
// so'zlar soni (haqiqiy progress) hech qachon kamaymaydi.
function getEarnings(_user) {
  if (!_userDataCache.earnings) _userDataCache.earnings = emptyEarnings();
  return _userDataCache.earnings;
}
function saveEarnings(_user, earnings) {
  _userDataCache.earnings = earnings;
  persistUserData();
}

function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA + 'T00:00:00');
  const b = new Date(dateStrB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

// Har bir sahifa ochilib, foydalanuvchi tizimga kirgan holatda
// authReady() ichida chaqiriladi. Agar oxirgi faollikdan beri
// INACTIVITY_RESET_DAYS kun (yoki undan ko'p) uzilish bo'lsa —
// ya'ni talaba shuncha kun ketma-ket profiliga kirmagan bo'lsa —
// yig'ilgan (hali chiqarilmagan) summa 0'ga tushadi. So'ngra so'z
// o'rganishni davom ettirsa, summa yana boshidan hisoblana boshlaydi.
function checkEarningsReset() {
  const earnings = getEarnings();
  const today = todayStr();
  if (earnings.lastActiveDate) {
    const gap = daysBetween(earnings.lastActiveDate, today);
    if (gap >= INACTIVITY_RESET_DAYS + 1 && earnings.balance > 0) {
      const lost = earnings.balance;
      earnings.balance = 0;
      earnings.history = earnings.history || [];
      earnings.history.push({ type: 'reset', amount: lost, date: today });
      if (earnings.history.length > 50) earnings.history = earnings.history.slice(-50);
    }
  }
  earnings.lastActiveDate = today;
  saveEarnings(_currentUser && _currentUser.uid, earnings);
}

function addEarning(_user, amount) {
  const earnings = getEarnings();
  earnings.balance += amount;
  earnings.lifetimeEarned += amount;
  saveEarnings(_user, earnings);
}

// Pul mukofoti funksiyasi qo'shilishidan OLDIN allaqachon o'rganilgan
// so'zlar uchun ham mukofot berish (bir martalik migratsiya). Har bir
// foydalanuvchida faqat bir marta ishlaydi — flags.earningsMigrated
// bayrog'i orqali belgilanadi. Shundan keyin barcha yangi so'zlar odatiy
// tartibda (markLearned ichida) hisoblanadi.
async function backfillEarningsIfNeeded(_user) {
  const flags = getFlags();
  const earnings = getEarnings();
  // "Migratsiya bajarilgan" deb hisoblanishi uchun kamida bitta haqiqiy
  // hodisa (pul yig'ilgan yoki chiqarilgan) bo'lishi kerak — aks holda
  // (masalan, oldingi urinishda vaqtinchalik xato tufayli bayroq
  // noto'g'ri o'rnatilib qolgan bo'lsa) qayta urinib ko'ramiz. Bu
  // xavfsiz: lifetimeEarned/cashWithdrawn/tuitionWithdrawn hech qachon
  // kamaymaydi, shuning uchun bir marta haqiqiy mukofot qo'shilgach, bu
  // shart doim rost bo'lib qoladi va qayta hisoblanmaydi.
  const alreadyReal = earnings.lifetimeEarned > 0 || earnings.cashWithdrawn > 0 || earnings.tuitionWithdrawn > 0;
  if (flags.earningsMigrated && alreadyReal) return;

  const stats = await collectStats(_user);
  const progress = getProgress();
  const hasRawProgress = LEVELS.some(l => Array.isArray(progress[l.id]) && progress[l.id].length > 0);
  // Agar foydalanuvchida progress bor-u, lekin so'z ro'yxatlari (data/*.json)
  // hali yuklanmagani sababli stats.totalWords 0 chiqsa — bu hisoblash
  // ishonchli emas. Bayroqni belgilamasdan, keyingi safar qayta urinamiz.
  if (hasRawProgress && stats.totalWords === 0) return;
  if (stats.totalLearned > 0) {
    const amount = stats.totalLearned * EARNING_PER_WORD;
    earnings.balance += amount;
    earnings.lifetimeEarned += amount;
    saveEarnings(_user, earnings);
  }
  setFlag(_user, 'earningsMigrated');
}

// Talaba pulni chiqarishga haqlimi: kamida MIN_WORDS_TO_WITHDRAW ta
// so'z o'rgangan (haqiqiy, data/*.json'dagi so'zlar bo'yicha
// tekshirilgan progress — collectStats orqali) va hozirgi balansi 0'dan katta.
async function getWithdrawEligibility(_user) {
  const stats = await collectStats(_user);
  const earnings = getEarnings();
  return {
    eligible: stats.totalLearned >= MIN_WORDS_TO_WITHDRAW && earnings.balance > 0,
    totalLearned: stats.totalLearned,
    needed: MIN_WORDS_TO_WITHDRAW,
    balance: earnings.balance,
  };
}

// Joriy balansni naqd yoki o'quv markazi to'loviga chiqarib oladi.
// type: 'cash' | 'tuition'. Muvaffaqiyatli bo'lsa, chiqarilgan summani qaytaradi.
async function withdrawEarnings(_user, type) {
  if (type !== 'cash' && type !== 'tuition') throw new Error("Noto'g'ri chiqarish turi");
  const elig = await getWithdrawEligibility(_user);
  if (!elig.eligible) {
    if (elig.balance <= 0) throw new Error("Hozircha chiqarish uchun mablag' yo'q.");
    throw new Error(`Pul chiqarish uchun kamida ${MIN_WORDS_TO_WITHDRAW} ta so'z o'rganishingiz kerak (hozir: ${elig.totalLearned}).`);
  }
  const earnings = getEarnings();
  const amount = earnings.balance;
  earnings.balance = 0;
  if (type === 'cash') earnings.cashWithdrawn += amount;
  else earnings.tuitionWithdrawn += amount;
  earnings.history = earnings.history || [];
  earnings.history.push({ type, amount, date: todayStr() });
  if (earnings.history.length > 50) earnings.history = earnings.history.slice(-50);
  saveEarnings(_user, earnings);
  await flushPersist(); // pul amaliyoti — kechiktirmasdan darhol saqlaymiz
  return amount;
}

// Sayt sozlamalaridagi jami o'quv markazi to'lovi (masalan 400 000 so'm)
// asosida, talaba markaz to'loviga o'tkazgan summalarni ayirib, hali
// TO'LASHI kerak bo'lgan qoldiqni hisoblaydi.
function tuitionRemaining(tuitionTotal, tuitionWithdrawn) {
  return Math.max(0, (Number(tuitionTotal) || 0) - (Number(tuitionWithdrawn) || 0));
}

// ── Yutuqlar (badges) ───────────────────────────────────────────────
const BADGE_DEFS = [
  { id: 'first_word', title: 'Birinchi qadam', desc: '1 ta so\u2019z o\u2019rgandingiz', check: s => s.totalLearned >= 1 },
  { id: 'words_10', title: '10 ta so\u2019z', desc: 'Jami 10 ta so\u2019z o\u2019rgandingiz', check: s => s.totalLearned >= 10 },
  { id: 'words_50', title: '50 ta so\u2019z', desc: 'Jami 50 ta so\u2019z o\u2019rgandingiz', check: s => s.totalLearned >= 50 },
  { id: 'words_100', title: '100 ta so\u2019z', desc: 'Jami 100 ta so\u2019z o\u2019rgandingiz', check: s => s.totalLearned >= 100 },
  { id: 'words_250', title: '250 ta so\u2019z', desc: 'Jami 250 ta so\u2019z o\u2019rgandingiz', check: s => s.totalLearned >= 250 },
  { id: 'words_500', title: '500 ta so\u2019z', desc: 'Jami 500 ta so\u2019z o\u2019rgandingiz', check: s => s.totalLearned >= 500 },
  { id: 'streak_3', title: '3 kunlik seriya', desc: '3 kun ketma-ket mashq qildingiz', check: s => s.streak.current >= 3 },
  { id: 'streak_7', title: '7 kunlik seriya', desc: '1 hafta ketma-ket mashq qildingiz', check: s => s.streak.current >= 7 },
  { id: 'streak_30', title: '30 kunlik seriya', desc: '1 oy ketma-ket mashq qildingiz', check: s => s.streak.current >= 30 },
  { id: 'level_beginner_done', title: 'Beginner tugallandi', desc: 'Beginner darajasini to\u2019liq o\u2019rgandingiz', check: s => s.levelDone.beginner },
  { id: 'level_elementary_done', title: 'Elementary tugallandi', desc: 'Elementary darajasini to\u2019liq o\u2019rgandingiz', check: s => s.levelDone.elementary },
  { id: 'level_pre_done', title: 'Pre-Intermediate tugallandi', desc: 'Pre-Intermediate darajasini to\u2019liq o\u2019rgandingiz', check: s => s.levelDone['pre-intermediate'] },
  { id: 'level_int_done', title: 'Intermediate tugallandi', desc: 'Intermediate darajasini to\u2019liq o\u2019rgandingiz', check: s => s.levelDone.intermediate },
  { id: 'level_upperint_done', title: 'Upper-Intermediate tugallandi', desc: 'Upper-Intermediate darajasini to\u2019liq o\u2019rgandingiz', check: s => s.levelDone['upper-intermediate'] },
  { id: 'quiz_perfect', title: 'Mukammal test', desc: 'Testda 100% natija ko\u2019rsatdingiz', check: s => !!s.flags.quizPerfect },
];

// stats obyektini yig'ib beradi (dashboard/stats sahifalari uchun umumiy)
async function collectStats(user) {
  const progress = getProgress(user);
  const streak = getStreak(user);
  const flags = getFlags(user);
  let totalLearned = 0, totalWords = 0, totalLater = 0;
  const levelDone = {};
  const levelUnlocked = {};
  const perLevel = [];
  let prevDone = true; // birinchi daraja doim ochiq

  for (const level of LEVELS) {
    let words = [];
    try { words = await loadLevelWords(level.id); } catch (e) { /* ignore */ }
    const learned = progress[level.id].filter(w => words.some(x => x.en.toLowerCase() === w)).length;
    const total = words.length;
    const laterCount = progress.later[level.id].filter(w => words.some(x => x.en.toLowerCase() === w)).length;
    const dueReview = getDueReviewCount(user, level.id);
    const isDone = total > 0 && learned >= total;
    // Daraja ochiqmi: oldingi daraja tugagan bo'lsa YOKI bu darajada
    // allaqachon progress bor bo'lsa (so'zlar ro'yxati keyinchalik
    // kengaytirilsa ham, foydalanuvchi qo'lga kiritgan progress hech
    // qachon qayta "qulflanib" qolmasligi uchun).
    const unlocked = prevDone || learned > 0;
    levelDone[level.id] = isDone;
    levelUnlocked[level.id] = unlocked;
    prevDone = isDone;
    totalLearned += learned;
    totalWords += total;
    totalLater += laterCount;
    perLevel.push({ level, learned, total, laterCount, dueReview, isDone, unlocked });
  }

  return { totalLearned, totalWords, totalLater, levelDone, levelUnlocked, perLevel, streak, flags };
}

// Bitta darajaning hozir ochiqmi-yo'qligini tekshiradi (study/quiz
// sahifalari to'g'ridan-to'g'ri URL orqali ochilganda ham himoya qilish
// uchun) — collectStats kabi barcha darajalarni emas, faqat kerakli
// oldingi darajani yuklaydi, shu bilan yengil ishlaydi.
async function isLevelUnlocked(user, levelId) {
  const idx = LEVELS.findIndex(l => l.id === levelId);
  if (idx < 0) return false;
  if (idx === 0) return true;

  const progress = getProgress(user);
  if (progress[levelId] && progress[levelId].length > 0) return true; // progress bor — doim ochiq

  const prevLevel = LEVELS[idx - 1];
  let prevWords = [];
  try { prevWords = await loadLevelWords(prevLevel.id); } catch { return false; }
  if (prevWords.length === 0) return false;
  const learnedPrev = progress[prevLevel.id].filter(w => prevWords.some(x => x.en.toLowerCase() === w)).length;
  return learnedPrev >= prevWords.length;
}
function computeBadges(stats) {
  return BADGE_DEFS.map(b => ({ ...b, earned: !!b.check(stats) }));
}

// Talaba hozir qaysi darajada ekanini aniqlaydi: ochiq va hali
// tugallanmagan birinchi daraja — agar hammasi tugagan bo'lsa, oxirgi
// (Upper-Intermediate) daraja qaytariladi.
function currentLevelInfo(perLevel) {
  const active = perLevel.find(p => p.unlocked && !p.isDone);
  const chosen = active || perLevel[perLevel.length - 1];
  return { id: chosen.level.id, name: chosen.level.name };
}

// ── Progressni eksport / import qilish ─────────────────────────────
function exportProgress(user) {
  const payload = {
    app: 'lugat',
    version: 1,
    exportedAt: new Date().toISOString(),
    user,
    progress: getProgress(user),
    activity: getActivity(user),
    flags: getFlags(user),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = String(user).replace(/[^a-zA-Z0-9_-]+/g, '_');
  a.download = `lugat-progress-${safeName}-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
async function importProgressFromObject(_user, obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Noto\u2019g\u2019ri fayl formati');
  if (obj.progress) _userDataCache.progress = obj.progress;
  if (obj.activity) _userDataCache.activity = obj.activity;
  if (obj.flags) _userDataCache.flags = obj.flags;
  await flushPersist();
}

// ── Word data ─────────────────────────────────────────────────────
const _wordCache = {};
async function loadLevelWords(levelId) {
  if (_wordCache[levelId]) return _wordCache[levelId];
  const level = LEVELS.find(l => l.id === levelId);
  if (!level) throw new Error('Unknown level: ' + levelId);
  const res = await fetch(level.file);
  if (!res.ok) throw new Error('Could not load word list for ' + levelId);
  const data = await res.json();
  _wordCache[levelId] = data;
  return data;
}
async function loadAllWords() {
  const all = await Promise.all(LEVELS.map(l => loadLevelWords(l.id).catch(() => [])));
  return LEVELS.map((l, i) => ({ level: l, words: all[i] }));
}

// ── Reyting (leaderboard) ───────────────────────────────────────────
// Email hech qachon reyting hujjatiga yozilmaydi — faqat ism (yoki ism
// kiritilmagan bo'lsa, emaildan olingan xavfsiz taxallus) va sonlar.
function publicDisplayName(name, email) {
  if (name && name.trim()) return name.trim();
  const local = (email || '').split('@')[0] || 'Talaba';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function leaderboardDocRef(uid) { return db.collection('leaderboard').doc(uid); }

// Joriy foydalanuvchining progressidan reyting yozuvini hisoblab, yozadi.
// flushPersist() har safar progress saqlanganda avtomatik chaqiradi.
async function syncLeaderboardEntry() {
  if (!_currentUser || !_userDataCache) return;
  const stats = await collectStats(_currentUser.uid);
  const cur = currentLevelInfo(stats.perLevel);
  const badgeCount = computeBadges(stats).filter(b => b.earned).length;
  const perLevel = {};
  stats.perLevel.forEach(p => { perLevel[p.level.id] = p.learned; });

  await leaderboardDocRef(_currentUser.uid).set({
    name: publicDisplayName(_userNameCache, _currentUser.email),
    totalLearned: stats.totalLearned,
    totalWords: stats.totalWords,
    pct: stats.totalWords ? Math.round((stats.totalLearned / stats.totalWords) * 100) : 0,
    perLevel,
    currentLevelId: cur.id,
    currentLevelName: cur.name,
    badgeCount,
    streakCurrent: stats.streak.current,
    streakLongest: stats.streak.longest,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

// Reyting sahifasi uchun — hamma tizimga kirgan foydalanuvchilarga ochiq
async function fetchLeaderboard() {
  const snap = await db.collection('leaderboard').orderBy('totalLearned', 'desc').limit(200).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Bosh sahifadagi qisqa reyting bo'limi uchun — faqat eng yaxshi N ta
// talaba (mehmonlar ham ko'ra oladi, tizimga kirish shart emas).
async function fetchTopLeaderboard(n) {
  const snap = await db.collection('leaderboard').orderBy('totalLearned', 'desc').limit(n).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Reyting yozuvlarini YAGONA RO'YXAT ko'rinishida (podiumsiz) HTML'ga
// aylantiradi — top-3 uchun medal (lb-medal2), qolganlar uchun oddiy
// raqam (lb-rank2). index.html (bosh sahifa) va leaderboard.html
// (to'liq Reyting sahifasi) shu bitta funksiyadan foydalanadi, shunda
// ikkala joyda reyting bir xil ko'rinishda chiqadi.
function renderLeaderboardList2(entries, myUid) {
  const medalClass = ['gold', 'silver', 'bronze'];
  return `
    <div class="lb-list2">
      ${entries.map((e, i) => {
        const rank = i + 1;
        const isMe = !!myUid && e.id === myUid;
        const rowClass = 'lb-row2' + (rank === 1 ? ' lb-row2-top' : '') + (isMe ? ' is-me' : '');
        const rankHtml = i < 3
          ? `<div class="lb-medal2 ${medalClass[i]}"><div class="ribbon"></div><div class="disc">${rank}</div></div>`
          : `<div class="lb-rank2">${rank}</div>`;
        return `
          <div class="${rowClass}">
            ${rankHtml}
            <div class="lb-avatar2">${escapeHtmlGlobal((e.name || '?')[0].toUpperCase())}</div>
            <div class="lb-info2">
              <div class="lb-name2">${escapeHtmlGlobal(e.name || 'Talaba')}${isMe ? ' <span class="me-tag">Siz</span>' : ''}</div>
              <div class="lb-meta2">${escapeHtmlGlobal(e.currentLevelName || 'Beginner')} · 🏅 ${e.badgeCount || 0}</div>
            </div>
            <div class="lb-divider2"></div>
            <div class="lb-nums2">
              <div class="lb-num2">${e.totalLearned || 0}</div>
              <div class="lb-lbl2">so'z</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ── Fikrlar (testimonials) — bosh sahifada ko'rsatiladigan talaba fikri ──
// Hujjat ID = foydalanuvchi uid'i, shuning uchun har bir talaba faqat
// bitta marta fikr qoldira oladi (Firestore qoidalari ham buni talab
// qiladi — qarang: firestore.rules, /testimonials/{uid}).
function testimonialDocRef(uid) { return db.collection('testimonials').doc(uid); }

// Joriy foydalanuvchi allaqachon fikr qoldirganmi — forma o'rniga
// "rahmat" holatini ko'rsatish uchun ishlatiladi.
async function fetchMyTestimonial(uid) {
  const snap = await testimonialDocRef(uid).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

// Yangi fikr qo'shadi. Faqat bir marta muvaffaqiyatli bo'ladi — agar
// foydalanuvchi avval fikr qoldirgan bo'lsa, Firestore qoidalari
// yozishni rad etadi (update taqiqlangan).
async function submitTestimonial(uid, name, text) {
  await testimonialDocRef(uid).set({
    name: (name || '').trim(),
    text: (text || '').trim(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// Bosh sahifada va admin panelida ko'rsatish uchun — oxirgi N ta fikr
// (o'qish hammaga ochiq, tizimga kirish shart emas).
async function fetchTestimonials(n) {
  const snap = await db.collection('testimonials').orderBy('createdAt', 'desc').limit(n || 30).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Faqat admin chaqirishi kerak — Firestore qoidalari o'chirishni faqat adminga ruxsat beradi
async function deleteTestimonial(uid) {
  await testimonialDocRef(uid).delete();
}

// ── So'zni ovozda o'qish (talaffuz) ─────────────────────────────
// Brauzerning o'zidagi Speech Synthesis API'sidan foydalanadi —
// internetdan audio fayl yuklash shart emas. Mavjud bo'lsa inglizcha
// ovozni tanlaydi (ro'yxat ba'zi brauzerlarda kechroq keladi, shuning
// uchun voiceschanged hodisasida ham qayta tanlanadi).
let _enVoice = null;
function _pickEnglishVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  return voices.find(v => v.lang === 'en-US') ||
         voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en')) ||
         null;
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  _enVoice = _pickEnglishVoice();
  speechSynthesis.onvoiceschanged = () => { _enVoice = _pickEnglishVoice(); };
}

// ── Fallback: haqiqiy audio fayl orqali talaffuz ────────────────
// Android'dagi Telegram ichki brauzeri (WebView) speechSynthesis'ni
// UMUMAN qo'llab-quvvatlamaydi — 'speechSynthesis' in window true
// bo'lishi mumkin, lekin speak() chaqirilganda hech qanday xato
// bermay, jimgina hech narsa qilmaydi. Shu sababli faqat "mavjudmi"
// deb tekshirish yetarli emas — haqiqatan ishlayotganini vaqt
// bo'yicha tekshirish kerak (onstart hodisasi kutiladi).
//
// Ishlamasa — Google Translate'ning ovozli tarjima audio endpoint'i
// orqali haqiqiy mp3 oqimi olib kelinadi va <audio> bilan ijro
// etiladi. Bu so'rovni FOYDALANUVCHINING qurilmasi yuboradi (WebView
// ichida ham oddiy tarmoq so'rovlari va <audio> ijrosi ishlaydi —
// faqat TTS dvigateli yo'q), shuning uchun bu yerda ishlaydi.
const _audioCache = new Map(); // so'z -> HTMLAudioElement (qayta yuklamaslik uchun)

function _fallbackSpeak(text) {
  const key = text.toLowerCase().trim();
  let audio = _audioCache.get(key);
  if (!audio) {
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=' + encodeURIComponent(text);
    audio = new Audio(url);
    _audioCache.set(key, audio);
  }
  audio.currentTime = 0;
  audio.play().catch((e) => console.error("Fallback audio ijro etilmadi:", e));
}

// So'zni (odatda inglizcha) ovozda o'qiydi. Avval brauzerning o'z
// speechSynthesis'ini sinaydi; agar u belgilangan vaqt ichida
// haqiqatan gapira boshlamasa (yoki umuman qo'llab-quvvatlanmasa),
// audio-fayl asosidagi fallback'ga o'tadi.
function speakWord(text) {
  if (!text) return;

  if (!('speechSynthesis' in window)) {
    _fallbackSpeak(text);
    return;
  }

  try {
    // Android/Chrome'da ba'zan speechSynthesis "pauza" holatida qolib
    // ketadi va shundan keyingi speak() chaqiruvlari sababsiz jim
    // o'tadi — resume() shu holatni oldindan tozalaydi.
    speechSynthesis.resume();
    speechSynthesis.cancel(); // oldingi o'qishni to'xtatib, yangisini boshlaydi

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    if (_enVoice) utter.voice = _enVoice;
    utter.rate = 0.9;

    let started = false;
    utter.onstart = () => { started = true; };
    utter.onerror = (ev) => {
      console.error("Talaffuzda xatolik (speechSynthesis):", ev.error || ev);
      if (!started) _fallbackSpeak(text);
    };

    speechSynthesis.speak(utter);

    // WebView'da speak() na xato, na onstart bermay "jim" o'tirib
    // qoladi — shu holatni ushlab, fallback'ga o'tamiz.
    setTimeout(() => {
      if (!started) {
        try { speechSynthesis.cancel(); } catch (e) {}
        _fallbackSpeak(text);
      }
    }, 400);
  } catch (e) {
    console.error("Ovozda o'qishda xatolik:", e);
    _fallbackSpeak(text);
  }
}

// "🔊" tugmasi uchun umumiy HTML — so'z data-word atributida (HTML
// tarzida ekranlangan holda) saqlanadi, shunda apostrof/qo'shtirnoq
// kabi belgilar JS satriga noto'g'ri kiritilib qolmaydi. Bosilganda
// atrofdagi elementga (masalan flashcard flip) hodisa tarqalmasligi
// uchun stopPropagation chaqiriladi.
function speakBtnHtml(word) {
  return `<button type="button" class="speak-btn" data-word="${escapeHtmlGlobal(word)}" onclick="event.stopPropagation(); speakWord(this.dataset.word)" aria-label="Talaffuzni eshitish" title="Talaffuzni eshitish">🔊</button>`;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
