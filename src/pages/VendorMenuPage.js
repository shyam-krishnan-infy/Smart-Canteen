// src/pages/VendorMenuPage.js
import React, { useEffect, useState } from "react";
import db from "../firestore";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";
import "./EmployeePage.css";
import { useAuth } from "../AuthContext";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";
import { Link } from "react-router-dom";

function todayString() {
  return new Date().toISOString().split("T")[0];
}

function daysAgoString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

// Demand insights for AI hint
function computeDemandInsights(menuItems, orders) {
  if (!menuItems.length || !orders.length) return {};

  const WINDOW_DAYS = 7;
  const startDate = daysAgoString(WINDOW_DAYS);
  const today = todayString();

  const byName = {};
  orders.forEach((o) => {
    if (!o.name || !o.date) return;
    if (o.date < startDate || o.date > today) return;
    const status = (o.status || "").toLowerCase();
    if (["cancelled"].includes(status)) return;
    byName[o.name] = (byName[o.name] || 0) + 1;
  });

  const counts = Object.values(byName);
  if (counts.length === 0) return {};

  const maxCount = Math.max(...counts);
  const minHigh = Math.max(3, Math.round(maxCount * 0.4));

  const insights = {};
  menuItems.forEach((item) => {
    const name = item.name;
    if (!name) return;
    const recentCount = byName[name] || 0;
    const highDemand = recentCount >= minHigh;
    insights[item.id] = {
      recentCount,
      highDemand,
    };
  });

  return insights;
}

export default function VendorMenuPage() {
  const { user, profile } = useAuth();

  const [menuItems, setMenuItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notif, setNotif] = useState("");

  const [newItem, setNewItem] = useState({
    name: "",
    price: "",
    image: "",
    available: true,
    category: "Lunch",
  });

  const [editId, setEditId] = useState(null);
  const [editItem, setEditItem] = useState({
    name: "",
    price: "",
    image: "",
    available: true,
    category: "Lunch",
  });

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "menu"),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        arr.sort((a, b) => {
          const ca = (a.category || "Other").localeCompare(
            b.category || "Other"
          );
          if (ca !== 0) return ca;
          return (a.name || "").localeCompare(b.name || "");
        });
        setMenuItems(arr);
        setLoading(false);
      },
      (err) => {
        console.error("VendorMenuPage menu snapshot error:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "orders"),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setOrders(arr);
      },
      (err) => {
        console.error("VendorMenuPage orders snapshot error:", err);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!notif) return;
    const t = setTimeout(() => setNotif(""), 4000);
    return () => clearTimeout(t);
  }, [notif]);

  const demandInsights = computeDemandInsights(menuItems, orders);

  const handleNewChange = (field, value) => {
    setNewItem((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditChange = (field, value) => {
    setEditItem((prev) => ({ ...prev, [field]: value }));
  };

  const resetNewForm = () => {
    setNewItem({
      name: "",
      price: "",
      image: "",
      available: true,
      category: "Lunch",
    });
  };

  const startEdit = (item) => {
    setEditId(item.id);
    setEditItem({
      name: item.name || "",
      price: item.price || "",
      image: item.image || "",
      available: !!item.available,
      category: item.category || "Lunch",
    });
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditItem({
      name: "",
      price: "",
      image: "",
      available: true,
      category: "Lunch",
    });
  };

  const handleAddItem = async (e) => {
    e.preventDefault();

    if (!newItem.name.trim()) {
      setNotif("Name is required.");
      return;
    }

    const priceNumber = Number(newItem.price);
    if (isNaN(priceNumber) || priceNumber < 0) {
      setNotif("Price must be a valid non-negative number.");
      return;
    }

    try {
      await addDoc(collection(db, "menu"), {
        name: newItem.name.trim(),
        price: priceNumber,
        image: newItem.image.trim() || "",
        available: !!newItem.available,
        category: newItem.category || "Lunch",
      });
      setNotif(`Added "${newItem.name}" to menu.`);
      resetNewForm();
    } catch (err) {
      console.error("Add menu item error", err);
      setNotif("Failed to add item. Check console.");
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editId) return;

    if (!editItem.name.trim()) {
      setNotif("Name is required.");
      return;
    }

    const priceNumber = Number(editItem.price);
    if (isNaN(priceNumber) || priceNumber < 0) {
      setNotif("Price must be a valid non-negative number.");
      return;
    }

    try {
      const ref = doc(db, "menu", editId);
      await updateDoc(ref, {
        name: editItem.name.trim(),
        price: priceNumber,
        image: editItem.image.trim() || "",
        available: !!editItem.available,
        category: editItem.category || "Lunch",
      });
      setNotif(`Updated "${editItem.name}".`);
      cancelEdit();
    } catch (err) {
      console.error("Update menu item error", err);
      setNotif("Failed to update item. Check console.");
    }
  };

  const handleDelete = async (item) => {
    const ok = window.confirm(
      `Delete menu item "${item.name}"? Employees will no longer see it.`
    );
    if (!ok) return;

    try {
      const ref = doc(db, "menu", item.id);
      await deleteDoc(ref);
      setNotif(`Deleted "${item.name}".`);
    } catch (err) {
      console.error("Delete menu item error", err);
      setNotif("Failed to delete item. Check console.");
    }
  };

  const toggleAvailability = async (item) => {
    try {
      const ref = doc(db, "menu", item.id);
      await updateDoc(ref, {
        available: !item.available,
      });
      setNotif(
        `"${item.name}" marked as ${
          !item.available ? "available" : "unavailable"
        }.`
      );
    } catch (err) {
      console.error("Toggle availability error", err);
      setNotif("Failed to toggle availability. Check console.");
    }
  };

  return (
    <div className="container">
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
          flexWrap: "wrap",
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
          <Link to="/vendor" className="btn">
            Back to Vendor Dashboard
          </Link>
          <button className="btn danger" onClick={() => signOut(auth)}>
            Logout
          </button>
        </div>
      </div>

      <h1>Menu Management</h1>
      <p className="muted">
        Add, edit, categorise and control availability. Employees see these
        changes instantly in their app.
      </p>

      {notif && (
        <div
          style={{
            marginTop: 12,
            marginBottom: 12,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #d0e2ff",
            background: "#f3f8ff",
            fontSize: 13,
          }}
        >
          {notif}
        </div>
      )}

      {/* Add new item */}
      <div
        className="order-card"
        style={{ marginTop: 20, alignItems: "flex-start" }}
      >
        <div style={{ flex: 1 }}>
          <h2 style={{ marginTop: 0, marginBottom: 10 }}>Add New Item</h2>
          <form
            onSubmit={handleAddItem}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <input
              type="text"
              placeholder="Item name (e.g., Masala Dosa)"
              value={newItem.name}
              onChange={(e) => handleNewChange("name", e.target.value)}
              style={{
                padding: 8,
                borderRadius: 6,
                border: "1px solid #ccc",
              }}
            />

            <div style={{ display: "flex", gap: 10 }}>
              <input
                type="number"
                placeholder="Price (₹)"
                value={newItem.price}
                onChange={(e) => handleNewChange("price", e.target.value)}
                style={{
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  flex: 1,
                }}
              />
              <select
                value={newItem.category}
                onChange={(e) => handleNewChange("category", e.target.value)}
                style={{
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid #ccc",
                  minWidth: 140,
                }}
              >
                <option value="Breakfast">Breakfast</option>
                <option value="Lunch">Lunch</option>
                <option value="Snacks">Snacks</option>
                <option value="Dinner">Dinner</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <input
              type="text"
              placeholder="Image URL (optional)"
              value={newItem.image}
              onChange={(e) => handleNewChange("image", e.target.value)}
              style={{
                padding: 8,
                borderRadius: 6,
                border: "1px solid #ccc",
              }}
            />
            <label style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={newItem.available}
                onChange={(e) =>
                  handleNewChange("available", e.target.checked)
                }
                style={{ marginRight: 6 }}
              />
              Available by default
            </label>
            <div>
              <button type="submit" className="btn">
                Add Item
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Existing items */}
      <h2 style={{ marginTop: 30 }}>Existing Menu Items</h2>
      {loading ? (
        <p className="muted">Loading menu…</p>
      ) : menuItems.length === 0 ? (
        <p className="muted">No items yet. Add your first item above.</p>
      ) : (
        <div className="menu-list">
          {menuItems.map((item) => {
            const isEditing = editId === item.id;
            const insight = demandInsights[item.id] || {
              recentCount: 0,
              highDemand: false,
            };

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

                {/* VIEW MODE */}
                {!isEditing && (
                  <>
                    <div className="menu-main">
                      <h2>{item.name}</h2>
                      <p>
                        Category:{" "}
                        <strong>{item.category || "Other"}</strong>
                      </p>
                      <p>Price: ₹{item.price}</p>
                      <p>
                        Available:{" "}
                        <strong
                          style={{ color: item.available ? "#0a0" : "#c00" }}
                        >
                          {item.available ? "Yes" : "No"}
                        </strong>
                      </p>
                      {insight.recentCount > 0 && (
                        <p className="muted" style={{ marginTop: 4 }}>
                          Last 7 days demand:{" "}
                          <strong>{insight.recentCount}</strong> orders
                        </p>
                      )}
                      {insight.highDemand && (
                        <p
                          style={{
                            marginTop: 4,
                            fontSize: 12,
                            color: "#b45309",
                          }}
                        >
                          🔥 High demand this week — AI suggests you can
                          safely add <strong>₹5</strong>.
                        </p>
                      )}
                    </div>
                    <div className="vendor-actions">
                      <button
                        className="btn"
                        onClick={() => toggleAvailability(item)}
                      >
                        {item.available
                          ? "Mark Unavailable"
                          : "Mark Available"}
                      </button>
                      <button className="btn" onClick={() => startEdit(item)}>
                        Edit
                      </button>
                      <button
                        className="btn danger"
                        onClick={() => handleDelete(item)}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}

                {/* EDIT MODE */}
                {isEditing && (
                  <>
                    <div className="menu-main">
                      <h2>Edit Item</h2>
                      <form
                        onSubmit={handleSaveEdit}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <input
                          type="text"
                          placeholder="Item name"
                          value={editItem.name}
                          onChange={(e) =>
                            handleEditChange("name", e.target.value)
                          }
                          style={{
                            padding: 8,
                            borderRadius: 6,
                            border: "1px solid #ccc",
                          }}
                        />
                        <div style={{ display: "flex", gap: 10 }}>
                          <input
                            type="number"
                            placeholder="Price (₹)"
                            value={editItem.price}
                            onChange={(e) =>
                              handleEditChange("price", e.target.value)
                            }
                            style={{
                              padding: 8,
                              borderRadius: 6,
                              border: "1px solid #ccc",
                              flex: 1,
                            }}
                          />
                          <select
                            value={editItem.category}
                            onChange={(e) =>
                              handleEditChange("category", e.target.value)
                            }
                            style={{
                              padding: 8,
                              borderRadius: 6,
                              border: "1px solid #ccc",
                              minWidth: 140,
                            }}
                          >
                            <option value="Breakfast">Breakfast</option>
                            <option value="Lunch">Lunch</option>
                            <option value="Snacks">Snacks</option>
                            <option value="Dinner">Dinner</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        <input
                          type="text"
                          placeholder="Image URL (optional)"
                          value={editItem.image}
                          onChange={(e) =>
                            handleEditChange("image", e.target.value)
                          }
                          style={{
                            padding: 8,
                            borderRadius: 6,
                            border: "1px solid #ccc",
                          }}
                        />
                        <label style={{ fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={editItem.available}
                            onChange={(e) =>
                              handleEditChange("available", e.target.checked)
                            }
                            style={{ marginRight: 6 }}
                          />
                          Available
                        </label>
                        <div style={{ marginTop: 4 }}>
                          <button
                            type="submit"
                            className="btn"
                            style={{ marginRight: 8 }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="btn danger"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
