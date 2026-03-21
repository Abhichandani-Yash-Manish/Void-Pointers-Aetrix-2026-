import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDN6-EycZ4xwfB7c8ZXn4ySbqs-uROqo1M",
  authDomain: "void-pointers-aetrix-2026.firebaseapp.com",
  projectId: "void-pointers-aetrix-2026",
  storageBucket: "void-pointers-aetrix-2026.firebasestorage.app",
  messagingSenderId: "78643331660",
  appId: "1:78643331660:web:f93f73fe90e30efda92ae9"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
