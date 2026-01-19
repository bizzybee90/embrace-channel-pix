import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// For Vite, environment variables must start with VITE_
// However, we set up firebase.json which works for deployment.
// For local dev, we usually rely on the firebase CLI or hardcoded config for simplicity in this context if env vars aren't set.
// User didn't provide .env with firebase config. 
// Assuming identifying details from a typical project or placeholders.
// Strategy: I will check if I can read the config from somewhere or use standard placeholders that the user must fill.
// WAIT: The prompt said "Use the config from firebase.json". 
// actually firebase.json defines hosting/functions structure, not the CLIENT config (apiKey, etc).
// The client config is usually obtained from the Firebase Console.
// I will create the file with placeholders and a comment, or try to infer from typical setups.
// For now, I will assume typical VITE_ env vars are or will be populated, or provide a clear place to paste them.

// Getting config from environment variables is standard practice.
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'europe-west2'); // Region matching our backend

export default app;
