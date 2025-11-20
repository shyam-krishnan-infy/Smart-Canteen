// src/pages/VendorOrdersPage.js
import React, { useEffect, useState } from "react";
import db from "../firestore";
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc,
} from "firebase/firestore";
import { useAuth } from "../AuthContext";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";
import { Link } from "react-router-dom";

function todayString() {
  return new Date().toISOString().split("T")[0];
}

// Same transition rules as VendorPage
function canTransition(currentStatus, newStatus) {
  switch (currentStatus) {
    case "Prebooked":
      return (
        newStatus === "Preparing" ||
        newStatus === "Ready" ||
        newStatus === "Completed"
      );
    case "Preparing":
      return newStatus === "Ready" || newStatus === "Completed";
    case "Ready":
      return newStatus === "Completed";
    case "Completed":
    case "Cancelled":
    default:
      return false;
  }
}

function VendorOrdersPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState("Active");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const q = query(
      collection(db, "orders"),
      where("date", "==", todayString())
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const arr = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

        // sort by createdAt (oldest first → top of queue)
        arr.sort((a, b) => {
          const at = a.createdAt?.seconds || 0;
          const bt = b.createdAt?.seconds || 0;
          return at - bt;
        });

        setOrders(arr);
      },
      (err) => {
        console.error("Error in VendorOrdersPage snapshot:", err);
      }
    );

    return () => unsub();
  }, []);

  async function updateStatus(order, newStatus) {
    if (!canTransition(order.status, newStatus)) {
      console.warn(
        `Blocked invalid transition on /vendor/orders: ${order.status} → ${newStatus}`
      );
      return;
    }
    const ref = doc(db, "orders", order.id);
    await updateDoc(ref, {
      status: newStatus,
    });
  }

  const STATUS_TABS = [
    "Active",
    "All",
    "Prebooked",
    "Preparing",
    "Ready",
    "Completed",
    "Cancelled",
  ];

  // Queue counts for heat strip
  const prebookedCount = orders.filter((o) => o.status === "Prebooked")
    .length;
  const preparingCount = orders.filter((o) => o.status === "Preparing")
    .length;
  const readyCount = orders.filter((o) => o.status === "Ready").length;
  const activeTotal = prebookedCount + preparingCount + readyCount;

  // Filter for Active vs specific statuses
  let filtered = orders;
  if (statusFilter === "Active") {
    filtered = orders.filter((o) =>
      ["Prebooked", "Preparing", "Ready"].includes(o.status)
    );
  } else if (statusFilter !== "All") {
    filtered = orders.filter((o) => o.status === statusFilter);
  }

  // Search by item name / employee
  const searchLower = search.trim().toLowerCase();
  if (searchLower) {
    filtered = filtered.filter((o) => {
      const n = (o.name || "").toLowerCase();
      const u = (o.userId || "").toLowerCase();
      return n.includes(searchLower) || u.includes(searchLower);
    });
  }

  const styles = {
    container: { maxWidth: 1100, margin: "30px auto", padding: "0 20px" },
    heading: { fontSize: 28, fontWeight: 700, marginBottom: 6 },
    subheading: { marginBottom: 18, color: "#555", fontSize: 14 },
    topBar: {
      marginBottom: 20,
      padding: "10px 14px",
      borderRadius: 8,
      border: "1px solid #eee",
      background: "#fafafa",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      flexWrap: "wrap",
    },
    tabsRow: {
      display: "flex",
      gap: 8,
      marginBottom: 10,
      overflowX: "auto",
    },
    tab: (active) => ({
      padding: "6px 14px",
      borderRadius: 999,
      border: active ? "1px solid #0366d6" : "1px solid #ddd",
      background: active ? "#e0f2ff" : "#fff",
      fontSize: 12,
      cursor: "pointer",
      whiteSpace: "nowrap",
    }),
    searchRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 10,
      marginBottom: 10,
      flexWrap: "wrap",
    },
    searchInput: {
      padding: "6px 10px",
      borderRadius: 6,
      border: "1px solid #ddd",
      minWidth: 220,
      fontSize: 13,
    },
    tableWrapper: {
      borderRadius: 10,
      border: "1px solid #e0e0e0",
      overflow: "auto",
      background: "#fff",
      maxHeight: 520,
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: 13,
    },
    th: {
      textAlign: "left",
      padding: "8px 10px",
      borderBottom: "1px solid #ddd",
      background: "#f7f7f7",
      position: "sticky",
      top: 0,
      zIndex: 1,
    },
    td: {
      padding: "7px 10px",
      borderBottom: "1px solid #f0f0f0",
      whiteSpace: "nowrap",
    },
    chip: (bg, color) => ({
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      background: bg,
      color,
    }),
    actionBtn: (enabled) => ({
      padding: "4px 8px",
      borderRadius: 6,
      border: "1px solid #ccc",
      background: enabled ? "#fff" : "#f5f5f5",
      fontSize: 11,
      cursor: enabled ? "pointer" : "not-allowed",
      marginRight: 4,
    }),
    summaryText: { fontSize: 13, color: "#666", marginBottom: 8 },
    heatStripContainer: {
      marginBottom: 14,
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid #e5e7eb",
      background: "#f9fafb",
    },
    heatBar: {
      height: 14,
      borderRadius: 999,
      overflow: "hidden",
      display: "flex",
      marginTop: 6,
      marginBottom: 6,
    },
    heatSegment: (flex, bg) => ({
      flex,
      background: bg,
      transition: "flex 0.2s ease-out",
    }),
    heatLegend: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 11,
      color: "#4b5563",
    },
  };

  function statusChip(status) {
    switch (status) {
      case "Prebooked":
        return styles.chip("#e0f2ff", "#0366d6");
      case "Preparing":
        return styles.chip("#fff3cd", "#856404");
      case "Ready":
        return styles.chip("#d4edda", "#155724");
      case "Completed":
        return styles.chip("#e2e3e5", "#6c757d");
      case "Cancelled":
        return styles.chip("#fdecea", "#b71c1c");
      default:
        return styles.chip("#f0f0f0", "#555");
    }
  }

  return (
    <div style={styles.container}>
      {/* Auth bar + navigation */}
      <div style={styles.topBar}>
        <div>
          Logged in as{" "}
          <strong>{user?.email || user?.uid || "Unknown user"}</strong>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link to="/vendor" className="btn">
            ← Back to Vendor Dashboard
          </Link>
          <button className="btn danger" onClick={() => signOut(auth)}>
            Logout
          </button>
        </div>
      </div>

      <h1 style={styles.heading}>Today&apos;s Orders</h1>
      <div style={styles.subheading}>
        Live view for <strong>{todayString()}</strong>. Designed to handle peak
        rush (100+ orders) without confusion.
      </div>

      {/* 🔥 Queue Heat Strip */}
      {activeTotal > 0 && (
        <div style={styles.heatStripContainer}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Queue load: {activeTotal} active orders
          </div>
          <div style={styles.heatBar}>
            <div
              style={styles.heatSegment(
                prebookedCount || 0.0001,
                "#e0f2ff"
              )}
            />
            <div
              style={styles.heatSegment(
                preparingCount || 0.0001,
                "#fef3c7"
              )}
            />
            <div
              style={styles.heatSegment(readyCount || 0.0001, "#dcfce7")}
            />
          </div>
          <div style={styles.heatLegend}>
            <span>Prebooked: {prebookedCount}</span>
            <span>Preparing: {preparingCount}</span>
            <span>Ready: {readyCount}</span>
          </div>
        </div>
      )}

      {/* Status tabs */}
      <div style={styles.tabsRow}>
        {STATUS_TABS.map((st) => (
          <button
            key={st}
            style={styles.tab(statusFilter === st)}
            onClick={() => setStatusFilter(st)}
          >
            {st}
          </button>
        ))}
      </div>

      {/* Search + summary */}
      <div style={styles.searchRow}>
        <div style={styles.summaryText}>
          Showing <strong>{filtered.length}</strong> of{" "}
          <strong>{orders.length}</strong> orders.
        </div>
        <input
          type="text"
          placeholder="Search by item or employee..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={styles.searchInput}
        />
      </div>

      {orders.length === 0 ? (
        <p>No orders today.</p>
      ) : filtered.length === 0 ? (
        <p>No orders matching the current filter/search.</p>
      ) : (
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Time</th>
                <th style={styles.th}>Item</th>
                <th style={styles.th}>Employee</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Payment</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const created =
                  o.createdAt?.toDate &&
                  o.createdAt.toDate().toLocaleTimeString();

                const canPrep = canTransition(o.status, "Preparing");
                const canReady = canTransition(o.status, "Ready");
                const canDone = canTransition(o.status, "Completed");

                const payment = o.paymentStatus || "Pending";

                return (
                  <tr key={o.id}>
                    <td style={styles.td}>{created || "—"}</td>
                    <td style={styles.td}>{o.name}</td>
                    <td style={styles.td}>{o.userId}</td>
                    <td style={styles.td}>
                      <span style={statusChip(o.status || "Unknown")}>
                        {o.status || "Unknown"}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={styles.chip("#f0f0f0", "#555")}>
                        {payment}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <button
                        style={styles.actionBtn(canPrep)}
                        disabled={!canPrep}
                        onClick={() => updateStatus(o, "Preparing")}
                      >
                        Prep
                      </button>
                      <button
                        style={styles.actionBtn(canReady)}
                        disabled={!canReady}
                        onClick={() => updateStatus(o, "Ready")}
                      >
                        Ready
                      </button>
                      <button
                        style={styles.actionBtn(canDone)}
                        disabled={!canDone}
                        onClick={() => updateStatus(o, "Completed")}
                      >
                        Done
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default VendorOrdersPage;