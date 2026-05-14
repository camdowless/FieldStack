import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// Connect to emulators only when explicitly enabled via VITE_USE_EMULATORS=true
export const useEmulators = import.meta.env.VITE_USE_EMULATORS === "true";

if (useEmulators) {
  console.log("[Firebase] Connecting to local emulators");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}

/**
 * Base URL for direct HTTP calls to Cloud Functions.
 *
 * - Emulator: calls functions directly at their emulator URL (no Hosting layer).
 *   http://127.0.0.1:5001/{projectId}/us-central1
 *
 * - Production: uses relative paths so requests go through Firebase Hosting rewrites
 *   (firebase.json maps /api/* → the correct function). This means same-origin requests
 *   with no CORS headers needed — the cleanest and most secure approach.
 *
 * This is used by fieldstackApi.ts, api.ts, and any other direct fetch() callers.
 */
export const functionsBaseUrl = useEmulators
  ? `http://127.0.0.1:5001/${import.meta.env.VITE_FIREBASE_PROJECT_ID}/us-central1`
  : "";
