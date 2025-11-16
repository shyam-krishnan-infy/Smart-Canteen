// src/pages/EmployeePage.js
import React, { useEffect, useState, useRef } from "react";
import db from "../firestore";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  updateDoc,
  doc
} from "firebase/firestore";
import "./EmployeePage.css";
import { useAuth } from "../AuthContext";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";

// Helper: interpret different representations of "available"
function isItemAvailable(item) {
  const v = item?.available;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "yes" || s === "y" || s === "true" || s === "available";
  }
  return !!v;
}

// Helper: can an order be cancelled by employee?
function canCancelOrder(order) {
  return order.status === "Prebooked";
}

// Helper: AI-ish queue time estimate for this employee
function computeQueueEstimate(orders) {
  if (!orders || orders.length === 0) return null;

  const ACTIVE_STATUSES = ["Prebooked", "Preparing", "Ready"];
  const active = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));

  if (active.length === 0) return null;

  const DEFAULT_PREP_MIN = 8; // assumed average prep time per order (min)
  const PARALLEL_STATIONS = 2; // assumed number of parallel prep lines

  const estMinutes = Math.max(
    1,
    Math.round((active.length * DEFAULT_PREP_MIN) / PARALLEL_STATIONS)
  );

  const now = new Date();
  const eta = new Date(now.getTime() + estMinutes * 60000);

  return {
    activeCount: active.length,
    estMinutes,
    etaString: eta.toLocaleTimeString()
  };
}

export default function EmployeePage() {
  const { user, profile } = useAuth();

  // This is the ID we will use to tie orders to the employee
  // Prefer profile.employeeId if you set it in Firestore; otherwise fall back to email / uid
  const derivedUserId =
    profile?.employeeId || user?.email || user?.uid || "";

  const [userId, setUserId] = useState(derivedUserId);
  const [menuItems, setMenuItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [notif, setNotif] = useState("");
  const prevStatuses = useRef({});

  // Keep userId in sync with auth profile
  useEffect(() => {
    setUserId(derivedUserId);
  }, [derivedUserId]);

  // load menu items
  useEffect(() => {
    const q = query(collection(db, "menu"));
    const unsub = onSnapshot(q, (snap) => {
      const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMenuItems(arr);
    });
    return () => unsub();
  }, []);

  // auto-clear notification after 5 seconds
  useEffect(() => {
    if (!notif) return;
    const t = setTimeout(() => setNotif(""), 5000);
    return () => clearTimeout(t);
  }, [notif]);

  // listen to orders for this user
  useEffect(() => {
    if (!userId) {
      setOrders([]);
      return;
    }

    const q = query(collection(db, "orders"), where("userId", "==", userId));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        arr.sort((a, b) => {
          const at = a.createdAt?.seconds || 0;
          const bt = b.createdAt?.seconds || 0;
          return bt - at;
        });

        snap.docChanges().forEach((change) => {
          if (change.type === "modified") {
            const data = change.doc.data();
            const prev = prevStatuses.current[change.doc.id];
            if (prev && prev !== data.status) {
              if (!(prev === "Prebooked" && data.status === "Cancelled")) {
                setNotif(
                  `Order "${data.name}" status changed to ${data.status}`
                );
              }
            }
          }
        });

        const newMap = {};
        arr.forEach((o) => (newMap[o.id] = o.status));
        prevStatuses.current = newMap;

        setOrders(arr);
      },
      (err) => {
        console.error("Error in orders onSnapshot:", err);
      }
    );

    return () => unsub();
  }, [userId]);

  // pre-book an item
  const handlePrebook = async (item) => {
    if (!userId) {
      setNotif("No Employee ID linked to this account.");
      return;
    }

    const available = isItemAvailable(item);
    if (!available) {
      setNotif(`❌ "${item.name}" is not available right now.`);
      return;
    }

    const todayDateString = new Date().toISOString().split("T")[0];

    try {
      await addDoc(collection(db, "orders"), {
        itemId: item.id || null,
        name: item.name || "item",
        price: item.price || 0,
        userId,
        status: "Prebooked",
        paymentStatus: "Pending",
        date: todayDateString,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setNotif(`Pre-booked "${item.name}" successfully. Track it below.`);
    } catch (err) {
      console.error("Prebook error", err);
      setNotif("Failed to pre-book. Check console.");
    }
  };

  // cancel order
  const handleCancelOrder = async (order) => {
    if (!canCancelOrder(order)) {
      setNotif(
        `Order "${order.name}" can no longer be cancelled (status: ${order.status}).`
      );
      return;
    }

    try {
      const ref = doc(db, "orders", order.id);
      const newPaymentStatus =
        order.paymentStatus === "Paid" ? "Refunded" : "Pending";
      await updateDoc(ref, {
        status: "Cancelled",
        paymentStatus: newPaymentStatus,
        updatedAt: serverTimestamp()
      });
      setNotif(`Cancelled "${order.name}".`);
    } catch (err) {
      console.error("Cancel order error", err);
      setNotif("Failed to cancel order. Check console.");
    }
  };

  // simulate online payment
  const handlePayOnline = async (order) => {
    if (order.paymentStatus === "Paid") {
      setNotif(`Order "${order.name}" is already paid.`);
      return;
    }
    if (order.status === "Cancelled") {
      setNotif(`Cancelled order "${order.name}" cannot be paid.`);
      return;
    }

    try {
      const ref = doc(db, "orders", order.id);
      await updateDoc(ref, {
        paymentStatus: "Paid",
        updatedAt: serverTimestamp()
      });
      setNotif(`Payment successful for "${order.name}" (demo).`);
    } catch (err) {
      console.error("Pay online error", err);
      setNotif("Failed to update payment status. Check console.");
    }
  };

  // AI recommendations
  const recommendedItems = (() => {
    if (!menuItems.length) return [];

    const availableMenu = menuItems.filter((item) => isItemAvailable(item));
    if (!availableMenu.length) return [];

    if (!orders.length) {
      return [...availableMenu]
        .sort((a, b) => (a.price || 0) - (b.price || 0))
        .slice(0, 2);
    }

    const countsByName = {};
    orders.forEach((o) => {
      if (!o.name) return;
      countsByName[o.name] = (countsByName[o.name] || 0) + 1;
    });

    const scored = availableMenu.map((item) => {
      const userCount = countsByName[item.name] || 0;
      const price = item.price || 0;
      const priceBonus = 1 / (1 + price);
      return {
        item,
        score: userCount + priceBonus
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 2).map((s) => s.item);
  })();

  const queueEstimate = computeQueueEstimate(orders);

  return (
    <div className="employee-page container">
      {/* Notification banner */}
      {notif && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            borderRadius: 8,
            background: "#e0f2ff",
            color: "#0366d6",
            fontSize: 14,
            fontWeight: 500
          }}
        >
          {notif}
        </div>
      )}

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
          {profile?.employeeId && (
            <span style={{ marginLeft: 8, fontSize: 13, color: "#555" }}>
              (Employee ID: {profile.employeeId})
            </span>
          )}
        </div>
        <button className="btn" onClick={() => signOut(auth)}>
          Logout
        </button>
      </div>

      {/* AI Queue-Time Estimator */}
      {userId && queueEstimate && (
        <div
          style={{
            marginBottom: 20,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #d0e2ff",
            background: "#f3f8ff"
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            AI Wait Time Estimate
          </div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            Active orders in kitchen for you:{" "}
            <strong>{queueEstimate.activeCount}</strong>
          </div>
          <div style={{ fontSize: 13 }}>
            If you place a new order now, your estimated pickup time is{" "}
            <strong>{queueEstimate.etaString}</strong> (~
            {queueEstimate.estMinutes} minutes).
          </div>
        </div>
      )}

      {/* AI Smart Suggestions */}
      {recommendedItems.length > 0 && (
        <>
          <h2>Smart suggestions for you (AI)</h2>
          <p className="muted">
            Based on your past orders, today&apos;s availability and prices.
          </p>
          <div className="menu-list">
            {recommendedItems.map((item) => {
              const available = isItemAvailable(item);
              return (
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
                        <strong style={{ color: available ? "#0a0" : "#c00" }}>
                          {available ? "Yes" : "No"}
                        </strong>
                    </p>
                  </div>
                  <div className="menu-action">
                    <button
                      className="btn"
                      disabled={!available || !userId}
                      style={{
                        opacity: available && userId ? 1 : 0.4,
                        cursor:
                          available && userId ? "pointer" : "not-allowed"
                      }}
                      onClick={() => handlePrebook(item)}
                    >
                      Pre-book
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h1>Menu</h1>
      <div className="menu-list">
        {menuItems.map((item) => {
          const available = isItemAvailable(item);
          return (
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
                  <strong style={{ color: available ? "#0a0" : "#c00" }}>
                    {available ? "Yes" : "No"}
                  </strong>
                </p>
              </div>
              <div className="menu-action">
                <button
                  className="btn"
                  disabled={!available || !userId}
                  style={{
                    opacity: available && userId ? 1 : 0.4,
                    cursor:
                      available && userId ? "pointer" : "not-allowed"
                  }}
                  onClick={() => handlePrebook(item)}
                >
                  Pre-book
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <h2>My Orders</h2>
      <div className="my-orders">
        {!userId ? (
          <p className="muted">
            No Employee ID linked. Please ensure this user has an{" "}
            <code>employeeId</code> in Firestore <code>users</code> document,
            or we will use UID/email.
          </p>
        ) : orders.length === 0 ? (
          <p className="muted">No orders yet.</p>
        ) : (
          orders.map((o) => {
            const payment = o.paymentStatus || "Pending";
            return (
              <div key={o.id} className="order-card">
                <div>
                  <h3>{o.name}</h3>
                  <p>Price: ₹{o.price}</p>
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
                    Ordered:{" "}
                    {o.createdAt?.toDate
                      ? o.createdAt.toDate().toLocaleString()
                      : "—"}
                  </small>
                </div>

                <div className="vendor-actions">
                  {canCancelOrder(o) && (
                    <button
                      className="btn danger"
                      onClick={() => handleCancelOrder(o)}
                    >
                      Cancel Order
                    </button>
                  )}
                  {payment !== "Paid" && o.status !== "Cancelled" && (
                    <button
                      className="btn"
                      onClick={() => handlePayOnline(o)}
                    >
                      Pay Online (demo)
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}