const firebaseConfig = {
  apiKey: "AIzaSyDQFAJH5_V1-qApDKg1I9RcDi3eVMcWAWg",
  authDomain: "eternal-memories-wedding.firebaseapp.com",
  projectId: "eternal-memories-wedding",
  storageBucket: "eternal-memories-wedding.firebasestorage.app",
  messagingSenderId: "702108745012",
  appId: "1:702108745012:web:1bf2f1f8de187ed231b961"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

// 🆕 APP CHECK SETUP — do these steps IN ORDER before enforcing anything:
//
// 1. Firebase Console → Build → App Check → Apps → register this web app
//    → choose reCAPTCHA v3 → copy the site key it gives you.
// 2. Replace 'PASTE_YOUR_RECAPTCHA_V3_SITE_KEY_HERE' below with that key.
// 3. Also register the SAME site key in the Google reCAPTCHA admin console
//    (https://www.google.com/recaptcha/admin) for your actual domain(s) —
//    Firebase's App Check screen links you there directly.
// 4. Deploy this file as-is (still `enforceAppCheck: false` in index.js) and
//    open the live lookbook page for a few days of real traffic.
// 5. In Firebase Console → App Check → Cloud Functions tab, watch the
//    "Verified requests" metric climb close to 100%. ONLY once you see real
//    traffic passing verification, flip `enforceAppCheck: false` to `true`
//    for each function in index.js and redeploy functions.
// Flipping enforceAppCheck to true BEFORE step 5 confirms real traffic is
// passing will lock every real client out of their own gallery.
const RECAPTCHA_V3_SITE_KEY = "PASTE_YOUR_RECAPTCHA_V3_SITE_KEY_HERE";
if (RECAPTCHA_V3_SITE_KEY !== "PASTE_YOUR_RECAPTCHA_V3_SITE_KEY_HERE") {
  firebase.appCheck().activate(
    new firebase.appCheck.ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
    true // auto-refresh the token
  );
} else {
  console.warn("App Check not active yet — set RECAPTCHA_V3_SITE_KEY in lookbook.js after registering in Firebase Console.");
}

const db = firebase.firestore();
const storage = firebase.storage();
const functionsRegion = firebase.app().functions("asia-south1");

const galleryId = new URLSearchParams(location.search).get("gallery");
const nameEl = document.getElementById("couple-names");
const statusEl = document.getElementById("gallery-sub-status");
const grid = document.getElementById("main-photo-grid");
const pinGate = document.getElementById("gallery-pin-gate");
const pinInput = document.getElementById("gallery-pin-input");
const counter = document.getElementById("counter-zone");
const countEl = document.getElementById("selected-count");
const footer = document.getElementById("action-footer");
const submit = document.getElementById("submit-selection-btn");
const downloadZipBtn = document.getElementById("download-zip-btn");
const undoBar = document.getElementById("undo-submit-bar");
const undoBtn = document.getElementById("undo-submit-btn");
const undoSecondsEl = document.getElementById("undo-seconds");

// 🐞 FIX: lookbook.html had "/ 40" hardcoded in the counter badge, but the
// actual enforced limit below was 350 — a client would see "0 / 40" while
// really being allowed up to 350, and would have no idea why the counter
// never matched what they could actually select. One constant, used both
// places, so they can never drift apart again.
const selectionLimitLabel = document.getElementById("selection-limit-label");
const DEFAULT_SELECTION_LIMIT = 200;
let selectionLimit = DEFAULT_SELECTION_LIMIT;

function setSelectionLimit(value) {
  const parsed = Number(value);
  selectionLimit = parsed === 350 ? 350 : DEFAULT_SELECTION_LIMIT;
  if (selectionLimitLabel) selectionLimitLabel.textContent = selectionLimit;
}

setSelectionLimit(DEFAULT_SELECTION_LIMIT);

const UNDO_WINDOW_SECONDS = 30;

// 🌐 GLOBAL OFFLINE BANNER — one clear signal for the client instead of
// each button separately discovering "no internet" at click time.
function updateLookbookOfflineBanner() {
  const banner = document.getElementById("lookbookOfflineBanner");
  if (banner) banner.style.display = navigator.onLine ? "none" : "block";
}
window.addEventListener("online", updateLookbookOfflineBanner);
window.addEventListener("offline", updateLookbookOfflineBanner);
updateLookbookOfflineBanner();

let selected = [];
let galleryData = {};
let pendingPreviewFiles = [];
let pinVerified = false;
let verifiedPin = "";
let undoTimer = null;
let isVerifyingPin = false; // 🐞 FIX: guards against a fast typer/paste firing verifyGalleryPin multiple times at once

function setError(message) {
  if (nameEl) nameEl.textContent = "Gallery unavailable";
  if (statusEl) statusEl.textContent = message;
  if (grid) grid.innerHTML = "";
  if (pinGate) pinGate.style.display = "none";
  if (footer) footer.style.display = "none";
  hideUndoBar();
}

function hideUndoBar() {
  if (undoTimer) { clearInterval(undoTimer); undoTimer = null; }
  if (undoBar) undoBar.style.display = "none";
}

function startUndoCountdown(submittedAtMs) {
  if (!undoBar || !undoBtn || !submittedAtMs) return;

  const tick = () => {
    const remaining = UNDO_WINDOW_SECONDS - Math.floor((Date.now() - submittedAtMs) / 1000);
    if (remaining <= 0) {
      hideUndoBar();
      showSubmittedScreen(false);
      return;
    }
    if (undoSecondsEl) undoSecondsEl.textContent = remaining;
  };

  hideUndoBar();
  undoBar.style.display = "block";
  tick();
  undoTimer = setInterval(tick, 1000);
}

function applyThemeClass(themeId) {
  // 🐞 FIX (broken/frozen theme): returns a Promise now, and callers below
  // await it before rendering. Previously this ran un-awaited — if
  // renderPreviews() (which checks document.body.classList at the very end
  // to decide whether to start the cinematic slider animation) finished its
  // own network calls first, it would find the OLD theme class still on
  // <body>, skip starting the GSAP/ScrollTrigger animation, and then the
  // theme class would flip in moments later — leaving every photo frozen at
  // its animation's starting position (scaled down, rotated, faded) forever,
  // since nothing ever ran the animation that was supposed to bring them to
  // their normal state. This is what produced the distorted/frozen slider.
  if (!themeId) return Promise.resolve();
  return db.collection("themes").doc(themeId).get().then(themeDoc => {
    if (themeDoc.exists && themeDoc.data().cssClass) {
      document.body.className = themeDoc.data().cssClass;
    }
  }).catch(err => console.warn("Theme load failed:", err));
}

if (!galleryId || !/^[A-Za-z0-9_-]{20,}$/.test(galleryId)) {
  setError("This gallery link is invalid. Please ask your photographer for a new link.");
} else {
  // The gallery document is private. Its contents are loaded below through
  // getGalleryAccess only after the client supplies the PIN.
  if (nameEl) nameEl.textContent = "Private client gallery";
  if (statusEl) statusEl.textContent = "Enter the gallery PIN to view your photos.";
  if (pinGate) pinGate.style.display = "block";
}

if (pinInput) {
  pinInput.addEventListener("input", async () => {
    const pin = pinInput.value.trim();
    if (pin.length !== 6) return;

    // 🐞 FIX: without this, pasting a 6-digit PIN (which can fire the
    // "input" event more than once) could send two verifyGalleryPin calls
    // at the same time — harmless most of the time, but wastes one of the
    // limited PIN attempts for no reason.
    if (isVerifyingPin) return;
    isVerifyingPin = true;

    // 🌐 FIX: fail fast with a friendly message if already offline,
    // instead of waiting for the Cloud Function call to time out and then
    // showing a raw technical error message to the client.
    if (!navigator.onLine) {
      alert("You're not connected to the internet right now. Please check your connection and try again.");
      isVerifyingPin = false;
      return;
    }

    try {
      // PIN check backend pe hi chalega for security
      const getGalleryAccess = functionsRegion.httpsCallable("getGalleryAccess");
      const response = await getGalleryAccess({ shareId: galleryId, pin });

      if (response.data) {
        galleryData = {
          ...response.data,
          isActive: true,
          previewFiles: Array.isArray(response.data.previews) ? response.data.previews : []
        };
        setSelectionLimit(galleryData.selectionLimit);
        pendingPreviewFiles = galleryData.previewFiles;
        pinVerified = true;
        verifiedPin = pin;
        pinInput.disabled = true;
        if (pinGate) pinGate.style.display = 'none';

        // 🐛 FIX: this is the actual live code path (the old theme-apply
        // logic lived only inside a dead `if (false)` realtime-listener
        // block that never ran) — theme was saving fine in Firestore via
        // applyThemeAndPublish, but the client page never read it back and
        // applied it, so every gallery stayed on theme-default regardless
        // of what the photographer picked. Awaited before renderPreviews()
        // so <body>'s class is already settled when it checks classList to
        // decide whether to start the cinematic-slider animation.
        await applyThemeClass(galleryData.selectedThemeId);

        if (galleryData.workflowState === "selection_completed") {
          const submittedAtMs = galleryData.selectionSubmittedAt && typeof galleryData.selectionSubmittedAt.toMillis === "function"
            ? galleryData.selectionSubmittedAt.toMillis() : null;
          const undoStillOpen = submittedAtMs && (Date.now() - submittedAtMs) < UNDO_WINDOW_SECONDS * 1000;
          showSubmittedScreen(undoStillOpen);
          if (undoStillOpen) {
            startUndoCountdown(submittedAtMs);
          }
        } else if (pendingPreviewFiles.length === 0) {
          if (statusEl) statusEl.textContent = "Photos are being processed by photographer. Please wait a moment...";
        } else {
          await renderPreviews(pendingPreviewFiles);
        }

        if (galleryData.workflowState === 'published') {
            checkDownloadAvailability();
        }
      } else {
        alert("Invalid PIN! Try again.");
        pinInput.value = "";
      }
    } catch (error) {
      console.error("Firebase Function Error:", error);
      // 🐞 FIX: a network drop mid-call used to fall through to the generic
      // "Verification failed: " + error.message branch, which shows a raw
      // Firebase error string (e.g. "functions/unavailable") to the client —
      // confusing for someone who isn't technical. Now it gets the same
      // plain-language message as the offline pre-check above.
      if (error.code === "functions/resource-exhausted") {
        alert("Too many incorrect attempts. Please wait a few minutes and try again.");
      } else if (error.code === "functions/permission-denied") {
        alert("Incorrect gallery PIN.");
      } else if (error.code === "functions/unavailable" || !navigator.onLine) {
        alert("Connection problem — please check your internet and try again.");
      } else {
        alert("Verification failed: " + error.message);
      }
      pinInput.value = "";
    } finally {
      isVerifyingPin = false;
    }
  });
}

async function renderPreviews(files) {
  if (!grid) return;
  grid.innerHTML = "";
  grid.style.display = "grid";

  // 🆕 FIX: when a gallery gets sent back to selection_open after the
  // client already submitted once (photographer's "Revert to Editing"),
  // this used to render a completely blank grid — the client's earlier
  // picks were still saved in Firestore, but nothing on screen showed it,
  // so it looked like their selection had been wiped. Restoring both the
  // visual .selected state AND the local `selected` array here means they
  // see exactly what they picked before and can adjust from there instead
  // of starting over.
  selected = Array.isArray(galleryData?.selectedPhotoIds) ? [...galleryData.selectedPhotoIds] : [];
  if (countEl) countEl.textContent = selected.length;

  if (galleryData.workflowState === 'published') {
      if (statusEl) statusEl.textContent = "Your beautiful moments are here!";
  } else {
      if (statusEl) statusEl.textContent = "Select your favorite photos below:";
  }

  // 🐞 FIX: previously each failed image just logged a console.warn and
  // was silently skipped — if the connection is bad enough that EVERY
  // photo fails to load, the client just sees an empty grid with no
  // explanation. Now we track failures and show a clear message instead.
  let loadFailCount = 0;

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    try {
      const fileName = typeof file === "string" ? file : file.name;
      const url = typeof file === "string"
        ? await storage.ref(`gallery-previews/${galleryId}/${file}`).getDownloadURL()
        : file.url;
      if (!fileName || !url) throw new Error("Preview URL unavailable.");
      const item = document.createElement("div");
      item.className = "grid-item";

      const image = document.createElement("img");
      image.src = url;
      image.alt = `Preview ${index + 1}`;
      image.loading = "lazy";

      item.appendChild(image);

      // 🆕 FIX: show this item as already-selected if it's in the
      // restored `selected` array (see comment above renderPreviews).
      if (selected.includes(fileName)) {
        item.classList.add("selected");
      }

      // Selection tabhi allow karni hai jab state published NA ho
      if (galleryData.workflowState !== 'published') {
          item.addEventListener("click", () => toggleSelection(item, fileName));
      } else {
          item.style.cursor = "default"; // Pointer hata do published state mein
      }

      grid.appendChild(item);
    } catch (err) {
      console.warn(`Could not load preview image: ${file}`, err);
      loadFailCount++;
    }
  }

  if (loadFailCount === files.length && files.length > 0) {
    // Every single photo failed to load — near-certainly a connection
    // problem on the client's end, not a real "no photos" situation.
    grid.style.display = "none";
    if (statusEl) {
      statusEl.innerHTML = `
        <div style="text-align:center;padding:20px;">
          <p>⚠️ Your photos couldn't load. Please check your internet connection and refresh the page.</p>
          <button id="retryLoadPreviewsBtn" class="btn-secondary" style="margin-top:12px;">Retry</button>
        </div>`;
      const retryBtn = document.getElementById("retryLoadPreviewsBtn");
      if (retryBtn) retryBtn.addEventListener("click", () => renderPreviews(files));
    }
    return;
  } else if (loadFailCount > 0) {
    console.warn(`${loadFailCount} of ${files.length} preview photos failed to load.`);
  }

  if (galleryData.workflowState !== 'published') {
      if (counter) counter.style.display = "block";
      if (footer) footer.style.display = "flex";
      if (submit) submit.style.display = "block";
      if (downloadZipBtn) downloadZipBtn.style.display = "none";
  } else {
      if (counter) counter.style.display = "none";
      // 🐛 FIX: submit button was never explicitly hidden in the published
      // branch — only the non-published branch set it to "block", so if it
      // was already visible from an earlier render (e.g. before publish),
      // it just stayed visible alongside Download ZIP. Once a gallery is
      // published, the client is done selecting — showing both buttons
      // together is confusing.
      if (submit) submit.style.display = "none";
      if (footer) footer.style.display = "flex"; // Footer dikhao ZIP button ke liye
      initCinematicSliderAnimation();
  }
}

function toggleSelection(item, file) {
  if (item.classList.contains("selected")) {
    item.classList.remove("selected");
    selected = selected.filter(id => id !== file);
  } else {
    if (selected.length >= selectionLimit) return alert(`You can select up to ${selectionLimit} photos.`);
    item.classList.add("selected");
    selected.push(file);
  }
  if (countEl) countEl.textContent = selected.length;
}

if (submit) {
  submit.addEventListener("click", async () => {
    if (!pinVerified || !verifiedPin) return alert("Enter and verify the 6-digit PIN first.");
    if (!selected.length) return alert("Please select at least one photo.");
    // 🌐 FIX: fail fast with a clear message instead of the call hanging
    // and then showing a technical error after timing out.
    if (!navigator.onLine) return alert("You're not connected to the internet. Please check your connection and try again.");

    submit.disabled = true;
    submit.innerHTML = '<span class="btn-spinner"></span><span class="btn-label">Submitting...</span>';

    try {
      const submitSelection = functionsRegion.httpsCallable("submitGallerySelection");
      await submitSelection({ shareId: galleryId, pin: verifiedPin, photoIds: selected });

      // 🐛 FIX: the undo bar/countdown only ever started when re-verifying
      // the PIN after a page reload (see the getGalleryAccess handler
      // above) — immediately after a fresh submit, showSubmittedScreen()
      // ran but startUndoCountdown() was never called, so the undo bar
      // never appeared at all until the client happened to reload the
      // page within the 30s window. The stale comment below used to
      // reference a realtime onSnapshot listener for this that had
      // actually been dead code (if (false)) for a while.
      showSubmittedScreen(true);
      startUndoCountdown(Date.now());
    } catch (error) {
      console.error("Submit selection error:", error);
      // 🐞 FIX: friendlier message for a network-related failure instead of
      // always appending the raw error.message.
      const msg = (error.code === "functions/unavailable" || !navigator.onLine)
        ? "Could not submit your selection — please check your internet connection and try again."
        : "Could not submit selection: " + (error.message || "Please check your connection and try again.");
      alert(msg);
      submit.disabled = false;
      // 🐞 FIX: this used to use .textContent, which wiped out the button's
      // icon (added alongside the label span) permanently after any failed
      // submit — a retry would work fine functionally, but the icon would
      // never come back without a page reload. .innerHTML with the same
      // icon+label markup restores it exactly.
      submit.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg><span class="btn-label">Submit Selection</span>';
    }
  });
}

if (undoBtn) {
  undoBtn.addEventListener("click", async () => {
    if (!pinVerified || !verifiedPin) return;
    // 🌐 FIX: same fail-fast pattern — the undo window is only 30 seconds,
    // so a slow/hanging network call here is especially costly.
    if (!navigator.onLine) return alert("You're not connected to the internet. Please check your connection and try again.");

    undoBtn.disabled = true;
    undoBtn.textContent = "Undoing...";
    try {
      const undoSubmission = functionsRegion.httpsCallable("undoSelectionSubmission");
      await undoSubmission({ shareId: galleryId, pin: verifiedPin });
      hideUndoBar();
      // onSnapshot will flip workflowState back to selection_open and
      // re-render the grid automatically (selection will reset — client
      // reselects, which is expected after an explicit undo).
    } catch (error) {
      console.error("Undo error:", error);
      alert("Could not undo: " + (error.message || "The undo window may have expired."));
      hideUndoBar();
    } finally {
      undoBtn.disabled = false;
      undoBtn.innerHTML = `Undo Submission (<span id="undo-seconds">30</span>s)`;
    }
  });
}

async function checkDownloadAvailability() {
  if (!downloadZipBtn) return;
  try {
    // 🛑 FIX (silent download-credit burn): this used to call getDownloadUrls
    // just to decide whether to SHOW the button — but getDownloadUrls is the
    // function that actually counts against the daily download limit. That
    // meant simply opening the gallery page (or the listener re-firing on
    // any doc write) silently used up one of the client's limited daily
    // downloads before they ever clicked anything. checkDownloadAvailable
    // mirrors every gate (PIN, active link, subscription, published) but
    // never touches the counter — only the actual button click below still
    // calls getDownloadUrls, which is the only place the count should move.
    const checkAvailable = functionsRegion.httpsCallable("checkDownloadAvailable");
    const getUrls = functionsRegion.httpsCallable("getDownloadUrls");

    const result = await checkAvailable({ shareId: galleryId, pin: verifiedPin });
    if (result.data?.available) {
      downloadZipBtn.style.display = "inline-flex";
      downloadZipBtn.disabled = false;
      downloadZipBtn.onclick = async (e) => {
        e.preventDefault();
        if (downloadZipBtn.disabled) return;
        downloadZipBtn.disabled = true;
        try {
          const freshResult = await getUrls({ shareId: galleryId, pin: verifiedPin });
          if (freshResult.data?.files?.length) {
            await downloadAsZip(freshResult.data.files);
          }
        } catch (error) {
          console.error("Download limit check failed:", error);
          alert(error.message || "Could not start the download. Please try again.");
        } finally {
          downloadZipBtn.disabled = false;
        }
      };
    } else if (result.data && typeof result.data.remaining === "number" && result.data.remaining <= 0) {
      // Gallery IS downloadable, just today's limit is used up — show the
      // button in a disabled state instead of hiding it, so the client
      // understands why (rather than assuming the feature doesn't exist).
      downloadZipBtn.style.display = "block";
      downloadZipBtn.disabled = true;
      downloadZipBtn.title = "Today's download limit has been reached. Please try again tomorrow.";
      downloadZipBtn.onclick = (e) => {
        e.preventDefault();
        alert("Today's download limit has been reached. Please try again tomorrow.");
      };
    }
  } catch (error) {
    console.log("HD download not available yet:", error.code);
  }
}

async function downloadAsZip(files) {
  // 🌐 FIX: fail fast instead of starting to fetch dozens of HD photos
  // only to fail partway through with no connection.
  if (!navigator.onLine) {
    return alert("You're not connected to the internet. Please check your connection and try again.");
  }

  const originalLabel = downloadZipBtn.innerHTML;
  downloadZipBtn.innerHTML = '<span class="btn-spinner"></span><span class="btn-label">Preparing ZIP...</span>';
  try {
    const zip = new JSZip();
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      // 🐞 FIX: show progress so a slow/large gallery doesn't look frozen,
      // and so a connection drop mid-way is easier for the client to place.
      downloadZipBtn.innerHTML = `<span class="btn-spinner"></span><span class="btn-label">ZIP (${i + 1}/${files.length})</span>`;
      const response = await fetch(item.url);
      if (!response.ok) throw new Error("A photo could not be downloaded.");
      zip.file(item.name, await response.blob());
    }
    const content = await zip.generateAsync({ type: "blob" });
    const blobUrl = URL.createObjectURL(content);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = "wedding-photos.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error("ZIP download failed:", error);
    // 🐞 FIX: friendlier message specifically for a connection drop
    // mid-download, instead of the same generic line every time.
    const msg = !navigator.onLine
      ? "Your connection dropped while preparing the download. Please check your internet and try again."
      : "Could not prepare the download. Please try again.";
    alert(msg);
  } finally {
    downloadZipBtn.innerHTML = originalLabel;
  }
}

function showSubmittedScreen(undoAvailable) {
  if (grid) grid.style.display = "none";
  if (footer) footer.style.display = "none";
  if (counter) counter.style.display = "none";
  if (pinGate) pinGate.style.display = "none";

  if (nameEl) nameEl.textContent = galleryData?.coupleName || "Your Gallery";
  if (statusEl) {
    // 🐛 FIX: this used to always say "your photographer is now working on
    // your gallery" — shown at the exact same time as a 30s Undo button.
    // Confusing: it announces the photographer is already on it while
    // still offering to take it back. Now it says something accurate to
    // whichever state is actually true, and gets re-rendered with the
    // "working on it" message the moment the undo window naturally
    // expires (see the tick() timeout branch below).
    statusEl.innerHTML = undoAvailable
      ? `
        <div style="text-align:center;padding:40px 20px;">
          <div style="font-size:3rem;margin-bottom:16px;">📸</div>
          <h3 style="margin-bottom:12px;font-size:1.2rem;">Selection submitted!</h3>
          <p style="color:var(--text-muted);font-size:0.9rem;line-height:1.6;">
            You have a few seconds to undo below if this was a mistake.
          </p>
        </div>
      `
      : `
        <div style="text-align:center;padding:40px 20px;">
          <div style="font-size:3rem;margin-bottom:16px;">📸</div>
          <h3 style="margin-bottom:12px;font-size:1.2rem;">Selection submitted!</h3>
          <p style="color:var(--text-muted);font-size:0.9rem;line-height:1.6;">
            Your photographer is now working on your gallery.<br>
            You'll receive an update when it's ready.
          </p>
        </div>
      `;
  }
}

// 🎬 UNIVERSAL 3D FLIP CINEMATIC SLIDER (DESKTOP + MOBILE)
let sliderMatchMediaContext = null; // 🐞 FIX: see note below

function initCinematicSliderAnimation() {
    if (typeof ScrollTrigger !== "undefined") {
        ScrollTrigger.getAll().forEach(t => t.kill());
    }

    // 🐞 FIX (broken/warped theme-modern-slider layout): this function can
    // legitimately run more than once for the same page view — the
    // publicGalleries onSnapshot listener re-fires on ANY write to that
    // doc (a theme change, a storage-quota update, etc.), and each fire
    // calls renderPreviews() → initCinematicSliderAnimation() again while
    // the gallery is already open. gsap.matchMedia() was called fresh
    // every time WITHOUT reverting the previous one, so a second (then
    // third...) full set of scroll-linked 3D-flip animations stacked on
    // top of the first, fighting over the same transform — that's what
    // produced the sheared, overlapping "broken" look in testing. Reverting
    // the previous context before creating a new one keeps exactly one
    // active set of animations at a time.
    if (sliderMatchMediaContext) {
        sliderMatchMediaContext.revert();
        sliderMatchMediaContext = null;
    }

    if (document.body.classList.contains("theme-modern-slider")) {
        gsap.registerPlugin(ScrollTrigger);

        const items = gsap.utils.toArray(".grid-item");
        const grid = document.getElementById("main-photo-grid");

        if (items.length === 0) return;

        // 1. Initial Entrance Fade-in (Common for all screens)
        gsap.to(items, {
            opacity: 1,
            duration: 1,
            stagger: 0.1,
            ease: "power3.out"
        });

        // 2. Setup MatchMedia for Responsive Animations
        let mm = gsap.matchMedia();
        sliderMatchMediaContext = mm; // FIX: keep a reference so the next call can revert it

        // 🖥️ DESKTOP LOGIC (Screen width > 768px)
        mm.add("(min-width: 769px)", () => {
            const totalScrollWidth = grid.scrollWidth - window.innerWidth + window.innerWidth * 0.30;

            let scrollTween = gsap.to(grid, {
                x: -totalScrollWidth,
                ease: "none",
                scrollTrigger: {
                    trigger: ".lookbook-main-container",
                    pin: true,
                    scrub: 1.2,
                    end: () => "+=" + totalScrollWidth,
                    invalidateOnRefresh: true
                }
            });

            // Extreme 3D Flip (45 degrees) for Desktop
            items.forEach((item) => {
                gsap.fromTo(item,
                    { scale: 0.7, opacity: 0.2, rotationY: 45 },
                    {
                        scale: 1, opacity: 1, rotationY: 0, ease: "power1.inOut",
                        scrollTrigger: { trigger: item, containerAnimation: scrollTween, start: "left right", end: "center center", scrub: true }
                    }
                );
                gsap.to(item, {
                    scale: 0.7, opacity: 0.2, rotationY: -45, ease: "power1.inOut",
                    scrollTrigger: { trigger: item, containerAnimation: scrollTween, start: "center center", end: "right left", scrub: true }
                });
            });
        });

        // 📱 MOBILE LOGIC (Screen width <= 768px)
        mm.add("(max-width: 768px)", () => {
            const mobileScrollWidth = grid.scrollWidth - window.innerWidth + window.innerWidth * 0.10;

            let scrollTween = gsap.to(grid, {
                x: -mobileScrollWidth,
                ease: "none",
                scrollTrigger: {
                    trigger: ".lookbook-main-container",
                    pin: true,
                    scrub: 1, // Halka sa fast scrubbing for mobile
                    end: () => "+=" + mobileScrollWidth,
                    invalidateOnRefresh: true
                }
            });

            // Subtle 3D Flip (20 degrees) for Mobile - Better performance & UI
            items.forEach((item) => {
                gsap.fromTo(item,
                    { scale: 0.85, opacity: 0.4, rotationY: 20 },
                    {
                        scale: 1, opacity: 1, rotationY: 0, ease: "power1.inOut",
                        scrollTrigger: { trigger: item, containerAnimation: scrollTween, start: "left right", end: "center center", scrub: true }
                    }
                );
                gsap.to(item, {
                    scale: 0.85, opacity: 0.4, rotationY: -20, ease: "power1.inOut",
                    scrollTrigger: { trigger: item, containerAnimation: scrollTween, start: "center center", end: "right left", scrub: true }
                });
            });
        });
    }
}