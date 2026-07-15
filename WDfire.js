// ==========================================================================
// 🔥 FIREBASE LIGHTWEIGHT INITIALIZATION FOR HOME PAGE STATUS (v11 MODULAR)
// ==========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDQFAJH5_V1-qApDKg1I9RcDi3eVMcWAWg", 
    authDomain: "eternal-memories-wedding.firebaseapp.com",
    projectId: "eternal-memories-wedding",
    storageBucket: "eternal-memories-wedding.firebasestorage.app",
    messagingSenderId: "702108745012",
    appId: "1:702108745012:web:1bf2f1f8de187ed231b961",
    measurementId: "G-M16V77Z2QS" 
};

// Initialize Firebase Node
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ==========================================================================
// 🌐 LIVE NAVBAR USER STATE MANAGER (Clean & Synchronized)
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    const loginLink = document.querySelector('.nav-login-link');
    const startFreeBtn = document.querySelector('.get-started-btn');
    const heroActionBtn = document.querySelector('.hero-action-btn');

    // 🎯 REUSABLE UI RENDER ENGINE (Bina repetitive code ke State update karega)
    function updateNavbarUI(isUserActive) {
        if (isUserActive) {
            console.log("Navbar Pipeline: Render Active Dashboard Links");
            if (loginLink) { loginLink.textContent = "DASHBOARD"; loginLink.href = "DSB.html"; }
            if (startFreeBtn) { startFreeBtn.textContent = "VIEW DASHBOARD"; startFreeBtn.href = "DSB.html"; }
            if (heroActionBtn) { heroActionBtn.textContent = "VIEW DASHBOARD"; heroActionBtn.href = "DSB.html"; }
        } else {
            console.log("Navbar Pipeline: Render Guest Access Links");
            if (loginLink) { loginLink.textContent = "LOG IN"; loginLink.href = "login.html"; }
            if (startFreeBtn) { startFreeBtn.textContent = "START FREE"; startFreeBtn.href = "login.html"; }
            if (heroActionBtn) { heroActionBtn.textContent = "CREATE FREE GALLERY"; heroActionBtn.href = "login.html"; }
        }
    }

    // 🚀 STEP 1: INSTANT HYBRID LOCAL STORAGE PATCH
    const localLoggedIn = localStorage.getItem('isLoggedIn');
    const clientWorkspace = localStorage.getItem('clientWorkspace');

    if (localLoggedIn === 'true' && clientWorkspace) {
        // Agar local storage me verification cache pada hai, UI turant Dashboard link dikhayega
        updateNavbarUI(true);
    } else {
        // Default guest links load honge
        updateNavbarUI(false);
    }

    // 🔥 FIX SPOT: DOM Parse hote hi page visual active kar do, wait nahi karwana
    document.body.classList.add('loaded');

    // 🚀 STEP 2: SILENT BACKEND AUTH WATCHDOG SYNC
    onAuthStateChanged(auth, (user) => {
        if (user) {
            console.log("🟢 Firebase Auth Session Active:", user.email);
            
            // Sync current validated data safely to storage bucket cache
            localStorage.setItem('isLoggedIn', 'true');
            localStorage.setItem('clientWorkspace', user.uid);
            
            updateNavbarUI(true);
        } else {
            console.log("ℹ️ Firebase Auth reported: No Active Core Google Session");
            
            // Catch Block: Agar manual session login available hai, toh use ignore nahi karenge
            if (localStorage.getItem('isLoggedIn') === 'true' && localStorage.getItem('clientWorkspace')) {
                console.log("✅ Keeping current manual/client custom workspace active.");
                updateNavbarUI(true);
            } else {
                // Real Logout detected: Wiping UI completely to safety
                updateNavbarUI(false);
            }
        }
    });
});