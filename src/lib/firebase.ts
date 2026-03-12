import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// 這裡的設定請替換成您在 Firebase Console 取得的正式設定
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBge5NcCflxCHiRzcAL7jOxDDWXUjgdxRE",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "voxflow-pro.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "voxflow-pro",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "voxflow-pro.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "957058122655",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:957058122655:web:c0f6655d7016697e1873aa"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logOut = () => signOut(auth);
