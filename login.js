// ==========================================================================
// 🔒 FIREBASE CONFIGURATION
// ==========================================================================
const firebaseConfig = {
    apiKey: "AIzaSyDQFAJH5_V1-qApDKg1I9RcDi3eVMcWAWg", 
    authDomain: "eternal-memories-wedding.firebaseapp.com",
    projectId: "eternal-memories-wedding",
    storageBucket: "eternal-memories-wedding.firebasestorage.app",
    messagingSenderId: "702108745012",
    appId: "1:702108745012:web:1bf2f1f8de187ed231b961",
    measurementId: "G-M16V77Z2QS" 
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

const loginSection = document.getElementById('loginSection');
const setupSection = document.getElementById('setupSection');
const manualCredentialsGroup = document.getElementById('manualCredentialsGroup');

function resetBtn(button, text) {
    if (button) {
        button.innerText = text;
        button.disabled = false;
    }
}

// ==========================================================================
// 🔁 VIEW SWITCHING (Login <-> Signup)
// ==========================================================================
const switchToSignUpBtn = document.getElementById('switchToSignUpBtn');
if (switchToSignUpBtn) {
    switchToSignUpBtn.addEventListener('click', (e) => {
    e.preventDefault();
    loginSection.style.display = 'none';
    setupSection.style.display = 'block';
    if (manualCredentialsGroup) manualCredentialsGroup.style.display = 'block';

    // 👇 YE 2 LINES ADD KARO — manual signup me fields wapas required karo
    document.getElementById('signupEmail').required = true;
    document.getElementById('signupPassword').required = true;
});

}

const backToLogin = document.getElementById('backToLogin');
if (backToLogin) {
    backToLogin.addEventListener('click', (e) => {
        e.preventDefault();
        setupSection.style.display = 'none';
        loginSection.style.display = 'block';
    });
}

// ==========================================================================
// 🔐 EMAIL/PASSWORD LOGIN (Firebase Auth — secure, no plaintext passwords)
// ==========================================================================
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();

        const email = document.getElementById('loginEmail').value.trim();
        const pass = document.getElementById('loginPassword').value.trim();
        const submitBtn = document.querySelector('.submit-btn');

        if (submitBtn) { submitBtn.innerText = "Verifying..."; submitBtn.disabled = true; }

        firebase.auth().signInWithEmailAndPassword(email, pass)
            .then((cred) => loadUserProfileAndRedirect(cred.user))
            .catch((error) => {
                console.error("Login Error:", error);
                if (error.code === 'auth/user-not-found') {
                    alert('❌ No account found with this email. Please sign up.');
                } else if (error.code === 'auth/wrong-password') {
                    alert('❌ Incorrect password.');
                } else {
                    alert('⚙️ ' + error.message);
                }
                resetBtn(submitBtn, "Log In");
            });
    });
}

// ==========================================================================
// 🔄 GOOGLE AUTH FLOW
// ==========================================================================
const googleBtn = document.getElementById('google-signin-btn');
if (googleBtn) {
    googleBtn.addEventListener('click', function() {
        const provider = new firebase.auth.GoogleAuthProvider();

firebase.auth().signInWithPopup(provider)
    .then((result) => {
        const user = result.user;
        db.collection("users").doc(user.uid).get().then((doc) => {
            if (doc.exists) {
                loadUserProfileAndRedirect(user);
            } else {
                loginSection.style.display = 'none';
                setupSection.style.display = 'block';
                if (manualCredentialsGroup) manualCredentialsGroup.style.display = 'none';

                // 👇 YE 2 LINES ADD KARO — hidden fields ko required na rakho
                document.getElementById('signupEmail').required = false;
                document.getElementById('signupPassword').required = false;

                localStorage.setItem('tempUid', user.uid);
                localStorage.setItem('tempEmail', user.email);
            }
        });
    })
            .catch((error) => {
                console.error("Google Auth Error:", error);
                if (error.code !== 'auth/popup-closed-by-user') {
                    alert("Google Sign-In failed: " + error.message);
                }
            });
    });
}

// ==========================================================================
// 📝 SIGNUP FORM (Handles BOTH manual signup and Google onboarding)
// ==========================================================================
const setupForm = document.getElementById('setupForm');
if (setupForm) {
    setupForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const submitBtn = document.querySelector('.setup-submit-btn');
        if (submitBtn) { submitBtn.innerText = "Creating Account..."; submitBtn.disabled = true; }

        const userRole = document.getElementById('userRole').value;
        const businessName = document.getElementById('businessName').value.trim();
        const websiteUrl = document.getElementById('websiteUrl').value.trim() || "";

        const tempUid = localStorage.getItem('tempUid');

        if (tempUid) {
            // ── Google onboarding path: account already exists in Firebase Auth ──
            saveUserProfile(tempUid, localStorage.getItem('tempEmail'), userRole, businessName, websiteUrl, submitBtn);
        } else {
            // ── Manual signup path: create a brand-new Firebase Auth account ──
            const email = document.getElementById('signupEmail').value.trim();
            const pass = document.getElementById('signupPassword').value.trim();

            firebase.auth().createUserWithEmailAndPassword(email, pass)
                .then((cred) => {
                    return cred.user.sendEmailVerification().then(() => {
                        return saveUserProfile(cred.user.uid, email, userRole, businessName, websiteUrl, submitBtn);
                    });
                })
                .catch((error) => {
                    console.error("Signup Error:", error);
                    if (error.code === 'auth/email-already-in-use') {
                        alert('❌ This email is already registered. Please log in instead.');
                    } else if (error.code === 'auth/weak-password') {
                        alert('❌ Password must be at least 6 characters.');
                    } else {
                        alert('⚙️ ' + error.message);
                    }
                    resetBtn(submitBtn, "CREATE FREE ACCOUNT");
                });
        }
    });
}

// ==========================================================================
// 💾 HELPER: Save user profile document to Firestore
// ==========================================================================
function saveUserProfile(uid, email, role, businessName, websiteUrl, submitBtn) {
    db.collection("users").doc(uid).set({
        uid: uid,
        email: email,
        role: role,
        businessName: businessName,
        websiteUrl: websiteUrl,
        accountStatus: "trial",
        subscriptionStatus: "trial",
        planName: "7-day Free Trial",
        trialStartDate: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    })
    .then(() => {
        localStorage.removeItem('tempUid');
        localStorage.removeItem('tempEmail');
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('clientWorkspace', uid);           // 👈 ab UID hi workspace ID hai
        localStorage.setItem('userRole', role);
        localStorage.setItem('loggedInClientName', businessName);
        const user = firebase.auth().currentUser;
        if (user && user.providerData.some(provider => provider.providerId === 'password')) {
            alert("Verification email sent. Please verify your email before creating galleries or uploading photos.");
        }
        window.location.href = 'DSB.html';
    })
    .catch((error) => {
        console.error("Error creating profile:", error);
        alert("Failed to create profile: " + error.message);
        resetBtn(submitBtn, "CREATE FREE ACCOUNT");
    });
}

// ==========================================================================
// 💾 HELPER: Existing user — load profile & redirect
// ==========================================================================
function loadUserProfileAndRedirect(user) {
    db.collection("users").doc(user.uid).get().then((doc) => {
        const data = doc.exists ? doc.data() : {};
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('clientWorkspace', user.uid);       // 👈 ab UID hi workspace ID hai
        localStorage.setItem('userRole', data.role || 'photographer');
        localStorage.setItem('loggedInClientName', data.businessName || 'Studio Space');
        window.location.href = 'DSB.html';
    });
}

// ==========================================================================
// 🔑 FORGOT PASSWORD
// ==========================================================================
const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const email = prompt("Enter your email");
        if (!email) return;
        firebase.auth().sendPasswordResetEmail(email.trim())
            .then(() => alert("📧 Password reset link."))
            .catch((error) => alert("⚙️ " + error.message));
    });
}
