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
    <div style={{ maxWidth: 380, margin: "60px auto", padding: "0 16px" }}>
      <h1>Login</h1>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 10, borderRadius: 6, border: "1px solid #ccc" }}
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: 10, borderRadius: 6, border: "1px solid #ccc" }}
        />

        <button
          type="submit"
          style={{
            padding: 10,
            borderRadius: 8,
            border: "none",
            background: "#0366d6",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Sign In
        </button>
      </form>

      {error && (
        <div style={{ color: "red", marginTop: 10, fontSize: 13 }}>{error}</div>
      )}
    </div>
  );
}