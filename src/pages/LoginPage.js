// src/pages/LoginPage.js
import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import { useAuth } from "../AuthContext";

export default function LoginPage() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // If already logged in, send to home
  if (!loading && user && profile) {
    navigate("/");
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/"); // AuthContext will redirect them based on role
    } catch (err) {
      console.error("Login error", err);
      setError("Invalid email or password.");
    }
  };

  return (
    <div className="app-shell">
      <div className="login-wrapper">
        <div className="login-card">
          <div className="login-title">Smart Canteen</div>
          <div className="login-subtitle">
            Sign in with your office canteen account to continue.
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <input
              type="email"
              className="input"
              placeholder="Work email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <input
              type="password"
              className="input"
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button type="submit" className="btn" style={{ marginTop: 6 }}>
              Sign In
            </button>
          </form>

          {error && (
            <div
              style={{
                color: "#b91c1c",
                marginTop: 10,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
