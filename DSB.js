// 🏷️ BUILD MARKER — update this string every time you deploy a new DSB.js.
// Open DevTools Console after deploying and confirm THIS exact line prints —
// if it doesn't (or shows an older date), the browser/CDN is still serving
// a stale cached copy, not your latest edit.
console.log("PHOTRIX DSB.js build: 2026-07-30-v1");

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

// 🆕 APP CHECK — same setup as lookbook.js. Requires adding
// <script src="https://www.gstatic.com/firebasejs/12.15.0/firebase-app-check-compat.js"></script>
// to DSB.html (after firebase-app-compat.js). See the full step-by-step in
// lookbook.js — do not enable enforceAppCheck in index.js until traffic here
// is confirmed passing verification in the Firebase Console.
const RECAPTCHA_V3_SITE_KEY = "PASTE_YOUR_RECAPTCHA_V3_SITE_KEY_HERE";
if (RECAPTCHA_V3_SITE_KEY !== "PASTE_YOUR_RECAPTCHA_V3_SITE_KEY_HERE") {
    firebase.appCheck().activate(
        new firebase.appCheck.ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
        true
    );
} else {
    console.warn("App Check not active yet — set RECAPTCHA_V3_SITE_KEY in DSB.js after registering in Firebase Console.");
}

const db = firebase.firestore();
const storage = firebase.storage();

let currentUid = null;
let currentUser = null;
let dashboardStarted = false;
let verificationEmailAttempted = false;
const TRIAL_DAYS = 7;

// 🛑 FIX: listenLiveClientPipeline() used to be called (setActiveProject,
// new client, rename, etc.) without ever closing the previous onSnapshot
// listener. Each call stacked a NEW listener on top of old ones — with 2+
// listeners live on the same doc, each one independently clears + redraws
// liveClientSelectionThumbnailsGrid, and their async getDownloadURL() calls
// interleave, so photos got double-rendered (e.g. 3 selected -> 6 shown).
// unsubscribeLiveClientPipeline: closes the previous listener before a new
// one is attached. livePipelineRenderToken: guards against a *single*
// listener's own stale async renders landing after a newer snapshot already
// cleared the grid (same race, just within one listener instead of across two).
let unsubscribeLiveClientPipeline = null;
let livePipelineRenderToken = 0;

// DOM SELECTORS
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
const activeClientIndicator = document.getElementById("activeClientIndicator"); // 🗒️ element removed from HTML (replaced by the picker below) — kept as a guarded no-op so nothing here breaks if referenced elsewhere

// 🆕 CLIENT PICKER (Overview UX fix) — the single control for selecting,
// switching, or creating a client. Populated from allClientDocs (declared
// further below, but only READ inside functions below, never at this
// top-level point, so there's no temporal-dead-zone issue — see notes on
// each function). Visibility of the upload/link empty-states is delegated
// to DSBstyle.js's window.setOverviewClientSelectedState(), which is pure
// UI and knows nothing about Firestore — this file only tells it true/false.
const overviewClientQuickPicker = document.getElementById("overviewClientQuickPicker");

function populateOverviewClientQuickPicker() {
    if (!overviewClientQuickPicker) return;
    overviewClientQuickPicker.innerHTML = `<option value="">— Select or create a client —</option>`;
    allClientDocs.forEach(({ id, data }) => {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = data.coupleName || "Unnamed";
        overviewClientQuickPicker.appendChild(opt);
    });
    overviewClientQuickPicker.value = activeProjectId || "";
}

if (overviewClientQuickPicker) {
    overviewClientQuickPicker.addEventListener("change", () => {
        const selectedId = overviewClientQuickPicker.value;
        if (!selectedId) return;
        const match = allClientDocs.find(item => item.id === selectedId);
        setActiveProject(selectedId, match ? match.data.coupleName : "Client");
    });
}

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
    if (account.subscriptionStatus?.trim() === "active" || getTrialDaysLeft(account) > 0) return true;
    alert("Your 7-day free trial has ended. Please subscribe to add or upload galleries.");
    return false;
}

function findLoadedProject(projectId) {
    return allClientDocs.find(item => item.id === projectId)?.data || null;
}

const LIVE_LINK_STATES = ["selection_open", "selection_completed", "published"];

async function restoreExistingLinkIfValid(projectId) {
    const data = findLoadedProject(projectId);
    const pinDisplay = document.getElementById("clientGalleryPinDisplay");
    const stillValid = data?.shareId && LIVE_LINK_STATES.includes(data?.workflowState);

    if (!stillValid) {
        if (clientGeneratedUrlDisplayField) clientGeneratedUrlDisplayField.value = "";
        if (pinDisplay) { pinDisplay.style.display = "none"; pinDisplay.textContent = ""; }
        const regenBtnHide = document.getElementById("regeneratePinBtn");
        if (regenBtnHide) regenBtnHide.style.display = "none";
        updatePublishControls(null);
        return;
    }

    const securePath = `${window.location.origin}${window.location.pathname.replace("DSB.html", "lookbook.html")}?gallery=${encodeURIComponent(data.shareId)}`;
    if (clientGeneratedUrlDisplayField) clientGeneratedUrlDisplayField.value = securePath;
    updatePublishControls(data);

    try {
        const getPin = firebase.app().functions("asia-south1").httpsCallable("getGalleryPin");
        const result = await getPin({ projectId });
        if (pinDisplay) {
            pinDisplay.textContent = `Gallery PIN: ${result.data.pin} — same PIN as before, link is permanently active.`;
            pinDisplay.style.display = "block";
        }
    } catch (err) {
        console.warn("Could not fetch existing PIN:", err);
        if (pinDisplay) {
            pinDisplay.textContent = `Active link exists (expires ${new Date(data.expiresAt.toMillis()).toLocaleString()}), but the PIN could not be loaded — try reselecting this client.`;
            pinDisplay.style.display = "block";
        }
    }

    // 🆕 SECURITY FIX: shows/enables the "Regenerate PIN" button whenever a
    // live link exists. Needed because anyone with the shareId (forwarded
    // link, shared device) can deliberately fail the PIN 8 times and lock
    // the real client out for 15 min repeatedly — this button lets the
    // photographer instantly issue a new PIN and clear any active lockout.
    const regenBtn = document.getElementById("regeneratePinBtn");
    if (regenBtn) regenBtn.style.display = "inline-flex";
}

const regeneratePinBtn = document.getElementById("regeneratePinBtn");
if (regeneratePinBtn) {
    regeneratePinBtn.addEventListener("click", async () => {
        if (!activeProjectId) return;
        const pinDisplay = document.getElementById("clientGalleryPinDisplay");

        const confirmed = confirm("⚠️ This will invalidate the current PIN immediately. The client will need the new PIN to access their gallery. Continue?");
        if (!confirmed) return;

        if (!navigator.onLine) return alert("⚠️ You're offline. Connect to the internet and try again.");

        regeneratePinBtn.disabled = true;
        regeneratePinBtn.innerText = "Regenerating...";

        try {
            const regenerate = firebase.app().functions("asia-south1").httpsCallable("regenerateGalleryPin");
            const result = await regenerate({ projectId: activeProjectId });
            if (pinDisplay) {
                pinDisplay.textContent = `Gallery PIN: ${result.data.pin} — new PIN generated, old PIN no longer works.`;
                pinDisplay.style.display = "block";
            }
            alert("✅ New PIN generated. Please share the new PIN with your client — the old one no longer works.");
        } catch (err) {
            console.error("Regenerate PIN error:", err);
            alert("❌ Failed to regenerate PIN: " + err.message);
        } finally {
            regeneratePinBtn.disabled = false;
            regeneratePinBtn.innerText = "Regenerate PIN";
        }
    });
}

function setActiveProject(projectId, coupleName) {
    activeProjectId = projectId;
    activeProjectName = coupleName;
    if (activeClientIndicator) {
        activeClientIndicator.innerText = `Active project: ${coupleName}`;
        activeClientIndicator.style.color = "var(--primary-blue)";
    }

    // 🆕 Client is now selected — swap the Overview empty-states for the
    // real upload/link content (pure UI toggle, lives in DSBstyle.js).
    if (typeof window.setOverviewClientSelectedState === "function") {
        window.setOverviewClientSelectedState(true);
    }
    if (overviewClientQuickPicker && overviewClientQuickPicker.value !== projectId) {
        overviewClientQuickPicker.value = projectId;
    }

    // 🐞 CRITICAL FIX (wrong-client upload risk): none of this was reset on
    // client switch before. A stale file selection (still sitting in the
    // hidden <input type=file> from a previous client) or a leftover
    // pendingRetryFiles list (from an earlier failed batch) stayed alive
    // across the switch — and since the upload click handler always uses
    // whatever activeProjectId is CURRENT at click time, clicking "Upload
    // Images"/"Retry Failed Uploads" after switching clients could silently
    // upload one client's photos into a completely different client's
    // folder. Every client switch now starts upload state from a clean slate.
    pendingRetryFiles = null;
    if (bulkImagePickerFiles) bulkImagePickerFiles.value = "";
    if (uploadImagesBtn) {
        uploadImagesBtn.style.display = "none";
        uploadImagesBtn.innerText = "Upload Images";
        uploadImagesBtn.disabled = false;
    }
    if (globalProgressWrapper) globalProgressWrapper.style.display = "none";

    listenLiveClientPipeline();
    restoreExistingLinkIfValid(projectId);
    calculateCloudStorageMetrics();
}

// 🛠️ FEATURE 1: IMAGES UPLOADER ENGINE VALIDATION RULES 
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_FILE_SIZE_MB = 30;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 500;

// 🐞 FIX (duplicate photos on retry): earlier, if some files failed and the
// photographer clicked "Upload Images" again with the SAME file selection
// still in the input, EVERY file — including ones that had already
// uploaded successfully — got re-uploaded under a new Date.now() path,
// creating visible duplicates in the gallery. This tracks only the files
// that actually failed, so a retry only re-attempts those.
let pendingRetryFiles = null;
const globalProgressWrapper = document.getElementById("globalProgressWrapper");
const globalPercentageLabel = document.getElementById("globalPercentage");
const globalProgressBarFill = document.getElementById("globalProgressBarFill");

// Selecting a fresh batch of files always means "start over" — clear any
// pending retry-only list so it doesn't get mixed with the new selection.
if (bulkImagePickerFiles) {
    bulkImagePickerFiles.addEventListener("change", () => {
        pendingRetryFiles = null;
        if (uploadImagesBtn) uploadImagesBtn.innerText = "Upload Images";
    });
}

if (uploadImagesBtn) {
    uploadImagesBtn.addEventListener("click", async function() {
        if (!activeProjectId) return alert("Please select a client from the table first!");
        if (!(await canManageStudio())) return;

        // FIX: use the failed-only list when we're in retry mode, otherwise
        // whatever is currently selected in the file input.
        const files = pendingRetryFiles && pendingRetryFiles.length
            ? pendingRetryFiles
            : bulkImagePickerFiles.files;
        if (files.length === 0) return alert("Please select files first!");

        // 🐞 FIX: extra safety net on top of the state-reset fix above —
        // names the exact client before anything uploads, so a photographer
        // managing many clients back-to-back gets one last clear checkpoint
        // instead of trusting silent state.
        if (!confirm(`Upload ${files.length} photo(s) to "${activeProjectName || activeProjectId}"?`)) {
            return;
        }

        const isUserLogged = localStorage.getItem('isLoggedIn') === 'true';
        if (!isUserLogged) {
            return alert("Session Out: Unauthorized action blocked. Please login again.");
        }

        const fileArray = Array.from(files);

        if (fileArray.length > MAX_FILES_PER_UPLOAD) {
            return alert(`⚠️ Too many files selected! Max ${MAX_FILES_PER_UPLOAD} photos allowed per upload. You selected ${fileArray.length}.`);
        }

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

        // 🌐 FIX: fail fast if already offline, instead of letting every
        // file spend up to ~2 minutes retrying (Firebase Storage's default
        // maxUploadRetryTime) before anything tells the user what's wrong.
        if (!navigator.onLine) {
            alert("⚠️ You're offline. Connect to the internet and try uploading again.");
            return;
        }

        uploadImagesBtn.innerText = "Uploading Assets...";
        uploadImagesBtn.disabled = true;
        pendingRetryFiles = null; // this attempt owns these files now

        // 🐞 FIX (invisible progress): #globalProgressWrapper already existed
        // in DSB.html with a percentage label + progress bar, but nothing in
        // this file ever un-hid it or updated the bar — so uploadStatusText
        // was being updated the whole time inside a div stuck on
        // display:none. That's why clicking Upload looked like nothing was
        // happening. Now it's shown for the duration of the upload and
        // actually driven by real progress.
        if (globalProgressWrapper) globalProgressWrapper.style.display = "block";
        if (globalProgressBarFill) globalProgressBarFill.style.width = "0%";
        if (globalPercentageLabel) globalPercentageLabel.textContent = "0%";
        if (uploadStatusNotificationLabel) uploadStatusNotificationLabel.textContent = `Uploading 0 of ${fileArray.length} photos...`;

        let doneCount = 0;      // succeeded
        let failCount = 0;      // failed
        const failedFileObjs = []; // FIX: actual File objects, not just names, so a retry can re-use them directly
        const totalCount = fileArray.length;

        const selectedCategory = document.getElementById("photoCategorySelect")?.value || "Wedding";

        const updateProgressUI = () => {
            const processed = doneCount + failCount;
            const pct = Math.round((processed / totalCount) * 100);
            if (globalProgressBarFill) globalProgressBarFill.style.width = `${pct}%`;
            if (globalPercentageLabel) globalPercentageLabel.textContent = `${pct}%`;
            if (uploadStatusNotificationLabel) {
                uploadStatusNotificationLabel.textContent = failCount > 0
                    ? `Uploading ${processed} of ${totalCount} photos... (${failCount} failed)`
                    : `Uploading ${processed} of ${totalCount} photos...`;
            }
        };

        const finishIfDone = () => {
            if (doneCount + failCount !== totalCount) return;

            uploadImagesBtn.innerText = "Upload Images";
            uploadImagesBtn.disabled = false;
            if (globalProgressWrapper) globalProgressWrapper.style.display = "none";
            calculateCloudStorageMetrics();

            // FIX: accurate partial-failure summary instead of silently
            // never showing the "all done" alert when some files fail.
            if (failCount === 0) {
                alert("🎉 All assets uploaded securely to Cloud Bucket!");
            } else if (doneCount === 0) {
                pendingRetryFiles = failedFileObjs;
                uploadImagesBtn.innerText = `Retry Failed Uploads (${failCount})`;
                alert(`❌ Upload failed for all ${totalCount} photo(s). Check your connection, then click "Retry Failed Uploads".`);
            } else {
                // FIX: set up retry-only mode instead of leaving the
                // photographer to re-select the whole batch (which is what
                // caused duplicates before).
                pendingRetryFiles = failedFileObjs;
                uploadImagesBtn.innerText = `Retry Failed Uploads (${failCount})`;
                alert(`⚠️ Uploaded ${doneCount} of ${totalCount} photos. ${failCount} failed:\n${failedFileObjs.slice(0, 5).map(f => f.name).join("\n")}${failedFileObjs.length > 5 ? `\n...and ${failedFileObjs.length - 5} more` : ""}\n\nClick "Retry Failed Uploads" to upload just those — the ${doneCount} that succeeded won't be re-uploaded.`);
            }
        };

        const reserveUpload = firebase.app().functions("asia-south1").httpsCallable("reservePhotoUpload");
        fileArray.forEach(async (file) => {
            try {
            const reservation = await reserveUpload({
                projectId: activeProjectId,
                originalName: file.name,
                size: file.size,
                contentType: file.type
            });
            const fileRef = storage.ref().child(`client-albums/${currentUid}/${activeProjectId}/${reservation.data.fileName}`);

            // 🐛 FIX: contentType wasn't set here, so Cloud Storage fell back
            // to guessing it from the file extension. For uppercase
            // extensions (iPhone/Android default "IMG_0461.JPG") that guess
            // comes back as application/octet-stream instead of image/jpeg —
            // which no longer matches what reservePhotoUpload already saved
            // in the Firestore reservation (it correctly used file.type).
            // storage.rules then rejects the mismatch as storage/unauthorized.
            // Setting it explicitly here, from the same file.type used for
            // the reservation, keeps both sides identical regardless of
            // filename casing.
            const metadata = {
                contentType: file.type,
                customMetadata: {
                    category: selectedCategory,
                    originalName: file.name
                }
            };

            const uploadTask = fileRef.put(file, metadata);

            // FIX: use the resumable upload's own state_changed events so a
            // connection drop mid-upload updates the status label immediately
            // ("Connection lost, retrying...") instead of the button just
            // sitting on "Uploading Assets..." with no explanation until the
            // internal retry window (~2 min) finally times out.
            uploadTask.on("state_changed",
                () => {
                    if (uploadStatusNotificationLabel && !navigator.onLine) {
                        uploadStatusNotificationLabel.textContent = `⚠️ Connection lost — retrying ${file.name}...`;
                    }
                },
                (err) => {
                    console.error("Upload error:", file.name, err);
                    failCount++;
                    failedFileObjs.push(file);
                    updateProgressUI();
                    finishIfDone();
                },
                () => {
                    doneCount++;
                    updateProgressUI();
                    finishIfDone();
                }
            );
            } catch (err) {
                console.error("Upload reservation error:", file.name, err);
                failCount++;
                failedFileObjs.push(file);
                updateProgressUI();
                finishIfDone();
            }
        });
    });
}

// 🔗 FEATURE 2: SECURE CLIENT LINK GENERATOR
if (generateClientLinkBtn) {
    generateClientLinkBtn.addEventListener("click", async function() {
        if (!activeProjectId) return alert("⚠️ Please select a client from the table first!");
        // 🌐 FIX: same fail-fast pattern as client creation.
        if (!navigator.onLine) return alert("⚠️ You're offline. Connect to the internet and try again.");

        if (!(await canManageStudio())) return;

        const existing = findLoadedProject(activeProjectId);
        const existingStillValid = existing?.shareId && LIVE_LINK_STATES.includes(existing?.workflowState);
        if (existingStillValid) {
            const refresh = confirm(
                `This client already has an active link.\n\n` +
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

    // 🐞 FIX (duplicate photos in client gallery): this generates one preview
    // per Storage object found here. If the same original photo was ever
    // physically stored twice under this client (e.g. an old test upload
    // from before the retry-only-failed-files fix above, or any other
    // reason), every copy got its own preview — the client would see the
    // same photo twice, exactly like in the screenshot. Storage object names
    // are `${timestamp}-${index}-${safeName}`, so de-dupe by that trailing
    // safeName, keeping only the most recently uploaded copy of each. This
    // also retroactively fixes clients who already had duplicate previews —
    // just click "Refresh photos" / re-generate the link.
    const mostRecentByName = new Map();
    for (const item of sourceFiles.items) {
        const match = item.name.match(/^(\d+)-\d+-(.+)$/);
        const key = match ? match[2] : item.name;
        const ts = match ? Number(match[1]) : 0;
        const existing = mostRecentByName.get(key);
        if (!existing || ts > existing.ts) {
            mostRecentByName.set(key, { item, ts });
        }
    }
    const dedupedItems = Array.from(mostRecentByName.values()).map(entry => entry.item);

    const previews = [];
    for (let index = 0; index < dedupedItems.length; index++) {
        const source = dedupedItems[index];
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

function listenLiveClientPipeline() {
    if (!activeProjectId || !currentUid) return;

    // 🛑 FIX: close the previous listener (if any) before attaching a new
    // one — otherwise switching/reselecting a client stacks listeners on
    // the old project's doc forever, each still firing in the background.
    if (unsubscribeLiveClientPipeline) {
        unsubscribeLiveClientPipeline();
        unsubscribeLiveClientPipeline = null;
    }

    unsubscribeLiveClientPipeline = db.collection("users").doc(currentUid).collection("clientProjects").doc(activeProjectId)
        .onSnapshot((doc) => {
            if (liveClientSelectionThumbnailsGrid) liveClientSelectionThumbnailsGrid.innerHTML = "";
            // 🛑 FIX: bump the render token on every snapshot. Any
            // getDownloadURL().then() callback still in flight from a
            // PREVIOUS snapshot checks this before appending — if it's
            // stale (a newer snapshot already cleared the grid), it skips
            // instead of appending a leftover thumbnail into the new render.
            const myRenderToken = ++livePipelineRenderToken;

            if (doc.exists) {
                const data = doc.data();
                updatePublishControls(data);

                if (paymentStatusBadgeIndicator) {
                    if (data.workflowState === "published") {
                        paymentStatusBadgeIndicator.innerText = "Published ✅";
                        paymentStatusBadgeIndicator.style.color = "var(--success-green)";
                    } else if (data.workflowState === "selection_completed") {
                        paymentStatusBadgeIndicator.innerText = "Review Compiled! (Choose theme & Publish)";
                        paymentStatusBadgeIndicator.style.color = "var(--warning-orange)";
                    } else {
                        paymentStatusBadgeIndicator.innerText = "Awaiting Client Action";
                        paymentStatusBadgeIndicator.style.color = "";
                    }
                }

                if (selectionStatsStatusSummaryCounter) {
                    if (data.selectedPhotoIds && data.selectedPhotoIds.length > 0 && data.shareId) {
                        selectionStatsStatusSummaryCounter.innerText = `Client selected total ${data.selectedPhotoIds.length} photos.`;

                        const canEdit = data.workflowState === "selection_completed";
                        data.selectedPhotoIds.forEach((file) => {
                            storage.ref(`gallery-previews/${data.shareId}/${file}`).getDownloadURL()
                                .then((url) => {
                                    // 🛑 FIX: a newer snapshot already fired and cleared the
                                    // grid while this URL was still loading — drop it instead
                                    // of appending a stale thumbnail on top of the new render.
                                    if (myRenderToken !== livePipelineRenderToken) return;

                                    const wrapper = document.createElement("div");
                                    wrapper.className = "thumbnail-wrapper";

                                    const img = document.createElement("img");
                                    img.src = url;
                                    img.onclick = () => {
                                        const lightbox = document.getElementById("photoLightbox");
                                        const lightboxImg = document.getElementById("lightboxImage");
                                        if (lightbox && lightboxImg) {
                                            lightboxImg.src = url;
                                            lightbox.classList.add("active");
                                        }
                                    };

                                    wrapper.appendChild(img);

                                    // Removing a photo only makes sense while still reviewing —
                                    // once published, use "Revert to Editing" first.
                                    if (canEdit) {
                                        const removeBtn = document.createElement("button");
                                        removeBtn.className = "remove-photo-btn";
                                        removeBtn.innerHTML = '<i class="fas fa-trash"></i>';
                                        removeBtn.title = "Remove from selection";

                                        removeBtn.onclick = async (e) => {
                                            e.stopPropagation();
                                            if (!confirm("Are you sure you want to remove this photo from the client's selection?")) return;
                                            removeBtn.disabled = true;
                                            try {
                                                const removePhoto = firebase.app().functions("asia-south1").httpsCallable("removeSelectedPhoto");
                                                await removePhoto({ projectId: activeProjectId, file });
                                            } catch (err) {
                                                console.error("Error removing photo:", err);
                                                alert("Failed to remove photo: " + (err.message || "Try again."));
                                                removeBtn.disabled = false;
                                            }
                                        };

                                        wrapper.appendChild(removeBtn);
                                    }

                                    if (liveClientSelectionThumbnailsGrid) {
                                        liveClientSelectionThumbnailsGrid.appendChild(wrapper);
                                    }
                                })
                                .catch((err) => console.warn("Could not load a selected preview:", file, err));
                        });
                    } else {
                        selectionStatsStatusSummaryCounter.innerText = "No selections yet — waiting on your client.";
                    }
                }
            } else {
                updatePublishControls(null);
            }
        }, err => console.log("Watchdog passive error:", err));
}

// 💸 FEATURE 4: REVIEW & FINALIZE — Publish Gallery / Revert to Editing
const revertToEditingBtn = document.getElementById("revertToEditingBtn");

// Keeps the Publish/Revert buttons in sync with the gallery's current
// workflowState — same URL, same PIN, only the state (and what the
// buttons let you do) changes.
function updatePublishControls(data) {
    if (!unlockPremiumGalleryBtn) return;
    const state = data?.workflowState;

    if (state === "published") {
        unlockPremiumGalleryBtn.style.display = "none";
        if (revertToEditingBtn) revertToEditingBtn.style.display = "inline-flex";
    } else if (state === "selection_completed") {
        unlockPremiumGalleryBtn.style.display = "inline-flex";
        unlockPremiumGalleryBtn.disabled = false;
        unlockPremiumGalleryBtn.innerHTML = '<i class="fas fa-unlock"></i> Publish Gallery';
        if (revertToEditingBtn) revertToEditingBtn.style.display = "none";
    } else {
        // selection_open or no gallery yet — nothing to publish
        unlockPremiumGalleryBtn.style.display = "inline-flex";
        unlockPremiumGalleryBtn.disabled = true;
        unlockPremiumGalleryBtn.innerHTML = '<i class="fas fa-unlock"></i> Awaiting Client Selection';
        if (revertToEditingBtn) revertToEditingBtn.style.display = "none";
    }
}

if (unlockPremiumGalleryBtn) {
    unlockPremiumGalleryBtn.addEventListener("click", async function() {
        if (!activeProjectId) return alert("⚠️ Please select a client from the table first!");
        if (!(await canManageStudio())) return;

        const projectData = findLoadedProject(activeProjectId);
        if (!projectData?.shareId) return alert("⚠️ Generate a client link first!");
        if (projectData.workflowState !== "selection_completed") {
            return alert("⚠️ Client hasn't submitted their selection yet.");
        }
        const themeId = projectData.selectedThemeId;
        if (!themeId) {
            return alert("⚠️ Choose a theme from Gallery Themes first — it gets locked in when you publish.");
        }

        unlockPremiumGalleryBtn.disabled = true;
        unlockPremiumGalleryBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing...';

        try {
            const publish = firebase.app().functions("asia-south1").httpsCallable("applyThemeAndPublish");
            await publish({ projectId: activeProjectId, themeId });
            alert("💸 Gallery Published! Your client can now view the final themed gallery and download the full HD ZIP.");
        } catch (error) {
            console.error("Error publishing gallery:", error);
            alert("Could not publish the gallery: " + (error.message || "Try again."));
            unlockPremiumGalleryBtn.disabled = false;
            unlockPremiumGalleryBtn.innerHTML = '<i class="fas fa-unlock"></i> Publish Gallery';
        }
    });
}

if (revertToEditingBtn) {
    revertToEditingBtn.addEventListener("click", async function() {
        if (!activeProjectId) return;
        if (!confirm("Reopen this gallery for editing? Your client will temporarily see the review-in-progress screen instead of the final gallery, until you publish again.")) return;

        revertToEditingBtn.disabled = true;
        try {
            const revert = firebase.app().functions("asia-south1").httpsCallable("revertGalleryToEditing");
            await revert({ projectId: activeProjectId });
        } catch (error) {
            console.error("Error reverting gallery:", error);
            alert("Could not reopen the gallery: " + (error.message || "Try again."));
        } finally {
            revertToEditingBtn.disabled = false;
        }
    });
}

// 🎛️ FEATURE 5: STORAGE METRICS CALCULATOR
// 🐞 FIX (wrong number shown): this used to list files in just the
// CURRENTLY ACTIVE client's own Storage folder and show "X MB in this
// project" — not useful for "how full is my 20GB plan?" since a
// photographer manages many clients at once, each a different size.
// users/{uid}.storageUsedBytes is already the real ACCOUNT-WIDE total,
// kept accurate in real time by the onPhotoUploaded/onPhotoDeleted Storage
// triggers (see index.js) — so this just reads that directly instead of
// recomputing anything, and listens live so it self-updates within moments
// of any upload/delete anywhere in the account (not just the active one).
let studioStorageListenerAttached = false;
function calculateCloudStorageMetrics() {
    if (!storageTextCounter || !currentUid) return;
    if (studioStorageListenerAttached) return; // listener (below) handles every future update
    studioStorageListenerAttached = true;

    db.collection("users").doc(currentUid).onSnapshot(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        const usedBytes = Number(data.storageUsedBytes) || 0;
        const limitBytes = Number(data.storageLimitBytes) || (20 * 1024 * 1024 * 1024); // 20GB fallback
        const usedGB = usedBytes / (1024 ** 3);
        const limitGB = limitBytes / (1024 ** 3);
        const percent = limitBytes > 0 ? Math.min(100, (usedBytes / limitBytes) * 100) : 0;

        storageTextCounter.innerText = `${usedGB.toFixed(2)} GB of ${limitGB.toFixed(0)} GB used`;
        const progress = document.getElementById("studioStorageProgressFill");
        if (progress) {
            progress.style.width = `${percent.toFixed(1)}%`;
            progress.style.background = percent >= 90 ? "var(--danger-red)" : "";
        }
    }, err => console.warn("Storage metrics listener error:", err));
}

// 🚪 SECURE LOGOUT PIPELINE
document.addEventListener("click", (e) => {
    if (e.target.closest("#signOutMasterBtn")) {
        firebase.auth().signOut().then(() => {
            console.log("🔴 Firebase Auth Logged Out");
            localStorage.removeItem('isLoggedIn');
            localStorage.removeItem('clientWorkspace');
            localStorage.clear(); 
            window.location.replace("WD.html");
        }).catch((error) => {
            console.error("Logout Error:", error);
        });
    }
});

// 🆕 STEP A: NEW CLIENT MODAL
const createClientBtn = document.getElementById("createClientBtn");
// 🆕 Modal open/close (openNewClientModal, closeNewClientModal, closeEditModal)
// and ALL their DOM selectors (newClientModal, closeModalBtn, cancelModalBtn,
// clientNameInput, eventTypeInput, editClientModal, closeEditModalBtn,
// cancelEditModalBtn) now live in DSBstyle.js as pure frontend UI — this
// file only calls the close functions after a successful Firebase write,
// and re-queries the two input fields locally below (rather than a
// duplicate top-level const, which two plain <script> files sharing one
// global scope would collide on).

if (createClientBtn) {
    createClientBtn.addEventListener("click", async function() {
        const coupleName = document.getElementById("clientNameInput").value.trim();
        const eventType = document.getElementById("eventTypeInput").value;

        if (!coupleName) return alert("Please enter a client/couple name!");
        if (!currentUid) return alert("Session error — please log in again.");
        // 🌐 FIX: fail fast + clear message instead of a generic error
        // string after the Cloud Function call times out.
        if (!navigator.onLine) return alert("⚠️ You're offline. Connect to the internet and try again.");

        if (!(await canManageStudio())) return;
        createClientBtn.innerText = "Creating...";
        createClientBtn.disabled = true;

        try {
            const createProject = firebase.app().functions("asia-south1").httpsCallable("createClientProject");
            const result = await createProject({ coupleName, eventType });
            console.log("✅ New client project created:", result.data.projectId);
            closeNewClientModal();
            createClientBtn.innerText = "Create & Go to Upload";
            createClientBtn.disabled = false;
            setActiveProject(result.data.projectId, coupleName);
        } catch (err) {
            console.error("Error creating client project:", err);
            alert(err.code === "functions/resource-exhausted" ? `⚠️ ${err.message}` : "❌ Failed to create client: " + err.message);
            createClientBtn.innerText = "Create & Go to Upload";
            createClientBtn.disabled = false;
        }
    });
}

// 🚀 EDIT CLIENT MODAL LOGIC
// closeEditModal() and its trigger-button bindings now live in DSBstyle.js
// (pure UI, no Firebase) — saveClientEditBtn's handler below is the only
// backend-tied piece, and it calls that same global closeEditModal().
const saveClientEditBtn = document.getElementById("saveClientEditBtn");

if (saveClientEditBtn) {
    saveClientEditBtn.addEventListener("click", async () => {
        const projectId = document.getElementById("editClientIdInput").value;
        const newName = document.getElementById("editClientNameInput").value.trim();
        const newEvent = document.getElementById("editEventTypeInput").value;

        if (!newName) {
            alert("Client name cannot be empty!");
            return;
        }

        saveClientEditBtn.innerText = "Saving...";
        saveClientEditBtn.disabled = true;

        try {
            await db.collection("users").doc(currentUid).collection("clientProjects").doc(projectId).update({
                coupleName: newName,
                eventType: newEvent
            });

            closeEditModal(); 
            saveClientEditBtn.innerText = "Save Changes";
            saveClientEditBtn.disabled = false;
            
            if (activeProjectId === projectId) {
                setActiveProject(projectId, newName);
            }

            if (typeof renderTablePage === "function") {
                renderTablePage(); 
            }

        } catch (error) {
            console.error("Edit Update Error:", error);
            alert("Failed to update project: " + error.message);
            saveClientEditBtn.innerText = "Save Changes";
            saveClientEditBtn.disabled = false;
        }
    });
}

// 🆕 STEP B: CLIENT TRACKER TABLE 
const clientTrackerTableBody = document.getElementById("clientTrackerTableBody");
const clientSearchInput = document.getElementById("clientSearchInput");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const paginationInfo = document.getElementById("paginationInfo");

const PAGE_SIZE = 10;
let allClientDocs = [];
let currentPage = 1;

function renderClientRow(projectId, data) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-project-id", projectId);
    tr.setAttribute("data-couple-name", data.coupleName || "Unnamed");

    let statusHtml = "";
    let statusDotClass = "dot-pending";
    if (data.workflowState === "published") {
        statusHtml = `<span class="status-badge success">✅ Published</span>`;
        statusDotClass = "dot-published";
    } else if (data.selectedPhotoIds && data.selectedPhotoIds.length > 0) {
        statusHtml = `<span class="status-badge success">✅ ${data.selectedPhotoIds.length} Photos Picked</span>`;
        statusDotClass = "dot-picked";
    } else if (data.workflowState === "selection_open") {
        statusHtml = `<span class="status-badge pending">⏳ Awaiting Selection</span>`;
        statusDotClass = "dot-pending";
    } else {
        statusHtml = `<span class="status-badge pending">🆕 Not Sent Yet</span>`;
        statusDotClass = "dot-draft";
    }

    const eventClass = data.eventType === "Pre-Wedding" ? "event-tag pre-wed" : "event-tag";
    const safeName = escapeHtml(data.coupleName || "Unnamed");
    const safeEvent = escapeHtml(data.eventType || "");
    
    tr.innerHTML = `
        <td data-label="Client Name" class="td-name">
            <div class="client-info">
                <strong>${safeName}</strong>
                <span class="client-meta-inline">
                    ${safeEvent ? `<span class="event-pill-mini">${safeEvent}</span>` : ""}
                    <span class="mobile-status-dot ${statusDotClass}" title="${statusHtml.replace(/<[^>]+>/g, "")}"></span>
                </span>
            </div>
            <i class="fas fa-chevron-down row-expand-chevron" aria-hidden="true"></i>
        </td>
        <td data-label="Event Type" class="td-event-detail"><span class="${eventClass}">${safeEvent || "N/A"}</span></td>
        <td data-label="Selection Status" class="td-status-detail">${statusHtml}</td>
        <td data-label="Action" class="td-action">
            <button class="action-btn text-btn manage-project-btn" data-project-id="${projectId}" data-couple-name="${safeName}" title="Manage">
                <i class="fas fa-gauge"></i>
            </button>
            <button class="action-btn text-btn copy-project-link-btn" data-project-id="${projectId}" title="Copy Link">
                <i class="far fa-copy"></i>
            </button>
            <button class="action-btn text-btn edit-project-btn" data-project-id="${projectId}" data-couple-name="${safeName}" data-event-type="${safeEvent}" style="color:var(--primary-blue); border-color:var(--border-medium);" title="Edit">
                <i class="fas fa-pencil-alt"></i>
            </button>
            <button class="action-btn text-btn delete-project-btn" data-project-id="${projectId}" data-couple-name="${safeName}" style="color:var(--danger-red); border-color:rgba(248,113,113,0.35);" title="Delete">
                <i class="fas fa-trash"></i>
            </button>
        </td>
    `;
    return tr;
}

function renderTablePage() {
    if (!clientTrackerTableBody) return;

    const query = (clientSearchInput?.value || "").trim().toLowerCase();

    const filtered = query
        ? allClientDocs.filter(item => (item.data.coupleName || "").toLowerCase().includes(query))
        : allClientDocs;

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(startIndex, startIndex + PAGE_SIZE);

    clientTrackerTableBody.innerHTML = "";

    if (pageItems.length === 0) {
        clientTrackerTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--text-subtle);">${query ? "No clients match your search." : "No clients yet. Click \"New Client\" to add one."}</td></tr>`;
    } else {
        pageItems.forEach(item => {
            const row = renderClientRow(item.id, item.data);
            if (item.id === activeProjectId) row.classList.add("active-row");
            clientTrackerTableBody.appendChild(row);
        });
    }

    if (paginationInfo) paginationInfo.innerText = `Page ${currentPage} of ${totalPages}`;
    if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;
}

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
                if (data.workflowState === "selection_open" || data.workflowState === "selection_completed") {
                    activeLinksCount++;
                }
                if (hasSelectedPhotos && data.workflowState !== "published") {
                    readyToDeliverCount++;
                }
            });

            updateDashboardMetrics(activeLinksCount, readyToDeliverCount);
            renderTablePage();
            populateOverviewClientQuickPicker();
        }, (err) => {
            console.error("Error loading client tracker:", err);
        });
}

function updateDashboardMetrics(activeLinks, readyToDeliver) {
    const activeLinksEl = document.getElementById("activeLinksCount");
    const readyToDeliverEl = document.getElementById("readyToDeliverCount");

    if (activeLinksEl) activeLinksEl.innerHTML = `${activeLinks} <span class="metric-label">Live</span>`;
    if (readyToDeliverEl) readyToDeliverEl.innerHTML = `${readyToDeliver} <span class="metric-label">Pending Galleries</span>`;
}

if (clientSearchInput) {
    clientSearchInput.addEventListener("input", () => {
        currentPage = 1;
        renderTablePage();
    });
}

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

// 🆕 STEP C: TABLE ROW ACTIONS
if (clientTrackerTableBody) {
    clientTrackerTableBody.addEventListener("click", async (e) => {
        
        // 1. COPY LINK
        const copyBtn = e.target.closest(".copy-project-link-btn");
        if (copyBtn) {
            const projectId = copyBtn.getAttribute("data-project-id");
            const project = allClientDocs.find(item => item.id === projectId)?.data;
            if (!project?.shareId || project.workflowState === "draft") {
                return alert("Select this client, then use Generate Client Link before sharing it.");
            }
            const link = `${window.location.href.split('DSB.html')[0]}lookbook.html?gallery=${encodeURIComponent(project.shareId)}`;
            navigator.clipboard.writeText(link).then(() => alert("📋 Link copied to clipboard!"));
            return; 
        }

        // 2. EDIT PROJECT
        const editBtn = e.target.closest(".edit-project-btn");
        if (editBtn) {
            document.getElementById("editClientIdInput").value = editBtn.getAttribute("data-project-id");
            document.getElementById("editClientNameInput").value = editBtn.getAttribute("data-couple-name");
            document.getElementById("editEventTypeInput").value = editBtn.getAttribute("data-event-type");
            document.getElementById("editClientModal").classList.add("active");
            return; 
        }

        // 3. DELETE PROJECT
        const deleteBtn = e.target.closest(".delete-project-btn");
        if (deleteBtn) {
            const projectId = deleteBtn.getAttribute("data-project-id");
            const coupleName = deleteBtn.getAttribute("data-couple-name");

            const confirmed = confirm(`⚠️ Are you sure you want to permanently delete "${coupleName}"?\n\nThis will delete ALL photos and cannot be undone.`);
            if (!confirmed) return;

            // 🌐 FIX: fail fast if offline.
            if (!navigator.onLine) return alert("⚠️ You're offline. Connect to the internet and try again.");

            deleteBtn.innerText = "Deleting...";
            deleteBtn.disabled = true;

            try {
                // 🐞 FIX: this used to do the deletion piece-by-piece directly
                // from the browser — original photos + clientProjects doc
                // deleted fine, but the publicGalleries doc delete silently
                // FAILED every time (firestore.rules blocks browser writes to
                // it) and gallery-previews/ + gallerySecrets/ were never even
                // attempted (also blocked by rules, on purpose). The
                // photographer still saw "✅ deleted" regardless. Now the
                // whole thing runs server-side in one Cloud Function so
                // nothing is left behind — see index.js: deleteClientProject.
                const deleteProject = firebase.app().functions("asia-south1").httpsCallable("deleteClientProject");
                await deleteProject({ projectId });

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

        // 4. MANAGE (mobile expanded-row action, and desktop's direct entry point)
        const manageBtn = e.target.closest(".manage-project-btn");
        if (manageBtn) {
            const projectId = manageBtn.getAttribute("data-project-id");
            const coupleName = manageBtn.getAttribute("data-couple-name");
            setActiveProject(projectId, coupleName);
            document.querySelectorAll("#clientTrackerTableBody tr").forEach(r => r.classList.remove("active-row"));
            manageBtn.closest("tr")?.classList.add("active-row");
            const overviewTab = document.querySelector('.nav-item[data-target="view-overview"]');
            if (overviewTab) overviewTab.click();
            return;
        }

        // 5. ROW SELECTION (desktop) — selects the client + jumps to Overview.
        // On mobile, tapping a row only expands/collapses it (pure UI —
        // handled in DSBstyle.js); use the Manage button above for that.
        const row = e.target.closest("tr[data-project-id]");
        if (!row) return;
        if (window.innerWidth <= 768) return;

        const projectId = row.getAttribute("data-project-id");
        const coupleName = row.getAttribute("data-couple-name");
        setActiveProject(projectId, coupleName);

        document.querySelectorAll("#clientTrackerTableBody tr").forEach(r => r.classList.remove("active-row"));
        row.classList.add("active-row");

        const overviewTab = document.querySelector('.nav-item[data-target="view-overview"]');
        if (overviewTab) {
            overviewTab.click(); 
        }
    });
}

// PAGE LOAD
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
        calculateCloudStorageMetrics(); // 🐞 FIX: show account-wide storage on load, no client selection needed
    }
});

// SUBSCRIPTION TAB UI — logic now lives in subscription.js

function escapeHtml(value) {
    return String(value).replace(/[&<>'\"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}