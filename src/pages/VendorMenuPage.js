// src/pages/VendorMenuPage.js
import React, { useEffect, useState } from "react";
import db from "../firestore";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  updateDoc,
  doc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { storage } from "../firebase";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { useAuth } from "../AuthContext";
import { useNavigate } from "react-router-dom";
import "./VendorPage.css";

export default function VendorMenuPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  // If you later add real vendorIds, this still works.
  const vendorId = profile?.vendorId || "defaultVendor";

  const [items, setItems] = useState([]);

  // form state
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("Lunch");
  const [available, setAvailable] = useState(true);

  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [notif, setNotif] = useState("");
  const [error, setError] = useState("");

  // editing state
  const [editingId, setEditingId] = useState(null);
  const [editingOriginalImage, setEditingOriginalImage] = useState(null);

  // Load menu items (legacy + vendor-specific)
  useEffect(() => {
    const menuRef = collection(db, "menu");
    const q = query(menuRef); // no where filter – filter in JS

    const unsub = onSnapshot(
      q,
      (snap) => {
        let arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        arr = arr.filter((item) => {
          // Legacy items: no vendorId → show them
          if (!item.vendorId) return true;
          // New items: must match this vendor
          return item.vendorId === vendorId;
        });

        arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setItems(arr);
      },
      (err) => {
        console.error("VendorMenuPage onSnapshot error:", err);
        setError("Failed to load menu items.");
      }
    );

    return () => unsub();
  }, [vendorId]);

  // auto-clear notifications
  useEffect(() => {
    if (!notif && !error) return;
    const t = setTimeout(() => {
      setNotif("");
      setError("");
    }, 5000);
    return () => clearTimeout(t);
  }, [notif, error]);

  // clean preview URL on unmount
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const resetForm = () => {
    setName("");
    setPrice("");
    setCategory("Lunch");
    setAvailable(true);

    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    setUploadProgress(0);

    setEditingId(null);
    setEditingOriginalImage(null);
  };

  // helper: upload image and return URL with progress updates
  const uploadImageAndGetUrl = (file) => {
    return new Promise((resolve, reject) => {
      const cleanName = file.name.replace(/\s+/g, "-");
      const path = `menu-images/${vendorId}/${Date.now()}-${cleanName}`;
      const storageRef = ref(storage, path);

      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        "state_changed",
        (snapshot) => {
          const progress =
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(Math.round(progress));
        },
        (err) => {
          reject(err);
        },
        async () => {
          try {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(url);
          } catch (err) {
            reject(err);
          }
        }
      );
    });
  };

  // Add or Update item (with optional image upload)
  const handleSubmitItem = async (e) => {
    e.preventDefault();
    setError("");
    setNotif("");

    if (!name.trim()) {
      setError("Item name is required.");
      return;
    }
    if (!price || Number(price) <= 0) {
      setError("Please enter a valid price.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      let imageUrl = editingOriginalImage || null;

      // If a new file is selected, upload and override
      if (imageFile) {
        imageUrl = await uploadImageAndGetUrl(imageFile);
      }

      const payload = {
        name: name.trim(),
        price: Number(price),
        category,
        available,
        image: imageUrl,
        updatedAt: serverTimestamp(),
      };

      if (editingId) {
        // UPDATE existing item
        const refDoc = doc(db, "menu", editingId);
        await updateDoc(refDoc, payload);
        setNotif("Menu item updated successfully.");
      } else {
        // CREATE new item
        await addDoc(collection(db, "menu"), {
          ...payload,
          vendorId,
          createdAt: serverTimestamp(),
        });
        setNotif("Menu item added successfully.");
      }

      resetForm();
    } catch (err) {
      console.error("Add/update menu item error:", err);
      setError("Failed to save item. Please check console.");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // Toggle availability
  const handleToggleAvailability = async (item) => {
    try {
      const refDoc = doc(db, "menu", item.id);
      await updateDoc(refDoc, {
        available: !item.available,
        updatedAt: serverTimestamp(),
      });
      setNotif(
        `"${item.name}" is now marked as ${
          !item.available ? "Available" : "Unavailable"
        }.`
      );
    } catch (err) {
      console.error("Update availability error:", err);
      setError("Failed to update availability.");
    }
  };

  // Start editing an item
  const handleEditItem = (item) => {
    setEditingId(item.id);
    setName(item.name || "");
    setPrice(item.price != null ? String(item.price) : "");
    setCategory(item.category || "Lunch");
    setAvailable(item.available !== false); // default true

    // keep original image URL in case user doesn't upload a new one
    setEditingOriginalImage(item.image || null);

    // reset new image selection/preview
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);

    setNotif(`Editing "${item.name}" — change details and click Save.`);
  };

  // Delete an item
  const handleDeleteItem = async (item) => {
    const ok = window.confirm(
      `Delete "${item.name}" from the menu? This cannot be undone.`
    );
    if (!ok) return;

    try {
      const refDoc = doc(db, "menu", item.id);
      await deleteDoc(refDoc);
      setNotif(`"${item.name}" has been deleted from the menu.`);
      // no need to manually remove from state; onSnapshot will update
      if (editingId === item.id) {
        resetForm();
      }
    } catch (err) {
      console.error("Delete menu item error:", err);
      setError("Failed to delete item.");
    }
  };

  const handleBack = () => {
    navigate("/vendor");
  };

  // handle file selection: size limit + preview
  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0];

    if (!file) {
      setImageFile(null);
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
      return;
    }

    const MAX_SIZE = 1 * 1024 * 1024; // 1 MB

    if (file.size > MAX_SIZE) {
      setError("Image too large. Please upload a file under 1 MB.");
      setImageFile(null);
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
      return;
    }

    if (imagePreview) URL.revokeObjectURL(imagePreview);

    setImageFile(file);
    const previewUrl = URL.createObjectURL(file);
    setImagePreview(previewUrl);
  };

  return (
    <div className="app-shell vendor-page">
      <div className="container">
        {/* Top bar */}
        <div className="top-bar">
          <div>
            Logged in as{" "}
            <strong>{user?.email || user?.uid || "Unknown user"}</strong>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn outline" onClick={handleBack}>
              Back to Vendor Dashboard
            </button>
          </div>
        </div>

        <h1 className="page-title">Menu Management</h1>
        <p className="page-subtitle">
          Add, edit, categorise and control availability. Employees see these
          changes instantly in their app.
        </p>

        {error && (
          <div className="info-banner error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        {notif && (
          <div className="info-banner" style={{ marginTop: 12 }}>
            {notif}
          </div>
        )}

        {/* Add / Edit item */}
        <div className="card" style={{ marginTop: 20 }}>
          <h2 className="card-title">
            {editingId ? "Edit Menu Item" : "Add New Item"}
          </h2>

          <form
            onSubmit={handleSubmitItem}
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 12,
            }}
          >
            <input
              className="input"
              placeholder="Item name (e.g., Masala Dosa)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr",
                gap: 12,
              }}
            >
              <input
                className="input"
                placeholder="Price (₹)"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                type="number"
                min="0"
              />
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="Breakfast">Breakfast</option>
                <option value="Lunch">Lunch</option>
                <option value="Snacks">Snacks</option>
                <option value="Dinner">Dinner</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* Image upload with size check + preview + progress */}
            <div>
              <div className="small" style={{ marginBottom: 4 }}>
                {editingId ? "Change image (optional)" : "Upload image (optional)"}
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
              />
              <p className="small" style={{ marginTop: 4, color: "#6b7280" }}>
                Max size: 1&nbsp;MB. Recommended: 4:3 or 16:9 landscape photos.
              </p>

              {/* Existing image (when editing) */}
              {editingId && editingOriginalImage && !imagePreview && (
                <div
                  style={{
                    marginTop: 8,
                    display: "inline-block",
                    borderRadius: 12,
                    overflow: "hidden",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <img
                    src={editingOriginalImage}
                    alt="Current"
                    style={{
                      display: "block",
                      maxWidth: 220,
                      maxHeight: 140,
                      objectFit: "cover",
                    }}
                  />
                </div>
              )}

              {/* New preview if a new file selected */}
              {imagePreview && (
                <div
                  style={{
                    marginTop: 8,
                    display: "inline-block",
                    borderRadius: 12,
                    overflow: "hidden",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <img
                    src={imagePreview}
                    alt="Preview"
                    style={{
                      display: "block",
                      maxWidth: 220,
                      maxHeight: 140,
                      objectFit: "cover",
                    }}
                  />
                </div>
              )}

              {uploading && (
                <div style={{ marginTop: 8 }}>
                  <div
                    className="small"
                    style={{ marginBottom: 2, color: "#4b5563" }}
                  >
                    Uploading image… {uploadProgress}%
                  </div>
                  <div
                    style={{
                      width: 220,
                      height: 6,
                      borderRadius: 999,
                      background: "#e5e7eb",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${uploadProgress}%`,
                        height: "100%",
                        background: "#2563eb",
                        transition: "width 0.2s ease-out",
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 4,
              }}
            >
              <input
                type="checkbox"
                checked={available}
                onChange={(e) => setAvailable(e.target.checked)}
              />
              <span className="small">Available</span>
            </label>

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                className="btn"
                type="submit"
                disabled={uploading}
                style={{ maxWidth: 160 }}
              >
                {uploading
                  ? "Saving…"
                  : editingId
                  ? "Save Changes"
                  : "Add Item"}
              </button>

              {editingId && (
                <button
                  type="button"
                  className="btn outline"
                  onClick={resetForm}
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Existing items */}
        <div className="section" style={{ marginTop: 28 }}>
          <h2 className="section-title">Existing Menu</h2>
          {items.length === 0 ? (
            <div className="info-banner muted">
              No items yet. Use the form above to add your first dish.
            </div>
          ) : (
            <div className="menu-list vendor-menu-list">
              {items.map((item) => (
                <div key={item.id} className="menu-card">
                  <div className="menu-left">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="menu-thumb"
                      />
                    ) : (
                      <div className="menu-thumb placeholder">
                        <span role="img" aria-label="no image">
                          📷
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="menu-main">
                    <h2>{item.name}</h2>
                    <p>Price: ₹{item.price}</p>
                    <p style={{ fontSize: 12, color: "#6b7280" }}>
                      {item.category || "Uncategorised"}
                    </p>
                    <p>
                      Available:{" "}
                      <strong
                        style={{
                          color: item.available ? "#16a34a" : "#b91c1c",
                        }}
                      >
                        {item.available ? "Yes" : "No"}
                      </strong>
                    </p>
                  </div>
                  <div className="menu-action">
                    <button
                      className="btn outline"
                      type="button"
                      onClick={() => handleToggleAvailability(item)}
                    >
                      Mark {item.available ? "Unavailable" : "Available"}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      style={{ marginTop: 6 }}
                      onClick={() => handleEditItem(item)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn outline danger"
                      type="button"
                      style={{ marginTop: 6 }}
                      onClick={() => handleDeleteItem(item)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}