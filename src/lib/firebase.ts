import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// 確保使用設定檔中的 firestoreDatabaseId (如果有)
export const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId || '(default)');
const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result;
  } catch (error: any) {
    console.error("Firebase Auth Error:", error.code, error.message);
    if (error.code === 'auth/popup-closed-by-user') {
      console.warn("Popup was closed by the user before completing the sign-in.");
    } else if (error.code === 'auth/cancelled-popup-request') {
      console.warn("Multiple popup requests were made.");
    } else if (error.code === 'auth/internal-error') {
      console.error("Internal error during popup sign-in. This might be due to iframe restrictions.");
    }
    throw error;
  }
};
export const logOut = () => signOut(auth);
