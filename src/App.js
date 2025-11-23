// src/App.js
import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate
} from "react-router-dom";

import { AuthProvider, useAuth } from "./AuthContext";
import EmployeePage from "./pages/EmployeePage";
import VendorPage from "./pages/VendorPage";
import VendorOrdersPage from "./pages/VendorOrdersPage";
import VendorMenuPage from "./pages/VendorMenuPage";
import AdminPage from "./pages/AdminPage";
import LoginPage from "./pages/LoginPage";
import VerifyEmail from "./pages/VerifyEmail";

/**
 * ProtectedRoute: ensures user is signed in AND their email is verified.
 * Also enforces role-based access if allowedRoles is provided.
 *
 * Behavior:
 * - shows a short "Checking session..." placeholder while auth is loading.
 * - if no user -> redirect to /login
 * - if user exists but email is not verified -> redirect to /login?unverified=true
 * - if allowedRoles provided and user profile.role is missing/unauthorized -> show unauthorized message
 */
function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: 20 }}>Checking session...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // --- UPDATED: allow admin/vendor to bypass email verification ---
  const userRole = profile?.role || null;
  const bypassVerificationForRoles = ["admin", "vendor"];

  // Only enforce email verification for users who are NOT admin/vendor
  if (!bypassVerificationForRoles.includes(userRole) && !user.emailVerified) {
    // You can show a message on /login reading query param ?unverified=true
    return <Navigate to="/login?unverified=true" replace />;
  }

  if (allowedRoles && (!profile || !allowedRoles.includes(profile.role))) {
    return (
      <div style={{ padding: 20 }}>
        You are not authorized to view this page.
      </div>
    );
  }

  return children;
}

/**
 * RoleLanding: decides where to send a verified user based on Firestore profile.role
 * - If user is not signed in -> redirect to /login
 * - If profile missing or has no role -> show a helpful message
 * - Otherwise redirect to correct dashboard
 */
function RoleLanding() {
  const { user, profile, loading } = useAuth();

  if (loading) return <div style={{ padding: 20 }}>Loading...</div>;

  if (!user) return <Navigate to="/login" replace />;

  if (!profile || !profile.role) {
    return (
      <div style={{ padding: 20 }}>
        No role configured for this user. Please add a document in
        Firestore <code>users</code> collection with a <code>role</code> field.
      </div>
    );
  }

  if (profile.role === "employee") return <Navigate to="/employee" replace />;
  if (profile.role === "vendor") return <Navigate to="/vendor" replace />;
  if (profile.role === "admin") return <Navigate to="/admin" replace />;

  return <div style={{ padding: 20 }}>Unknown role: {profile.role}</div>;
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Login */}
          <Route path="/login" element={<LoginPage />} />

          {/* Verify (email action link lands here) */}
          <Route path="/verify" element={<VerifyEmail />} />

          {/* Employee */}
          <Route
            path="/employee"
            element={
              <ProtectedRoute allowedRoles={["employee"]}>
                <EmployeePage />
              </ProtectedRoute>
            }
          />

          {/* Vendor main dashboard */}
          <Route
            path="/vendor"
            element={
              <ProtectedRoute allowedRoles={["vendor"]}>
                <VendorPage />
              </ProtectedRoute>
            }
          />

          {/* Vendor orders page */}
          <Route
            path="/vendor/orders"
            element={
              <ProtectedRoute allowedRoles={["vendor"]}>
                <VendorOrdersPage />
              </ProtectedRoute>
            }
          />

          {/* Vendor menu management page */}
          <Route
            path="/vendor/menu"
            element={
              <ProtectedRoute allowedRoles={["vendor"]}>
                <VendorMenuPage />
              </ProtectedRoute>
            }
          />

          {/* Admin */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminPage />
              </ProtectedRoute>
            }
          />

          {/* Landing: redirect user based on role */}
          <Route path="/" element={<RoleLanding />} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
