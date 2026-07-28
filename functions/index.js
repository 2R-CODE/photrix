const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onObjectFinalized, onObjectDeleted } = require("firebase-functions/v2/storage");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const REGION = "asia-south1";
const TRIAL_DAYS = 7;

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

  await db.runTransaction(async transaction => {
    
    transaction.set(db.doc(`publicGalleries/${shareId}`), {
      uid, projectId, coupleName: data.coupleName || "Wedding Album", expiresAt,
      isActive: true,
      status: "sent_to_client", selectionLimit: 40,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.set(db.doc(`gallerySecrets/${shareId}`), { pinSalt, pinHash: hashPin(pin, pinSalt), pin });
    transaction.update(projectRef, {
      status: "sent_to_client",
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
  if (!/^\d{6}$/.test(pin) || photoIds.length < 1 || photoIds.length > 40 || photoIds.some(id => typeof id !== "string" || id.length > 200)) {
    throw new HttpsError("invalid-argument", "Invalid PIN or photo selection.");
  }
  
  const galleryRef = db.doc(`publicGalleries/${shareId}`);
  const gallery = await galleryRef.get();
  if (!gallery.exists) throw new HttpsError("not-found", "Gallery not found.");
  
  const data = gallery.data();
  if (data.isActive !== true) {
    throw new HttpsError("failed-precondition", "Gallery is no longer accepting selections.");
  }
  
  if (!(await checkGalleryPin(shareId, pin))) {
    throw new HttpsError("permission-denied", "Incorrect PIN.");
  }
  
  const allowed = new Set(data.previewFiles || []);
  if (allowed.size === 0 || photoIds.some(id => !allowed.has(id))) {
    throw new HttpsError("invalid-argument", "One or more selected photos are invalid.");
  }

  // 1. Update Photographer's private project document
  await db.doc(`users/${data.uid}/clientProjects/${data.projectId}`).update({
    status: "pending_review",
    workflowState: "selection_completed", // Dashboard ko bhi pata chale ki submit ho gaya
    selectedPhotoIds: [...new Set(photoIds)],
    selectedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // 2. 🛠️ FIX: Update Public Gallery document so Client UI locks up on refresh!
  await galleryRef.update({
    workflowState: "selection_completed",
    status: "selection_completed"
  });

  logger.info("Gallery selection submitted", { shareId });
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
  await galleryRef.update({
    previewFiles,
    previewCategories: previews.map(item => String(item.category || "Wedding")),
    previewOriginalFiles
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

  const userDoc = await db.doc(`users/${uid}`).get();
  const rawLimit = userDoc.exists ? userDoc.data().galleryLimit : undefined;
  const coercedLimit = Number(rawLimit);
  const galleryLimit = Number.isFinite(coercedLimit) && coercedLimit > 0 ? coercedLimit : 10;

  const countSnap = await db.collection(`users/${uid}/clientProjects`).count().get();
  if (countSnap.data().count >= galleryLimit) {
    throw new HttpsError(
      "resource-exhausted",
      `You've reached your plan's limit of ${galleryLimit} client galleries. Upgrade to add more.`
    );
  }

  const projectRef = await db.collection(`users/${uid}/clientProjects`).add({
    coupleName,
    eventType,
    status: "created",
    selectedPhotoIds: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { projectId: projectRef.id };
});

// 🆕 QUOTA ENFORCEMENT — storage counter
// These two run automatically on every file added/removed anywhere in the
// bucket, filtered down to client-albums/{uid}/... (a photographer's own HD
// originals — NOT gallery-previews, which are disposable and already
// cleaned up by cleanupExpiredGalleries). They keep users/{uid}.storageUsedBytes
// accurate in real time, which storage.rules then checks against
// storageLimitBytes before allowing any new upload.
const CLIENT_ALBUM_PATH = /^client-albums\/([^/]+)\//;

exports.onPhotoUploaded = onObjectFinalized({ region: REGION }, async (event) => {
  const filePath = event.data.name || "";
  const match = filePath.match(CLIENT_ALBUM_PATH);
  if (!match) return;
  const uid = match[1];
  const size = Number(event.data.size || 0);
  await db.doc(`users/${uid}`).update({
    storageUsedBytes: admin.firestore.FieldValue.increment(size)
  }).catch(err => logger.warn("Could not increment storageUsedBytes", { uid, error: err.message }));
});

exports.onPhotoDeleted = onObjectDeleted({ region: REGION }, async (event) => {
  const filePath = event.data.name || "";
  const match = filePath.match(CLIENT_ALBUM_PATH);
  if (!match) return;
  const uid = match[1];
  const size = Number(event.data.size || 0);
  await db.doc(`users/${uid}`).update({
    storageUsedBytes: admin.firestore.FieldValue.increment(-size)
  }).catch(err => logger.warn("Could not decrement storageUsedBytes", { uid, error: err.message }));
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
  if (!project.exists || project.data().status !== "unlocked") {
    throw new HttpsError("failed-precondition", "This gallery hasn't been unlocked for download yet.");
  }
  const projectData = project.data();
  const selectedPhotoIds = Array.isArray(projectData.selectedPhotoIds) ? projectData.selectedPhotoIds : [];
  if (!selectedPhotoIds.length) {
    throw new HttpsError("failed-precondition", "No photos have been selected for this gallery yet.");
  }

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