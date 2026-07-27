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
let galleryData = {};
let pendingPreviewFiles = [];
let pinVerified = false;
let verifiedPin = "";

function setError(message) {
  if (nameEl) nameEl.textContent = "Gallery unavailable";
  if (statusEl) statusEl.textContent = message;
  if (grid) grid.innerHTML = "";
  if (pinGate) pinGate.style.display = "none";
  if (footer) footer.style.display = "none";
}

if (!galleryId || !/^[A-Za-z0-9_-]{20,}$/.test(galleryId)) {
  setError("This gallery link is invalid. Please ask your photographer for a new link.");
} else {
  // Real-time listener: taaki agar upload late complete ho toh photos apne aap dikhne lagein
  db.collection("publicGalleries").doc(galleryId).onSnapshot(doc => {
    if (!doc.exists) return setError("This gallery was not found.");
    
    const gallery = doc.data();
    galleryData = gallery;

    if (gallery.isActive !== true) {
      return setError("This gallery is no longer active.");
    }

    if (nameEl) nameEl.textContent = gallery.coupleName || "Wedding Album";
    if (statusEl && !pinVerified) statusEl.textContent = "Enter the gallery PIN to view and select your previews.";
    if (pinGate && !pinVerified) pinGate.style.display = "block";

    pendingPreviewFiles = Array.isArray(gallery.previewFiles) ? gallery.previewFiles : [];

    // Theme loading
    if (gallery.selectedThemeId) {
      db.collection("themes").doc(gallery.selectedThemeId).get().then(themeDoc => {
        if (themeDoc.exists && themeDoc.data().cssClass) {
          document.body.className = themeDoc.data().cssClass;
        }
      }).catch(err => console.warn("Theme load failed:", err));
    }

    // Agar PIN pehle hi verify ho chuka hai aur naye files aaye hain toh render karein
    if (pinVerified && pendingPreviewFiles.length > 0) {
      renderPreviews(pendingPreviewFiles);
    }
  }, err => setError("This gallery cannot be opened right now."));
}

if (pinInput) {
  pinInput.addEventListener("input", async () => {
    const pin = pinInput.value.trim();
    if (pin.length !== 6) return;

    try {
      const verifyGalleryPin = functionsRegion.httpsCallable("verifyGalleryPin");
      const response = await verifyGalleryPin({ shareId: galleryId, pin });

      if (response.data.ok) {
        pinVerified = true;
        verifiedPin = pin;
        pinInput.disabled = true;
        if (pinGate) pinGate.style.display = 'none';

        if (pendingPreviewFiles.length === 0) {
          if (statusEl) statusEl.textContent = "Photos are being processed by photographer. Please wait a moment...";
        } else {
          await renderPreviews(pendingPreviewFiles);
        }
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
}

async function renderPreviews(files) {
  if (!grid) return;
  grid.innerHTML = "";
  if (statusEl) statusEl.textContent = "Select your favorite photos below:";

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    try {
      const url = await storage.ref(`gallery-previews/${galleryId}/${file}`).getDownloadURL();
      const item = document.createElement("div");
      item.className = "grid-item";
      
      const image = document.createElement("img");
      image.src = url;
      image.alt = `Preview ${index + 1}`;
      image.loading = "lazy";
      
      item.appendChild(image);
      item.addEventListener("click", () => toggleSelection(item, file));
      grid.appendChild(item);
    } catch (err) {
      console.warn(`Could not load preview image: ${file}`, err);
    }
  }

  if (counter) counter.style.display = "block";
  if (footer) footer.style.display = "flex";
  if (submit) submit.style.display = "block";
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
  if (countEl) countEl.textContent = selected.length;
}

if (submit) {
  submit.addEventListener("click", async () => {
    if (!pinVerified || !verifiedPin) return alert("Enter and verify the 6-digit PIN first.");
    if (!selected.length) return alert("Please select at least one photo.");

    submit.disabled = true;
    submit.textContent = "Submitting selection...";
    try {
      const submitSelection = functionsRegion.httpsCallable("submitGallerySelection");
      await submitSelection({ shareId: galleryId, pin: verifiedPin, photoIds: selected });

      if (grid) grid.style.display = "none";
      if (footer) footer.style.display = "none";
      if (counter) counter.style.display = "none";

      if (nameEl) nameEl.textContent = galleryData?.coupleName || "Your Gallery";
      if (statusEl) {
        statusEl.innerHTML = `
          <div style="text-align:center;padding:40px 20px;">
            <div style="font-size:3rem;margin-bottom:16px;">📸</div>
            <h3 style="margin-bottom:12px;font-size:1.2rem;">Selection submitted!</h3>
            <p style="color:var(--gallery-text-muted);font-size:0.9rem;line-height:1.6;">
              Your photographer is now working on your gallery.<br>
              You'll receive an update when it's ready.
            </p>
          </div>
        `;
      }
      checkDownloadAvailability();
    } catch (error) {
      alert(error.code === "functions/permission-denied" ? "Incorrect gallery PIN." : "Could not submit selection. Please try again.");
      submit.disabled = false;
      submit.textContent = "Submit Selected Previews";
    }
  });
}

async function checkDownloadAvailability() {
  if (!downloadZipBtn) return;
  try {
    const getUrls = functionsRegion.httpsCallable("getDownloadUrls");
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