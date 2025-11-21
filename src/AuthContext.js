// src/AuthContext.js
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { auth } from "./firebase";
import db from "./firestore";
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  addDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // Firebase auth user
  const [profile, setProfile] = useState(null); // Firestore `users` doc
  const [loading, setLoading] = useState(true); // loading auth + profile

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      setUser(firebaseUser);

      if (!firebaseUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        const email = firebaseUser.email || "";
        const uid = firebaseUser.uid;

        const usersRef = collection(db, "users");

        // 1️⃣ Try by uid first
        let q1 = query(usersRef, where("uid", "==", uid), limit(1));
        let snap = await getDocs(q1);

        // 2️⃣ Fallback: try by email (in case uid not yet attached)
        if (snap.empty && email) {
          const q2 = query(
            usersRef,
            where("email", "==", email),
            limit(1)
          );
          snap = await getDocs(q2);
        }

        // 3️⃣ If still nothing → auto-create a default EMPLOYEE profile
        if (snap.empty) {
          console.warn(
            "[AuthContext] No profile found; auto-creating default employee profile."
          );

          const docRef = await addDoc(usersRef, {
            uid,
            email: email || null,
            role: "employee",
            employeeId: null,
            vendorId: null,
            createdAt: serverTimestamp(),
            createdVia: "auto-bootstrap",
          });

          const newProfile = {
            id: docRef.id,
            uid,
            email,
            role: "employee",
            employeeId: null,
            vendorId: null,
          };
          setProfile(newProfile);
          setLoading(false);
          return;
        }

        // 4️⃣ Profile exists; ensure it has a role
        const docSnap = snap.docs[0];
        const data = docSnap.data();

        if (!data.role) {
          console.warn(
            "[AuthContext] Profile without role detected; defaulting to employee."
          );
          await updateDoc(docSnap.ref, {
            role: "employee",
            updatedAt: serverTimestamp(),
          });
          data.role = "employee";
        }

        setProfile({ id: docSnap.id, ...data });
      } catch (err) {
        console.error("[AuthContext] Failed to load profile:", err);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const value = {
    user,
    profile,
    loading,
    logout: () => signOut(auth),
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}