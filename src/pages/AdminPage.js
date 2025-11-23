// src/pages/AdminPage.js
import React, { useEffect, useState } from "react";
import db from "../firestore";
import {
  collection,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useAuth } from "../AuthContext";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";

function todayString() {
  return new Date().toISOString().split("T")[0];
}

function daysAgoString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

// 🔹 Time-of-day meal window for badge
function getCurrentMealWindowMeta() {
  const now = new Date();
  const hour = now.getHours();

  if (hour >= 7 && hour < 12) {
    return { label: "Breakfast", range: "07:00 – 11:59" };
  }
  if (hour >= 12 && hour < 16) {
    return { label: "Lunch", range: "12:00 – 15:59" };
  }
  if (hour >= 16 && hour < 19) {
    return { label: "Snacks", range: "16:00 – 18:59" };
  }
  if (hour >= 19 && hour < 23) {
    return { label: "Dinner", range: "19:00 – 22:59" };
  }
  return null; // outside main windows
}

// AI-style efficiency insights
function computeAiInsights(orders) {
  if (!orders.length) {
    return {
      consideredOrders: 0,
      timeSavedMinutes: 0,
      avgPrepTimeMinutes: 0,
      wasteAvoidedKg: 0,
      cancelledCount: 0,
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
    cancelledCount,
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
      perDay: [],
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
      onTimeCount: 0,
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
    const avg = b.completed === 0 ? 0 : b.totalMinutes / b.completed;
    const onTimePercent =
      b.completed === 0 ? 0 : Math.round((b.onTimeCount / b.completed) * 100);

    totalCompleted += b.completed;
    totalMinutes += b.totalMinutes;
    totalOnTime += b.onTimeCount;

    return {
      date: b.date,
      completed: b.completed,
      avgPrepMinutes: avg,
      onTimePercent,
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
    perDay,
  };
}

/**
 * Heatmap: last 7 days × time slots
 */
const TIME_SLOTS = [
  { id: "breakfast", label: "Breakfast", from: 7, to: 10 },
  { id: "lunch", label: "Lunch", from: 12, to: 15 },
  { id: "snacks", label: "Snacks", from: 16, to: 18 },
  { id: "dinner", label: "Dinner", from: 19, to: 23 }, // added dinner
];

function getHour(o) {
  if (!o.createdAt?.toDate) return null;
  return o.createdAt.toDate().getHours();
}

function computeDemandHeatmap(orders) {
  const WINDOW_DAYS = 7;
  if (!orders.length) return { rows: [], max: 0 };

  const today = new Date(todayString());
  const rows = [];
  let maxCount = 0;

  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().split("T")[0];

    const row = { date: dateKey, slots: {} };

    for (const slot of TIME_SLOTS) {
      let count = 0;
      for (const o of orders) {
        if (o.date !== dateKey) continue;
        const h = getHour(o);
        if (h == null) continue;
        if (h >= slot.from && h < slot.to) count += 1;
      }
      row.slots[slot.id] = count;
      if (count > maxCount) maxCount = count;
    }

    rows.push(row);
  }

  return { rows, max: maxCount || 1 };
}

function computeNextLunchForecast(orders) {
  if (!orders.length) {
    return { forecast: 0, lower: 0, upper: 0 };
  }

  const todayDate = new Date();
  const todayWeekday = todayDate.getDay(); // 0–6
  const lunchSlot = TIME_SLOTS[1]; // lunch

  const byDate = {};
  orders.forEach((o) => {
    if (!o.date) return;
    const h = getHour(o);
    if (h == null) return;
    const d = new Date(o.date);
    const wd = d.getDay();
    if (wd !== todayWeekday) return;
    if (o.date === todayString()) return;

    if (!byDate[o.date]) byDate[o.date] = 0;
    if (h >= lunchSlot.from && h < lunchSlot.to) {
      byDate[o.date] += 1;
    }
  });

  const counts = Object.values(byDate)
    .sort((a, b) => b - a)
    .slice(0, 3);

  if (!counts.length) {
    return { forecast: 0, lower: 0, upper: 0 };
  }

  const avg =
    counts.reduce((sum, v) => sum + v, 0) / (counts.length || 1);

  const forecast = Math.round(avg);
  const lower = Math.max(0, Math.round(forecast * 0.9));
  const upper = Math.round(forecast * 1.15);

  return { forecast, lower, upper };
}

function runQueueSimulation({
  durationMinutes = 45,
  newOrdersPerMin = 5,
  stations = 2,
  avgPrepMinutes = 6,
}) {
  const capacityPerMin = stations / avgPrepMinutes;
  let queue = 0;
  let totalQueue = 0;
  let maxQueue = 0;

  for (let t = 0; t < durationMinutes; t++) {
    const noise = (Math.random() - 0.5) * newOrdersPerMin * 0.3;
    const incoming = Math.max(
      0,
      Math.round(newOrdersPerMin + noise)
    );
    queue = Math.max(0, queue + incoming - capacityPerMin);
    totalQueue += queue;
    if (queue > maxQueue) maxQueue = queue;
  }

  const avgQueue = totalQueue / durationMinutes;
  const estMaxWait =
    capacityPerMin === 0
      ? 0
      : Math.round((maxQueue / capacityPerMin) * 10) / 10;

  return {
    maxQueue: Math.round(maxQueue),
    avgQueue: Math.round(avgQueue * 10) / 10,
    estMaxWait,
  };
}

export default function AdminPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [statusFilter, setStatusFilter] = useState("All");

  const [simParams, setSimParams] = useState({
    durationMinutes: 45,
    newOrdersPerMin: 5,
    stations: 2,
    avgPrepMinutes: 6,
  });
  const [simResult, setSimResult] = useState(null);

  const mealWindow = getCurrentMealWindowMeta();

  const [vendorForm, setVendorForm] = useState({
    name: "",
    email: "",
    vendorId: "",
    location: "",
    contactName: "",
  });
  const [vendorMsg, setVendorMsg] = useState("");

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

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setUsersList(arr);
      },
      (err) => {
        console.error("AdminPage users snapshot error:", err);
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

  const todayStatusCounts = todayOrders.reduce((acc, o) => {
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
  const sla = computeSlaStats(orders);
  const { rows: heatRows, max: heatMax } = computeDemandHeatmap(orders);
  const lunchForecast = computeNextLunchForecast(orders);

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

  const maxTopItemCount = topItems.length
    ? Math.max(...topItems.map(([, count]) => count))
    : 0;

  const kitchenCounts = orders.reduce((acc, o) => {
    const key = o.kitchen || "Main Kitchen";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const statusOrder = [
    "Prebooked",
    "Preparing",
    "Ready",
    "Completed",
    "Cancelled",
  ];
  const statusTabs = [
    "All",
    ...statusOrder.filter((s) => todayStatusCounts[s]),
  ];

  const filteredTodayOrders =
    statusFilter === "All"
      ? todayOrders
      : todayOrders.filter((o) => (o.status || "Unknown") === statusFilter);

  const liveQueueLength = orders.filter(
    (o) =>
      o.status &&
      !["Completed", "Cancelled"].includes(o.status)
  ).length;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7);

  const recentOrders = orders.filter((o) => {
    if (!o.createdAt?.toDate) return false;
    return o.createdAt.toDate() >= cutoffDate;
  });

  const activeUserIds = new Set();
  recentOrders.forEach((o) => {
    if (o.userId) activeUserIds.add(o.userId);
    else if (o.uid) activeUserIds.add(o.uid);
    else if (o.userEmail) activeUserIds.add(o.userEmail);
  });
  const activeUsersCount = activeUserIds.size;

  const newSignupsCount = usersList.filter((u) => {
    if (!u.createdAt?.toDate) return false;
    return u.createdAt.toDate() >= cutoffDate;
  }).length;

  const prebookedCount = recentOrders.filter(
    (o) => (o.status === "Prebooked") || (o.prebooked === true)
  ).length;
  const totalRecentOrders = recentOrders.length || 0;
  const prebookPct = totalRecentOrders === 0 ? 0 : Math.round((prebookedCount / totalRecentOrders) * 100);
  const estRushReductionPct = Math.round((prebookPct * 0.3) || 0);

  const handleVendorChange = (k, v) =>
    setVendorForm((p) => ({ ...p, [k]: v }));

  const handleCreateVendor = async (e) => {
    e.preventDefault();
    setVendorMsg("");
    try {
      await addDoc(collection(db, "users"), {
        name: vendorForm.name,
        email: vendorForm.email,
        role: "vendor",
        vendorId: vendorForm.vendorId,
        location: vendorForm.location || null,
        contactName: vendorForm.contactName || null,
        createdAt: serverTimestamp(),
      });
      setVendorMsg(
        `Vendor profile created. Ask them to register using the same email via Login -> New employee / vendor registration.`
      );
      setVendorForm({
        name: "",
        email: "",
        vendorId: "",
        location: "",
        contactName: "",
      });
    } catch (err) {
      console.error("Create vendor profile error:", err);
      setVendorMsg("Failed to create vendor profile. Check console.");
    }
  };

  const handleSimChange = (k, v) => {
    setSimParams((p) => ({ ...p, [k]: Number(v) }));
  };

  const handleRunSimulation = () => {
    const res = runQueueSimulation(simParams);
    setSimResult(res);
  };

  // Inline styles used specifically for this page
  const adminPageInlineStyles = `
    .admin-card-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; align-items: stretch; width: 100%; margin-top: 12px; }
    .admin-card-grid .card { display: flex; flex-direction: column; justify-content: space-between; height: 100%; min-height: 120px; box-sizing: border-box; }
    .card .card-header-row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .card p.small { margin-top:8px; color:#374151; }

    /* Heatmap specific styles */
    .heatmap-wrapper { width:100%; overflow:auto; padding-top: 8px; }
    .heatmap-grid { display:grid; gap:12px; align-items:center; }
    .heatmap-header { font-weight:700; color:#374151; text-align:center; }
    .heatmap-label { color:#374151; padding:8px 6px; text-align:left; }
    .heatmap-cell {
      display:flex; align-items:center; justify-content:center;
      height:44px; min-width:64px; border-radius:12px; font-weight:700;
      background: rgba(59,130,246,0.12); color:#0f172a;
    }

    @media (max-width:880px) {
      .admin-card-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
      .heatmap-cell { height:40px; min-width:56px; font-size:14px; }
    }
  `;

  return (
    <div className="app-shell">
      <div className="container">
        <style>{adminPageInlineStyles}</style>

        <div className="top-bar">
          <div>
            Logged in as{" "}
            <strong>{user?.email || user?.uid || "Unknown user"}</strong>
          </div>
          <button className="btn outline" onClick={() => signOut(auth)}>
            Logout
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <h1 style={{ margin: 0 }}>Admin dashboard</h1>
          <div style={{ color: "#6b7280", marginTop: 6 }}>Overview of orders, vendors, and KPIs</div>
        </div>

        {mealWindow && (
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid #d1fae5", background: "#ecfdf5", fontSize: 12, fontWeight: 600, color: "#047857" }}>
              Current active window: {mealWindow.label}
            </span>
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              Time range: {mealWindow.range}
            </span>
          </div>
        )}

        <div className="card-grid admin-card-grid" style={{ marginTop: 12 }}>
          <div className="card">
            <div className="card-header-row">
              <div className="card-header-main">
                <span className="metric-icon">📦</span>
                <div className="card-title">Total Orders</div>
              </div>
              <div className="card-value">{totalOrders}</div>
            </div>
            <p className="small mt-8">All historical orders currently stored in Firestore.</p>
          </div>

          <div className="card">
            <div className="card-header-row">
              <div className="card-header-main">
                <span className="metric-icon">📅</span>
                <div className="card-title">Today's Orders</div>
              </div>
              <div className="card-value">{todayOrders.length}</div>
            </div>
            <p className="small mt-8">Date filter: <strong>{today}</strong>.</p>
          </div>

          <div className="card">
            <div className="card-header-row">
              <div className="card-header-main">
                <span className="metric-icon">🍽️</span>
                <div className="card-title">Distinct Menu Items</div>
              </div>
              <div className="card-value">{Object.keys(itemCounts).length}</div>
            </div>
            <p className="small mt-8">Unique dish names ordered at least once.</p>
          </div>

          <div className="card">
            <div className="card-header-row">
              <div className="card-header-main">
                <span className="metric-icon">🧾</span>
                <div className="card-title">Order Status Totals</div>
              </div>
              <div className="card-value">{Object.values(statusCounts).reduce((s,v)=>s+v,0)}</div>
            </div>
            <p className="small mt-8">{Object.entries(statusCounts).length === 0 ? "No orders yet." : Object.entries(statusCounts).map(([k,v]) => `${k}: ${v}`).join(" • ")}</p>
          </div>

          <div className="card">
            <div className="card-header-row">
              <div className="card-header-main">
                <span className="metric-icon">💳</span>
                <div className="card-title">Payments</div>
              </div>
              <div className="card-value">{Object.values(paymentCounts).reduce((s,v)=>s+v,0)}</div>
            </div>
            <p className="small mt-8">{Object.entries(paymentCounts).length === 0 ? "No payments yet." : Object.entries(paymentCounts).map(([k,v]) => `${k}: ${v}`).join(" • ")}</p>
          </div>
       

	<div className="card">
  	  <div className="card-header-row">
            <div className="card-header-main">
              <span className="metric-icon">💵</span>
              <div className="card-title">Today's Revenue</div>
           </div>
           <div className="card-value">
             ₹{Number(todayRevenue).toLocaleString()}
          </div>
        </div>

        <p className="small mt-8">
          Revenue from all paid orders today.
        </p>
       </div>

       </div>

        <div className="card-grid admin-card-grid" style={{ marginTop: 18 }}>
          <div className="card">
            <div className="card-header-row">
              <div className="card-header-main">
                <span className="metric-icon">🤖</span>
                <div className="card-title">AI Insights (7 days)</div>
              </div>
              <div className="card-value">{ai.consideredOrders}</div>
            </div>
            <p className="small mt-8">Avg prep time: {ai.avgPrepTimeMinutes ? ai.avgPrepTimeMinutes.toFixed(1) : 0} min</p>
          </div>

          <div className="card">
            <div className="card-header-row">
              <div className="card-header-main">
                <span className="metric-icon">👥</span>
                <div className="card-title">Active Users (7 days)</div>
              </div>
              <div className="card-value">{activeUsersCount}</div>
            </div>
            <p className="small mt-8">Unique users who placed orders in the last 7 days.</p>
            <p className="small mt-8"><strong>{newSignupsCount}</strong> new signups (last 7 days).</p>
          </div>

          <div className="card">
            <div className="card-header-row">
              <div className="card-header-main">
                <span className="metric-icon">📆</span>
                <div className="card-title">Pre-booking % (7 days)</div>
              </div>
              <div className="card-value">{prebookPct}<span style={{ fontSize: 16 }}>%</span></div>
            </div>
            <p className="small mt-8">Of orders in the last 7 days that were pre-booked vs live orders.</p>
            <p className="small mt-8">Estimated kitchen rush reduced by <strong>{estRushReductionPct}%</strong>.</p>
          </div>
        </div>

        {/* HEATMAP SECTION */}
        <div className="card-grid admin-card-grid" style={{ marginTop: 24 }}>
          <div className="card">
            <div className="card-header-row">
              <div className="card-header-main">
                <div className="card-title">AI Demand Heatmap</div>
              </div>
            </div>
            <p className="small mt-8">Last 7 days — darker cells mean heavier demand in that time slot.</p>

            <div className="heatmap-wrapper">
              {heatRows.length === 0 ? (
                <div className="info-banner muted mt-12">Not enough data yet.</div>
              ) : (
                (() => {
                  // compute template columns: first column for date labels, then one for each time slot
                  const cols = `140px repeat(${TIME_SLOTS.length}, 1fr)`;
                  return (
                    <div className="heatmap-grid" style={{ gridTemplateColumns: cols }}>
                      {/* top-left empty placeholder */}
                      <div style={{}} />
                      {/* slot headers */}
                      {TIME_SLOTS.map((s) => (
                        <div key={s.id} className="heatmap-header">{s.label}</div>
                      ))}

                      {/* rows */}
                      {heatRows.map((row) => (
                        <React.Fragment key={row.date}>
                          <div className="heatmap-label">{row.date}</div>
                          {TIME_SLOTS.map((slot) => {
                            const val = row.slots[slot.id] || 0;
                            const intensity = val === 0 ? 0 : val / heatMax;
                            const alpha = 0.12 + intensity * 0.65;
                            const bg = `rgba(59,130,246,${alpha})`;
                            const color = intensity > 0.5 ? "#ffffff" : "#0f172a";
                            return (
                              <div key={slot.id} className="heatmap-cell" style={{ background: bg, color }}>
                                {val}
                              </div>
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </div>
                  );
                })()
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header-row">
              <div className="card-header-main">
                <div className="card-title">Next Lunch Forecast</div>
              </div>
            </div>
            {lunchForecast.forecast === 0 ? (
              <p className="small mt-8">Not enough historic data yet for this weekday.</p>
            ) : (
              <>
                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 10 }}>{lunchForecast.forecast} plates</div>
                <p className="small mt-8">Expected lunch demand for today, based on the last 3 same weekdays.</p>
                <p className="small mt-8">Range: <strong>{lunchForecast.lower} – {lunchForecast.upper}</strong> plates.</p>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-header-row">
              <div className="card-header-main">
                <div className="card-title">Live Queue (Camera / AI)</div>
              </div>
            </div>
            <p className="small mt-8">Prototype: using active orders as a proxy for live queue length.</p>
            <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 14, background: "radial-gradient(circle at top, #dbeafe, #eff6ff)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1e3a8a" }}>Estimated Queue Length</div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>{liveQueueLength} people</div>
              </div>
              <div style={{ width: 48, height: 48, borderRadius: "999px", border: "3px solid rgba(37,99,235,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
                👥
              </div>
            </div>
          </div>
        </div>

        {/* Multi-kitchen load */}
        <div className="section">
          <h2 className="section-title">Multi-Kitchen Load</h2>
          <p className="small mt-8">
            Shows how orders would be split across multiple kitchens / counters.
            If no <code>kitchen</code> field is set on orders, everything is
            grouped under “Main Kitchen”.
          </p>
          {Object.keys(kitchenCounts).length === 0 ? (
            <div className="info-banner muted mt-12">
              No orders to display.
            </div>
          ) : (
            <div className="card">
              <div className="bar-chart">
                {Object.entries(kitchenCounts).map(([name, count]) => (
                  <div className="bar-row" key={name}>
                    <div className="bar-label">
                      <div className="bar-label-main">{name}</div>
                      <div className="bar-label-sub">
                        {count} orders
                      </div>
                    </div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div className="bar-value">{count}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* SLA bar chart */}
        <div className="section">
          <h2 className="section-title">SLA Trend (last 7 days)</h2>
          {sla.perDay.length === 0 ? (
            <div className="info-banner muted">No SLA data yet.</div>
          ) : (
            <div className="card">
              <div className="bar-chart">
                {sla.perDay.map((d) => (
                  <div className="bar-row" key={d.date}>
                    <div className="bar-label">
                      <div className="bar-label-main">{d.date}</div>
                      <div className="bar-label-sub">
                        {d.completed} completed
                      </div>
                    </div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ width: `${d.onTimePercent}%` }}
                      />
                    </div>
                    <div className="bar-value">{d.onTimePercent}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Top items bar chart */}
        <div className="section">
          <h2 className="section-title">Top Items (by count)</h2>
          {topItems.length === 0 || maxTopItemCount === 0 ? (
            <div className="info-banner muted">No items ordered yet.</div>
          ) : (
            <div className="card">
              <div className="bar-chart">
                {topItems.map(([name, count]) => (
                  <div className="bar-row" key={name}>
                    <div className="bar-label">
                      <div className="bar-label-main">{name}</div>
                      <div className="bar-label-sub">
                        {count} orders
                      </div>
                    </div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          width: `${(count / maxTopItemCount) * 100}%`,
                        }}
                      />
                    </div>
                    <div className="bar-value">{count}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Queue simulation mode */}
        <div className="section">
          <h2 className="section-title">Simulation Mode</h2>
          <p className="small mt-8">
            “What happens if 500 people walk in over the next 45 minutes?” —
            run a quick scenario to see queue build-up and worst-case wait
            time.
          </p>

          <div className="card" style={{ marginTop: 12 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit,minmax(160px,1fr))",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <div className="small">Duration (minutes)</div>
                <input
                  type="number"
                  className="input"
                  value={simParams.durationMinutes}
                  onChange={(e) =>
                    handleSimChange("durationMinutes", e.target.value)
                  }
                />
              </div>
              <div>
                <div className="small">Avg new orders / min</div>
                <input
                  type="number"
                  className="input"
                  value={simParams.newOrdersPerMin}
                  onChange={(e) =>
                    handleSimChange("newOrdersPerMin", e.target.value)
                  }
                />
              </div>
              <div>
                <div className="small">Serving stations</div>
                <input
                  type="number"
                  className="input"
                  value={simParams.stations}
                  onChange={(e) =>
                    handleSimChange("stations", e.target.value)
                  }
                />
              </div>
              <div>
                <div className="small">Avg prep time / order (min)</div>
                <input
                  type="number"
                  className="input"
                  value={simParams.avgPrepMinutes}
                  onChange={(e) =>
                    handleSimChange("avgPrepMinutes", e.target.value)
                  }
                />
              </div>
            </div>

            <button className="btn" onClick={handleRunSimulation}>
              Run Simulation
            </button>

            {simResult && (
              <div className="card-grid" style={{ marginTop: 16 }}>
                <div className="card">
                  <div className="card-title">Peak queue length</div>
                  <div className="card-value">{simResult.maxQueue}</div>
                </div>
                <div className="card">
                  <div className="card-title">Avg queue length</div>
                  <div className="card-value">
                    {simResult.avgQueue.toFixed(1)}
                  </div>
                </div>
                <div className="card">
                  <div className="card-title">
                    Worst-case wait (approx.)
                  </div>
                  <div className="card-value">
                    {simResult.estMaxWait} min
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---------- New Vendor Registration (Admin) ---------- */}
        <div className="section" style={{ marginTop: 32 }}>
          <h2 className="section-title">New Vendor Registration</h2>
          <p className="small mt-8">
            Use this to onboard a new vendor partner. This creates a{" "}
            <code>users</code> document with role <code>vendor</code>. Ask the
            vendor to visit the portal, click{" "}
            <strong>“New employee / vendor registration”</strong> on the login
            page and register using the <strong>same email</strong>. Their
            account will automatically link to this profile.
          </p>

          {vendorMsg && (
            <div
              style={{
                marginTop: 12,
                marginBottom: 8,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #dbeafe",
                background: "#eff6ff",
                fontSize: 13,
                color: "#1d4ed8",
              }}
            >
              {vendorMsg}
            </div>
          )}

          <div className="card" style={{ marginTop: 12, maxWidth: 640 }}>
            <form
              onSubmit={handleCreateVendor}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
                gap: 12,
              }}
            >
              <div>
                <div className="small">
                  Vendor name{" "}
                  <span style={{ color: "#b91c1c" }}>*</span>
                </div>
                <input
                  className="input"
                  value={vendorForm.name}
                  onChange={(e) =>
                    handleVendorChange("name", e.target.value)
                  }
                  placeholder="Main Canteen"
                />
              </div>
              <div>
                <div className="small">
                  Vendor admin email{" "}
                  <span style={{ color: "#b91c1c" }}>*</span>
                </div>
                <input
                  className="input"
                  type="email"
                  value={vendorForm.email}
                  onChange={(e) =>
                    handleVendorChange("email", e.target.value)
                  }
                  placeholder="vendor@canteen.com"
                />
              </div>
              <div>
                <div className="small">
                  Vendor ID <span style={{ color: "#b91c1c" }}>*</span>
                </div>
                <input
                  className="input"
                  value={vendorForm.vendorId}
                  onChange={(e) =>
                    handleVendorChange("vendorId", e.target.value)
                  }
                  placeholder="VEND01"
                />
              </div>
              <div>
                <div className="small">
                  Location / campus{" "}
                  <span style={{ color: "#6b7280" }}>(optional)</span>
                </div>
                <input
                  className="input"
                  value={vendorForm.location}
                  onChange={(e) =>
                    handleVendorChange("location", e.target.value)
                  }
                  placeholder="Tower 3, Phase 1"
                />
              </div>
              <div>
                <div className="small">
                  Contact person{" "}
                  <span style={{ color: "#6b7280" }}>(optional)</span>
                </div>
                <input
                  className="input"
                  value={vendorForm.contactName}
                  onChange={(e) =>
                    handleVendorChange("contactName", e.target.value)
                  }
                  placeholder="Canteen Manager Name"
                />
              </div>

              <div style={{ alignSelf: "flex-end" }}>
                <button type="submit" className="btn" style={{ marginTop: 4 }}>
                  Create Vendor Profile
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Today’s orders with status tabs */}
        <div className="section">
          <h2 className="section-title">
            Today&apos;s Orders ({today})
          </h2>

          {todayOrders.length === 0 ? (
            <div className="info-banner muted">No orders for today.</div>
          ) : (
            <>
              <div className="pill-tabs">
                {statusTabs.map((status) => {
                  const count =
                    status === "All"
                      ? todayOrders.length
                      : todayStatusCounts[status] || 0;
                  return (
                    <button
                      key={status}
                      className={
                        "pill-tab" +
                        (statusFilter === status ? " active" : "")
                      }
                      type="button"
                      onClick={() => setStatusFilter(status)}
                    >
                      <span>{status}</span>
                      <span className="pill-tab-count">{count}</span>
                      <span className="small">orders</span>
                    </button>
                  );
                })}
              </div>

              <div className="card">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Employee</th>
                      <th>Price</th>
                      <th>Status</th>
                      <th>Payment</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTodayOrders.map((o) => {
                      const payment = o.paymentStatus || "Pending";
                      const statusClass =
                        "status-badge status-" +
                        (o.status
                          ? o.status.toLowerCase()
                          : "completed");
                      const paymentClass =
                        "status-badge payment-" +
                        payment.toLowerCase();

                      return (
                        <tr key={o.id}>
                          <td>{o.name}</td>
                          <td>{o.userId}</td>
                          <td>₹{o.price}</td>
                          <td>
                            <span className={statusClass}>
                              {o.status || "Unknown"}
                            </span>
                          </td>
                          <td>
                            <span className={paymentClass}>{payment}</span>
                          </td>
                          <td>
                            {o.createdAt?.toDate
                              ? o.createdAt
                                  .toDate()
                                  .toLocaleTimeString()
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}