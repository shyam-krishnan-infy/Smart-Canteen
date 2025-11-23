// /mnt/data/LoginPage.js
import React, { useState } from "react";
import { auth } from "../firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  fetchSignInMethodsForEmail,
} from "firebase/auth";
import db from "../firestore";
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
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const navigate = useNavigate();

  // "login" or "register"
  const [mode, setMode] = useState("login");

  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
  });

  const [regForm, setRegForm] = useState({
    fullName: "",
    employeeId: "",
    email: "",
    password: "",
    confirm: "",
  });

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLoginChange = (field, value) => {
    setLoginForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleRegChange = (field, value) => {
    setRegForm((prev) => ({ ...prev, [field]: value }));
  };

  // ---------- LOGIN ----------
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);

    try {
      // 1) Sign in
      const cred = await signInWithEmailAndPassword(
        auth,
        loginForm.email.trim(),
        loginForm.password
      );

      const current = cred.user || auth.currentUser;
      if (!current) {
        setError("Failed to sign in. Please try again.");
        setLoading(false);
        return;
      }

      // 2) Load profile from Firestore (users collection)
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", current.email), limit(1));
      const snap = await getDocs(q);

      if (snap.empty) {
        // If you don't have a profile for this email, we still allow sign-in
        // but show a message — optionally you can block login here.
        setInfo("Signed in but no profile found in users collection.");
        // continue to navigate — adjust if you want stricter checks
        navigate("/");
        return;
      }

      const profile = snap.docs[0].data();

      // 3) Determine whether to enforce email verification
      const role = (profile.role || "").toLowerCase();
      const isAdminOrVendor = role === "admin" || role === "vendor";

      // If user is admin/vendor -> skip verification check
      if (isAdminOrVendor) {
        // allow login even if email not verified
        navigate("/");
        return;
      }

      // For employees (or other roles) — require emailVerified
      // If emailVerified -> allow
      if (current.emailVerified) {
        navigate("/");
        return;
      }

      // If not verified -> send verification email (if possible) and inform user
      try {
        const actionCodeSettings = {
          url: `${window.location.origin}/verify?email=${encodeURIComponent(
            current.email
          )}`,
          handleCodeInApp: true,
        };
        await sendEmailVerification(current, actionCodeSettings);
        setInfo(
          "Email not verified. A verification link has been sent to your inbox. Check spam/junk. After verifying, click 'Complete verification' on this page."
        );
      } catch (mailErr) {
        console.warn("Failed to send verification email:", mailErr);
        setError(
          "Email not verified and we couldn't send a verification email automatically. Please check your email or contact support."
        );
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  // ---------- REGISTRATION (with duplicate checks) ----------
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    const { fullName, employeeId, email, password, confirm } = regForm;

    if (!fullName || !email || !password || !confirm) {
      setError("All fields marked * are required.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password should be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", email.trim()), limit(1));
      const snap = await getDocs(q);

      // 1) If a users doc exists and already has a uid -> block (already claimed)
      if (!snap.empty) {
        const existingDoc = snap.docs[0].data();
        if (existingDoc.uid) {
          setError(
            "An account for this email already exists. Please login or contact admin if you think this is an error."
          );
          setLoading(false);
          return;
        }
        // else: users doc exists but no uid -> admin pre-created profile (allowed)
      }

      // 2) Check Firebase Auth if an account already exists for this email
      //    If an auth account already exists, block registration and ask user to sign in
      try {
        const methods = await fetchSignInMethodsForEmail(auth, email.trim());
        if (methods && methods.length > 0) {
          // There's already an auth account for this email
          setError(
            "An authentication account already exists for this email. Please sign in or reset your password."
          );
          setLoading(false);
          return;
        }
      } catch (fetchErr) {
        // If fetchSignInMethods fails, we still proceed carefully (but better to block)
        console.warn("fetchSignInMethodsForEmail failed:", fetchErr);
      }

      // Passed checks — create auth user
      const cred = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      const firebaseUser = cred.user;

      // 3) Send verification email (actionCodeSettings points to /verify)
      const actionCodeSettings = {
        url: `${window.location.origin}/verify?email=${encodeURIComponent(
          firebaseUser.email
        )}`,
        handleCodeInApp: true,
      };

      try {
        await sendEmailVerification(firebaseUser, actionCodeSettings);
      } catch (mailErr) {
        console.warn("Failed to send verification email:", mailErr);
      }

      // 4) Create or update users doc but keep pending until verified
      const snapAfter = await getDocs(q); // re-query to get latest
      if (snapAfter.empty) {
        // No existing profile → create a pending EMPLOYEE profile.
        await addDoc(usersRef, {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          name: fullName.trim(),
          role: "employee",
          employeeId: employeeId.trim() || null,
          vendorId: null,
          createdAt: serverTimestamp(),
          createdVia: "self-register",
          emailVerified: false, // pending until user confirms via email link
          pendingVerification: true,
        });

        setInfo(
          "Account created — verification email sent. Please open your email, click the verification link, then come back and click \"Complete verification\"."
        );
      } else {
        // There is an existing profile (admin-created). Do NOT overwrite the profile with uid right away.
        // Instead note a pending link and wait for email verification.
        const docSnap = snapAfter.docs[0];

        await updateDoc(docSnap.ref, {
          // preserve existing fields, add a pendingUid marker
          pendingUid: firebaseUser.uid,
          emailVerified: false,
          pendingVerification: true,
          updatedAt: serverTimestamp(),
        });

        const existing = docSnap.data();
        const roleLabel = existing.role || "user";
        setInfo(
          `A ${roleLabel} profile exists for this email. Verification email sent. After you verify your email, click "Complete verification" to link your account to the existing profile.`
        );
      }

      // Keep the user signed in — they must verify then click Complete verification.
    } catch (err) {
      console.error("Registration error:", err);
      // Prefer friendly messages for known firebase errors
      const msg = (err && err.code) || "";
      if (msg === "auth/email-already-in-use") {
        setError("That email is already in use. Please sign in or reset your password.");
      } else {
        setError(err.message || "Failed to register.");
      }
    } finally {
      setLoading(false);
    }
  };

  // User clicks this after clicking the verification link in their email.
  const handleCompleteVerification = async () => {
    setError("");
    setInfo("");
    setLoading(true);

    try {
      // ensure auth.currentUser is present
      const current = auth.currentUser;
      if (!current) {
        setError("No active user session found. Please login again after verifying your email.");
        setLoading(false);
        return;
      }

      // Reload to fetch latest emailVerified state
      await current.reload();

      if (!current.emailVerified) {
        setError("Email not verified yet. Please click the verification link in your email and then try again.");
        setLoading(false);
        return;
      }

      // Now email is verified — finalize Firestore user doc
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", current.email), limit(1));
      const snap = await getDocs(q);

      if (snap.empty) {
        // Shouldn't normally happen (we create a doc earlier), but create one now as verified employee.
        await addDoc(usersRef, {
          uid: current.uid,
          email: current.email,
          name: regForm.fullName?.trim() || current.displayName || "",
          role: "employee",
          employeeId: regForm.employeeId?.trim() || null,
          vendorId: null,
          createdAt: serverTimestamp(),
          createdVia: "self-register",
          emailVerified: true,
          pendingVerification: false,
          updatedAt: serverTimestamp(),
        });
      } else {
        const docSnap = snap.docs[0];
        const existing = docSnap.data();

        // If admin had pre-created profile, attach uid (either pendingUid or current.uid)
        await updateDoc(docSnap.ref, {
          uid: current.uid,
          name: existing.name || regForm.fullName?.trim() || existing.name || "",
          employeeId: existing.employeeId || regForm.employeeId?.trim() || null,
          emailVerified: true,
          pendingVerification: false,
          pendingUid: null,
          updatedAt: serverTimestamp(),
        });
      }

      setInfo("Email verified and account linked. Redirecting…");

      // navigate to app — AuthContext / RoleLanding will route by role
      setTimeout(() => {
        navigate("/");
      }, 700);
    } catch (err) {
      console.error("Complete verification error:", err);
      setError(err.message || "Failed to complete verification.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="container" style={{ maxWidth: 520, marginTop: 40 }}>
        <h1 className="page-title">Smart Canteen Portal</h1>
        <p className="page-subtitle">
          One login for employees, vendors and admins.
        </p>

        {/* Mode switch */}
        <div
          style={{
            marginTop: 16,
            marginBottom: 16,
            display: "flex",
            gap: 8,
            background: "#f3f4f6",
            padding: 4,
            borderRadius: 999,
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
              setInfo("");
            }}
            style={{
              flex: 1,
              padding: "6px 12px",
              borderRadius: 999,
              border: "none",
              background: mode === "login" ? "#ffffff" : "transparent",
              boxShadow: mode === "login" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError("");
              setInfo("");
            }}
            style={{
              flex: 1,
              padding: "6px 12px",
              borderRadius: 999,
              border: "none",
              background: mode !== "login" ? "#ffffff" : "transparent",
              boxShadow: mode !== "login" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            New employee / vendor registration
          </button>
        </div>

        {/* Error / info banners */}
        {error && (
          <div
            style={{
              marginBottom: 8,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #fecaca",
              background: "#fef2f2",
              fontSize: 13,
              color: "#b91c1c",
            }}
          >
            {error}
          </div>
        )}
        {info && (
          <div
            style={{
              marginBottom: 8,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #bbf7d0",
              background: "#f0fdf4",
              fontSize: 13,
              color: "#166534",
            }}
          >
            {info}
          </div>
        )}

        {/* ---------- LOGIN CARD ---------- */}
        {mode === "login" && (
          <div className="card" style={{ marginTop: 8 }}>
            <h2 className="card-title">Login</h2>
            <p className="small mt-8">
              Use the email and password created for you (or that you
              registered with).
            </p>

            <form
              onSubmit={handleLoginSubmit}
              style={{
                marginTop: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div>
                <div className="small">Email</div>
                <input
                  type="email"
                  className="input"
                  value={loginForm.email}
                  onChange={(e) =>
                    handleLoginChange("email", e.target.value)
                  }
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <div className="small">Password</div>
                <input
                  type="password"
                  className="input"
                  value={loginForm.password}
                  onChange={(e) =>
                    handleLoginChange("password", e.target.value)
                  }
                />
              </div>

              <button
                type="submit"
                className="btn"
                disabled={loading}
                style={{ marginTop: 4 }}
              >
                {loading ? "Signing in..." : "Login"}
              </button>
            </form>
          </div>
        )}

        {/* ---------- REGISTRATION CARD ---------- */}
        {mode !== "login" && (
          <div className="card" style={{ marginTop: 8 }}>
            <h2 className="card-title">New registration</h2>
            <p className="small mt-8">
              <strong>Employees:</strong> fill your details and create your
              account. <br />
              <strong>Vendors:</strong> ask the admin to first create your
              vendor profile in the Admin panel, then register here using the{" "}
              <strong>same email</strong>.
            </p>

            <form
              onSubmit={handleRegisterSubmit}
              style={{
                marginTop: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div>
                <div className="small">
                  Full name <span style={{ color: "#b91c1c" }}>*</span>
                </div>
                <input
                  className="input"
                  value={regForm.fullName}
                  onChange={(e) =>
                    handleRegChange("fullName", e.target.value)
                  }
                  placeholder="Your full name"
                />
              </div>
              <div>
                <div className="small">
                  Employee ID{" "}
                  <span style={{ color: "#6b7280" }}>(optional for vendors)</span>
                </div>
                <input
                  className="input"
                  value={regForm.employeeId}
                  onChange={(e) =>
                    handleRegChange("employeeId", e.target.value)
                  }
                  placeholder="EMP123 (optional)"
                />
              </div>
              <div>
                <div className="small">
                  Work email <span style={{ color: "#b91c1c" }}>*</span>
                </div>
                <input
                  type="email"
                  className="input"
                  value={regForm.email}
                  onChange={(e) =>
                    handleRegChange("email", e.target.value)
                  }
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <div className="small">
                  Password <span style={{ color: "#b91c1c" }}>*</span>
                </div>
                <input
                  type="password"
                  className="input"
                  value={regForm.password}
                  onChange={(e) =>
                    handleRegChange("password", e.target.value)
                  }
                />
              </div>
              <div>
                <div className="small">
                  Confirm password{" "}
                  <span style={{ color: "#b91c1c" }}>*</span>
                </div>
                <input
                  type="password"
                  className="input"
                  value={regForm.confirm}
                  onChange={(e) =>
                    handleRegChange("confirm", e.target.value)
                  }
                />
              </div>

              <button
                type="submit"
                className="btn"
                disabled={loading}
                style={{ marginTop: 4 }}
              >
                {loading ? "Creating account…" : "Create account"}
              </button>
            </form>

            <div style={{ marginTop: 12 }}>
              <div className="small">
                After creating an account you'll receive a verification email.
                Please click the link in that email and then come back here and
                click <strong>"Complete verification"</strong> to finalize your
                account activation.
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button
                  className="btn outline"
                  onClick={handleCompleteVerification}
                  disabled={loading}
                >
                  Complete verification
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    // allow user to resend verification email (if they are signed in)
                    const current = auth.currentUser;
                    if (!current) {
                      setError("No active user session. If you already registered, please login and then request verification.");
                      return;
                    }
                    setLoading(true);
                    const actionCodeSettings = {
                      url: `${window.location.origin}/verify?email=${encodeURIComponent(current.email)}`,
                      handleCodeInApp: true,
                    };
                    sendEmailVerification(current, actionCodeSettings)
                      .then(() => {
                        setInfo("Verification email resent. Please check your inbox.");
                      })
                      .catch((e) => {
                        console.error("Resend verification error:", e);
                        setError("Failed to resend verification email.");
                      })
                      .finally(() => setLoading(false));
                  }}
                >
                  Resend verification email
                </button>
              </div>
            </div>

            <p className="small" style={{ marginTop: 12 }}>
              After registration and verification you'll be taken to your
              dashboard based on your role (Employee / Vendor / Admin).
              Roles come from your profile in the <code>users</code> collection.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
