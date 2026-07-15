const { onCall, HttpsError } = require("firebase-functions/v2/https");
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

// Mirrors the trial/subscription logic in firestore.rules. Admin SDK calls
// (which every function below makes) BYPASS Firestore security rules
// entirely, so this check has to be re-implemented here — the rules alone
// do not protect this function.
async function hasStudioAccess(uid) {
  const userDoc = await db.doc(`users/${uid}`).get();
  if (!userDoc.exists) return false;
  const data = userDoc.data();
  if (data.subscriptionStatus === "active") return true;
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
      status: "sent_to_client", selectionLimit: 40,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.set(db.doc(`gallerySecrets/${shareId}`), { pinSalt, pinHash: hashPin(pin, pinSalt) });
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
  if (data.expiresAt.toMillis() < Date.now() || data.status !== "sent_to_client") {
    throw new HttpsError("failed-precondition", "Gallery is no longer accepting selections.");
  }
  const secret = await db.doc(`gallerySecrets/${shareId}`).get();
  if (!secret.exists || hashPin(pin, secret.data().pinSalt) !== secret.data().pinHash) {
    throw new HttpsError("permission-denied", "Incorrect PIN.");
  }
  const allowed = new Set(data.previewFiles || []);
  if (allowed.size === 0 || photoIds.some(id => !allowed.has(id))) {
    throw new HttpsError("invalid-argument", "One or more selected photos are invalid.");
  }

  await db.doc(`users/${data.uid}/clientProjects/${data.projectId}`).update({
    status: "pending_review",
    selectedPhotoIds: [...new Set(photoIds)],
    selectedAt: admin.firestore.FieldValue.serverTimestamp()
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
  const secret = await db.doc(`gallerySecrets/${shareId}`).get();
  if (!gallery.exists || !secret.exists || gallery.data().expiresAt.toMillis() < Date.now()) {
    throw new HttpsError("not-found", "Gallery unavailable.");
  }
  if (hashPin(pin, secret.data().pinSalt) !== secret.data().pinHash) {
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
  await galleryRef.update({
    previewFiles,
    previewCategories: previews.map(item => String(item.category || "Wedding"))
  });
  return { ok: true };
});