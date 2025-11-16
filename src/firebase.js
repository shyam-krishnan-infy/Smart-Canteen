// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCYlx1S9uJXvOlXpdE95NsrxM6yd0xElWg",
  authDomain: "smart-canteen-demo-fada9.firebaseapp.com",
  projectId: "smart-canteen-demo-fada9",
  storageBucket: "smart-canteen-demo-fada9.firebasestorage.app",
  messagingSenderId: "892214668404",
  appId: "1:892214668404:web:b80d1af599ef2a99cf7521"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export default app;