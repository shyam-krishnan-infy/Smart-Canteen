// src/pages/VendorPage.js
import React, { useEffect, useState } from "react";
import db from "../firestore";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  serverTimestamp
} from "firebase/firestore";
import "./EmployeePage.css"; // reuse existing styles
import { useAuth } from "../AuthContext";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";
import { Link } from "react-router-dom";

// Helpers for dates
function todayString() {
  return new Date().toISOString().split("T")[0];
}

function daysAgoString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

// 🔮 Compute AI-style prep suggestions based on past orders + today's prebooked
function computePrepSuggestions(menuItems, orders) {
  if (!menuItems.length) return [];

  const today = todayString();
  const windowStart = daysAgoString(5); // look at last 5 days

  const suggestions = [];

  menuItems.forEach((item) => {
    const name = item.name;
    if (!name) return;

    // Recent orders for this item
    const recent = orders.filter(
      (o) =>
        o.name === name &&
        o.date &&
        o.date >= windowStart &&
        o.date <= today
    );

    const pastDaysOrders = recent.filter((o) => o.date < today);
    const pastCount = pastDaysOrders.length;

    const DAYS_WINDOW = 5;
    const avgPerDay = pastCount / DAYS_WINDOW;

    const todayPrebooked = orders.filter(
      (o) => o.name === name && o.date === today && o.status === "Prebooked"
    ).length;

    // Base forecast = today prebooked + weighted history
    let forecast = todayPrebooked + 0.7 * avgPerDay;
    if (forecast < todayPrebooked) forecast = todayPrebooked;
    forecast = Math.round(forecast);

    if (forecast <= 0) return;

    const activeToday = orders.filter(
      (o) =>
        o.name === name &&
        o.date === today &&
        ["Prebooked", "Preparing", "Ready"].includes(o.status)
    ).length;

    let prepNow = Math.max(0, forecast - activeToday);

    // If nothing is started but we forecast demand → recommend starting now
    if (activeToday === 0 && forecast > 0) {
      prepNow = Math.max(1, Math.round(forecast * 0.6));
    }

    suggestions.push({
      id: item.id,
      name,
      forecast,
      todayPrebooked,
      activeToday,
      prepNow
    });
  });

  suggestions.sort((a, b) => b.forecast - a.forecast);
  return suggestions;
}

export default function VendorPage() {
  const { user, profile } = useAuth();
  const [orders, setOrders] = useState([]);
  const [menuItems, setMenuItems] = useState([]);

  // Listen to orders
  useEffect(() => {
    const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setOrders(arr);
    });
    return () => unsub();
  }, []);

  // Listen to menu items
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "menu"), (snap) => {
      const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMenuItems(arr);
    });
    return () => unsub();
  }, []);

  // Update order status
  const updateStatus = async (orderId, newStatus) => {
    try {
      const d = doc(db, "orders", orderId);
      await updateDoc(d, {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to update order status", err);
      alert("Failed to update order status. Check console.");
    }
  };

  // Mark paid (cash)
  const markPaidCash = async (order) => {
    if (order.paymentStatus === "Paid") {
      alert("Already marked as paid.");
      return;
    }
    try {
      const d = doc(db, "orders", order.id);
      await updateDoc(d, {
        paymentStatus: "Paid",
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to mark paid", err);
      alert("Failed to update payment status. Check console.");
    }
  };

  // Toggle item availability
  const toggleAvailability = async (item) => {
    try {
      const ref = doc(db, "menu", item.id);
      await updateDoc(ref, {
        available: !item.available
      });
    } catch (err) {
      console.error("Failed to update availability", err);
      alert("Failed to update availability. Check console.");
    }
  };

  // Split orders
  const activeOrders = orders.filter(
    (o) => o.status !== "Completed" && o.status !== "Cancelled"
  );
  const completedOrders = orders.filter(
    (o) => o.status === "Completed" || o.status === "Cancelled"
  );

  // 🔮 AI prep suggestions
  const prepSuggestions = computePrepSuggestions(menuItems, orders);

  return (
    <div className="vendor-page container">
      {/* Auth bar + navigation */}
      <div
        style={{
          marginBottom: 20,
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid #eee",
          background: "#fafafa",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap"
        }}
      >
        <div>
          Logged in as{" "}
          <strong>{user?.email || user?.uid || "Unknown user"}</strong>
          {profile?.vendorId && (
            <span style={{ marginLeft: 8, fontSize: 13, color: "#555" }}>
              (Vendor ID: {profile.vendorId})
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {/* 👉 Button to Vendor Orders Page */}
          <Link to="/vendor/orders" className="btn">
            View Today&apos;s Orders
          </Link>
          <button className="btn danger" onClick={() => signOut(auth)}>
            Logout
          </button>
        </div>
      </div>

      <h1>Vendor — Manage Orders & Menu</h1>

      {/* 🔮 AI Prep Suggestions */}
      <h2>AI Prep Suggestions for Today</h2>
      {prepSuggestions.length === 0 ? (
        <p className="muted">
          Not enough data yet. As orders come in over a few days, AI will start
          suggesting how many plates to prep for each item.
        </p>
      ) : (
        <div className="my-orders">
          {prepSuggestions.map((s) => (
            <div key={s.id} className="order-card">
              <div>
                <h3>{s.name}</h3>
                <p>
                  Forecast for today: <strong>{s.forecast}</strong> orders
                </p>
                <p>
                  Pre-booked already today:{" "}
                  <strong>{s.todayPrebooked}</strong>
                </p>
                <p>
                  Currently active orders: <strong>{s.activeToday}</strong>
                </p>
                <p>
                  Suggested to prep now:{" "}
                  <strong>{s.prepNow}</strong> plate
                  {s.prepNow === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MENU AVAILABILITY SECTION */}
      <h2 style={{ marginTop: 30 }}>Menu Availability</h2>
      {menuItems.length === 0 ? (
        <p className="muted">No menu items found. Add items in Firestore.</p>
      ) : (
        <div className="menu-list">
          {menuItems.map((item) => (
            <div key={item.id} className="menu-card">
              <div className="menu-left">
                {item.image ? (
                  <img
                    src={item.image}
                    alt={item.name}
                    className="menu-thumb"
                  />
                ) : null}
              </div>
              <div className="menu-main">
                <h2>{item.name}</h2>
                <p>Price: ₹{item.price}</p>
                <p>
                  Available:{" "}
                  <strong style={{ color: item.available ? "#0a0" : "#c00" }}>
                    {item.available ? "Yes" : "No"}
                  </strong>
                </p>
              </div>
              <div className="vendor-actions">
                <button className="btn" onClick={() => toggleAvailability(item)}>
                  {item.available ? "Mark Unavailable" : "Mark Available"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ORDERS SECTION */}
      <h2 style={{ marginTop: 30 }}>Active Orders</h2>
      {activeOrders.length === 0 ? (
        <p className="muted">No active orders right now.</p>
      ) : (
        activeOrders.map((o) => {
          const payment = o.paymentStatus || "Pending";
          return (
            <div className="order-card" key={o.id}>
              <div>
                <h3>{o.name}</h3>
                <p>Price: ₹{o.price}</p>
                <p>Employee: {o.userId}</p>
                <p>
                  Status:{" "}
                  <span
                    className={
                      "status-badge status-" +
                      (o.status ? o.status.toLowerCase() : "completed")
                    }
                  >
                    {o.status}
                  </span>
                </p>
                <p>
                  Payment:{" "}
                  <span
                    className={
                      "status-badge payment-" + payment.toLowerCase()
                    }
                  >
                    {payment}
                  </span>
                </p>
                <small>
                  Created:{" "}
                  {o.createdAt?.toDate
                    ? o.createdAt.toDate().toLocaleString()
                    : "—"}
                </small>
              </div>
              <div className="vendor-actions">
                <button
                  className="btn"
                  onClick={() => updateStatus(o.id, "Preparing")}
                >
                  Mark Preparing
                </button>
                <button
                  className="btn"
                  onClick={() => updateStatus(o.id, "Ready")}
                >
                  Mark Ready
                </button>
                <button
                  className="btn danger"
                  onClick={() => updateStatus(o.id, "Completed")}
                >
                  Mark Completed
                </button>
                {payment !== "Paid" && o.status !== "Cancelled" && (
                  <button
                    className="btn"
                    onClick={() => markPaidCash(o)}
                  >
                    Mark Paid (Cash)
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}

      <h2 style={{ marginTop: 30 }}>Completed / Cancelled Orders</h2>
      {completedOrders.length === 0 ? (
        <p className="muted">No completed or cancelled orders yet.</p>
      ) : (
        completedOrders.map((o) => {
          const payment = o.paymentStatus || "Pending";
          return (
            <div className="order-card" key={o.id}>
              <div>
                <h3>{o.name}</h3>
                <p>Price: ₹{o.price}</p>
                <p>Employee: {o.userId}</p>
                <p>
                  Status:{" "}
                  <span
                    className={
                      "status-badge status-" +
                      (o.status ? o.status.toLowerCase() : "completed")
                    }
                  >
                    {o.status}
                  </span>
                </p>
                <p>
                  Payment:{" "}
                  <span
                    className={
                      "status-badge payment-" + payment.toLowerCase()
                    }
                  >
                    {payment}
                  </span>
                </p>
                <small>
                  Created:{" "}
                  {o.createdAt?.toDate
                    ? o.createdAt.toDate().toLocaleString()
                    : "—"}
                </small>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}