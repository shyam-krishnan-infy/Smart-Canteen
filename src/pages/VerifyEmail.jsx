// src/pages/VerifyEmail.jsx
import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { applyActionCode } from "firebase/auth";
import { auth } from "../firebase";

/**
 * VerifyEmail page:
 * - Reads oobCode from query string (?oobCode=...).
 * - Calls applyActionCode(auth, oobCode) to complete verification.
 * - On success redirects to /login?verified=true
 * - On failure shows an error message (link expired/used/invalid).
 */
export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const oobCode = searchParams.get("oobCode");
  const navigate = useNavigate();
  const [msg, setMsg] = useState("Verifying...");

  useEffect(() => {
    if (!oobCode) {
      setMsg("Invalid verification link.");
      return;
    }

    applyActionCode(auth, oobCode)
      .then(() => {
        setMsg("Email verified successfully! Redirecting to login...");
        // small delay so user sees the success message
        setTimeout(() => navigate("/login?verified=true"), 1400);
      })
      .catch((err) => {
        console.error("applyActionCode error:", err);
        // You might show different messages based on err.code if needed
        setMsg("Failed to verify. The link may be expired or already used.");
      });
  }, [oobCode, navigate]);

  return (
    <div style={{ padding: 24 }}>
      <h2>Email verification</h2>
      <p>{msg}</p>
    </div>
  );
}
