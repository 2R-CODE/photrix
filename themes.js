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

            // Mirrors the color variables defined per-theme in lookbook.css.
            // Small duplication, but the Dashboard doesn't load lookbook.css,
            // so this is the simplest way to preview real theme colors here.
            const THEME_COLORS = {
                "theme-royal-gold":   { bg: "#0b0c10", card: "#1f2833", accent: "#d4af37" },
                "theme-pastel-bloom": { bg: "#fcf8f6", card: "#ffffff", accent: "#e8a598" },
                "theme-default":      { bg: "#0c0c0c", card: "#141414", accent: "#FF3B30" },
                "theme-minimal-dark": { bg: "#0c0c0c", card: "#141414", accent: "#FF3B30" },
            };
            const colors = THEME_COLORS[theme.cssClass] || THEME_COLORS["theme-default"];
            const accentGlow = `${colors.accent}40`; // ~25% alpha hex suffix

            const card = document.createElement("div");
            card.className = `theme-card${isPending ? " theme-card-selected" : ""}`;
            card.setAttribute("data-theme-id", themeId);
            card.setAttribute("data-css-class", theme.cssClass);
            card.style.setProperty("--theme-accent", colors.accent);
            card.style.setProperty("--theme-accent-glow", accentGlow);

            // Note: escapeHtml is globally available from DSB.js
            card.innerHTML = `
                <div class="theme-preview-box ${theme.cssClass}">
                    ${theme.previewImageUrl
                        ? `<img src="${theme.previewImageUrl}" alt="${theme.name}" style="width:100%;height:100%;object-fit:cover;">`
                        : `<div class="theme-preview-placeholder"><i class="fas fa-palette"></i></div>`
                    }
                    <div class="theme-swatches">
                        <span class="theme-swatch-dot" style="background:${colors.bg}"></span>
                        <span class="theme-swatch-dot" style="background:${colors.card}"></span>
                        <span class="theme-swatch-dot" style="background:${colors.accent}"></span>
                    </div>
                </div>
                <div class="theme-card-info">
                    <div class="theme-card-text">
                        <strong>${escapeHtml(theme.name)}</strong>
                        <span>${escapeHtml(theme.description || "")}</span>
                    </div>
                    <button type="button" class="theme-preview-eye-btn" title="Preview this theme">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
                ${isPending ? `<div class="theme-selected-badge">${isPublished ? "✓ Live for client" : "⏳ Pending — publish to apply"}</div>` : ""}
            `;

            card.querySelector(".theme-preview-eye-btn")?.addEventListener("click", (e) => {
                e.stopPropagation();
                openThemePreview(theme.name, Array.isArray(theme.previewGallery) ? theme.previewGallery : []);
            });

            card.addEventListener("click", () => applyThemeToClient(themeId, theme.cssClass, theme.name));
            container.appendChild(card);
        });

        const comingSoon = document.createElement("div");
        comingSoon.className = "theme-card-coming-soon";
        comingSoon.innerHTML = `
            <i class="fas fa-wand-magic-sparkles"></i>
            <strong>More themes on the way</strong>
            <span>New looks are added regularly</span>
        `;
        container.appendChild(comingSoon);

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

// 🖼️ THEME PREVIEW SLIDESHOW — pure UI, reads theme.previewGallery (array
// of image URLs). No Firebase writes here.
let themePreviewImages = [];
let themePreviewIndex = 0;

function openThemePreview(themeName, images) {
    const overlay = document.getElementById("themePreviewOverlay");
    if (!overlay) return;
    themePreviewImages = images && images.length ? images : [];
    themePreviewIndex = 0;
    overlay.dataset.themeName = themeName;
    renderThemePreviewSlide();
    overlay.classList.add("active");
}

function renderThemePreviewSlide() {
    const overlay = document.getElementById("themePreviewOverlay");
    const imgEl = document.getElementById("themePreviewImage");
    const titleEl = document.getElementById("themePreviewTitle");
    const dotsEl = document.getElementById("themePreviewDots");
    const prevBtn = document.getElementById("themePreviewPrevBtn");
    const nextBtn = document.getElementById("themePreviewNextBtn");
    if (!imgEl) return;

    const themeName = overlay?.dataset.themeName || "";

    if (!themePreviewImages.length) {
        imgEl.src = "";
        imgEl.alt = "No preview images yet";
        if (titleEl) titleEl.textContent = `${themeName} — no preview images uploaded yet`;
        if (dotsEl) dotsEl.innerHTML = "";
        if (prevBtn) prevBtn.style.display = "none";
        if (nextBtn) nextBtn.style.display = "none";
        return;
    }

    imgEl.src = themePreviewImages[themePreviewIndex];
    imgEl.alt = `${themeName} preview ${themePreviewIndex + 1}`;
    if (titleEl) titleEl.textContent = `${themeName} — ${themePreviewIndex + 1} / ${themePreviewImages.length}`;

    if (dotsEl) {
        dotsEl.innerHTML = themePreviewImages.map((_, i) =>
            `<span class="theme-preview-dot${i === themePreviewIndex ? " active" : ""}" data-index="${i}"></span>`
        ).join("");
    }
    const multi = themePreviewImages.length > 1;
    if (prevBtn) { prevBtn.style.display = multi ? "flex" : "none"; prevBtn.disabled = themePreviewIndex === 0; }
    if (nextBtn) { nextBtn.style.display = multi ? "flex" : "none"; nextBtn.disabled = themePreviewIndex === themePreviewImages.length - 1; }
}

document.addEventListener("DOMContentLoaded", () => {
    const overlay = document.getElementById("themePreviewOverlay");
    if (!overlay) return;
    const closeBtn = document.getElementById("closeThemePreviewBtn");
    const prevBtn = document.getElementById("themePreviewPrevBtn");
    const nextBtn = document.getElementById("themePreviewNextBtn");
    const dotsEl = document.getElementById("themePreviewDots");

    const close = () => overlay.classList.remove("active");

    if (closeBtn) closeBtn.onclick = close;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    if (prevBtn) prevBtn.onclick = () => {
        if (themePreviewIndex > 0) { themePreviewIndex--; renderThemePreviewSlide(); }
    };
    if (nextBtn) nextBtn.onclick = () => {
        if (themePreviewIndex < themePreviewImages.length - 1) { themePreviewIndex++; renderThemePreviewSlide(); }
    };
    if (dotsEl) dotsEl.addEventListener("click", (e) => {
        const dot = e.target.closest(".theme-preview-dot");
        if (!dot) return;
        themePreviewIndex = parseInt(dot.getAttribute("data-index"), 10);
        renderThemePreviewSlide();
    });
});