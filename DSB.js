// 🏷️ BUILD MARKER — update this string every time you deploy a new DSB.js.
// Open DevTools Console after deploying and confirm THIS exact line prints —
// if it doesn't (or shows an older date), the browser/CDN is still serving
// a stale cached copy, not your latest edit.
console.log("PHOTRIX DSB.js build: 2026-07-19-b");

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
const storage = firebase.storage();

let currentUid = null;
let currentUser = null;
let dashboardStarted = false;
let verificationEmailAttempted = false;
const TRIAL_DAYS = 7;

// DOM SELECTORS (Updated for New UI Design)
const bulkImagePickerFiles = document.getElementById("realFileInput");
const uploadImagesBtn = document.getElementById("startCloudUploadBtn");
const uploadStatusNotificationLabel = document.getElementById("uploadStatusText");
const clientGeneratedUrlDisplayField = document.getElementById("clientGeneratedUrlDisplayField");
const generateClientLinkBtn = document.getElementById("generateClientLinkBtn");
const copySecureLinkBtn = document.getElementById("copySecureLinkBtn");
const liveClientSelectionThumbnailsGrid = document.getElementById("liveClientSelectionThumbnailsGrid");
const selectionStatsStatusSummaryCounter = document.getElementById("selectionStatsStatusSummaryCounter");
const paymentStatusBadgeIndicator = document.getElementById("paymentStatusBadgeIndicator");
const unlockPremiumGalleryBtn = document.getElementById("unlockPremiumGalleryBtn");
const storageTextCounter = document.getElementById("storageTextSpan");


let activeProjectId = null;
let activeProjectName = null;
const activeClientIndicator = document.getElementById("activeClientIndicator");

function getTrialDaysLeft(data) {
    const start = data?.trialStartDate || data?.createdAt;
    const startMillis = start && start.toMillis ? start.toMillis() : start;
    if (!startMillis) return TRIAL_DAYS;
    return Math.max(0, Math.ceil(TRIAL_DAYS - ((Date.now() - startMillis) / 86400000)));
}

async function canManageStudio() {
    if (!currentUser || currentUser.uid !== currentUid) {
        alert("Your session has expired. Please log in again.");
        window.location.replace("login.html");
        return false;
    }
    await currentUser.reload();
    if (!currentUser.emailVerified) {
        if (!verificationEmailAttempted && currentUser.providerData.some(provider => provider.providerId === "password")) {
            verificationEmailAttempted = true;
            try { await currentUser.sendEmailVerification(); } catch (error) { console.warn("Verification email could not be sent.", error); }
        }
        alert("Please verify your email address first. A verification link has been sent to your email.");
        return false;
    }
    const userDoc = await db.collection("users").doc(currentUid).get();
    const account = userDoc.exists ? userDoc.data() : {};
    if (account.subscriptionStatus === "active" || getTrialDaysLeft(account) > 0) return true;
    alert("Your 7-day free trial has ended. Please subscribe to add or upload galleries.");
    return false;
}

function findLoadedProject(projectId) {
    // allClientDocs is populated by the client tracker listener before any
    // row can be clicked, so this is always available without a fresh read.
    return allClientDocs.find(item => item.id === projectId)?.data || null;
}

// 🆕 FIX: switching clients used to always leave the link field blank, even
// when that client already had a valid (not-yet-expired) link — so
// photographers kept hitting "Generate Client Link" again "just to be
// safe," which silently created a brand new shareId + duplicate preview
// photos in Storage every time. Now the existing link AND its original PIN
// are both restored automatically (via getGalleryPin) — no need to ever
// regenerate just because the PIN wasn't written down somewhere.
async function restoreExistingLinkIfValid(projectId) {
    const data = findLoadedProject(projectId);
    const pinDisplay = document.getElementById("clientGalleryPinDisplay");
    const stillValid = data?.shareId && data?.expiresAt?.toMillis && data.expiresAt.toMillis() > Date.now();

    if (!stillValid) {
        if (clientGeneratedUrlDisplayField) clientGeneratedUrlDisplayField.value = "";
        if (pinDisplay) { pinDisplay.style.display = "none"; pinDisplay.textContent = ""; }
        return;
    }

    const securePath = `${window.location.origin}${window.location.pathname.replace("DSB.html", "lookbook.html")}?gallery=${encodeURIComponent(data.shareId)}`;
    if (clientGeneratedUrlDisplayField) clientGeneratedUrlDisplayField.value = securePath;

    try {
        const getPin = firebase.app().functions("asia-south1").httpsCallable("getGalleryPin");
        const result = await getPin({ projectId });
        if (pinDisplay) {
            pinDisplay.textContent = `Gallery PIN: ${result.data.pin} — same PIN as before, active until ${new Date(result.data.expiresAt).toLocaleString()}.`;
            pinDisplay.style.display = "block";
        }
    } catch (err) {
        console.warn("Could not fetch existing PIN:", err);
        if (pinDisplay) {
            pinDisplay.textContent = `Active link exists (expires ${new Date(data.expiresAt.toMillis()).toLocaleString()}), but the PIN could not be loaded — try reselecting this client.`;
            pinDisplay.style.display = "block";
        }
    }
}


function setActiveProject(projectId, coupleName) {
    activeProjectId = projectId;
    activeProjectName = coupleName;
    if (activeClientIndicator) {
        activeClientIndicator.innerText = `Currently working on: ${coupleName}`;
        activeClientIndicator.style.color = "var(--primary-blue)";
    }
    // Jab client badle, uska tracker data + storage bhi reload karo
    listenLiveClientPipeline();
    restoreExistingLinkIfValid(projectId);
    calculateCloudStorageMetrics();
}

// ==========================================================================
// 🛠️ FEATURE 1: IMAGES UPLOADER ENGINE (Secured at Action Click)
// ==========================================================================

// 🆕 VALIDATION RULES — yahan se limits control hote hain
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_FILE_SIZE_MB = 30;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 500;

if (uploadImagesBtn) {
    uploadImagesBtn.addEventListener("click", async function() {
        if (!activeProjectId) return alert("Please select a client from the table first!");
        if (!(await canManageStudio())) return;

        const files = bulkImagePickerFiles.files;
        if (files.length === 0) return alert("Please select files first!");

        // 🛡️ ACTION GUARD: Only verify context right when hitting the server
        const isUserLogged = localStorage.getItem('isLoggedIn') === 'true';
        if (!isUserLogged) {
            return alert("Session Out: Unauthorized action blocked. Please login again.");
        }

        const fileArray = Array.from(files);

        if (fileArray.length > MAX_FILES_PER_UPLOAD) {
            return alert(`⚠️ Too many files selected! Max ${MAX_FILES_PER_UPLOAD} photos allowed per upload. You selected ${fileArray.length}.`);
        }

        // 2) Type + size check — har file ko validate karo
        const invalidTypeFiles = [];
        const oversizedFiles = [];

        fileArray.forEach((file) => {
            if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
                invalidTypeFiles.push(file.name);
            }
            if (file.size > MAX_FILE_SIZE_BYTES) {
                oversizedFiles.push(file.name);
            }
        });

        if (invalidTypeFiles.length > 0) {
            return alert(`❌ Only image files (JPG, PNG, WEBP, HEIC) are allowed.\n\nInvalid files:\n${invalidTypeFiles.slice(0, 5).join("\n")}${invalidTypeFiles.length > 5 ? `\n...and ${invalidTypeFiles.length - 5} more` : ""}`);
        }

        if (oversizedFiles.length > 0) {
            return alert(`❌ Each photo must be under ${MAX_FILE_SIZE_MB}MB.\n\nToo large:\n${oversizedFiles.slice(0, 5).join("\n")}${oversizedFiles.length > 5 ? `\n...and ${oversizedFiles.length - 5} more` : ""}`);
        }
        // ==================================================================
        // ✅ Validation passed — ab upload shuru karo
        // ==================================================================

        uploadImagesBtn.innerText = "Uploading Assets...";
        uploadImagesBtn.disabled = true;
        let uploadCounter = 0;

        // 🆕 Category dropdown se select ki hui category yahan padho
        const selectedCategory = document.getElementById("photoCategorySelect")?.value || "Wedding";

        fileArray.forEach((file, index) => {
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const fileRef = storage.ref().child(`client-albums/${currentUid}/${activeProjectId}/${Date.now()}-${index}-${safeName}`);

            // 🆕 Category ko file ke saath metadata me save karo
            const metadata = {
                customMetadata: {
                    category: selectedCategory,
                    originalName: file.name
                }
            };

            fileRef.put(file, metadata).then(() => {
                uploadCounter++;
                if (uploadStatusNotificationLabel) {
                    uploadStatusNotificationLabel.innerText = `Syncing Progress: ${uploadCounter}/${fileArray.length} Loaded!`;
                }
                if (uploadCounter === fileArray.length) {
                    alert("🎉 All assets uploaded securely to Cloud Bucket!");
                    uploadImagesBtn.innerText = "Upload Images";
                    uploadImagesBtn.disabled = false;
                    calculateCloudStorageMetrics();
                }
            }).catch(err => {
                console.error("Upload error:", err);
                alert("❌ Upload blocked. Resetting connection pipeline.");
                uploadImagesBtn.innerText = "Upload Images";
                uploadImagesBtn.disabled = false;
            });
        });
    });
}

// ==========================================================================
// 🔗 FEATURE 2: SECURE CLIENT LINK GENERATOR
// 🛠️ FIX: purane code me yahan link generate hone ke baad ek dusra,
// direct client-side write "publicGalleries/{shareId}" par hota tha jo
// expiresAt ko plain number se overwrite kar deta tha (Cloud Function ne
// use pehle hi sahi Timestamp ke roop me likha hota hai). Ye duplicate
// write ab poori tarah hata di gayi hai — Cloud Functions (createGalleryShare
// + publishGalleryPreviews) hi is data ka single source of truth hain.
// ==========================================================================
if (generateClientLinkBtn) {
    generateClientLinkBtn.addEventListener("click", async function() {
        if (!activeProjectId) return alert("⚠️ Please select a client from the table first!");

        if (!(await canManageStudio())) return;

        // 🛠️ FIX: this used to warn-then-allow regenerating a *whole new*
        // link even while the old one was still valid, which duplicated
        // shareId/gallerySecrets/preview data. But hard-blocking entirely
        // (yesterday's fix) created a new problem: a photographer who
        // uploads MORE photos after already generating a link had no way
        // to get those new photos into the client's gallery until the old
        // link naturally expired. Now: the shareId/PIN never change while
        // still valid (no duplicate data), but the photo list CAN be
        // refreshed on demand — same link, same PIN, just re-synced photos.
        const existing = findLoadedProject(activeProjectId);
        const existingStillValid = existing?.shareId && existing?.expiresAt?.toMillis && existing.expiresAt.toMillis() > Date.now();
        if (existingStillValid) {
            const refresh = confirm(
                `This client already has an active link (expires ${new Date(existing.expiresAt.toMillis()).toLocaleString()}).\n\n` +
                `The link and PIN won't change, but I can refresh the gallery's photo list to include anything you've uploaded since it was generated.\n\n` +
                `Refresh photos now?`
            );
            if (!refresh) return;

            generateClientLinkBtn.disabled = true;
            generateClientLinkBtn.innerText = "Refreshing photos...";
            try {
                await createGalleryPreviews(existing.shareId);
                alert("✅ Gallery photos refreshed. The same link and PIN still work for your client.");
            } catch (error) {
                console.error("Refresh failed:", error);
                alert("❌ Could not refresh photos. Check console for details.");
            } finally {
                generateClientLinkBtn.disabled = false;
                generateClientLinkBtn.innerHTML = '<i class="fas fa-link"></i> Generate Client Link';
            }
            return;
        }

        generateClientLinkBtn.disabled = true;
        generateClientLinkBtn.innerText = "Preparing secure gallery...";

        try {
            const createShare = firebase.app().functions("asia-south1").httpsCallable("createGalleryShare");
            const result = await createShare({ projectId: activeProjectId });
            const { shareId, pin } = result.data;
            const securePath = `${window.location.origin}${window.location.pathname.replace("DSB.html", "lookbook.html")}?gallery=${encodeURIComponent(shareId)}`;

            if (clientGeneratedUrlDisplayField) clientGeneratedUrlDisplayField.value = securePath;
            const pinDisplay = document.getElementById("clientGalleryPinDisplay");
            if (pinDisplay) {
                pinDisplay.textContent = `Gallery PIN: ${pin} — share this with the client separately.`;
                pinDisplay.style.display = "block";
            }

            // Preview upload + publishGalleryPreviews already write previewFiles/previewCategories.
            // createGalleryShare already wrote status/shareId/expiresAt on the project doc.
            // Nothing left to write from the client here.
            await createGalleryPreviews(shareId);

            alert("Secure gallery ready. Send the link and PIN separately to your client. 24-Hour protection protocol is active.");

        } catch (error) {
            console.error("Secure gallery creation failed:", error);
            alert("Secure gallery could not be created. Check console for details.");
        } finally {
            generateClientLinkBtn.disabled = false;
            generateClientLinkBtn.innerHTML = '<i class="fas fa-link"></i> Generate Client Link';
        }
    });
}

 if (copySecureLinkBtn) {
    copySecureLinkBtn.addEventListener("click", function() {
        if (!clientGeneratedUrlDisplayField) return;
        const textToCopy = clientGeneratedUrlDisplayField.value;
        if (!textToCopy) return alert("Generate a link first!");
        navigator.clipboard.writeText(textToCopy).then(() => alert("Link copied to clipboard!"));
       });
}

async function createGalleryPreviews(shareId) {
    const sourceFolder = storage.ref().child(`client-albums/${currentUid}/${activeProjectId}`);
    const sourceFiles = await sourceFolder.listAll();
    if (!sourceFiles.items.length) throw new Error("Upload photos before generating a gallery.");

    const previews = [];
    for (let index = 0; index < sourceFiles.items.length; index++) {
        const source = sourceFiles.items[index];
        const [url, metadata] = await Promise.all([source.getDownloadURL(), source.getMetadata()]);
        const response = await fetch(url);
        if (!response.ok) throw new Error("Could not prepare a gallery preview.");
        const blob = await response.blob();
        const previewBlob = await resizePreview(blob);
        const file = `${index}-${crypto.getRandomValues(new Uint32Array(1))[0]}.jpg`;
        await storage.ref().child(`gallery-previews/${shareId}/${file}`).put(previewBlob, {
            contentType: "image/jpeg",
            customMetadata: { category: metadata.customMetadata?.category || "Wedding" }
        });
        previews.push({ file, category: metadata.customMetadata?.category || "Wedding", originalFile: source.name });
    }
    const publishPreviews = firebase.app().functions("asia-south1").httpsCallable("publishGalleryPreviews");
    await publishPreviews({ shareId, previews });
}

function resizePreview(blob) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(blob);
        image.onload = () => {
            const maxWidth = 1600;
            const scale = Math.min(1, maxWidth / image.naturalWidth);
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(image.naturalWidth * scale);
            canvas.height = Math.round(image.naturalHeight * scale);
            const context = canvas.getContext("2d");
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            context.fillStyle = "rgba(255,255,255,0.72)";
            context.font = `${Math.max(18, Math.round(canvas.width / 28))}px sans-serif`;
            context.textAlign = "center";
            context.fillText("PHOTRIX PREVIEW", canvas.width / 2, canvas.height - Math.max(28, canvas.height / 20));
            URL.revokeObjectURL(objectUrl);
            canvas.toBlob(result => result ? resolve(result) : reject(new Error("Preview conversion failed.")), "image/jpeg", 0.82);
        };
        image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Unsupported image format for previews.")); };
        image.src = objectUrl;
    });
}
//TRACKER

// 🛠️ FIX: purana code field "selectedPhotos" padh raha tha, jabki
// submitGallerySelection Cloud Function "selectedPhotoIds" likhta hai
// (aur values filenames hain, poori URLs nahi) — isliye client ka
// selection dashboard par kabhi dikhta hi nahi tha. Ab sahi field
// padha ja raha hai aur har filename ko Storage se download URL me
// resolve karke dikhaya ja raha hai.
function listenLiveClientPipeline() {
    if (!activeProjectId || !currentUid) return;

    db.collection("users").doc(currentUid).collection("clientProjects").doc(activeProjectId)
        .onSnapshot((doc) => {
            if (liveClientSelectionThumbnailsGrid) liveClientSelectionThumbnailsGrid.innerHTML = "";

            if (doc.exists) {
                const data = doc.data();

                if (paymentStatusBadgeIndicator) {
                    if (data.status === "unlocked") {
                        paymentStatusBadgeIndicator.innerText = "Unlocked & Paid ✅";
                        paymentStatusBadgeIndicator.style.color = "#00cca3";
                    } else if (data.status === "pending_review") {
                        paymentStatusBadgeIndicator.innerText = "Review Compiled! (Payment Needed)";
                        paymentStatusBadgeIndicator.style.color = "#ef4444";
                    } else {
                        paymentStatusBadgeIndicator.innerText = "Awaiting Client Action";
                        paymentStatusBadgeIndicator.style.color = "";
                    }
                }

                if (selectionStatsStatusSummaryCounter) {
                    if (data.selectedPhotoIds && data.selectedPhotoIds.length > 0 && data.shareId) {
                        selectionStatsStatusSummaryCounter.innerText = `Client selected total ${data.selectedPhotoIds.length} photos.`;
                        data.selectedPhotoIds.forEach((file) => {
                            storage.ref(`gallery-previews/${data.shareId}/${file}`).getDownloadURL()
                                .then((url) => {
                                    const img = document.createElement("img");
                                    img.src = url;
                                    if (liveClientSelectionThumbnailsGrid) liveClientSelectionThumbnailsGrid.appendChild(img);
                                })
                                .catch((err) => console.warn("Could not load a selected preview:", file, err));
                        });
                    } else {
                        selectionStatsStatusSummaryCounter.innerText = "Awaiting client selection pipeline...";
                    }
                }
            }
        }, err => console.log("Watchdog passive error:", err));
}

// ==========================================================================
// 💸 FEATURE 4: PREMIUM LOCK REVENUE
// 🆕 HD ZIP download is a paid-plan-only feature — unlocking it now checks
// that the photographer's own subscriptionStatus is "active" (not trial).
// This is a UX convenience only; the real gate is server-side in
// getDownloadUrls (Cloud Function) — this check can't be trusted alone.
// ==========================================================================
if (unlockPremiumGalleryBtn) {
    unlockPremiumGalleryBtn.addEventListener("click", async function() {
        if (!activeProjectId) return alert("⚠️ Please select a client from the table first!");

        if (!(await canManageStudio())) return;

        const userDoc = await db.collection("users").doc(currentUid).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const expiresValue = userData.subscriptionExpiresAt;
        const expiresAtMs = expiresValue && typeof expiresValue.toMillis === "function" ? expiresValue.toMillis() : null;
        const subscriptionActive = userData.subscriptionStatus === "active"
            && (expiresAtMs === null || expiresAtMs > Date.now());
        if (!subscriptionActive) {
            return alert("⚠️ HD ZIP download is a paid-plan feature. Please subscribe to unlock this for your clients.");
        }

        db.collection("users").doc(currentUid).collection("clientProjects").doc(activeProjectId).set({
            status: "unlocked",
            unlockedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).then(() => alert("💸 Gallery Unlocked! Your client can now download the full HD ZIP."));
    });
}

// ==========================================================================
// 🎛️ FEATURE 5: STORAGE METRICS CALCULATOR
// ==========================================================================
function calculateCloudStorageMetrics() {
    if (!storageTextCounter || !storage || !currentUid || !activeProjectId) return;
    const folderRef = storage.ref().child(`client-albums/${currentUid}/${activeProjectId}`);
    folderRef.listAll().then(async (res) => {
        const metadata = await Promise.all(res.items.map(item => item.getMetadata()));
        const bytesUsed = metadata.reduce((total, item) => total + (item.size || 0), 0);
        const megabytesUsed = bytesUsed / (1024 * 1024);
        if (storageTextCounter) storageTextCounter.innerText = `${megabytesUsed.toFixed(1)} MB in this project`;
        const progress = document.querySelector(".metric-card .progress-bar-fill");
        if (progress) progress.style.width = `${Math.min(100, (megabytesUsed / (20 * 1024)) * 100)}%`;
    }).catch(() => {});
}

// ==========================================================================
// 🚪 SECURE LOGOUT PIPELINE (Clears Auth + LocalStorage)
// ==========================================================================
document.addEventListener("click", (e) => {
    if (e.target.closest("#signOutMasterBtn")) {

        // 1. Firebase se session khatam karo
        firebase.auth().signOut().then(() => {
            console.log("🔴 Firebase Auth Logged Out");

            // 2. Browser ka memory (Cache) saaf karo taaki Security lock wapas lag jaye
            localStorage.removeItem('isLoggedIn');
            localStorage.removeItem('clientWorkspace');
            localStorage.clear(); // Safe side ke liye sab saaf

            // 3. User ko wapas Home Page (WD.html) par bhej do
            window.location.replace("WD.html");
        }).catch((error) => {
            console.error("Logout Error:", error);
        });
    }
});

// ==========================================================================
// 🆕 STEP A: NEW CLIENT MODAL — Firestore me naya client project banata hai
// ==========================================================================
const newClientModal = document.getElementById("newClientModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelModalBtn = document.getElementById("cancelModalBtn");
const createClientBtn = document.getElementById("createClientBtn");
const clientNameInput = document.getElementById("clientNameInput");
const eventTypeInput = document.getElementById("eventTypeInput");
const newClientTriggerBtn = document.querySelector(".tracker-section .btn-primary-small"); // "New Client" wala button

function openNewClientModal() {
    if (newClientModal) newClientModal.classList.add("active");
}
function closeNewClientModal() {
    if (newClientModal) newClientModal.classList.remove("active");
    if (clientNameInput) clientNameInput.value = "";
    if (eventTypeInput) eventTypeInput.value = "Wedding";
}

if (newClientTriggerBtn) newClientTriggerBtn.addEventListener("click", openNewClientModal);
if (closeModalBtn) closeModalBtn.addEventListener("click", closeNewClientModal);
if (cancelModalBtn) cancelModalBtn.addEventListener("click", closeNewClientModal);

if (createClientBtn) {
    createClientBtn.addEventListener("click", async function() {
        const coupleName = clientNameInput.value.trim();
        const eventType = eventTypeInput.value;

        if (!coupleName) return alert("Please enter a client/couple name!");
        if (!currentUid) return alert("Session error — please log in again.");

        if (!(await canManageStudio())) return;
        createClientBtn.innerText = "Creating...";
        createClientBtn.disabled = true;

        // 🆕 Goes through a Cloud Function now instead of writing to Firestore
        // directly — the function checks the plan's gallery-count limit
        // before creating anything (see createClientProject in index.js).
        try {
            const createProject = firebase.app().functions("asia-south1").httpsCallable("createClientProject");
            const result = await createProject({ coupleName, eventType });
            console.log("✅ New client project created:", result.data.projectId);
            closeNewClientModal();
            createClientBtn.innerText = "Create & Go to Upload";
            createClientBtn.disabled = false;
            // Naya client banate hi usko automatically "active" bhi bana do
            setActiveProject(result.data.projectId, coupleName);
        } catch (err) {
            console.error("Error creating client project:", err);
            alert(err.code === "functions/resource-exhausted" ? `⚠️ ${err.message}` : "❌ Failed to create client: " + err.message);
            createClientBtn.innerText = "Create & Go to Upload";
            createClientBtn.disabled = false;
        }
    });
}

// ==========================================================================
// 🆕 STEP B: CLIENT TRACKER TABLE — Firestore se real-time data dikhata hai
// (Ab pagination + search dono ek saath kaam karte hain)
// ==========================================================================
const clientTrackerTableBody = document.getElementById("clientTrackerTableBody");
const clientSearchInput = document.getElementById("clientSearchInput");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const paginationInfo = document.getElementById("paginationInfo");

const PAGE_SIZE = 10;
let allClientDocs = [];   // Firestore se aaya poora data (unfiltered)
let currentPage = 1;

function renderClientRow(projectId, data) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-project-id", projectId);
    tr.setAttribute("data-couple-name", data.coupleName || "Unnamed");

    // Selection status badge decide karna
    let statusHtml = "";
    if (data.status === "unlocked") {
        statusHtml = `<span class="status-badge success">✅ Unlocked & Paid</span>`;
    } else if (data.selectedPhotoIds && data.selectedPhotoIds.length > 0) {
        statusHtml = `<span class="status-badge success">✅ ${data.selectedPhotoIds.length} Photos Picked</span>`;
    } else if (data.status === "sent_to_client") {
        statusHtml = `<span class="status-badge pending">⏳ Awaiting Selection</span>`;
    } else {
        statusHtml = `<span class="status-badge pending">🆕 Not Sent Yet</span>`;
    }

    // Event tag color class
    const eventClass = data.eventType === "Pre-Wedding" ? "event-tag pre-wed" : "event-tag";

    const safeName = escapeHtml(data.coupleName || "Unnamed");
    const safeEvent = escapeHtml(data.eventType || "");
    tr.innerHTML = `
        <td data-label="Client Name">
            <div class="client-info">
                <strong>${safeName}</strong>
                <span>${safeEvent}</span>
            </div>
        </td>
        <td data-label="Event Type"><span class="${eventClass}">${safeEvent || "N/A"}</span></td>
        <td data-label="Selection Status">${statusHtml}</td>
        <td data-label="Action">
            <button class="action-btn text-btn copy-project-link-btn" data-project-id="${projectId}">
                <i class="far fa-copy"></i> Copy Link
            </button>
            <button class="action-btn text-btn delete-project-btn" data-project-id="${projectId}" data-couple-name="${safeName}" style="color:#ef4444; border-color:#fecaca;">
                <i class="fas fa-trash"></i>
            </button>
        </td>
    `;
    return tr;
}

// ==========================================================================
// 🆕 RENDER FUNCTION — search filter + pagination dono yahin handle hote hain
// ==========================================================================
function renderTablePage() {
    if (!clientTrackerTableBody) return;

    const query = (clientSearchInput?.value || "").trim().toLowerCase();

    // Pehle search se filter karo
    const filtered = query
        ? allClientDocs.filter(item => (item.data.coupleName || "").toLowerCase().includes(query))
        : allClientDocs;

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(startIndex, startIndex + PAGE_SIZE);

    clientTrackerTableBody.innerHTML = "";

    if (pageItems.length === 0) {
        clientTrackerTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; color:#94a3b8;">${query ? "No clients match your search." : "No clients yet. Click \"New Client\" to add one."}</td></tr>`;
    } else {
        pageItems.forEach(item => {
            const row = renderClientRow(item.id, item.data);
            if (item.id === activeProjectId) row.classList.add("active-row");
            clientTrackerTableBody.appendChild(row);
        });
    }

    // Pagination controls update karo
    if (paginationInfo) paginationInfo.innerText = `Page ${currentPage} of ${totalPages}`;
    if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;
}

// ==========================================================================
// 🔴 FIRESTORE LISTENER — data aate hi metrics calculate + table render
// ==========================================================================
function listenClientTrackerTable() {
    if (!clientTrackerTableBody || !currentUid) return;

    db.collection("users").doc(currentUid).collection("clientProjects")
        .orderBy("createdAt", "desc")
        .onSnapshot((snapshot) => {
            allClientDocs = [];
            let activeLinksCount = 0;
            let readyToDeliverCount = 0;

            snapshot.forEach((doc) => {
                const data = doc.data();
                allClientDocs.push({ id: doc.id, data });

                const hasSelectedPhotos = data.selectedPhotoIds && data.selectedPhotoIds.length > 0;
                if (data.status === "sent_to_client" || data.status === "pending_review") {
                    activeLinksCount++;
                }
                if (hasSelectedPhotos && data.status !== "unlocked") {
                    readyToDeliverCount++;
                }
            });

            updateDashboardMetrics(activeLinksCount, readyToDeliverCount);
            renderTablePage();
        }, (err) => {
            console.error("Error loading client tracker:", err);
        });
}

// 🆕 HELPER FUNCTION — dashboard ke 2 metric cards update karta hai
function updateDashboardMetrics(activeLinks, readyToDeliver) {
    const activeLinksEl = document.getElementById("activeLinksCount");
    const readyToDeliverEl = document.getElementById("readyToDeliverCount");

    if (activeLinksEl) activeLinksEl.innerHTML = `${activeLinks} <span class="metric-label">Live</span>`;
    if (readyToDeliverEl) readyToDeliverEl.innerHTML = `${readyToDeliver} <span class="metric-label">Pending Galleries</span>`;
}

// ==========================================================================
// 🆕 SEARCH — ab sirf filter karta hai, page bhi reset karta hai
// ==========================================================================
if (clientSearchInput) {
    clientSearchInput.addEventListener("input", () => {
        currentPage = 1;
        renderTablePage();
    });
}

// ==========================================================================
// 🆕 PAGINATION BUTTONS
// ==========================================================================
if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
        if (currentPage > 1) { currentPage--; renderTablePage(); }
    });
}
if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
        currentPage++;
        renderTablePage();
    });
}

// ==========================================================================
// 🆕 STEP C: TABLE ROW CLICK — kisi row par click karne se wo client "active" ban jaata hai
// ==========================================================================
if (clientTrackerTableBody) {
    clientTrackerTableBody.addEventListener("click", async (e) => {
        // "Copy Link" button ka apna alag kaam hai — pehle wo check karo
        const copyBtn = e.target.closest(".copy-project-link-btn");
        if (copyBtn) {
            const projectId = copyBtn.getAttribute("data-project-id");
            const project = allClientDocs.find(item => item.id === projectId)?.data;
            // 🛠️ FIX: purana code yahan "?uid=...&project=..." wala alag, broken link
            // banata tha jo lookbook.js samajh hi nahi paata (wo sirf "?gallery=" padhta hai).
            // Ab yahan bhi wahi shareId use ho raha hai jo Generate Client Link banata hai —
            // link banane ki ek hi jagah / ek hi tareeka hai poore app me.
            if (!project?.shareId || project.status === "created") {
                return alert("Select this client, then use Generate Client Link before sharing it.");
            }
            const link = `${window.location.href.split('DSB.html')[0]}lookbook.html?gallery=${encodeURIComponent(project.shareId)}`;
            navigator.clipboard.writeText(link).then(() => alert("📋 Link copied to clipboard!"));
            return; // row-select trigger na ho isliye yahin ruk jao
        }

        // "Delete" button ka apna alag kaam
        const deleteBtn = e.target.closest(".delete-project-btn");
        if (deleteBtn) {
            const projectId = deleteBtn.getAttribute("data-project-id");
            const coupleName = deleteBtn.getAttribute("data-couple-name");

            const confirmed = confirm(`⚠️ Are you sure you want to permanently delete "${coupleName}"?\n\nThis will delete ALL photos and cannot be undone.`);
            if (!confirmed) return;

            deleteBtn.innerText = "Deleting...";
            deleteBtn.disabled = true;

            try {
                // 1. Pehle Storage se saari photos delete karo
                const folderRef = storage.ref().child(`client-albums/${currentUid}/${projectId}`);
                const res = await folderRef.listAll();
                await Promise.all(res.items.map(item => item.delete()));

                // 2. Fir Firestore se project document delete karo
                await db.collection("users").doc(currentUid).collection("clientProjects").doc(projectId).delete();

                // 3. Agar yehi client abhi "active" tha, to active state clear karo
                if (activeProjectId === projectId) {
                    activeProjectId = null;
                    activeProjectName = null;
                    if (activeClientIndicator) {
                        activeClientIndicator.innerText = "No client selected — click a row in the table above";
                        activeClientIndicator.style.color = "var(--text-muted)";
                    }
                }

                alert(`✅ "${coupleName}" and all their photos have been deleted.`);
            } catch (err) {
                console.error("Delete error:", err);
                alert("❌ Failed to delete: " + err.message);
                deleteBtn.innerText = "Delete";
                deleteBtn.disabled = false;
            }
            return;
        }

        // Baaki row click = us client ko active banao
        const row = e.target.closest("tr[data-project-id]");
        if (!row) return;
        const projectId = row.getAttribute("data-project-id");
        const coupleName = row.getAttribute("data-couple-name");
        setActiveProject(projectId, coupleName);

        // Visual feedback: saari rows se highlight hatao, isi row pe lagao
        document.querySelectorAll("#clientTrackerTableBody tr").forEach(r => r.classList.remove("active-row"));
        row.classList.add("active-row");
    });
}

// ==========================================================================
// ⭐ PAGE LOAD — table listener + subscription UI start hoga
// ==========================================================================
firebase.auth().onAuthStateChanged((user) => {
    if (!user) {
        localStorage.removeItem("isLoggedIn");
        localStorage.removeItem("clientWorkspace");
        window.location.replace("login.html");
        return;
    }

    currentUser = user;
    currentUid = user.uid;
    localStorage.setItem("isLoggedIn", "true");
    localStorage.setItem("clientWorkspace", user.uid);
    if (!dashboardStarted) {
        dashboardStarted = true;
        listenClientTrackerTable();
        updateSubscriptionUI();
    }
});

// ==========================================================================
// 🆕 SPA VIEW SWITCHING — sidebar click karne se page reload hue bina
// content switch hota hai
// ==========================================================================
const navItems = document.querySelectorAll(".nav-item[data-target]");
navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
        e.preventDefault();
        const targetId = item.getAttribute("data-target");

        document.querySelectorAll(".view-section").forEach(v => v.classList.remove("active-view"));
        document.getElementById(targetId)?.classList.add("active-view");

        navItems.forEach(nav => nav.classList.remove("active"));
        item.classList.add("active");
    });
});

// ==========================================================================
// 🆕 SUBSCRIPTION TAB UI — current plan status dikhata hai
// ==========================================================================
function updateSubscriptionUI() {
    if (!currentUid) return;
    db.collection("users").doc(currentUid).get().then((doc) => {
        if (!doc.exists) return;
        const data = doc.data();

        const planNameEl = document.getElementById("currentPlanName");
        const statusTextEl = document.getElementById("subscriptionStatusText");

        if (data.subscriptionStatus === "active") {
            if (planNameEl) planNameEl.innerText = data.planName || "Active Plan";
            if (statusTextEl) {
                statusTextEl.innerText = "✅ Your subscription is active.";
                statusTextEl.style.color = "#15803d";
            }
        } else {
            const daysLeft = getTrialDaysLeft(data);

            if (planNameEl) planNameEl.innerText = "Free Trial";
            if (statusTextEl) {
                if (daysLeft > 0) {
                    statusTextEl.innerText = `⏳ ${daysLeft} day(s) left in your free trial.`;
                    statusTextEl.style.color = "";
                } else {
                    statusTextEl.innerText = "❌ Your trial has ended. Please subscribe to continue adding clients.";
                    statusTextEl.style.color = "#ef4444";
                }
            }
            const banner = document.getElementById("trialStatusBanner");
            if (banner) {
                banner.innerText = daysLeft > 0
                    ? `Your free trial has ${daysLeft} day(s) remaining.`
                    : "Your 7-day free trial has ended. Subscribe to keep adding new clients.";
            }
        }
    }).catch(err => console.error("Subscription UI error:", err));
}

// ==========================================================================
// 🆕 WHATSAPP SHARE — gallery link seedha WhatsApp pe pre-filled message ke saath
// ==========================================================================
const whatsappShareBtn = document.getElementById("whatsappShareBtn");
if (whatsappShareBtn) {
    whatsappShareBtn.addEventListener("click", () => {
        const link = clientGeneratedUrlDisplayField?.value;
        if (!link) return alert("Generate a link first!");

        const clientName = activeProjectName || "there";
        const message = `Hi ${clientName}! 📸✨ Your wedding photo gallery is ready. View and select your favorite photos here: ${link}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
    });
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'\"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}