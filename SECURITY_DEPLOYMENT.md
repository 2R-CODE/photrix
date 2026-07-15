# PHOTRIX security rollout

## What is already wired in the website

- Email/password photographers receive a verification email at signup.
- Unverified users cannot create galleries, upload images, generate links, or unlock a gallery.
- Dashboard actions use the Firebase Auth session, not only browser storage.

## Functions scaffold

`functions/index.js` contains two Cloud Functions:

- `createGalleryShare`: authenticated photographer gets a random share ID and a one-time 6-digit PIN.
- `submitGallerySelection`: validates the PIN, link expiry, and a maximum of 40 selected photo IDs.

The PIN hash is in the private `gallerySecrets` collection. Never allow client reads to that collection.

## Before deploying Functions

1. Install the Firebase CLI and sign in to the correct Firebase project.
2. In `functions`, run `npm install`.
3. Enable App Check for Cloud Functions. The functions use `enforceAppCheck: true`, so direct browser calls will be rejected until the web App Check client is added.
4. Deploy with `firebase deploy --only functions`.

Do not connect `lookbook.js` to these functions until preview-image delivery is implemented. Original HD files must remain private; public galleries should use watermarked previews only.

## Rules requirements

- `users/{uid}` and its `clientProjects` must be readable/writable only by the matching authenticated photographer.
- `gallerySecrets/{shareId}` must deny every client request.
- `publicGalleries/{shareId}` may allow only a single-document `get` before expiry; do not allow `list`.
- Cloud Storage originals in `client-albums/{uid}/...` must be owner-only, email-verified, image-only, and <= 30 MB.

## Billing safety

Do not allow a browser user to write `subscriptionStatus`, `planName`, or payment status. Payment webhooks should update those fields through Admin SDK Cloud Functions only.
