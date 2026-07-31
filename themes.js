// 🎨 THEMES MANAGEMENT MODULE (`themes.js`)
// Selecting a theme here only sets a PENDING choice on the photographer's
// own clientProjects doc — it never touches publicGalleries directly.
// The theme only becomes visible to the client when "Publish Gallery" is
// pressed (applyThemeAndPublish Cloud Function), which locks it in on both
// documents atomically. This keeps "photographer's own single-document
// write" separate from "client-facing, cross-collection write".
async function loadGalleryThemes() {
    const container = document.getElementById("themesGridContainer");
    if (!container) return;

    container.innerHTML = `<p style="color:var(--text-muted);font-size:0.9rem;">Loading themes...</p>`;

    try {
        const snapshot = await db.collection("themes")
            .where("isActive", "==", true)
            .orderBy("order")
            .get();

        if (snapshot.empty) {
            container.innerHTML = `<p style="color:var(--text-muted);">No themes available yet.</p>`;
            return;
        }

        container.innerHTML = "";

        // Active project ka pending theme aur uska publish status kya hai?
        let pendingThemeId = null;
        let isPublished = false;
        if (typeof activeProjectId !== 'undefined' && activeProjectId) {
            const projectDoc = await db.collection("users").doc(currentUid)
                .collection("clientProjects").doc(activeProjectId).get();
            if (projectDoc.exists) {
                pendingThemeId = projectDoc.data().selectedThemeId || null;
                isPublished = projectDoc.data().workflowState === "published";
            }
        }

        snapshot.forEach(doc => {
            const theme = doc.data();
            const themeId = doc.id;
            const isPending = themeId === pendingThemeId;

            const card = document.createElement("div");
            card.className = `theme-card${isPending ? " theme-card-selected" : ""}`;
            card.setAttribute("data-theme-id", themeId);
            card.setAttribute("data-css-class", theme.cssClass);

            // Note: escapeHtml is globally available from DSB.js
            card.innerHTML = `
                <div class="theme-preview-box ${theme.cssClass}">
                    ${theme.previewImageUrl
                        ? `<img src="${theme.previewImageUrl}" alt="${theme.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`
                        : `<div class="theme-preview-placeholder"><i class="fas fa-palette"></i></div>`
                    }
                </div>
                <div class="theme-card-info">
                    <strong>${escapeHtml(theme.name)}</strong>
                    <span>${escapeHtml(theme.description || "")}</span>
                </div>
                ${isPending ? `<div class="theme-selected-badge">${isPublished ? "✓ Live for client" : "⏳ Pending — publish to apply"}</div>` : ""}
            `;

            card.addEventListener("click", () => applyThemeToClient(themeId, theme.cssClass, theme.name));
            container.appendChild(card);
        });

    } catch (err) {
        console.error("Error loading themes:", err);
        container.innerHTML = `<p style="color:#ef4444;">Could not load themes. Try again.</p>`;
    }
}

async function applyThemeToClient(themeId, cssClass, themeName) {
    if (typeof activeProjectId === 'undefined' || !activeProjectId) {
        return alert("⚠️ Please select a client from Client Projects first!");
    }
    // canManageStudio check (coming from DSB.js)
    if (typeof canManageStudio === 'function' && !(await canManageStudio())) return;

    try {
        const projectRef = db.collection("users").doc(currentUid)
            .collection("clientProjects").doc(activeProjectId);

        // Owner-scoped, single-document write — safe as a direct Firestore
        // write. This is just a PENDING choice; it does not touch
        // publicGalleries and the client cannot see it yet.
        await projectRef.update({ selectedThemeId: themeId });

        // Live-preview: swap the theme class on the dashboard's own
        // selected-photos thumbnail grid so the photographer can see the
        // look before publishing — purely local, no Firestore write.
        if (typeof liveClientSelectionThumbnailsGrid !== 'undefined' && liveClientSelectionThumbnailsGrid) {
            liveClientSelectionThumbnailsGrid.className = "live-thumbnails-grid " + cssClass;
        }

        alert(`🎨 "${themeName}" set as the pending theme. It'll go live for your client as soon as you hit "Publish Gallery".`);

        loadGalleryThemes();

    } catch (err) {
        console.error("Theme apply error:", err);
        alert("❌ Could not set theme. Try again.");
    }
}

// Jab bhi Gallery Themes tab khule, themes load karo
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".nav-item[data-target]").forEach(item => {
        item.addEventListener("click", () => {
            if (item.getAttribute("data-target") === "view-palette") {
                loadGalleryThemes();
            }
        });
    });
});