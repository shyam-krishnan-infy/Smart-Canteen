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
import VendorOrdersPage from "./pages/VendorOrdersPage"; // 👈 NEW
import AdminPage from "./pages/AdminPage";
import LoginPage from "./pages/LoginPage";

function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: 20 }}>Checking session...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
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

// If user hits "/", send them to the correct page based on their role
function RoleLanding() {
  const { user, profile, loading } = useAuth();

  if (loading) return <div style={{ padding: 20 }}>Loading...</div>;

  if (!user) return <Navigate to="/login" replace />;

  if (!profile || !profile.role) {
    return (
      <div style={{ padding: 20 }}>
        No role configured for this user. Please add a document in
        Firestore `users` collection with a `role` field.
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

          {/* Vendor orders page (your new screen) */}
          <Route
            path="/vendor/orders"
            element={
              <ProtectedRoute allowedRoles={["vendor"]}>
                <VendorOrdersPage />
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