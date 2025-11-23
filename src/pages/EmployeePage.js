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
  doc,
} from "firebase/firestore";
import "./EmployeePage.css";
import { useAuth } from "../AuthContext";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";

// ---- Time-of-day meal window helper ----
// As per requirement:
// 07:00–11:59  → Breakfast  (hours 7..11 inclusive)
// 12:00–15:59  → Lunch      (hours 12..15)
// 16:00–18:59  → Snacks     (hours 16..18)
// 19:00–23:00  → Dinner     (hours 19..23)
// Any other time => no active window (view only, no pre-book)
function getCurrentMealWindow() {
  const now = new Date();
  const hour = now.getHours(); // 0–23

  if (hour >= 7 && hour <= 11) return "Breakfast";
  if (hour >= 12 && hour <= 15) return "Lunch";
  if (hour >= 16 && hour <= 18) return "Snacks";
  if (hour >= 19 && hour <= 23) return "Dinner";

  return null; // outside main windows
}

// next meal window mapping (for allowed pre-book target)
function getNextMealWindow(window) {
  if (!window) return null;
  if (window === "Breakfast") return "Lunch";
  if (window === "Lunch") return "Snacks";
  if (window === "Snacks") return "Dinner";
  if (window === "Dinner") return "Breakfast"; // next-day breakfast
  return null;
}

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
    etaString: eta.toLocaleTimeString(),
  };
}

export default function EmployeePage() {
  const { user, profile } = useAuth();

  const derivedUserId =
    profile?.employeeId || user?.email || user?.uid || "";

  const [userId, setUserId] = useState(derivedUserId);
  const [menuItems, setMenuItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [notif, setNotif] = useState("");
  const prevStatuses = useRef({});

  // Category tabs + time-of-day window
  const CATEGORY_TABS = ["Breakfast", "Lunch", "Snacks", "Dinner"];
  const mealWindow = getCurrentMealWindow(); // e.g. "Breakfast" or null
  const nextMealWindow = getNextMealWindow(mealWindow);

  const [categoryFilter, setCategoryFilter] = useState(
    mealWindow || "Breakfast"
  );

  // Keep userId in sync
  useEffect(() => {
    setUserId(derivedUserId);
  }, [derivedUserId]);

  // If time window changes on reload, align filter to it
  useEffect(() => {
    if (mealWindow) {
      setCategoryFilter(mealWindow);
    }
  }, [mealWindow]);

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
        // newest first
        arr.sort((a, b) => {
          const at = a.createdAt?.seconds || 0;
          const bt = b.createdAt?.seconds || 0;
          return bt - at;
        });

        // detect status changes → notification
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

  // book an item for immediate preparation (enforces meal window)
  const handleBook = async (item) => {
    if (!userId) {
      setNotif("No Employee ID linked to this account.");
      return;
    }

    const nowWindow = getCurrentMealWindow();
    const itemCategory = item.category || "Other";

    // Must be in a meal window to book
    if (!nowWindow) {
      setNotif("Booking is only available during meal windows.");
      return;
    }

    // Only allow booking items that belong to current window
    if (itemCategory !== nowWindow) {
      setNotif(
        `"${item.name}" can be booked only during its window: ${itemCategory}. Current window: ${nowWindow}.`
      );
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
        status: "Preparing", // immediate booking goes to Preparing
        paymentStatus: "Pending",
        date: todayDateString,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNotif(`Booked "${item.name}" successfully. Track it below.`);
    } catch (err) {
      console.error("Book error", err);
      setNotif("Failed to book. Check console.");
    }
  };

  // pre-book an item (enforces next-meal window)
  const handlePrebook = async (item) => {
    if (!userId) {
      setNotif("No Employee ID linked to this account.");
      return;
    }

    const nowWindow = getCurrentMealWindow();
    const itemCategory = item.category || "Other";
    const intendedPrebookWindow = getNextMealWindow(nowWindow);

    // Outside any window → hard block
    if (!nowWindow) {
      setNotif(
        "Pre-booking is only available during meal windows (Breakfast / Lunch / Snacks / Dinner)."
      );
      return;
    }

    // Only allow items that belong to next window (not the current)
    if (itemCategory !== intendedPrebookWindow) {
      setNotif(
        `"${item.name}" can be pre-booked only for its window: ${itemCategory}. Current window: ${nowWindow}. You can pre-book ${intendedPrebookWindow} items now.`
      );
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
        updatedAt: serverTimestamp(),
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
        updatedAt: serverTimestamp(),
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
        updatedAt: serverTimestamp(),
      });
      setNotif(`Payment successful for "${order.name}" (demo).`);
    } catch (err) {
      console.error("Pay online error", err);
      setNotif("Failed to update payment status. Check console.");
    }
  };

  /* === FIXED: decide effective category filter ===
     When a meal window is active, allow selecting either current or next meal.
     When no meal window, default to the categoryFilter (or Breakfast if missing).
  */
  let effectiveFilter;
  if (mealWindow) {
    const allowed = [mealWindow];
    if (nextMealWindow) allowed.push(nextMealWindow);
    effectiveFilter = allowed.includes(categoryFilter)
      ? categoryFilter
      : mealWindow;
  } else {
    effectiveFilter = categoryFilter || "Breakfast";
  }

  // Helper: is this item allowed to be booked now?
  const isBookable = (item) => {
    const win = getCurrentMealWindow();
    const cat = item.category || "Other";
    if (!win) return false;
    return cat === win;
  };

  // Helper: is this item allowed to be pre-booked now (i.e., it's the next meal window)
  const isPrebookable = (item) => {
    const win = getCurrentMealWindow();
    const nextWin = getNextMealWindow(win);
    const cat = item.category || "Other";
    if (!win || !nextWin) return false;
    return cat === nextWin;
  };

  // AI recommendations (restricted to effectiveFilter & meal window rules)
  const recommendedItems = (() => {
    if (!menuItems.length) return [];

    let availableMenu = menuItems.filter((item) => isItemAvailable(item));

    // Filter to the currently selected category (no "All" option anymore)
    availableMenu = availableMenu.filter((item) => {
      const cat = item.category || "Other";
      return cat === effectiveFilter;
    });

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
        score: userCount + priceBonus,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 2).map((s) => s.item);
  })();

  const queueEstimate = computeQueueEstimate(orders);

  // Filter menu items for display
  const filteredMenuItems = menuItems.filter((item) => {
    const cat = item.category || "Other";
    return cat === effectiveFilter;
  });

  const now = new Date();
  const currentTimeLabel = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

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
            fontWeight: 500,
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
          flexWrap: "wrap",
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

      {/* Time window info */}
      {mealWindow ? (
        <div
          style={{
            marginBottom: 16,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #d1fae5",
            background: "#ecfdf5",
            fontSize: 13,
          }}
        >
          Current time: <strong>{currentTimeLabel}</strong>.{" "}
          <strong>{mealWindow}</strong> window is active now. You may{" "}
          <strong>book {mealWindow}</strong> items right away, and you may{" "}
          <strong>pre-book {nextMealWindow}</strong> items for the upcoming window. Other categories are disabled.
        </div>
      ) : (
        <div
          style={{
            marginBottom: 16,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #fef3c7",
            background: "#fffbeb",
            fontSize: 13,
          }}
        >
          Current time: <strong>{currentTimeLabel}</strong>. No specific meal
          window is active. You can browse categories, but{" "}
          <strong>booking and pre-booking are disabled until the next meal window</strong>.
        </div>
      )}

      {/* AI Queue-Time Estimator */}
      {userId && queueEstimate && (
        <div
          style={{
            marginBottom: 20,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #d0e2ff",
            background: "#f3f8ff",
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
              const canBook = isBookable(item);
              const canPre = isPrebookable(item);
              const disabled = !userId || !available || !(canBook || canPre);

              let label = "Pre-book";
              let onClick = () => handlePrebook(item);
              if (canBook) {
                label = "Book";
                onClick = () => handleBook(item);
              } else if (canPre) {
                label = "Pre-book";
                onClick = () => handlePrebook(item);
              }

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
                      disabled={disabled}
                      style={{
                        opacity: disabled ? 0.4 : 1,
                        cursor: disabled ? "not-allowed" : "pointer",
                      }}
                      onClick={onClick}
                    >
                      {label}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Category tabs + menu */}
      <h1>Menu</h1>
      <div
        style={{
          display: "flex",
          gap: 10,
          margin: "8px 0 16px",
          overflowX: "auto",
        }}
      >
        {CATEGORY_TABS.map((cat) => {
          const isActive = effectiveFilter === cat;
          const catIsMeal =
            ["Breakfast", "Lunch", "Snacks", "Dinner"].includes(cat);

          /* === CHANGED: allow both current mealWindow AND nextMealWindow ===
             When a meal window is active, enable only:
               - the current meal window (book)
               - the next meal window (pre-book)
             All others remain disabled during an active window.
          */
          const disabled =
            mealWindow && catIsMeal
              ? !(cat === mealWindow || cat === nextMealWindow)
              : false;

          const actuallyDisabled = disabled;

          return (
            <button
              key={cat}
              onClick={() => {
                if (actuallyDisabled) return;
                setCategoryFilter(cat);
              }}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border: isActive
                  ? "1px solid #0366d6"
                  : "1px solid #ddd",
                background: isActive ? "#e0f2ff" : "#fff",
                fontSize: 13,
                cursor: actuallyDisabled ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
                opacity: actuallyDisabled ? 0.4 : 1,
              }}
            >
              {cat}
            </button>
          );
        })}
      </div>

      <div className="menu-list">
        {filteredMenuItems.length === 0 ? (
          <p className="muted">
            No items found in this category. Try again later or during its
            active window.
          </p>
        ) : (
          filteredMenuItems.map((item) => {
            const available = isItemAvailable(item);
            const cat = item.category || "Other";
            const canBook = isBookable(item);
            const canPre = isPrebookable(item);
            const disabled = !userId || !available || !(canBook || canPre);

            let label = "Pre-book";
            let onClick = () => handlePrebook(item);
            if (canBook) {
              label = "Book";
              onClick = () => handleBook(item);
            } else if (canPre) {
              label = "Pre-book";
              onClick = () => handlePrebook(item);
            }

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
                  <p style={{ fontSize: 12, color: "#777", marginBottom: 4 }}>
                    {cat}
                  </p>
                  <p>
                    Available:{" "}
                    <strong style={{ color: available ? "#0a0" : "#c00" }}>
                      {available ? "Yes" : "No"}
                    </strong>
                  </p>
                  {!mealWindow && (
                    <p
                      style={{
                        fontSize: 11,
                        color: "#999",
                        marginTop: 4,
                      }}
                    >
                      Viewing only (outside meal hours).
                    </p>
                  )}
                </div>
                <div className="menu-action">
                  <button
                    className="btn"
                    disabled={disabled}
                    style={{
                      opacity: disabled ? 0.4 : 1,
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                    onClick={onClick}
                  >
                    {label}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* My orders section */}
      <h2 style={{ marginTop: 30 }}>My Orders</h2>
      <div className="my-orders">
        {!userId ? (
          <p className="muted">
            No Employee ID linked. Please ensure this user has an{" "}
            <code>employeeId</code> in Firestore <code>users</code> document,
            or we will use UID/email.
          </p>
        ) : orders.length === 0 ? (
          <p className="muted">No orders yet. Pre-book from the menu above.</p>
        ) : (
          orders.map((o) => {
            const payment = o.paymentStatus || "Pending";
            const canCancel = canCancelOrder(o);
            const created =
              o.createdAt?.toDate && o.createdAt.toDate().toLocaleString();

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
                  {created && (
                    <small style={{ color: "#777" }}>Created: {created}</small>
                  )}
                </div>
                <div className="vendor-actions">
                  <button
                    className="btn"
                    style={{
                      opacity: canCancel ? 1 : 0.4,
                      cursor: canCancel ? "pointer" : "not-allowed",
                    }}
                    disabled={!canCancel}
                    onClick={() => handleCancelOrder(o)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn"
                    style={{
                      marginLeft: 8,
                      opacity: payment === "Paid" ? 0.4 : 1,
                      cursor:
                        payment === "Paid" ? "not-allowed" : "pointer",
                    }}
                    disabled={payment === "Paid"}
                    onClick={() => handlePayOnline(o)}
                  >
                    Pay Online
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}