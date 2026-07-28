// 🎨 THEMES MANAGEMENT MODULE (`themes.js`)
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

        // Active project ka current theme kya hai?
        let currentThemeId = null;
        // Global variables `activeProjectId` and `currentUid` check (coming from DSB.js)
        if (typeof activeProjectId !== 'undefined' && activeProjectId) {
            const projectDoc = await db.collection("users").doc(currentUid)
                .collection("clientProjects").doc(activeProjectId).get();
            currentThemeId = projectDoc.exists ? projectDoc.data().selectedThemeId : null;
        }

        snapshot.forEach(doc => {
            const theme = doc.data();
            const themeId = doc.id;
            const isSelected = themeId === currentThemeId;

            const card = document.createElement("div");
            card.className = `theme-card${isSelected ? " theme-card-selected" : ""}`;
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
                ${isSelected ? `<div class="theme-selected-badge">✓ Applied</div>` : ""}
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
        // 1. clientProjects me selectedThemeId update karo
        await db.collection("users").doc(currentUid)
            .collection("clientProjects").doc(activeProjectId)
            .update({ selectedThemeId: themeId });

        alert(`✅ Theme "${themeName}" applied! Client will see this theme when they open their gallery.`);

        // Cards refresh karo — selected badge update ho
        loadGalleryThemes();

    } catch (err) {
        console.error("Theme apply error:", err);
        alert("❌ Could not apply theme. Try again.");
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