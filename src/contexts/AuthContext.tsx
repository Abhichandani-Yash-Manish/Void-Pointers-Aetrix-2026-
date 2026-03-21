import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import type { UserProfile, UserRole } from '../types';

// ── Known demo accounts ────────────────────────────────────────────────────────
// When a user signs in and no Firestore doc exists for their UID (e.g., the
// Firebase Auth account was created manually / via Firebase Console), we
// bootstrap the profile from this table so the role is correct.
const KNOWN_ACCOUNTS: Record<string, { name: string; role: UserRole }> = {
  'patel@hospital.guj.in': { name: 'Dr. Patel', role: 'pharmacist' },
  'shah@hospital.guj.in':  { name: 'Dr. Shah',  role: 'manager'    },
  'mehta@hospital.guj.in': { name: 'Dr. Mehta', role: 'admin'      },
};

// ── Context type ──────────────────────────────────────────────────────────────
interface AuthContextType {
  user:    User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn:  (email: string, password: string) => Promise<void>;
  signUp:  (email: string, password: string, name: string, role: UserRole) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        const profileRef = doc(db, 'users', firebaseUser.uid);
        const snap = await getDoc(profileRef);

        if (snap.exists()) {
          // Normal path — Firestore doc already exists
          setProfile(snap.data() as UserProfile);
        } else {
          // First sign-in: no Firestore doc for this UID yet.
          // Check if it's a known demo account; otherwise default to pharmacist.
          const email  = firebaseUser.email ?? '';
          const known  = KNOWN_ACCOUNTS[email.toLowerCase()];
          const newProfile: UserProfile = {
            uid:   firebaseUser.uid,
            name:  known?.name ?? (firebaseUser.displayName ?? email.split('@')[0]),
            email,
            role:  known?.role ?? 'pharmacist',
          };
          await setDoc(profileRef, newProfile);
          setProfile(newProfile);
        }
      } else {
        setProfile(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged handles profile fetch automatically
  };

  const signUp = async (
    email:    string,
    password: string,
    name:     string,
    role:     UserRole,
  ) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const newProfile: UserProfile = { uid: cred.user.uid, name, email, role };
    await setDoc(doc(db, 'users', cred.user.uid), newProfile);
    // onAuthStateChanged fires after this and will find the doc we just wrote
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Consumer hook ─────────────────────────────────────────────────────────────
export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within <AuthProvider>');
  return ctx;
}
