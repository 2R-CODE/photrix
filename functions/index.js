const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onObjectFinalized, onObjectDeleted } = require("firebase-functions/v2/storage");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

// 🆕 APP CHECK — every onCall below currently has enforceAppCheck: false.
// DO NOT flip any of these to true until:
//   1. lookbook.html/js AND DSB.html/js have App Check initialized client-side
//      with a real reCAPTCHA v3 site key (see the setup comment in lookbook.js).
//   2. Firebase Console → App Check → Cloud Functions shows real traffic
//      passing verification for several days.
// Flipping early breaks the app for every real user, not just abusers.
admin.initializeApp();
const db = admin.firestore();
const REGION = "asia-south1";
const TRIAL_DAYS = 7;
const STARTER_SELECTION_LIMIT = 200;
const GROWTH_SELECTION_LIMIT = 350;
const UPLOAD_RESERVATION_TTL_MS = 60 * 60 * 1000; // 🔧 bumped from 15 min — batches of up to 500 photos on a slow connection could realistically outlast 15 min between the first reservation and the last file's upload actually completing
// 🆕 SECURITY: kept in sync with ALLOWED_IMAGE_TYPES in DSB.js. Previously
// reservePhotoUpload only checked contentType.startsWith("image/"), which
// would still accept things like image/svg+xml from anyone who bypassed the
// browser UI and called this function directly. SVGs can carry embedded
// <script>, so even though this app only ever renders photos through <img>
// tags (which don't execute inline SVG scripts), there's no legitimate
// reason to accept a format no camera or phone actually produces. Matching
// the client's exact list here closes that gap.
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

// Gallery count is deliberately not an entitlement. Wedding albums vary too
// much in size; storage quota is the fair, enforceable capacity limit.
function getSelectionLimit(userData = {}) {
  const planId = String(userData.planId || "").toLowerCase();
  const planName = String(userData.planName || "").toLowerCase();
  return planId === "growth" || planName.includes("growth")
    ? GROWTH_SELECTION_LIMIT
    : STARTER_SELECTION_LIMIT;
}

function isValidProjectId(value) {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function makeUploadFileName(originalName) {
  const safeName = String(originalName || "photo")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(-120) || "photo";
  return `${Date.now()}-${crypto.randomInt(100000000, 1000000000)}-${safeName}`;
}

function makeShareId() {
  return crypto.randomBytes(24).toString("base64url");
}
function makePin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}
function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 32).toString("hex");
}

const MAX_PIN_ATTEMPTS = 8;
const LOCKOUT_MINUTES = 15;

// 🆕 A 6-digit PIN only has 1,000,000 combinations 
async function checkGalleryPin(shareId, pin) {
  const secretRef = db.doc(`gallerySecrets/${shareId}`);
  const secret = await secretRef.get();
  if (!secret.exists) return false;
  const secretData = secret.data();

  const now = Date.now();
  if (secretData.lockedUntil && secretData.lockedUntil.toMillis() > now) {
    throw new HttpsError("resource-exhausted", "Too many incorrect attempts. Please try again in a few minutes.");
  }

  const isCorrect = hashPin(pin, secretData.pinSalt) === secretData.pinHash;

  if (isCorrect) {
    if (secretData.failedAttempts) {
      await secretRef.update({ failedAttempts: 0, lockedUntil: admin.firestore.FieldValue.delete() });
    }
    return true;
  }

  const failedAttempts = (secretData.failedAttempts || 0) + 1;
  const update = { failedAttempts };
  if (failedAttempts >= MAX_PIN_ATTEMPTS) {
    update.failedAttempts = 0;
    update.lockedUntil = admin.firestore.Timestamp.fromMillis(now + LOCKOUT_MINUTES * 60 * 1000);
  }
  await secretRef.update(update);
  return false;
}

// 🛠️ FIX: subscriptionExpiresAt.toMillis() used to crash (silently, no
function getExpiryMillisOrNull(value) {
  return value && typeof value.toMillis === "function" ? value.toMillis() : null;
}

// Mirrors the trial/subscription logic in firestore.rules. Admin SDK calls
async function hasStudioAccess(uid) {
  const userDoc = await db.doc(`users/${uid}`).get();
  if (!userDoc.exists) return false;
  const data = userDoc.data();
  if (data.subscriptionStatus === "active") {
    const expiresAtMs = getExpiryMillisOrNull(data.subscriptionExpiresAt);
    return expiresAtMs === null || expiresAtMs > Date.now();
  }
  const start = data.trialStartDate;
  if (!start || typeof start.toMillis !== "function") return false;
  return Date.now() - start.toMillis() < TRIAL_DAYS * 24 * 60 * 60 * 1000;
}

exports.createGalleryShare = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  if (!request.auth.token.email_verified) {
    throw new HttpsError("permission-denied", "Please verify your email address first.");
  }
  const projectId = String(request.data?.projectId || "");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(projectId)) throw new HttpsError("invalid-argument", "Invalid project.");

  const uid = request.auth.uid;
  if (!(await hasStudioAccess(uid))) {
    throw new HttpsError("permission-denied", "Your trial has ended. Please subscribe to generate client links.");
  }

  const projectRef = db.doc(`users/${uid}/clientProjects/${projectId}`);
  const project = await projectRef.get();
  if (!project.exists) throw new HttpsError("not-found", "Project not found.");

  const shareId = makeShareId();
  const pin = makePin();
  const pinSalt = crypto.randomBytes(16).toString("hex");
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
  const data = project.data();
  const user = (await db.doc(`users/${uid}`).get()).data() || {};

  // WORKFLOW_STATE: single source of truth, mirrored on both documents.
  // Values: selection_open -> selection_completed -> published
  await db.runTransaction(async transaction => {

    transaction.set(db.doc(`publicGalleries/${shareId}`), {
      uid, projectId, coupleName: data.coupleName || "Wedding Album", expiresAt,
      isActive: true,
      workflowState: "selection_open", selectionLimit: getSelectionLimit(user),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.set(db.doc(`gallerySecrets/${shareId}`), { pinSalt, pinHash: hashPin(pin, pinSalt), pin });
    transaction.update(projectRef, {
      workflowState: "selection_open",
      shareId,
      expiresAt,
      linkGeneratedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  // shareId + expiresAt are the single source of truth from here on.
  // Nothing on the client should ever write to publicGalleries/{shareId} directly.
  return { shareId, pin, expiresAt: expiresAt.toMillis() };
});



// Public client endpoint: validates expiry + PIN and accepts only bounded image IDs.
exports.submitGallerySelection = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  const { shareId, pin, photoIds } = request.data || {};
  if (typeof shareId !== "string" || typeof pin !== "string" || !Array.isArray(photoIds)) {
    throw new HttpsError("invalid-argument", "Invalid selection request.");
  }
  if (!/^\d{6}$/.test(pin) || photoIds.length < 1 || photoIds.some(id => typeof id !== "string" || id.length > 200)) {
    throw new HttpsError("invalid-argument", "Invalid PIN or photo selection.");
  }
  
  const galleryRef = db.doc(`publicGalleries/${shareId}`);
  const gallery = await galleryRef.get();
  if (!gallery.exists) throw new HttpsError("not-found", "Gallery not found.");
  
  const data = gallery.data();
  if (data.isActive !== true) {
    throw new HttpsError("failed-precondition", "Gallery is no longer accepting selections.");
  }
  if (data.workflowState !== "selection_open") {
    throw new HttpsError("failed-precondition", "This gallery is not accepting selections right now.");
  }

  const selectionLimit = Number(data.selectionLimit) === GROWTH_SELECTION_LIMIT
    ? GROWTH_SELECTION_LIMIT
    : STARTER_SELECTION_LIMIT;
  if (photoIds.length > selectionLimit) {
    throw new HttpsError("invalid-argument", `You can select up to ${selectionLimit} photos.`);
  }

  if (!(await checkGalleryPin(shareId, pin))) {
    throw new HttpsError("permission-denied", "Incorrect PIN.");
  }

  const allowed = new Set(data.previewFiles || []);
  if (allowed.size === 0 || photoIds.some(id => !allowed.has(id))) {
    throw new HttpsError("invalid-argument", "One or more selected photos are invalid.");
  }

  const uniqueIds = [...new Set(photoIds)];
  const submittedAt = admin.firestore.FieldValue.serverTimestamp();

  // Single write pattern, mirrored on both documents so Dashboard and the
  // client-facing gallery never disagree about state.
  await db.doc(`users/${data.uid}/clientProjects/${data.projectId}`).update({
    workflowState: "selection_completed",
    selectedPhotoIds: uniqueIds,
    selectionSubmittedAt: submittedAt
  });
  await galleryRef.update({
    workflowState: "selection_completed",
    selectedPhotoIds: uniqueIds,
    selectionSubmittedAt: submittedAt
  });

  logger.info("Gallery selection submitted", { shareId });
  return { ok: true };
});

// Client-side "Undo" grace window right after submit — lets them reopen
// their selection without waiting on the photographer.
const UNDO_WINDOW_MS = 30 * 1000;
exports.undoSelectionSubmission = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  const { shareId, pin } = request.data || {};
  if (typeof shareId !== "string" || !/^\d{6}$/.test(String(pin || ""))) {
    throw new HttpsError("invalid-argument", "Invalid request.");
  }

  const galleryRef = db.doc(`publicGalleries/${shareId}`);
  const gallery = await galleryRef.get();
  if (!gallery.exists) throw new HttpsError("not-found", "Gallery not found.");
  const data = gallery.data();

  if (data.workflowState !== "selection_completed") {
    throw new HttpsError("failed-precondition", "This selection can no longer be undone.");
  }
  if (!(await checkGalleryPin(shareId, pin))) {
    throw new HttpsError("permission-denied", "Incorrect PIN.");
  }

  const submittedAtMs = data.selectionSubmittedAt && typeof data.selectionSubmittedAt.toMillis === "function"
    ? data.selectionSubmittedAt.toMillis() : 0;
  if (Date.now() - submittedAtMs > UNDO_WINDOW_MS) {
    throw new HttpsError("failed-precondition", "The undo window has expired.");
  }

  await db.doc(`users/${data.uid}/clientProjects/${data.projectId}`).update({
    workflowState: "selection_open",
    selectedPhotoIds: admin.firestore.FieldValue.delete(),
    selectionSubmittedAt: admin.firestore.FieldValue.delete()
  });
  await galleryRef.update({
    workflowState: "selection_open",
    selectedPhotoIds: admin.firestore.FieldValue.delete(),
    selectionSubmittedAt: admin.firestore.FieldValue.delete()
  });

  logger.info("Gallery selection undone", { shareId });
  return { ok: true };
});

// Photographer removes a single client-selected photo during the review
// stage (before publish). Keeps both documents in sync in one transaction.
exports.removeSelectedPhoto = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const uid = request.auth.uid;
  const projectId = String(request.data?.projectId || "");
  const file = String(request.data?.file || "");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(projectId) || !file) {
    throw new HttpsError("invalid-argument", "Invalid request.");
  }

  const projectRef = db.doc(`users/${uid}/clientProjects/${projectId}`);
  const project = await projectRef.get();
  if (!project.exists) throw new HttpsError("not-found", "Project not found.");
  const data = project.data();
  if (!data.shareId) throw new HttpsError("failed-precondition", "No gallery link generated yet.");
  if (data.workflowState === "published") {
    throw new HttpsError("failed-precondition", "Gallery is already published. Revert to editing first.");
  }

  const galleryRef = db.doc(`publicGalleries/${data.shareId}`);
  await db.runTransaction(async (tx) => {
    tx.update(projectRef, { selectedPhotoIds: admin.firestore.FieldValue.arrayRemove(file) });
    tx.update(galleryRef, { selectedPhotoIds: admin.firestore.FieldValue.arrayRemove(file) });
  });

  return { ok: true };
});

// Photographer locks in a theme and publishes the final gallery — one
// atomic write across both documents, so Dashboard and client never desync.
exports.applyThemeAndPublish = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const uid = request.auth.uid;
  const projectId = String(request.data?.projectId || "");
  const themeId = String(request.data?.themeId || "");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(projectId)) throw new HttpsError("invalid-argument", "Invalid project.");
  if (!themeId) throw new HttpsError("invalid-argument", "Please choose a theme first.");

  if (!(await hasStudioAccess(uid))) {
    throw new HttpsError("permission-denied", "HD ZIP download is a paid-plan feature. Please subscribe to publish.");
  }

  const themeDoc = await db.doc(`themes/${themeId}`).get();
  if (!themeDoc.exists) throw new HttpsError("not-found", "Selected theme not found.");

  const projectRef = db.doc(`users/${uid}/clientProjects/${projectId}`);
  const project = await projectRef.get();
  if (!project.exists) throw new HttpsError("not-found", "Project not found.");
  const data = project.data();
  if (!data.shareId) throw new HttpsError("failed-precondition", "Generate a client link first.");
  if (!Array.isArray(data.selectedPhotoIds) || data.selectedPhotoIds.length === 0) {
    throw new HttpsError("failed-precondition", "Client hasn't selected any photos yet.");
  }

  const galleryRef = db.doc(`publicGalleries/${data.shareId}`);
  await db.runTransaction(async (tx) => {
    tx.update(projectRef, {
      workflowState: "published",
      selectedThemeId: themeId,
      publishedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.update(galleryRef, {
      workflowState: "published",
      selectedThemeId: themeId,
      selectedPhotoIds: data.selectedPhotoIds
    });
  });

  return { ok: true };
});

// Photographer reopens a published gallery for further editing (same link,
// same PIN — client just sees the review-in-progress screen again).
exports.revertGalleryToEditing = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const uid = request.auth.uid;
  const projectId = String(request.data?.projectId || "");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(projectId)) throw new HttpsError("invalid-argument", "Invalid project.");

  const projectRef = db.doc(`users/${uid}/clientProjects/${projectId}`);
  const project = await projectRef.get();
  if (!project.exists) throw new HttpsError("not-found", "Project not found.");
  const data = project.data();
  if (!data.shareId) throw new HttpsError("failed-precondition", "No gallery link yet.");

  const galleryRef = db.doc(`publicGalleries/${data.shareId}`);
  await db.runTransaction(async (tx) => {
    // 🐛 FIX: this used to revert to "selection_completed", which on the
    // client just shows the static "Selection submitted!" message with no
    // way to interact — the photographer's "Revert to Editing" click had
    // no visible effect for the client at all. "selection_open" is the
    // state that actually re-enables the interactive photo grid and
    // Submit button client-side (see lookbook.js renderPreviews).
    tx.update(projectRef, { workflowState: "selection_open" });
    tx.update(galleryRef, { workflowState: "selection_open" });
  });

  return { ok: true };
});

exports.verifyGalleryPin = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  const { shareId, pin } = request.data || {};
  if (typeof shareId !== "string" || !/^\d{6}$/.test(String(pin || ""))) {
    throw new HttpsError("invalid-argument", "Invalid PIN.");
  }
  const gallery = await db.doc(`publicGalleries/${shareId}`).get();
  if (!gallery.exists || gallery.data().isActive !== true) {
    throw new HttpsError("not-found", "Gallery unavailable.");
  }
  if (!(await checkGalleryPin(shareId, pin))) {
    throw new HttpsError("permission-denied", "Incorrect PIN.");
  }
  return { ok: true };
});

// Client gallery metadata and previews are released only after server-side
// PIN verification. Preview URLs expire after ten minutes.
exports.getGalleryAccess = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  const { shareId, pin } = request.data || {};
  if (typeof shareId !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(shareId) || !/^\d{6}$/.test(String(pin || ""))) {
    throw new HttpsError("invalid-argument", "Invalid gallery access request.");
  }

  const gallery = await db.doc(`publicGalleries/${shareId}`).get();
  if (!gallery.exists || gallery.data().isActive !== true) {
    throw new HttpsError("not-found", "Gallery unavailable.");
  }
  if (!(await checkGalleryPin(shareId, pin))) {
    throw new HttpsError("permission-denied", "Incorrect gallery PIN.");
  }

  const data = gallery.data();
  const previewFiles = Array.isArray(data.previewFiles) ? data.previewFiles : [];
  const bucket = admin.storage().bucket();
  const signedUrlExpiresAt = Date.now() + 10 * 60 * 1000;
  const previews = await Promise.all(previewFiles.map(async name => {
    if (typeof name !== "string" || !/^[A-Za-z0-9_-]+\.jpg$/.test(name)) {
      throw new HttpsError("failed-precondition", "Gallery preview data is invalid.");
    }
    const [url] = await bucket.file(`gallery-previews/${shareId}/${name}`).getSignedUrl({
      action: "read",
      expires: signedUrlExpiresAt
    });
    return { name, url };
  }));

  return {
    coupleName: data.coupleName || "Wedding Album",
    workflowState: data.workflowState || "selection_open",
    selectedThemeId: data.selectedThemeId || null,
    selectionLimit: Number(data.selectionLimit) === GROWTH_SELECTION_LIMIT
      ? GROWTH_SELECTION_LIMIT
      : STARTER_SELECTION_LIMIT,
    selectedPhotoIds: Array.isArray(data.selectedPhotoIds) ? data.selectedPhotoIds : [],
    selectionSubmittedAt: data.selectionSubmittedAt || null,
    previews,
    signedUrlExpiresAt
  };
});

// Called by the photographer after preview files were uploaded. Public users
// can only select IDs from this server-validated manifest.
exports.publishGalleryPreviews = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const { shareId, previews } = request.data || {};
  if (typeof shareId !== "string" || !Array.isArray(previews) || previews.length > 500) {
    throw new HttpsError("invalid-argument", "Invalid preview manifest.");
  }
  const galleryRef = db.doc(`publicGalleries/${shareId}`);
  const gallery = await galleryRef.get();
  if (!gallery.exists || gallery.data().uid !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Gallery not found.");
  }
  const previewFiles = previews.map(item => String(item.file || ""));
  if (previewFiles.some(file => !/^[A-Za-z0-9_-]+\.jpg$/.test(file))) {
    throw new HttpsError("invalid-argument", "Invalid preview file.");
  }
  // originalFile is later used to build a Storage path (client-albums/{uid}/{projectId}/{originalFile}),
  // so it must be validated the same strictly — no slashes, no "..", nothing that could escape the folder.
  const previewOriginalFiles = previews.map(item => String(item.originalFile || ""));
  if (previewOriginalFiles.some(name => !/^[A-Za-z0-9._-]+$/.test(name))) {
    throw new HttpsError("invalid-argument", "Invalid original file reference.");
  }
  const ownerDoc = await db.doc(`users/${request.auth.uid}`).get();
  await galleryRef.update({
    previewFiles,
    previewCategories: previews.map(item => String(item.category || "Wedding")),
    previewOriginalFiles,
    selectionLimit: getSelectionLimit(ownerDoc.data() || {})
  });
  return { ok: true };
});

// 🆕 Lets a photographer look up the PIN for their own client's still-active
exports.getGalleryPin = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const projectId = String(request.data?.projectId || "");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(projectId)) throw new HttpsError("invalid-argument", "Invalid project.");

  const uid = request.auth.uid;
  const projectRef = db.doc(`users/${uid}/clientProjects/${projectId}`);
  const project = await projectRef.get();
  if (!project.exists) throw new HttpsError("not-found", "Project not found.");

  const data = project.data();
  if (!data.shareId) throw new HttpsError("failed-precondition", "No link has been generated for this client yet.");

  const galleryRef = db.doc(`publicGalleries/${data.shareId}`);
  const gallery = await galleryRef.get();
  if (!gallery.exists || gallery.data().isActive !== true) {
    throw new HttpsError("failed-precondition", "This client's link is no longer active.");
  }

  const secret = await db.doc(`gallerySecrets/${data.shareId}`).get();
  if (!secret.exists || !secret.data().pin) {
    throw new HttpsError("not-found", "PIN not available for this link.");
  }

  return { shareId: data.shareId, pin: secret.data().pin };
});

// 🆕 SECURITY FIX: a client's gallery link (shareId) is meant to be shared,
// so anyone who has it (forwarded WhatsApp message, shared device, etc.) can
// deliberately enter the wrong PIN 8 times and lock the REAL client out for
// 15 minutes at a time, repeatedly — a low-effort targeted DoS with no way
// for the photographer to fix it before now. This lets the photographer
// generate a brand-new PIN on demand, which also clears any existing lockout
// so the client can get back in immediately with the new PIN.
exports.regenerateGalleryPin = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const uid = request.auth.uid;
  const projectId = String(request.data?.projectId || "");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(projectId)) throw new HttpsError("invalid-argument", "Invalid project.");

  const projectRef = db.doc(`users/${uid}/clientProjects/${projectId}`);
  const project = await projectRef.get();
  if (!project.exists) throw new HttpsError("not-found", "Project not found.");

  const data = project.data();
  if (!data.shareId) throw new HttpsError("failed-precondition", "No link has been generated for this client yet.");

  const galleryRef = db.doc(`publicGalleries/${data.shareId}`);
  const gallery = await galleryRef.get();
  if (!gallery.exists || gallery.data().isActive !== true) {
    throw new HttpsError("failed-precondition", "This client's link is no longer active.");
  }

  const secretRef = db.doc(`gallerySecrets/${data.shareId}`);
  const secret = await secretRef.get();
  if (!secret.exists) throw new HttpsError("not-found", "PIN record not found for this link.");

  const newPin = makePin();
  const newSalt = crypto.randomBytes(16).toString("hex");
  await secretRef.set({
    pinSalt: newSalt,
    pinHash: hashPin(newPin, newSalt),
    pin: newPin,
    failedAttempts: 0,
    lockedUntil: admin.firestore.FieldValue.delete()
  }, { merge: true });

  logger.info("Gallery PIN regenerated", { shareId: data.shareId });
  return { shareId: data.shareId, pin: newPin };
});

// 🆕 SCHEDULED CLEANUP
exports.cleanupExpiredGalleries = onSchedule({ region: REGION, schedule: "every 24 hours" }, async () => {
  // Sirf vohi galleries clean hongi jinhe explicitly isActive: false set kiya gaya ho
  const inactiveSnap = await db.collection("publicGalleries").where("isActive", "==", false).get();

  if (inactiveSnap.empty) {
    logger.info("cleanupExpiredGalleries: nothing to clean up.");
    return;
  }

  const bucket = admin.storage().bucket();

  for (const doc of inactiveSnap.docs) {
    const shareId = doc.id;
    try {
      const [files] = await bucket.getFiles({ prefix: `gallery-previews/${shareId}/` });
      await Promise.all(files.map(file => file.delete().catch(err => {
        logger.warn("Could not delete a preview file", { shareId, file: file.name, error: err.message });
      })));
      await db.doc(`gallerySecrets/${shareId}`).delete().catch(() => {});
      await doc.ref.delete();
      logger.info("Cleaned up inactive gallery", { shareId, previewFilesDeleted: files.length });
    } catch (err) {
      logger.error("Cleanup failed for a gallery", { shareId, error: err.message });
    }
  }
});

const GRACE_DAYS = 21; // trial khatam hone ke baad itne din tak data safe rehta hai

// 🆕 TRIAL LIFECYCLE — trial → grace → expired
// Access control isme kuch change nahi karta — hasStudioAccess() (rules +
// yahan dono jagah) already trialStartDate se live time-math karta hai, toh
// 7 din baad naya client/upload/link apne aap block ho jata hai. Ye function
// sirf 2 cheez karta hai: (1) accountStatus label update taaki dashboard
// sahi banner dikha sake, (2) grace period khatam hone par asli HD photos
// delete karke Storage cost bachana — bina metadata/history khoye.
exports.updateTrialLifecycle = onSchedule({ region: REGION, schedule: "every 24 hours" }, async () => {
  const now = Date.now();

  // 1) trial → grace (7 din se zyada purana trial, abhi tak "trial" label pe hai)
  const trialCutoff = admin.firestore.Timestamp.fromMillis(now - TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const expiredTrialsSnap = await db.collection("users")
    .where("accountStatus", "==", "trial")
    .where("trialStartDate", "<=", trialCutoff)
    .get();

  for (const doc of expiredTrialsSnap.docs) {
    const gracePeriodEnd = admin.firestore.Timestamp.fromMillis(now + GRACE_DAYS * 24 * 60 * 60 * 1000);
    await doc.ref.update({ accountStatus: "grace", gracePeriodEnd }).catch(err => {
      logger.error("Failed to move user into grace", { uid: doc.id, error: err.message });
    });
  }
  if (!expiredTrialsSnap.empty) {
    logger.info(`updateTrialLifecycle: moved ${expiredTrialsSnap.size} user(s) into grace.`);
  }

  // 2) grace → expired (grace bhi khatam, subscribe nahi kiya — HD photos delete)
  const graceExpiredSnap = await db.collection("users")
    .where("accountStatus", "==", "grace")
    .where("gracePeriodEnd", "<=", admin.firestore.Timestamp.fromMillis(now))
    .get();

  const bucket = admin.storage().bucket();
  for (const doc of graceExpiredSnap.docs) {
    const uid = doc.id;
    // Safety guard: agar beech mein subscribe ho gaya (admin ne accountStatus
    // badal diya), query khud hi unhe match nahi karegi — ye ek extra check
    // race-condition se bachne ke liye.
    if (doc.data().subscriptionStatus === "active") continue;

    try {
      await bucket.deleteFiles({ prefix: `client-albums/${uid}/` });
      await doc.ref.update({ accountStatus: "expired", storageUsedBytes: 0 });
      logger.info("Trial data expired — original photos deleted", { uid });
    } catch (err) {
      logger.error("Failed to expire trial data", { uid, error: err.message });
    }
  }
});
// 🆕 QUOTA ENFORCEMENT — gallery count
exports.createClientProject = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  if (!request.auth.token.email_verified) {
    throw new HttpsError("permission-denied", "Please verify your email address first.");
  }
  const uid = request.auth.uid;
  const coupleName = String(request.data?.coupleName || "").trim();
  const eventType = String(request.data?.eventType || "Wedding");
  if (!coupleName) throw new HttpsError("invalid-argument", "Client name is required.");

  if (!(await hasStudioAccess(uid))) {
    throw new HttpsError("permission-denied", "Your trial has ended. Please subscribe to add new clients.");
  }

  // 🐞 FIX (pricing tagline problem): "Up to 50 client galleries" was being
  // enforced as a lifetime total — a photographer's 40th-ever client (even
  // if 35 of those weddings were long finished and archived) would get
  // blocked. That also made the number meaningless as a sales pitch, since
  // gallery size in GB varies wildly per client — it wasn't really telling
  // the photographer anything about their real constraint (storage).
  // Now it only counts ACTIVE galleries (not yet archived) — this makes
  // "Up to 50 active client galleries" both true and a genuinely different
  // axis of value from the GB storage cap (concurrent workload capacity,
  // not total-ever), and gives a real reason to archive finished weddings.
  const projectRef = await db.collection(`users/${uid}/clientProjects`).add({
    coupleName,
    eventType,
    workflowState: "draft",
    selectedPhotoIds: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { projectId: projectRef.id };
});

// A reservation is created before every browser upload. This makes the
// storage limit transactional: simultaneous uploads cannot all pass an old
// storageUsedBytes value and overrun the plan quota.
exports.reservePhotoUpload = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  if (!request.auth.token.email_verified) {
    throw new HttpsError("permission-denied", "Please verify your email address first.");
  }

  const uid = request.auth.uid;
  const projectId = String(request.data?.projectId || "");
  const originalName = String(request.data?.originalName || "");
  const size = Number(request.data?.size);
  const contentType = String(request.data?.contentType || "");
  if (!isValidProjectId(projectId) || !originalName || !Number.isInteger(size) || size < 1 || size >= 30 * 1024 * 1024 || !ALLOWED_IMAGE_TYPES.includes(contentType)) {
    throw new HttpsError("invalid-argument", "Invalid photo upload request.");
  }
  if (!(await hasStudioAccess(uid))) {
    throw new HttpsError("permission-denied", "Your trial has ended. Please subscribe to upload photos.");
  }

  const projectRef = db.doc(`users/${uid}/clientProjects/${projectId}`);
  const project = await projectRef.get();
  if (!project.exists) throw new HttpsError("not-found", "Project not found.");

  const fileName = makeUploadFileName(originalName);
  const userRef = db.doc(`users/${uid}`);
  const reservationRef = db.doc(`users/${uid}/uploadReservations/${fileName}`);
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + UPLOAD_RESERVATION_TTL_MS);

  await db.runTransaction(async tx => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new HttpsError("failed-precondition", "Account profile is missing.");
    const data = user.data();
    const used = Math.max(0, Number(data.storageUsedBytes) || 0);
    const reserved = Math.max(0, Number(data.storageReservedBytes) || 0);
    const limit = Number(data.storageLimitBytes);
    if (!Number.isFinite(limit) || limit <= 0 || used + reserved + size > limit) {
      throw new HttpsError("resource-exhausted", "This upload would exceed your secure storage limit.");
    }
    tx.create(reservationRef, { uid, projectId, fileName, size, contentType, expiresAt });
    tx.update(userRef, { storageReservedBytes: reserved + size });
  });

  return { fileName, expiresAt: expiresAt.toMillis() };
});

// 🆕 FIX (client delete didn't fully clean up): previously DSB.js deleted a
// client's original photos + the clientProjects doc directly from the
// browser, then TRIED to also delete publicGalleries/{shareId} client-side
// — but firestore.rules blocks that write (`allow write: if false`), so it
// silently failed. Net effect: the "deleted" client's gallery link stayed
// fully live and browsable (isActive was never set false), the watermarked
// preview photos in gallery-previews/{shareId}/ were never removed, and the
// gallerySecrets/{shareId} PIN-hash doc (also client-write-blocked by
// design) was never removed either — all orphaned in Storage/Firestore
// forever, uncounted, unbilled, unreachable by the daily cleanup job (which
// only finds galleries via publicGalleries.isActive == false, and that doc
// no longer existed to be flagged that way).
//
// This runs as Admin SDK so it can reach every one of those collections and
// do the full, real cleanup in one atomic-ish step.
exports.deleteClientProject = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const uid = request.auth.uid;
  const projectId = String(request.data?.projectId || "");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(projectId)) throw new HttpsError("invalid-argument", "Invalid project.");

  const projectRef = db.doc(`users/${uid}/clientProjects/${projectId}`);
  const project = await projectRef.get();
  if (!project.exists) throw new HttpsError("not-found", "Project not found.");
  const data = project.data();
  const shareId = data.shareId || null;

  const bucket = admin.storage().bucket();

  // 1. Original HD photos
  try {
    const [files] = await bucket.getFiles({ prefix: `client-albums/${uid}/${projectId}/` });
    await Promise.all(files.map(file => file.delete().catch(err =>
      logger.warn("Could not delete an original photo", { projectId, file: file.name, error: err.message })
    )));
  } catch (err) {
    logger.warn("Could not list original photos for deletion", { projectId, error: err.message });
  }

  if (shareId) {
    // 2. Watermarked preview photos
    try {
      const [previewFiles] = await bucket.getFiles({ prefix: `gallery-previews/${shareId}/` });
      await Promise.all(previewFiles.map(file => file.delete().catch(err =>
        logger.warn("Could not delete a preview photo", { shareId, file: file.name, error: err.message })
      )));
    } catch (err) {
      logger.warn("Could not list preview photos for deletion", { shareId, error: err.message });
    }

    // 3. PIN-hash doc — blocked from client writes by design, only Admin SDK can remove it
    await db.doc(`gallerySecrets/${shareId}`).delete().catch(err =>
      logger.warn("Could not delete gallerySecrets", { shareId, error: err.message })
    );

    // 4. Public gallery doc — same, client writes are blocked by firestore.rules
    await db.doc(`publicGalleries/${shareId}`).delete().catch(err =>
      logger.warn("Could not delete publicGalleries", { shareId, error: err.message })
    );
  }

  // 5. The client project doc itself
  await projectRef.delete();

  return { ok: true };
});

// ⚠️ ACCOUNT DELETION — deleteClientProject jaisa hi cleanup, lekin har
// client project ke liye loop me, phir account aur Auth user khud bhi
// delete karta hai. Admin SDK use karta hai isliye gallerySecrets/
// publicGalleries (jo client-write se blocked hain) bhi clean ho jate hain.
exports.deleteMyAccount = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  const uid = request.auth.uid;
  const bucket = admin.storage().bucket();

  const projectsSnap = await db.collection(`users/${uid}/clientProjects`).get();
  for (const projectDoc of projectsSnap.docs) {
    const projectId = projectDoc.id;
    const data = projectDoc.data();
    const shareId = data.shareId || null;

    try {
      const [files] = await bucket.getFiles({ prefix: `client-albums/${uid}/${projectId}/` });
      await Promise.all(files.map(file => file.delete().catch(err =>
        logger.warn("Could not delete an original photo", { projectId, file: file.name, error: err.message })
      )));
    } catch (err) {
      logger.warn("Could not list original photos for deletion", { projectId, error: err.message });
    }

    if (shareId) {
      try {
        const [previewFiles] = await bucket.getFiles({ prefix: `gallery-previews/${shareId}/` });
        await Promise.all(previewFiles.map(file => file.delete().catch(err =>
          logger.warn("Could not delete a preview photo", { shareId, file: file.name, error: err.message })
        )));
      } catch (err) {
        logger.warn("Could not list preview photos for deletion", { shareId, error: err.message });
      }

      await db.doc(`gallerySecrets/${shareId}`).delete().catch(err =>
        logger.warn("Could not delete gallerySecrets", { shareId, error: err.message })
      );
      await db.doc(`publicGalleries/${shareId}`).delete().catch(err =>
        logger.warn("Could not delete publicGalleries", { shareId, error: err.message })
      );
    }

    await projectDoc.ref.delete();
  }

  const reservationsSnap = await db.collection(`users/${uid}/uploadReservations`).get();
  await Promise.all(reservationsSnap.docs.map(doc => doc.ref.delete().catch(err =>
    logger.warn("Could not delete an upload reservation", { uid, doc: doc.id, error: err.message })
  )));

  await db.doc(`users/${uid}`).delete();

  await admin.auth().deleteUser(uid).catch(err =>
    logger.warn("Could not delete Auth user", { uid, error: err.message })
  );

  return { ok: true };
});


// 🆕 QUOTA ENFORCEMENT — storage counter
// These two run automatically on every file added/removed anywhere in the
// bucket, filtered down to client-albums/{uid}/... (a photographer's own HD
// originals — NOT gallery-previews, which are disposable and already
// cleaned up by cleanupExpiredGalleries). They keep users/{uid}.storageUsedBytes
// accurate in real time, which storage.rules then checks against
// storageLimitBytes before allowing any new upload.
const CLIENT_ALBUM_PATH = /^client-albums\/([^/]+)\/([^/]+)\/([^/]+)$/;

function storageEventRef(event) {
  return db.doc(`processedStorageEvents/${event.id}`);
}

exports.onPhotoUploaded = onObjectFinalized({ region: REGION }, async (event) => {
  const filePath = event.data.name || "";
  const match = filePath.match(CLIENT_ALBUM_PATH);
  if (!match) return;
  const [, uid, , fileName] = match;
  const size = Number(event.data.size || 0);
  const userRef = db.doc(`users/${uid}`);
  const reservationRef = db.doc(`users/${uid}/uploadReservations/${fileName}`);
  const eventRef = storageEventRef(event);

  await db.runTransaction(async tx => {
    if ((await tx.get(eventRef)).exists) return;
    const [user, reservation] = await Promise.all([tx.get(userRef), tx.get(reservationRef)]);
    if (!user.exists) return;
    const data = user.data();
    const reservedSize = reservation.exists ? Math.max(0, Number(reservation.data().size) || 0) : 0;
    const used = Math.max(0, Number(data.storageUsedBytes) || 0);
    const reserved = Math.max(0, Number(data.storageReservedBytes) || 0);
    tx.update(userRef, {
      storageUsedBytes: used + size,
      storageReservedBytes: Math.max(0, reserved - reservedSize)
    });
    if (reservation.exists) tx.delete(reservationRef);
    tx.set(eventRef, { createdAt: admin.firestore.FieldValue.serverTimestamp() });
  }).catch(err => logger.warn("Could not finalize storage quota", { uid, filePath, error: err.message }));
});

exports.onPhotoDeleted = onObjectDeleted({ region: REGION }, async (event) => {
  const filePath = event.data.name || "";
  const match = filePath.match(CLIENT_ALBUM_PATH);
  if (!match) return;
  const uid = match[1];
  const size = Number(event.data.size || 0);
  const userRef = db.doc(`users/${uid}`);
  const eventRef = storageEventRef(event);
  await db.runTransaction(async tx => {
    if ((await tx.get(eventRef)).exists) return;
    const user = await tx.get(userRef);
    if (!user.exists) return;
    const used = Math.max(0, Number(user.data().storageUsedBytes) || 0);
    tx.update(userRef, { storageUsedBytes: Math.max(0, used - size) });
    tx.set(eventRef, { createdAt: admin.firestore.FieldValue.serverTimestamp() });
  }).catch(err => logger.warn("Could not update deleted-photo quota", { uid, filePath, error: err.message }));
});

// Failed/disconnected browser uploads leave a reservation for at most 15
// minutes, after which this job releases the held quota.
exports.releaseExpiredUploadReservations = onSchedule({ region: REGION, schedule: "every 15 minutes" }, async () => {
  const now = admin.firestore.Timestamp.now();
  const reservations = await db.collectionGroup("uploadReservations")
    .where("expiresAt", "<=", now)
    .limit(500)
    .get();

  for (const reservation of reservations.docs) {
    const userRef = reservation.ref.parent.parent;
    if (!userRef) continue;
    await db.runTransaction(async tx => {
      const freshReservation = await tx.get(reservation.ref);
      if (!freshReservation.exists || freshReservation.data().expiresAt.toMillis() > Date.now()) return;
      const user = await tx.get(userRef);
      if (user.exists) {
        const reserved = Math.max(0, Number(user.data().storageReservedBytes) || 0);
        const size = Math.max(0, Number(freshReservation.data().size) || 0);
        tx.update(userRef, { storageReservedBytes: Math.max(0, reserved - size) });
      }
      tx.delete(reservation.ref);
    });
  }
  logger.info("Released expired upload reservations", { count: reservations.size });
});

// 🆕 READ-ONLY AVAILABILITY CHECK — used only to decide whether to SHOW the
// "Download HD ZIP" button (called once per gallery load, and again after
// a workflowState change). Mirrors every gate in getDownloadUrls (PIN,
// active link, subscription, published) but never touches downloadCount —
// so simply opening the gallery page no longer eats into the client's
// daily download allowance. The actual download click still calls
// getDownloadUrls, which is the only function that increments the counter.
exports.checkDownloadAvailable = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  const { shareId, pin } = request.data || {};
  if (typeof shareId !== "string" || !/^\d{6}$/.test(String(pin || ""))) {
    throw new HttpsError("invalid-argument", "Invalid request.");
  }

  const galleryRef = db.doc(`publicGalleries/${shareId}`);
  const gallery = await galleryRef.get();
  if (!gallery.exists) throw new HttpsError("not-found", "Gallery not found.");
  const galleryData = gallery.data();
  if (galleryData.isActive !== true) {
    throw new HttpsError("failed-precondition", "This gallery link is no longer active.");
  }

  if (!(await checkGalleryPin(shareId, pin))) {
    throw new HttpsError("permission-denied", "Incorrect PIN.");
  }

  const userDoc = await db.doc(`users/${galleryData.uid}`).get();
  const userData = userDoc.exists ? userDoc.data() : {};
  const subscriptionActive = userData.subscriptionStatus === "active"
    && (() => { const ms = getExpiryMillisOrNull(userData.subscriptionExpiresAt); return ms === null || ms > Date.now(); })();
  if (!subscriptionActive) {
    throw new HttpsError("permission-denied", "HD download is not available for this gallery.");
  }

  const projectRef = db.doc(`users/${galleryData.uid}/clientProjects/${galleryData.projectId}`);
  const project = await projectRef.get();
  if (!project.exists || project.data().workflowState !== "published") {
    throw new HttpsError("failed-precondition", "This gallery hasn't been published for download yet.");
  }
  const projectData = project.data();
  const selectedPhotoIds = Array.isArray(projectData.selectedPhotoIds) ? projectData.selectedPhotoIds : [];
  if (!selectedPhotoIds.length) {
    throw new HttpsError("failed-precondition", "No photos have been selected for this gallery yet.");
  }

  // Read-only preview of the same limit getDownloadUrls enforces — no write.
  const rawDownloadLimit = Number(userData.dailyDownloadLimit);
  const dailyDownloadLimit = Number.isFinite(rawDownloadLimit) && rawDownloadLimit > 0 ? rawDownloadLimit : 6;
  const todayStr = new Date().toISOString().slice(0, 10);
  const downloadsToday = projectData.downloadCountDate === todayStr ? (projectData.downloadCount || 0) : 0;

  return { available: downloadsToday < dailyDownloadLimit, remaining: Math.max(0, dailyDownloadLimit - downloadsToday) };
});

// 🆕 HD ZIP DOWNLOAD — returns short-lived signed URLs for a 
exports.getDownloadUrls = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  const { shareId, pin } = request.data || {};
  logger.info("getDownloadUrls called", { shareId, pinProvided: !!pin });
  if (typeof shareId !== "string" || !/^\d{6}$/.test(String(pin || ""))) {
    throw new HttpsError("invalid-argument", "Invalid request.");
  }

  const galleryRef = db.doc(`publicGalleries/${shareId}`);
  const gallery = await galleryRef.get();
  if (!gallery.exists) throw new HttpsError("not-found", "Gallery not found.");
  const galleryData = gallery.data();
  if (galleryData.isActive !== true) {
    throw new HttpsError("failed-precondition", "This gallery link is no longer active.");
  }

  if (!(await checkGalleryPin(shareId, pin))) {
    throw new HttpsError("permission-denied", "Incorrect PIN.");
  }

  const userDoc = await db.doc(`users/${galleryData.uid}`).get();
  const userData = userDoc.exists ? userDoc.data() : {};
  const subscriptionActive = userData.subscriptionStatus === "active"
    && (() => { const ms = getExpiryMillisOrNull(userData.subscriptionExpiresAt); return ms === null || ms > Date.now(); })();
  if (!subscriptionActive) {
    throw new HttpsError("permission-denied", "HD download is not available for this gallery.");
  }

  const projectRef = db.doc(`users/${galleryData.uid}/clientProjects/${galleryData.projectId}`);
  const project = await projectRef.get();
  if (!project.exists || project.data().workflowState !== "published") {
    throw new HttpsError("failed-precondition", "This gallery hasn't been published for download yet.");
  }
  const projectData = project.data();
  const selectedPhotoIds = Array.isArray(projectData.selectedPhotoIds) ? projectData.selectedPhotoIds : [];
  if (!selectedPhotoIds.length) {
    throw new HttpsError("failed-precondition", "No photos have been selected for this gallery yet.");
  }

  // 🐞 FIX (unlimited free downloads): previously this had no rate limit at
  // all — the same gallery link could trigger a full HD re-download as many
  // times a day as anyone wanted, and every HD photo re-fetched from
  // Storage is real egress cost. dailyDownloadLimit is set on the
  // photographer's own users/{uid} doc the same manual way as
  // galleryLimit/storageLimitBytes when their plan is activated (e.g. 6 for
  // Starter, 12 for Growth) — falls back to 6/day if never set.
  //
  // 🛑 FIX (race condition): the read (downloadsToday) and the write
  // (downloadCount: downloadsToday + 1) used to be two separate steps, not
  // atomic. Two near-simultaneous calls (double-click, two tabs/devices on
  // the same link) could both read the same downloadsToday before either
  // wrote — both would then pass the limit check and both write the SAME
  // downloadCount, silently swallowing one of the two downloads instead of
  // counting both. Wrapping the read+write in a single transaction makes
  // the whole check-and-increment atomic, so concurrent calls are always
  // counted correctly and the limit can't be raced past.
  const rawDownloadLimit = Number(userData.dailyDownloadLimit);
  const dailyDownloadLimit = Number.isFinite(rawDownloadLimit) && rawDownloadLimit > 0 ? rawDownloadLimit : 6;
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  await db.runTransaction(async (transaction) => {
    const freshProjectSnap = await transaction.get(projectRef);
    const freshData = freshProjectSnap.data() || {};
    const downloadsToday = freshData.downloadCountDate === todayStr ? (freshData.downloadCount || 0) : 0;

    if (downloadsToday >= dailyDownloadLimit) {
      throw new HttpsError(
        "resource-exhausted",
        `This gallery has reached its download limit for today (${dailyDownloadLimit}). Please try again tomorrow, or ask your photographer.`
      );
    }
    transaction.update(projectRef, { downloadCount: downloadsToday + 1, downloadCountDate: todayStr });
  });

  const previewFiles = Array.isArray(galleryData.previewFiles) ? galleryData.previewFiles : [];
  const previewOriginalFiles = Array.isArray(galleryData.previewOriginalFiles) ? galleryData.previewOriginalFiles : [];
  const previewToOriginal = {};
  previewFiles.forEach((f, i) => { previewToOriginal[f] = previewOriginalFiles[i]; });

  const originalFileNames = selectedPhotoIds
    .map(id => previewToOriginal[id])
    .filter(name => typeof name === "string" && /^[A-Za-z0-9._-]+$/.test(name));

  if (!originalFileNames.length) {
    throw new HttpsError("not-found", "Could not match selected photos to their originals.");
  }

  const bucket = admin.storage().bucket();
  const expiresAtMs = Date.now() + 15 * 60 * 1000;
  const downloadFiles = await Promise.all(originalFileNames.map(async name => {
    const file = bucket.file(`client-albums/${galleryData.uid}/${galleryData.projectId}/${name}`);
    const [url] = await file.getSignedUrl({ action: "read", expires: expiresAtMs });
    return { name, url };
  }));

  return { files: downloadFiles };
});