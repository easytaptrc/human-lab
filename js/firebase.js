// Conexión a Firebase compartida por todas las pantallas.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export * from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAyPC2L_FdJZfrHNbOjGJ0lmjDcO_ewlpU",
  authDomain: "easynegocio-6659a.firebaseapp.com",
  projectId: "easynegocio-6659a",
  storageBucket: "easynegocio-6659a.firebasestorage.app",
  messagingSenderId: "1098782625128",
  appId: "1:1098782625128:web:cf6d256eed69934bce5add",
  measurementId: "G-K54R37RQ4R"
};

// Servicio que genera las tarjetas de Apple Wallet y Google Wallet (Cloud Function "wallet")
export const WALLET_URL = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/wallet`;

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Modo de pruebas local con emuladores de Firebase: abrir http://localhost:5050/?emu
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
try { if (local && new URLSearchParams(location.search).has("emu")) sessionStorage.setItem("hpl_emu", "1"); } catch { /* sin almacenamiento */ }
export const USE_EMULATORS = local && (() => { try { return sessionStorage.getItem("hpl_emu") === "1"; } catch { return false; } })();

if (USE_EMULATORS) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
} else {
  // Analytics solo donde el navegador lo soporta (no bloquea la carga).
  import("https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js")
    .then(async (m) => { if (await m.isSupported()) m.getAnalytics(app); })
    .catch(() => {});
}
