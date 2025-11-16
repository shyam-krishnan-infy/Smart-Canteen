// src/pages/AdminPage.js
import React, { useEffect, useState } from "react";
import db from "../firestore";
import { collection, onSnapshot } from "firebase/firestore";
import { useAuth } from "../AuthContext";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";

function todayString() {
  return new Date().toISOString().split("T")[0];
}

// Helper: get date string N days ago
function daysAgoString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

// Compute AI-style efficiency insights from recent orders
function computeAiInsights(orders) {
  if (!orders.length) {
    return {
      consideredOrders: 0,
      timeSavedMinutes: 0,
      avgPrepTimeMinutes: 0,
      wasteAvoidedKg: 0,
      cancelledCount: 0
    };
  }

  const cutoff = daysAgoString(7);
  const recent = orders.filter((o) => !o.date || o.date >= cutoff);

  const completedLike = [];
  let cancelledCount = 0;

  recent.forEach((o) => {
    const status = (o.status || "").toLowerCase();
    if (status === "ready" || status === "completed") {
      if (o.createdAt?.toDate && o.updatedAt?.toDate) {
        const created = o.createdAt.toDate();
        const updated = o.updatedAt.toDate();
        const diffMs = updated.getTime() - created.getTime();
        const diffMin = diffMs / 60000;
        if (diffMin > 0 && diffMin < 180) {
          completedLike.push(diffMin);
        }
      }
    } else if (status === "cancelled") {
      cancelledCount += 1;
    }
  });

  const completedCount = completedLike.length;
  const avgPrepTimeMinutes =
    completedCount === 0
      ? 0
      : completedLike.reduce((a, b) => a + b, 0) / completedCount;

  const BASELINE_PREP_MINUTES = 12;

  const perOrderSaving = Math.max(
    0,
    BASELINE_PREP_MINUTES - (avgPrepTimeMinutes || BASELINE_PREP_MINUTES)
  );

  const timeSavedMinutes = Math.round(perOrderSaving * completedCount);

  const WASTE_PER_ORDER_KG = 0.25;
  const wasteAvoidedKg = +(cancelledCount * WASTE_PER_ORDER_KG).toFixed(2);

  return {
    consideredOrders: recent.length,
    timeSavedMinutes,
    avgPrepTimeMinutes: completedCount ? avgPrepTimeMinutes : 0,
    wasteAvoidedKg,
    cancelledCount
  };
}

// SLA / service quality stats (last 7 days)
function computeSlaStats(orders) {
  const SLA_MINUTES = 15;
  const WINDOW_DAYS = 7;

  if (!orders.length) {
    return {
      totalCompleted: 0,
      avgPrepMinutes: 0,
      slaOnTimePercent: 0,
      perDay: []
    };
  }

  const today = new Date(todayString());
  const perDayMap = {};
  const dayList = [];

  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    perDayMap[key] = {
      date: key,
      completed: 0,
      totalMinutes: 0,
      onTimeCount: 0
    };
    dayList.push(key);
  }

  orders.forEach((o) => {
    const status = (o.status || "").toLowerCase();
    if (!(status === "ready" || status === "completed")) return;
    if (!o.date) return;
    if (!perDayMap[o.date]) return;

    if (!o.createdAt?.toDate || !o.updatedAt?.toDate) return;
    const created = o.createdAt.toDate();
    const updated = o.updatedAt.toDate();
    const diffMs = updated.getTime() - created.getTime();
    const diffMin = diffMs / 60000;
    if (!(diffMin > 0 && diffMin < 240)) return;

    const bucket = perDayMap[o.date];
    bucket.completed += 1;
    bucket.totalMinutes += diffMin;
    if (diffMin <= SLA_MINUTES) {
      bucket.onTimeCount += 1;
    }
  });

  let totalCompleted = 0;
  let totalMinutes = 0;
  let totalOnTime = 0;

  const perDay = dayList.map((key) => {
    const b = perDayMap[key];
    const avg =
      b.completed === 0 ? 0 : b.totalMinutes / b.completed;
    const onTimePercent =
      b.completed === 0
        ? 0
        : Math.round((b.onTimeCount / b.completed) * 100);

    totalCompleted += b.completed;
    totalMinutes += b.totalMinutes;
    totalOnTime += b.onTimeCount;

    return {
      date: b.date,
      completed: b.completed,
      avgPrepMinutes: avg,
      onTimePercent
    };
  });

  const avgPrepMinutes =
    totalCompleted === 0 ? 0 : totalMinutes / totalCompleted;
  const slaOnTimePercent =
    totalCompleted === 0
      ? 0
      : Math.round((totalOnTime / totalCompleted) * 100);

  return {
    totalCompleted,
    avgPrepMinutes,
    slaOnTimePercent,
    perDay
  };
}

export default function AdminPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "orders"),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setOrders(arr);
      },
      (err) => {
        console.error("AdminPage orders snapshot error:", err);
      }
    );

    return () => unsub();
  }, []);

  const totalOrders = orders.length;
  const today = todayString();
  const todayOrders = orders.filter((o) => o.date === today);

  const statusCounts = orders.reduce((acc, o) => {
    const key = o.status || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const itemCounts = orders.reduce((acc, o) => {
    const key = o.name || "Unnamed item";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const topItems = Object.entries(itemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const ai = computeAiInsights(orders);

  const paidOrders = orders.filter((o) => o.paymentStatus === "Paid");
  const totalRevenue = paidOrders.reduce(
    (sum, o) => sum + (Number(o.price) || 0),
    0
  );
  const todayPaidOrders = paidOrders.filter((o) => o.date === today);
  const todayRevenue = todayPaidOrders.reduce(
    (sum, o) => sum + (Number(o.price) || 0),
    0
  );

  const paymentCounts = orders.reduce((acc, o) => {
    const key = o.paymentStatus || "Pending";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const sla = computeSlaStats(orders);

  const styles = {
    container: { maxWidth: 1100, margin: "30px auto", padding: "0 20px" },
    heading: { fontSize: 32, fontWeight: 700, marginBottom: 10 },
    subheading: { color: "#555", marginBottom: 24 },
    cardsRow: {
      display: "flex",
      flexWrap: "wrap",
      gap: 16,
      marginBottom: 24
    },
    card: {
      flex: "1 1 220px",
      padding: 16,
      borderRadius: 10,
      border: "1px solid #e0e0e0",
      background: "#fff"
    },
    cardTitle: { fontSize: 14, color: "#777", marginBottom: 4 },
    cardValue: { fontSize: 24, fontWeight: 700 },
    sectionTitle: { fontSize: 18, fontWeight: 600, margin: "20px 0 10px" },
    statusList: { listStyle: "none", padding: 0, margin: 0 },
    statusItem: { fontSize: 14, marginBottom: 4 },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: 14,
      marginTop: 8
    },
    th: {
      textAlign: "left",
      padding: "8px 10px",
      borderBottom: "1px solid #ddd",
      background: "#f7f7f7"
    },
    td: {
      padding: "8px 10px",
      borderBottom: "1px solid #eee"
    },
    chip: {
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      background: "#e0f2ff",
      color: "#0366d6"
    },
    aiCard: {
      flex: "1 1 260px",
      padding: 16,
      borderRadius: 10,
      border: "1px solid #d0e2ff",
      background: "#f3f8ff"
    },
    aiHighlight: {
      fontSize: 26,
      fontWeight: 700
    },
    aiSub: {
      fontSize: 13,
      color: "#555",
      marginTop: 4
    }
  };

  return (
    <div style={styles.container}>
      {/* Auth bar */}
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
        </div>
        <button className="btn" onClick={() => signOut(auth)}>
          Logout
        </button>
      </div>

      <h1 style={styles.heading}>Admin Dashboard</h1>
      <div style={styles.subheading}>
        Live overview of canteen orders, revenue and AI-powered efficiency
        &amp; service quality insights.
      </div>

      {/* Top summary + AI cards */}
      <div style={styles.cardsRow}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Total Orders (All Time)</div>
          <div style={styles.cardValue}>{totalOrders}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Today&apos;s Orders</div>
          <div style={styles.cardValue}>{todayOrders.length}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Distinct Menu Items Ordered</div>
          <div style={styles.cardValue}>{Object.keys(itemCounts).length}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Total Revenue (Paid)</div>
          <div style={styles.cardValue}>₹{totalRevenue}</div>
          <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
            Today: ₹{todayRevenue}
          </div>
        </div>

        {/* SLA / Service Quality card */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            Service Quality (last 7 days, SLA 15 min)
          </div>
          <div style={styles.cardValue}>
            {sla.slaOnTimePercent}
            <span style={{ fontSize: 16 }}>% on-time</span>
          </div>
          <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
            Avg prep: {sla.avgPrepMinutes.toFixed(1)} min over{" "}
            {sla.totalCompleted} completed orders.
          </div>
        </div>

        {/* 🔮 AI Efficiency Insights card */}
        <div style={styles.aiCard}>
          <div style={styles.cardTitle}>AI Efficiency (last 7 days)</div>
          <div style={styles.aiHighlight}>
            {ai.timeSavedMinutes} min saved
          </div>
          <div style={styles.aiSub}>
            Estimated kitchen &amp; queue time saved using pre-book data,
            compared to a 12 min/order baseline.
          </div>
          <div style={{ marginTop: 10 }}>
            <strong>{ai.wasteAvoidedKg} kg</strong> food waste avoided via{" "}
            {ai.cancelledCount} early cancellations.
          </div>
          {ai.avgPrepTimeMinutes > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
              Avg prep time (completed): {ai.avgPrepTimeMinutes.toFixed(1)} min
            </div>
          )}
        </div>
      </div>

      {/* Orders by status */}
      <div>
        <div style={styles.sectionTitle}>Orders by Status</div>
        {Object.keys(statusCounts).length === 0 ? (
          <p>No orders yet.</p>
        ) : (
          <ul style={styles.statusList}>
            {Object.entries(statusCounts).map(([status, count]) => (
              <li key={status} style={styles.statusItem}>
                <strong>{status}</strong>: {count}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Payments by status */}
      <div>
        <div style={styles.sectionTitle}>Payments by Status</div>
        {Object.keys(paymentCounts).length === 0 ? (
          <p>No payment data yet.</p>
        ) : (
          <ul style={styles.statusList}>
            {Object.entries(paymentCounts).map(([status, count]) => (
              <li key={status} style={styles.statusItem}>
                <strong>{status}</strong>: {count}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* SLA trend */}
      <div>
        <div style={styles.sectionTitle}>SLA Trend (last 7 days)</div>
        {sla.perDay.length === 0 ? (
          <p>No SLA data yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Completed</th>
                <th style={styles.th}>Avg Prep (min)</th>
                <th style={styles.th}>On-time %</th>
              </tr>
            </thead>
            <tbody>
              {sla.perDay.map((d) => (
                <tr key={d.date}>
                  <td style={styles.td}>{d.date}</td>
                  <td style={styles.td}>{d.completed}</td>
                  <td style={styles.td}>{d.avgPrepMinutes.toFixed(1)}</td>
                  <td style={styles.td}>{d.onTimePercent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Top items */}
      <div>
        <div style={styles.sectionTitle}>Top Items (by count)</div>
        {topItems.length === 0 ? (
          <p>No items ordered yet.</p>
        ) : (
          <ul style={styles.statusList}>
            {topItems.map(([name, count]) => (
              <li key={name} style={styles.statusItem}>
                {name} — <strong>{count}</strong> orders
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Today’s orders table */}
      <div>
        <div style={styles.sectionTitle}>Today&apos;s Orders ({today})</div>
        {todayOrders.length === 0 ? (
          <p>No orders for today.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Item</th>
                <th style={styles.th}>Employee</th>
                <th style={styles.th}>Price</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Payment</th>
                <th style={styles.th}>Time</th>
              </tr>
            </thead>
            <tbody>
              {todayOrders.map((o) => (
                <tr key={o.id}>
                  <td style={styles.td}>{o.name}</td>
                  <td style={styles.td}>{o.userId}</td>
                  <td style={styles.td}>₹{o.price}</td>
                  <td style={styles.td}>
                    <span style={styles.chip}>{o.status || "Unknown"}</span>
                  </td>
                  <td style={styles.td}>
                    <span style={styles.chip}>
                      {o.paymentStatus || "Pending"}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {o.createdAt?.toDate
                      ? o.createdAt.toDate().toLocaleTimeString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}