// ── Level configuration ──────────────────────────────────────────
// `target` = uzoq muddatli maqsad (to'liq so'zlar soni shu darajada bo'lishi kerak).
// Amaldagi so'zlar soni data/*.json fayllardan avtomatik o'qiladi va
// progress shu asosda hisoblanadi — shuning uchun ko'rsatkich hech qachon yolg'on bo'lmaydi.
const LEVELS = [
  { id: 'beginner', name: 'Beginner', file: 'data/beginner.json', target: 1000 },
  { id: 'elementary', name: 'Elementary', file: 'data/elementary.json', target: 2000 },
  { id: 'pre-intermediate', name: 'Pre-Intermediate', file: 'data/pre-intermediate.json', target: 3000 },
];

const SESSION_SIZE = 10; // bitta o'qish sessiyasidagi so'zlar soni

// ── User / auth ───────────────────────────────────────────────────
function getUsers() {
  try { return JSON.parse(localStorage.getItem('vocab_users') || '{}'); }
  catch { return {}; }
}
function saveUsers(users) {
  localStorage.setItem('vocab_users', JSON.stringify(users));
}
function getCurrentUser() {
  return localStorage.getItem('vocab_current_user') || '';
}
function setCurrentUser(name) {
  localStorage.setItem('vocab_current_user', name);
}
function logout() {
  localStorage.removeItem('vocab_current_user');
  location.href = 'index.html';
}
function requireAuth() {
  const u = getCurrentUser();
  if (!u) { location.href = 'index.html'; return null; }
  return u;
}
function registerOrLogin(name) {
  name = name.trim();
  if (!name) return null;
  const users = getUsers();
  if (!users[name]) {
    users[name] = { createdAt: new Date().toISOString() };
    saveUsers(users);
  }
  setCurrentUser(name);
  return name;
}

// ── Progress ──────────────────────────────────────────────────────
function progressKey(user) { return 'vocab_progress_' + user; }

function getProgress(user) {
  try {
    const p = JSON.parse(localStorage.getItem(progressKey(user)) || '{}');
    LEVELS.forEach(l => { if (!Array.isArray(p[l.id])) p[l.id] = []; });
    return p;
  } catch {
    const empty = {};
    LEVELS.forEach(l => { empty[l.id] = []; });
    return empty;
  }
}
function saveProgress(user, progress) {
  localStorage.setItem(progressKey(user), JSON.stringify(progress));
}
function markLearned(user, levelId, enWord) {
  const progress = getProgress(user);
  const key = enWord.toLowerCase();
  if (!progress[levelId].includes(key)) {
    progress[levelId].push(key);
    saveProgress(user, progress);
  }
  return progress;
}

// ── Word data ─────────────────────────────────────────────────────
async function loadLevelWords(levelId) {
  const level = LEVELS.find(l => l.id === levelId);
  if (!level) throw new Error('Unknown level: ' + levelId);
  const res = await fetch(level.file);
  if (!res.ok) throw new Error('Could not load word list for ' + levelId);
  return res.json();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
