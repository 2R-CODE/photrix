const firebaseConfig = {
  apiKey: "AIzaSyDQFAJH5_V1-qApDKg1I9RcDi3eVMcWAWg",
  authDomain: "eternal-memories-wedding.firebaseapp.com",
  projectId: "eternal-memories-wedding",
  storageBucket: "eternal-memories-wedding.firebasestorage.app",
  messagingSenderId: "702108745012",
  appId: "1:702108745012:web:1bf2f1f8de187ed231b961"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
const storage = firebase.storage();
// 🛠️ FIX: every Cloud Function call must use the same region the functions
// are actually deployed in ("asia-south1"). firebase.functions() alone
// defaults to us-central1, where these functions don't exist.
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

let selected = [];
let pendingPreviewFiles = [];
let pinVerified = false;
let verifiedPin = ""; // 🛠️ FIX: PIN ko ek safe variable me store karo — pinInput.value
                      // pe depend nahi karna chahiye kyunki wo disabled hone ke baad
                      // browser kabhi kabhi clear kar deta hai, aur submit ke baad bhi
                      // checkDownloadAvailability ko sahi PIN chahiye.

function setError(message) {
  nameEl.textContent = "Gallery unavailable";
  statusEl.textContent = message;
  grid.innerHTML = "";
  if (pinGate) pinGate.style.display = "none";
  if (footer) footer.style.display = "none";
}

if (!galleryId || !/^[A-Za-z0-9_-]{20,}$/.test(galleryId)) {
  setError("This gallery link is invalid. Please ask your photographer for a new link.");
} else {
  db.collection("publicGalleries").doc(galleryId).get().then(doc => {
    if (!doc.exists) return setError("This gallery was not found.");
    const gallery = doc.data();
    if (!gallery.expiresAt || Date.now() > gallery.expiresAt.toMillis()) {
      return setError("This gallery link has expired.");
    }
    nameEl.textContent = gallery.coupleName || "Wedding Album";
    statusEl.textContent = "Enter the gallery PIN to view and select your previews.";
    pinGate.style.display = "block";
    pinInput.focus();
    pendingPreviewFiles = Array.isArray(gallery.previewFiles) ? gallery.previewFiles : [];
    if (!pendingPreviewFiles.length) {
      console.log("Waiting for files from photographer...");
    }
  }).catch(() => setError("This gallery cannot be opened right now."));
}

pinInput.addEventListener("input", async () => {
  const pin = pinInput.value.trim();
  if (pin.length !== 6) return;

  try {
    const verifyGalleryPin = functionsRegion.httpsCallable("verifyGalleryPin");
    const response = await verifyGalleryPin({ shareId: galleryId, pin });

    // 🛠️ FIX: the Cloud Function returns { ok: true }, never { success: true }.
    if (response.data.ok) {
      pinVerified = true;
      verifiedPin = pin; // 🛠️ FIX: verified PIN yahan save karo
      pinInput.disabled = true;
      document.getElementById('gallery-pin-gate').style.display = 'none';
      await renderPreviews(pendingPreviewFiles);
      checkDownloadAvailability();
    } else {
      alert("Invalid PIN! Try again.");
      pinInput.value = "";
    }
  } catch (error) {
    console.error("Firebase Function Error:", error);
    if (error.code === "functions/resource-exhausted") {
      alert("Too many incorrect attempts. Please wait a few minutes and try again.");
    } else if (error.code === "functions/permission-denied") {
      alert("Incorrect gallery PIN.");
    } else {
      alert("Verification failed: " + error.message);
    }
    pinInput.value = "";
  }
});

async function renderPreviews(files) {
  grid.innerHTML = "";
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const url = await storage.ref(`gallery-previews/${galleryId}/${file}`).getDownloadURL();
    const item = document.createElement("div");
    item.className = "grid-item";
    const image = document.createElement("img");
    image.src = url;
    image.alt = `Wedding preview ${index + 1}`;
    image.loading = "lazy";
    item.appendChild(image);
    item.addEventListener("click", () => toggleSelection(item, file));
    grid.appendChild(item);
  }
  counter.style.display = "block";
  footer.style.display = "flex";
  submit.style.display = "block";
}

function toggleSelection(item, file) {
  if (item.classList.contains("selected")) {
    item.classList.remove("selected");
    selected = selected.filter(id => id !== file);
  } else {
    if (selected.length >= 40) return alert("You can select up to 40 photos.");
    item.classList.add("selected");
    selected.push(file);
  }
  countEl.textContent = selected.length;
}

submit.addEventListener("click", async () => {
  // 🛠️ FIX: pinInput.value ki jagah verifiedPin use karo — ye hamesha
  // sahi 6-digit PIN hold karta hai chahe input disabled ho ya browser
  // ne value clear kar di ho.
  if (!pinVerified || !verifiedPin) return alert("Enter and verify the 6-digit PIN first.");
  if (!selected.length) return alert("Please select at least one photo.");

  submit.disabled = true;
  submit.textContent = "Submitting selection...";
  try {
    const submitSelection = functionsRegion.httpsCallable("submitGallerySelection");
    await submitSelection({ shareId: galleryId, pin: verifiedPin, photoIds: selected });
    statusEl.textContent = "Your selection was sent to the photographer.";
    submit.style.display = "none";
    pinGate.style.display = "none";
    checkDownloadAvailability();
  } catch (error) {
    alert(error.code === "functions/permission-denied" ? "Incorrect gallery PIN." : "Could not submit selection. Please try again.");
    submit.disabled = false;
    submit.textContent = "Submit Selected Previews";
  }
});

// 🆕 HD ZIP DOWNLOAD — silently checks whether it's available (photographer
// on a paid plan + this gallery unlocked + a selection already submitted).
// This is a normal, expected "not yet" state most of the time (e.g. before
// the client has submitted a selection at all), so failures here don't
// alert the client — the button just stays hidden.
async function checkDownloadAvailability() {
  if (!downloadZipBtn) return;
  try {
    const getUrls = functionsRegion.httpsCallable("getDownloadUrls");
    // 🛠️ FIX: verifiedPin use karo, pinInput.value nahi — same reason as above
    const result = await getUrls({ shareId: galleryId, pin: verifiedPin });
    if (result.data?.files?.length) {
      downloadZipBtn.style.display = "block";
      downloadZipBtn.onclick = (e) => {
        e.preventDefault();
        downloadAsZip(result.data.files);
      };
    }
  } catch (error) {
    console.log("HD download not available yet:", error.code);
  }
}

async function downloadAsZip(files) {
  const originalLabel = downloadZipBtn.innerHTML;
  downloadZipBtn.innerHTML = "Preparing ZIP...";
  try {
    const zip = new JSZip();
    for (const item of files) {
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
    alert("Could not prepare the download. Please try again.");
  } finally {
    downloadZipBtn.innerHTML = originalLabel;
  }
}

function setTheme(themeName) {
    document.body.className = `theme-${themeName}`;
    // Future mein ise Firestore mein user preference ke taur par bhi save kar sakta hai
}