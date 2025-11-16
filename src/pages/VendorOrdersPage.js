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

function VendorOrdersPage() {
  const [orders, setOrders] = useState([]);

  function todayString() {
    return new Date().toISOString().split("T")[0];
  }

  useEffect(() => {
    const q = query(
      collection(db, "orders"),
      where("date", "==", todayString())
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const arr = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

        // sort by createdAt (oldest first)
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

  async function updateStatus(orderId, newStatus) {
    const ref = doc(db, "orders", orderId);
    await updateDoc(ref, { status: newStatus });
  }

  const styles = {
    container: { maxWidth: 900, margin: "30px auto", padding: "0 20px" },
    heading: { fontSize: 32, fontWeight: 700, marginBottom: 20 },
    subheading: { marginBottom: 10, color: "#555" },
    card: {
      padding: 20,
      marginBottom: 15,
      border: "1px solid #ddd",
      borderRadius: 10,
      background: "#fff",
    },
    row: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    },
    name: { fontSize: 20, fontWeight: 700 },
    status: { marginTop: 6, color: "#666" },
    buttonRow: { marginTop: 12, display: "flex", gap: 10 },
    btn: {
      padding: "8px 14px",
      borderRadius: 8,
      cursor: "pointer",
      border: "1px solid #333",
      background: "#fff",
    },
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Vendor — Today’s Orders</h1>
      <div style={styles.subheading}>Showing only orders for {todayString()}.</div>

      {orders.length === 0 ? (
        <p>No orders today.</p>
      ) : (
        orders.map((order) => (
          <div key={order.id} style={styles.card}>
            <div style={styles.row}>
              <div>
                <div style={styles.name}>{order.name}</div>
                <div style={styles.status}>Price: ₹{order.price}</div>
                <div style={styles.status}>
                  Employee: <strong>{order.userId}</strong>
                </div>
                <div style={styles.status}>
                  Status: <strong>{order.status}</strong>
                </div>
              </div>

              <div>
                {order.createdAt?.toDate &&
                  order.createdAt.toDate().toLocaleTimeString()}
              </div>
            </div>

            <div style={styles.buttonRow}>
              <button
                style={styles.btn}
                onClick={() => updateStatus(order.id, "Preparing")}
              >
                Mark Preparing
              </button>

              <button
                style={styles.btn}
                onClick={() => updateStatus(order.id, "Ready")}
              >
                Mark Ready
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default VendorOrdersPage;