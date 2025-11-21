// src/pages/LoginPage.js
import React, { useState } from "react";
import { auth } from "../firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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
      await signInWithEmailAndPassword(
        auth,
        loginForm.email.trim(),
        loginForm.password
      );

      // AuthContext + RoleLanding will route based on role
      navigate("/");
    } catch (err) {
      console.error("Login error:", err);
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  // ---------- REGISTRATION ----------
  // Flow:
  // 1. Create Firebase Auth account.
  // 2. Look for existing profile in `users` with this email (Admin-created vendor / employee).
  // 3. If found -> attach uid to that profile.
  //    If not found -> create new EMPLOYEE profile.
  // 4. Keep user logged in and send them to "/".
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
      // 1️⃣ Create auth user
      const cred = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      const firebaseUser = cred.user;

      // 2️⃣ Look for an existing profile created by admin (e.g. vendor)
      const usersRef = collection(db, "users");
      const q = query(
        usersRef,
        where("email", "==", firebaseUser.email),
        limit(1)
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        // No existing profile → default to EMPLOYEE
        await addDoc(usersRef, {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          name: fullName.trim(),
          role: "employee",
          employeeId: employeeId.trim() || null,
          vendorId: null,
          createdAt: serverTimestamp(),
          createdVia: "self-register",
        });

        setInfo("Employee account created. Redirecting to your dashboard…");
      } else {
        // Attach uid to existing profile (could be vendor OR employee)
        const docSnap = snap.docs[0];
        const existing = docSnap.data();

        await updateDoc(docSnap.ref, {
          uid: firebaseUser.uid,
          name: existing.name || fullName.trim(),
          employeeId: existing.employeeId || employeeId.trim() || null,
          updatedAt: serverTimestamp(),
        });

        const roleLabel = existing.role || "user";
        setInfo(
          `Account linked to existing ${roleLabel} profile. Redirecting…`
        );
      }

      // 3️⃣ User stays logged in → let AuthContext pick role and route
      setTimeout(() => {
        navigate("/");
      }, 800);
    } catch (err) {
      console.error("Registration error:", err);
      setError(err.message || "Failed to register.");
    } finally {
      setLoading(false);
    }
  };

  const isLoginMode = mode === "login";

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
              background: isLoginMode ? "#ffffff" : "transparent",
              boxShadow: isLoginMode ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
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
              background: !isLoginMode ? "#ffffff" : "transparent",
              boxShadow: !isLoginMode
                ? "0 1px 3px rgba(0,0,0,0.08)"
                : "none",
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
        {isLoginMode && (
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
        {!isLoginMode && (
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

            <p className="small" style={{ marginTop: 12 }}>
              After registration you&apos;ll be taken to your dashboard based
              on your role (Employee / Vendor / Admin). Roles come from your
              profile in the <code>users</code> collection.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}