// ── Firebase konfiguratsiyasi ─────────────────────────────────────
// Ushbu fayl firebase-app-compat.js, firebase-auth-compat.js va
// firebase-firestore-compat.js skriptlaridan KEYIN, lekin app.js'dan
// OLDIN ulanishi kerak (barcha sahifalarda shu tartib saqlanadi).
const firebaseConfig = {
  apiKey: "AIzaSyAddL6NDW5aOcGlGVLuUbUxv30ypGx7FGs",
  authDomain: "vocab-3609c.firebaseapp.com",
  projectId: "vocab-3609c",
  storageBucket: "vocab-3609c.firebasestorage.app",
  messagingSenderId: "98369446866",
  appId: "1:98369446866:web:b08fdae5ac84e5266c9e0b",
  measurementId: "G-V57W9YBGFH"
};

firebase.initializeApp(firebaseConfig);

// Global obyektlar — app.js va sahifa skriptlari shulardan foydalanadi.
const auth = firebase.auth();
const db = firebase.firestore();
