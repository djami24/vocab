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
    if (!p.later || typeof p.later !== 'object') p.later = {};
    LEVELS.forEach(l => { if (!Array.isArray(p.later[l.id])) p.later[l.id] = []; });
    if (!p.reviews || typeof p.reviews !== 'object') p.reviews = {};
    LEVELS.forEach(l => { if (!p.reviews[l.id] || typeof p.reviews[l.id] !== 'object') p.reviews[l.id] = {}; });
    return p;
  } catch {
    return emptyProgress();
  }
}
function emptyProgress() {
  const empty = {};
  LEVELS.forEach(l => { empty[l.id] = []; });
  empty.later = {};
  empty.reviews = {};
  LEVELS.forEach(l => { empty.later[l.id] = []; empty.reviews[l.id] = {}; });
  return empty;
}
function saveProgress(user, progress) {
  localStorage.setItem(progressKey(user), JSON.stringify(progress));
}

function markLearned(user, levelId, enWord) {
  const progress = getProgress(user);
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

  saveProgress(user, progress);
  if (wasNew) recordActivity(user);
  return progress;
}

// "Keyinroq" — foydalanuvchi hozircha o'tkazib yuborgan so'zlar shu yerga tushadi
function markLater(user, levelId, enWord) {
  const progress = getProgress(user);
  const key = enWord.toLowerCase();
  if (!progress.later[levelId].includes(key) && !progress[levelId].includes(key)) {
    progress.later[levelId].push(key);
    saveProgress(user, progress);
  }
  return progress;
}
function getLaterWords(user, levelId) {
  return getProgress(user).later[levelId];
}

// ── Takrorlash (spaced repetition, soddalashtirilgan SM-2) ─────────
function todayStr() { return new Date().toISOString().slice(0, 10); }
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function getDueReviewWords(user, levelId) {
  const progress = getProgress(user);
  const today = todayStr();
  const reviews = progress.reviews[levelId] || {};
  return Object.keys(reviews).filter(word => reviews[word].due <= today);
}
function getDueReviewCount(user, levelId) {
  return getDueReviewWords(user, levelId).length;
}
function reviewWord(user, levelId, enWord, remembered) {
  const progress = getProgress(user);
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
  saveProgress(user, progress);
  return progress;
}

// ── Faoliyat tarixi va streak (kunlik ketma-ketlik) ────────────────
function activityKey(user) { return 'vocab_activity_' + user; }
function getActivity(user) {
  try {
    const a = JSON.parse(localStorage.getItem(activityKey(user)) || '{}');
    return (a && typeof a === 'object') ? a : {};
  } catch { return {}; }
}
function saveActivity(user, activity) {
  localStorage.setItem(activityKey(user), JSON.stringify(activity));
}
function recordActivity(user) {
  const activity = getActivity(user);
  const today = todayStr();
  activity[today] = (activity[today] || 0) + 1;
  saveActivity(user, activity);
  return activity;
}
function getStreak(user) {
  const activity = getActivity(user);
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
function getLast14Days(user) {
  const activity = getActivity(user);
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
function flagsKey(user) { return 'vocab_flags_' + user; }
function getFlags(user) {
  try { return JSON.parse(localStorage.getItem(flagsKey(user)) || '{}'); }
  catch { return {}; }
}
function setFlag(user, name) {
  const flags = getFlags(user);
  flags[name] = true;
  localStorage.setItem(flagsKey(user), JSON.stringify(flags));
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
  a.download = `lugat-progress-${user}-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function importProgressFromObject(user, obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Noto\u2019g\u2019ri fayl formati');
  if (obj.progress) saveProgress(user, obj.progress);
  if (obj.activity) saveActivity(user, obj.activity);
  if (obj.flags) localStorage.setItem(flagsKey(user), JSON.stringify(obj.flags));
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

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
