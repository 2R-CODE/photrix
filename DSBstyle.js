// 🏷️ BUILD MARKER — update this string every time you deploy a new DSBstyle.js.

 

console.log("PHOTRIX DSBstyle.js build: 2026-08-20-v3");

 

 

 

document.addEventListener("DOMContentLoaded", () => {

 

    // 🛠️ FETCH ALL CORE UI DROPDOWNS & TOGGLES

 

    const appSwitcherHeading = document.getElementById("activeWorkspaceTitleHeading");

 

    const appSwitcherMenu = document.getElementById("appSwitcherDropdownMenu") || document.querySelector('.dashboard-dropdown-menu');

 

    

 

    const notifToggleBtn = document.getElementById("notifToggleBtn");

 

    const notifDropdownMenu = document.getElementById("notifDropdownMenu");

 

 

 

    const profileToggleBtn = document.getElementById("profileToggleBtn");

 

    const profileDropdownMenu = document.getElementById("profileDropdownMenu");

 

 

 

    // Helper function to close everything at once before toggling a new one

 

    const closeAllMenus = () => {

 

        if (appSwitcherMenu) appSwitcherMenu.style.display = "none";

 

        if (notifDropdownMenu) notifDropdownMenu.style.display = "none";

 

        if (profileDropdownMenu) profileDropdownMenu.style.display = "none";

 

    };

 

 

 

    // 1. 🔄 APP SWITCHER DROPDOWN (Dashboard Title Click)

 

    if (appSwitcherHeading && appSwitcherMenu) {

 

        appSwitcherMenu.style.display = "none"; // Force hide on startup safely

 

 

 

        appSwitcherHeading.addEventListener("click", (e) => {

 

            e.stopPropagation();

 

            const isOpen = appSwitcherMenu.style.display === "block";

 

            closeAllMenus(); 

 

            appSwitcherMenu.style.display = isOpen ? "none" : "block";

 

        });

 

    }

 

/*

 

    // 2. 🔔 NOTIFICATION DROPDOWN

 

    if (notifToggleBtn && notifDropdownMenu) {

 

        notifToggleBtn.addEventListener("click", (e) => {

 

            e.stopPropagation();

 

            const isOpen = notifDropdownMenu.style.display === "block"; // ✨ FIXED: Added missing declaration

 

            closeAllMenus(); 

 

            notifDropdownMenu.style.display = isOpen ? "none" : "block";

 

        });

 

    }

 

*/

 

    // 3. 👤 PROFILE DROPDOWN (Contains Logout, Billing, Settings)

 

    if (profileToggleBtn && profileDropdownMenu) {

 

        profileToggleBtn.addEventListener("click", (e) => {

 

            e.stopPropagation();

 

            const isOpen = profileDropdownMenu.style.display === "block";

 

            closeAllMenus(); 

 

            profileDropdownMenu.style.display = isOpen ? "none" : "block";

 

        });

 

    }

 

 

 

    // 🖱️ GLOBAL CLICK: Hide any open menu when clicking outside

 

    window.addEventListener("click", (e) => {

 

        if (appSwitcherMenu && !appSwitcherMenu.contains(e.target) && e.target !== appSwitcherHeading) {

 

            appSwitcherMenu.style.display = "none";

 

        }

 

        if (notifDropdownMenu && !notifDropdownMenu.contains(e.target) && e.target !== notifToggleBtn) {

 

            notifDropdownMenu.style.display = "none";

 

        }

 

        

 

        // ✨ FIXED: Agar click profile menu ke BAHAR hua hai, tabhi close karo

 

        if (profileDropdownMenu && !profileDropdownMenu.contains(e.target) && e.target !== profileToggleBtn) {

 

            profileDropdownMenu.style.display = "none";

 

        }

 

    });

 

 

 

    // ⌨️ ESCAPE KEY SHORTCUT

 

    window.addEventListener("keydown", (e) => {

 

        if (e.key === "Escape") closeAllMenus();

 

    });

 

});

 

// ⭐ FIXED: SIDEBAR TOGGLE LOGIC (Desktop collapse + Mobile slide-in

 

document.addEventListener("DOMContentLoaded", function () {

 

    const toggleBtn = document.getElementById("testToggleBtn");

 

    const sidebarElement = document.getElementById("testSidebar");

 

 

 

    if (toggleBtn && sidebarElement) {

 

        toggleBtn.addEventListener("click", function (e) {

 

            e.preventDefault();

 

            e.stopPropagation();

 

 

 

            // Mobile (<=768px) par sidebar slide-in/out hoti hai

 

            // Desktop par sidebar sirf collapse (chhoti) hoti hai

 

            if (window.innerWidth <= 768) {

 

                sidebarElement.classList.toggle("mobile-active");

 

            } else {

 

                sidebarElement.classList.toggle("collapsed");

 

            }

 

        });

 

 

 

        // 📱 Mobile: sidebar ke bahar click karne par usko band kar do

 

        document.addEventListener("click", function (e) {

 

            const isMobile = window.innerWidth <= 768;

 

            const isSidebarOpen = sidebarElement.classList.contains("mobile-active");

 

            const clickedOutside = !sidebarElement.contains(e.target) && !toggleBtn.contains(e.target);

 

 

 

            if (isMobile && isSidebarOpen && clickedOutside) {

 

                sidebarElement.classList.remove("mobile-active");

 

            }

 

        });

 

 

 

        // 🔄 Agar user resize karke desktop <-> mobile switch kare,

 

        // toh purani state (collapsed/mobile-active) reset ho jaye

 

        window.addEventListener("resize", function () {

 

            if (window.innerWidth > 768) {

 

                sidebarElement.classList.remove("mobile-active");

 

            } else {

 

                sidebarElement.classList.remove("collapsed");

 

            }

 

        });

 

    } else {

 

        console.log("Error: Sidebar elements not found in DOM yet!");

 

    }

 

});

 

 

 

 

 

 

 

// 📁 FILE PICKER UI — defensive binding so this frontend file never stops

 

// executing just because an optional upload element is missing from HTML.

 

const browseFilesBtn = document.getElementById('browseFilesBtn');

 

const realFileInput = document.getElementById('realFileInput');

 

const startCloudUploadBtn = document.getElementById('startCloudUploadBtn');

 

 

 

if (browseFilesBtn && realFileInput) {

 

    browseFilesBtn.addEventListener('click', (e) => {

 

        e.preventDefault();

 

        realFileInput.click();

 

    });

 

}

 

 

 

// Jab file select ho jaye, toh 'Start Cloud Upload' button dikhaye

 

if (realFileInput) {

 

    realFileInput.addEventListener('change', function() {

 

        if (startCloudUploadBtn) {

 

            startCloudUploadBtn.style.display = this.files.length > 0 ? 'inline-block' : 'none';

 

        }

 

    });

 

}

 

 

 

// 🆕 SPA VIEW SWITCHING 

 

const navItems = document.querySelectorAll(".nav-item[data-target]");

 

navItems.forEach((item) => {

 

    item.addEventListener("click", (e) => {

 

        e.preventDefault();

 

        const targetId = item.getAttribute("data-target");

 

 

 

        document.querySelectorAll(".view-section").forEach(v => v.classList.remove("active-view"));

 

        document.getElementById(targetId)?.classList.add("active-view");

 

 

 

        navItems.forEach(nav => nav.classList.remove("active"));

 

        item.classList.add("active");

 

 

 

        // Mobile: after choosing a section, close the drawer automatically so

 

        // the workspace is immediately visible. Desktop is unaffected.

 

        if (window.innerWidth <= 768) {

 

            document.getElementById("testSidebar")?.classList.remove("mobile-active");

 

        }

 

    });

 

});

 

 

 

// 🎨 "Choose Theme" SHORTCUT BUTTON (Overview tab) — FIX

 

// Bug: button existed in DSB.html but had zero click listener anywhere,

 

// so nothing happened on click. Fix: reuse the real Gallery Themes

 

// nav-item's own click handler (tab switch in this file + loadGalleryThemes()

 

// in themes.js) instead of duplicating that logic here.

 

document.addEventListener("DOMContentLoaded", () => {

 

    const goToThemesShortcutBtn = document.getElementById("goToThemesShortcutBtn");

 

    const themesNavItem = document.querySelector('.nav-item[data-target="view-palette"]');

 

 

 

    if (goToThemesShortcutBtn && themesNavItem) {

 

        goToThemesShortcutBtn.addEventListener("click", (e) => {

 

            e.preventDefault();

 

            themesNavItem.click(); // triggers tab switch + loadGalleryThemes() together

 

        });

 

    }

 

});

 

 

 

// 🌐 GLOBAL OFFLINE BANNER

 

// One shared "you're offline" signal (see DSB.html + DSB.css) instead of

 

// every action figuring out its own way to say the same thing.

 

function updatePhotrixOfflineBanner() {

 

    const banner = document.getElementById("globalOfflineBanner");

 

    if (!banner) return;

 

    banner.style.display = navigator.onLine ? "none" : "block";

 

}

 

window.addEventListener("online", updatePhotrixOfflineBanner);

 

window.addEventListener("offline", updatePhotrixOfflineBanner);

 

document.addEventListener("DOMContentLoaded", updatePhotrixOfflineBanner);

 

 

 

// ⚙️ SETTINGS (profile dropdown) — STUB ONLY

 

// No Settings screen exists yet — wiring this to a real view/tab is a

 

// separate decision (see chat: what should actually live here). Placeholder

 

// so the item isn't a silent dead click in the meantime.

 

document.addEventListener("DOMContentLoaded", () => {

 

    const openSettingsBtn = document.getElementById("openSettingsBtn");

 

    if (openSettingsBtn) {

 

        openSettingsBtn.addEventListener("click", () => {

 

            alert("⚙️ Settings — coming soon.");

 

        });

 

    }

 

});

 

 

 

 

 

// ================= LIGHTBOX CLOSE LOGIC =================

 

document.addEventListener("DOMContentLoaded", () => {

 

    const closeLightboxBtn = document.getElementById("closeLightboxBtn");

 

    const lightbox = document.getElementById("photoLightbox");

 

    

 

    if (closeLightboxBtn && lightbox) {

 

        // Cross button pe click karne se band

 

        closeLightboxBtn.onclick = () => lightbox.classList.remove("active");

 

        

 

        // Background black area pe click karne se bhi band ho jaye

 

        lightbox.onclick = (e) => {

 

            if (e.target === lightbox) lightbox.classList.remove("active");

 

        };

 

    }

 

});

 

 

 

// 📱 MOBILE CLIENT LIST ACCORDION — pure UI, no Firebase.

 

// On mobile, tapping a client row just expands/collapses it to reveal

 

// Event Type / Selection Status / Actions. Backend-tied actions (Copy Link,

 

// Edit, Delete, Manage) are handled separately in DSB.js — this listener

 

// only toggles the .row-expanded class and gets out of the way for buttons.

 

document.addEventListener("DOMContentLoaded", () => {

 

    const clientTrackerTableBody = document.getElementById("clientTrackerTableBody");

 

    if (!clientTrackerTableBody) return;

 

 

 

    clientTrackerTableBody.addEventListener("click", (e) => {

 

        if (window.innerWidth > 768) return;

 

 

 

        // Inputs, labels and action controls must never toggle the accordion.

 

        // In particular, tapping a checkbox used to expand the row on mobile.

 

        if (e.target.closest("button, input, select, textarea, label, a, [role=\"button\"]")) return;

 

 

 

        const row = e.target.closest("tr[data-project-id]");

 

        if (!row) return;

 

 

 

        const wasExpanded = row.classList.contains("row-expanded");

 

        clientTrackerTableBody.querySelectorAll("tr.row-expanded").forEach(r => r.classList.remove("row-expanded"));

 

        if (!wasExpanded) row.classList.add("row-expanded");

 

    });

 

});

 

 

 

// 🆕 WHATSAPP SHARE — gallery link seedha WhatsApp pe pre-filled message ke saath

 

const whatsappShareBtn = document.getElementById("whatsappShareBtn");

 

if (whatsappShareBtn) {

 

    whatsappShareBtn.addEventListener("click", () => {

 

        const link = clientGeneratedUrlDisplayField?.value;

 

        if (!link) return alert("Generate a link first!");

 

 

 

        const clientName = activeProjectName || "there";

 

        const message = `Hi ${clientName}! 📸✨ Your wedding photo gallery is ready. View and select your favorite photos here: ${link}`;

 

        window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");

 

    });

 

}

 

 

 

// ============================================================

 

// 🆕 NEW CLIENT / EDIT CLIENT MODALS — pure open/close UI (no

 

// Firebase). Moved here from DSB.js per the DSB.js = backend,

 

// DSBstyle.js = frontend split. The actual Firebase create/save

 

// calls stay in DSB.js and call these same open/close functions

 

// (safe: this file loads before DSB.js, so they're already

 

// defined on window by the time DSB.js's own listeners run).

 

// ============================================================

 

const newClientModal = document.getElementById("newClientModal");

 

const closeModalBtn = document.getElementById("closeModalBtn");

 

const cancelModalBtn = document.getElementById("cancelModalBtn");

 

const clientNameInput = document.getElementById("clientNameInput");

 

const eventTypeInput = document.getElementById("eventTypeInput");

 

const newClientTriggerBtn = document.querySelector(".tracker-section .btn-primary-small");

 

const overviewNewClientBtn = document.getElementById("overviewNewClientBtn");

 

const uploadEmptyStateCreateBtn = document.getElementById("uploadEmptyStateCreateBtn");

 

 

 

function openNewClientModal() {

 

    if (!newClientModal) return;

 

    newClientModal.classList.add("active");

 

    window.setTimeout(() => clientNameInput?.focus(), 0);

 

}

 

function closeNewClientModal() {

 

    if (newClientModal) newClientModal.classList.remove("active");

 

    if (clientNameInput) clientNameInput.value = "";

 

    if (eventTypeInput) eventTypeInput.value = "Wedding";

 

}

 

 

 

if (newClientTriggerBtn) newClientTriggerBtn.addEventListener("click", openNewClientModal);

 

if (overviewNewClientBtn) overviewNewClientBtn.addEventListener("click", openNewClientModal);

 

if (uploadEmptyStateCreateBtn) uploadEmptyStateCreateBtn.addEventListener("click", openNewClientModal);

 

if (closeModalBtn) closeModalBtn.addEventListener("click", closeNewClientModal);

 

if (cancelModalBtn) cancelModalBtn.addEventListener("click", closeNewClientModal);

 

 

 

const editClientModal = document.getElementById("editClientModal");

 

const closeEditModalBtn = document.getElementById("closeEditModalBtn");

 

const cancelEditModalBtn = document.getElementById("cancelEditModalBtn");

 

 

 

function closeEditModal() {

 

    if (editClientModal) editClientModal.classList.remove("active");

 

}

 

if (closeEditModalBtn) closeEditModalBtn.addEventListener("click", closeEditModal);

 

if (cancelEditModalBtn) cancelEditModalBtn.addEventListener("click", closeEditModal);

 

 

 

// Modal polish: Escape closes the active dialog; clicking the backdrop closes

 

// it too, while clicks inside the modal remain untouched.

 

window.addEventListener("keydown", (e) => {

 

    if (e.key !== "Escape") return;

 

    if (newClientModal?.classList.contains("active")) closeNewClientModal();

 

    if (editClientModal?.classList.contains("active")) closeEditModal();

 

});

 

 

 

if (newClientModal) {

 

    newClientModal.addEventListener("click", (e) => {

 

        if (e.target === newClientModal) closeNewClientModal();

 

    });

 

}

 

if (editClientModal) {

 

    editClientModal.addEventListener("click", (e) => {

 

        if (e.target === editClientModal) closeEditModal();

 

    });

 

}

 

 

 

// ============================================================

 

// 🆕 OVERVIEW EMPTY-STATE SWAP — pure UI: shows the empty-state

 

// card OR the real section content, never both, never a blurred

 

// overlay. DSB.js calls window.setOverviewClientSelectedState(bool)

 

// whenever activeProjectId changes (client picked/created/switched)

 

// or on initial dashboard load (no client yet). This function only

 

// toggles visibility — it has no idea what a "client" or Firestore

 

// even is, which is the whole point of it living here.

 

// ============================================================

 

const uploadEmptyState = document.getElementById("uploadEmptyState");

 

const mainDropzone = document.getElementById("mainDropzone");

 

const linkEmptyState = document.getElementById("linkEmptyState");

 

const linkRealContent = document.getElementById("linkRealContent");

 

 

 

function setOverviewClientSelectedState(hasClient) {

 

    if (uploadEmptyState) uploadEmptyState.style.display = hasClient ? "none" : "flex";

 

    if (mainDropzone) mainDropzone.style.display = hasClient ? "block" : "none";

 

    if (linkEmptyState) linkEmptyState.style.display = hasClient ? "none" : "flex";

 

    if (linkRealContent) linkRealContent.style.display = hasClient ? "block" : "none";

 

}

 

// Exposed on window so DSB.js (which owns activeProjectId) can call it

 

// without this file needing to know anything about Firebase state.

 

window.setOverviewClientSelectedState = setOverviewClientSelectedState;

 

 

 

// Start in the "no client" empty state until DSB.js says otherwise.

 

document.addEventListener("DOMContentLoaded", () => setOverviewClientSelectedState(false));

 

 

 

// ============================================================

 

// 🆕 CLIENT TRACKER TABLE — pure UI (no Firebase). Moved from

 

// DSB.js per the DSB.js = backend, DSBstyle.js = frontend split.

 

// DSB.js owns the Firestore data (allClientDocs) and calls

 

// window.renderClientTrackerTable(docs, activeProjectId) whenever

 

// that data changes. This file caches the last docs/activeId it

 

// was given so the search box and "Load More" button can re-render

 

// locally, without asking DSB.js to re-fetch anything.

 

// ============================================================

 

const clientTrackerTableBody = document.getElementById("clientTrackerTableBody");

 

const clientSearchInput = document.getElementById("clientSearchInput");

 

const loadMoreClientsBtn = document.getElementById("loadMoreClientsBtn");

 

const selectAllClientsCheckbox = document.getElementById("selectAllClientsCheckbox");

 

const bulkActionsBar = document.getElementById("bulkActionsBar");

 

const bulkSelectedCount = document.getElementById("bulkSelectedCount");

 

const bulkDeleteBtn = document.getElementById("bulkDeleteBtn");

 

 

 

const CLIENT_PAGE_SIZE = 10;

 

let cachedClientDocs = [];

 

let cachedActiveProjectId = null;

 

let visibleClientCount = CLIENT_PAGE_SIZE;

 

let selectedClientIds = new Set(); // pure UI selection state (no Firebase) — DSB.js reads it via window.getSelectedClientIds()

 

 

 

function escapeHtml(value) {

 

    return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

 

}

 

 

 

function renderClientRow(projectId, data) {

 

    const tr = document.createElement("tr");

 

    tr.setAttribute("data-project-id", projectId);

 

    tr.setAttribute("data-couple-name", data.coupleName || "Unnamed");

 

 

 

    let statusHtml = "";

 

    let statusDotClass = "dot-pending";

 

    if (data.workflowState === "published") {

 

        statusHtml = `<span class="status-badge success">✅ Published</span>`;

 

        statusDotClass = "dot-published";

 

    } else if (data.selectedPhotoIds && data.selectedPhotoIds.length > 0) {

 

        statusHtml = `<span class="status-badge success">✅ ${data.selectedPhotoIds.length} Photos Picked</span>`;

 

        statusDotClass = "dot-picked";

 

    } else if (data.workflowState === "selection_open") {

 

        statusHtml = `<span class="status-badge pending">⏳ Awaiting Selection</span>`;

 

        statusDotClass = "dot-pending";

 

    } else {

 

        statusHtml = `<span class="status-badge pending">🆕 Not Sent Yet</span>`;

 

        statusDotClass = "dot-draft";

 

    }

 

 

 

    const eventClass = data.eventType === "Pre-Wedding" ? "event-tag pre-wed" : "event-tag";

 

    const safeName = escapeHtml(data.coupleName || "Unnamed");

 

    const safeEvent = escapeHtml(data.eventType || "");

 

 

 

    tr.innerHTML = `

 

        <td data-label="" class="td-checkbox">

 

            <input type="checkbox" class="client-row-checkbox" data-project-id="${projectId}" ${selectedClientIds.has(projectId) ? "checked" : ""} aria-label="Select ${safeName}">

 

        </td>

 

        <td data-label="Client Name" class="td-name">

 

            <div class="client-info">

 

                <strong>${safeName}</strong>

 

                <span class="client-meta-inline">

 

                    ${safeEvent ? `<span class="event-pill-mini">${safeEvent}</span>` : ""}

 

                    <span class="mobile-status-dot ${statusDotClass}" title="${statusHtml.replace(/<[^>]+>/g, "")}"></span>

 

                </span>

 

            </div>

 

            <i class="fas fa-chevron-down row-expand-chevron" aria-hidden="true"></i>

 

        </td>

 

        <td data-label="Event Type" class="td-event-detail"><span class="${eventClass}">${safeEvent || "N/A"}</span></td>

 

        <td data-label="Selection Status" class="td-status-detail">${statusHtml}</td>

 

        <td data-label="Action" class="td-action">

 

            <button class="action-btn text-btn manage-project-btn" data-project-id="${projectId}" data-couple-name="${safeName}" title="Open Client Workspace" aria-label="Open Client Workspace">

 

                <i class="fas fa-gauge"></i>

 

            </button>

 

            <button class="action-btn text-btn copy-project-link-btn" data-project-id="${projectId}" title="Copy Gallery Link" aria-label="Copy Gallery Link">

 

                <i class="far fa-copy"></i>

 

            </button>

 

            <button class="action-btn text-btn edit-project-btn" data-project-id="${projectId}" data-couple-name="${safeName}" data-event-type="${safeEvent}" style="color:var(--primary-blue); border-color:var(--border-medium);" title="Edit Client" aria-label="Edit Client">

 

                <i class="fas fa-pencil-alt"></i>

 

            </button>

 

            <button class="action-btn text-btn delete-project-btn" data-project-id="${projectId}" data-couple-name="${safeName}" style="color:var(--danger-red); border-color:rgba(248,113,113,0.35);" title="Delete Client" aria-label="Delete Client">

 

                <i class="fas fa-trash"></i>

 

            </button>

 

        </td>

 

    `;

 

    return tr;

 

}

 

 

 

function renderClientTrackerFromCache() {

 

    if (!clientTrackerTableBody) return;

 

 

 

    const query = (clientSearchInput?.value || "").trim().toLowerCase();

 

    const filtered = query

 

        ? cachedClientDocs.filter(item => (item.data.coupleName || "").toLowerCase().includes(query))

 

        : cachedClientDocs;

 

 

 

    const pageItems = filtered.slice(0, visibleClientCount);

 

 

 

    clientTrackerTableBody.innerHTML = "";

 

 

 

    if (pageItems.length === 0) {

 

        clientTrackerTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-subtle);">${query ? "No clients match your search." : "No clients yet. Click \"New Client\" to add one."}</td></tr>`;

 

    } else {

 

        pageItems.forEach(item => {

 

            const row = renderClientRow(item.id, item.data);

 

            if (item.id === cachedActiveProjectId) row.classList.add("active-row");

 

            clientTrackerTableBody.appendChild(row);

 

        });

 

    }

 

 

 

    // "Load More" only shows when there are more rows beyond what's visible —

 

    // clean by default (matches the original search-first UX), no clutter

 

    // when everything already fits on screen.

 

    if (loadMoreClientsBtn) {

 

        loadMoreClientsBtn.style.display = filtered.length > visibleClientCount ? "inline-flex" : "none";

 

    }

 

 

 

    syncSelectAllCheckboxState(pageItems);

 

    updateBulkActionsBar();

 

}

 

 

 

// "Select all" reflects only the currently-rendered rows — checked when every

 

// visible row is selected, indeterminate (dash) when some but not all are,

 

// unchecked otherwise. Matches how the rows themselves are already scoped

 

// (search filter + load-more window), so it never silently selects clients

 

// the photographer can't currently see.

 

function syncSelectAllCheckboxState(pageItems) {

 

    if (!selectAllClientsCheckbox) return;

 

 

 

    const visibleCount = pageItems.length;

 

    selectAllClientsCheckbox.disabled = visibleCount === 0;

 

 

 

    if (visibleCount === 0) {

 

        selectAllClientsCheckbox.checked = false;

 

        selectAllClientsCheckbox.indeterminate = false;

 

        selectAllClientsCheckbox.title = "No visible clients to select";

 

        return;

 

    }

 

 

 

    const selectedVisibleCount = pageItems.filter(item => selectedClientIds.has(item.id)).length;

 

    selectAllClientsCheckbox.checked = selectedVisibleCount === visibleCount;

 

    selectAllClientsCheckbox.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleCount;

 

    selectAllClientsCheckbox.title = `Select all ${visibleCount} visible client${visibleCount === 1 ? "" : "s"}`;

 

}

 

 

 

function updateBulkActionsBar() {

 

    if (!bulkActionsBar) return;

 

    const count = selectedClientIds.size;

 

    bulkActionsBar.style.display = count > 0 ? "flex" : "none";

 

    if (bulkSelectedCount) {

        bulkSelectedCount.innerText = `${count} client${count === 1 ? "" : "s"} selected`;

        bulkSelectedCount.title = "Selected clients are retained while you search or load more.";

    }

 

    ensureBulkClearButton();

}

 

 

 

let clearClientSelectionBtn = document.getElementById("clearClientSelectionBtn");

 

function ensureBulkClearButton() {

 

    if (!bulkActionsBar || !bulkSelectedCount) return;

 

    if (!clearClientSelectionBtn) {

 

        clearClientSelectionBtn = document.createElement("button");

        clearClientSelectionBtn.id = "clearClientSelectionBtn";

        clearClientSelectionBtn.type = "button";

        clearClientSelectionBtn.className = "action-btn text-btn";

        clearClientSelectionBtn.innerHTML = '<i class="fas fa-xmark"></i> Clear Selection';

        clearClientSelectionBtn.title = "Clear all selected clients";

        clearClientSelectionBtn.setAttribute("aria-label", "Clear all selected clients");

 

        bulkActionsBar.insertBefore(clearClientSelectionBtn, bulkDeleteBtn || null);

 

        clearClientSelectionBtn.addEventListener("click", (e) => {

            e.preventDefault();

            e.stopPropagation();

            window.clearClientSelection();

        });

    }

}

 

 

 

// Checkbox clicks must never fall through to table row actions.

if (clientTrackerTableBody) {

    clientTrackerTableBody.addEventListener("click", (e) => {

        if (e.target.closest(".client-row-checkbox")) {

            e.stopImmediatePropagation();

        }

    }, true);

}

 

// Individual row checkboxes — delegated so newly-rendered rows work with no

// extra wiring per render.

 

if (clientTrackerTableBody) {

 

    clientTrackerTableBody.addEventListener("change", (e) => {

 

        const checkbox = e.target.closest(".client-row-checkbox");

 

        if (!checkbox) return;

 

        const projectId = checkbox.getAttribute("data-project-id");

 

        if (checkbox.checked) {

 

            selectedClientIds.add(projectId);

 

        } else {

 

            selectedClientIds.delete(projectId);

 

        }

 

        const query = (clientSearchInput?.value || "").trim().toLowerCase();

 

        const filtered = query

 

            ? cachedClientDocs.filter(item => (item.data.coupleName || "").toLowerCase().includes(query))

 

            : cachedClientDocs;

 

        syncSelectAllCheckboxState(filtered.slice(0, visibleClientCount));

 

        updateBulkActionsBar();

 

    });

 

}

 

 

 

if (selectAllClientsCheckbox) {

 

    selectAllClientsCheckbox.addEventListener("change", () => {

 

        if (!clientTrackerTableBody) return;

 

        const wantChecked = selectAllClientsCheckbox.checked;

 

        clientTrackerTableBody.querySelectorAll(".client-row-checkbox").forEach(cb => {

 

            cb.checked = wantChecked;

 

            const projectId = cb.getAttribute("data-project-id");

 

            if (wantChecked) selectedClientIds.add(projectId);

 

            else selectedClientIds.delete(projectId);

 

        });

 

        selectAllClientsCheckbox.indeterminate = false;

 

        updateBulkActionsBar();

 

    });

 

}

 

 

 

// Read-only access for DSB.js (backend) to know what's selected when the

 

// photographer clicks a bulk action button — this file owns the selection

 

// state, DSB.js never touches selectedClientIds directly.

 

window.getSelectedClientIds = () => Array.from(selectedClientIds);

 

ensureBulkClearButton();

 

 

 

// DSB.js calls this after a bulk action finishes (success or partial

 

// failure) so the checkboxes and bar reset to a clean state.

 

window.clearClientSelection = () => {

 

    selectedClientIds.clear();

 

    if (selectAllClientsCheckbox) {

        selectAllClientsCheckbox.checked = false;

        selectAllClientsCheckbox.indeterminate = false;

    }

 

    renderClientTrackerFromCache();

};

 

 

 

window.removeClientSelection = (projectId) => {

 

    if (!projectId) return;

 

    selectedClientIds.delete(String(projectId));

 

    const checkboxes = clientTrackerTableBody

        ? clientTrackerTableBody.querySelectorAll(".client-row-checkbox")

        : [];

 

    checkboxes.forEach(cb => {

        if (cb.getAttribute("data-project-id") === String(projectId)) {

            cb.checked = false;

        }

    });

 

    const query = (clientSearchInput?.value || "").trim().toLowerCase();

 

    const filtered = query

        ? cachedClientDocs.filter(item => (item.data.coupleName || "").toLowerCase().includes(query))

        : cachedClientDocs;

 

    syncSelectAllCheckboxState(filtered.slice(0, visibleClientCount));

    updateBulkActionsBar();

};

 

 

 

// Entry point DSB.js calls whenever Firestore data (or the active client)

 

// changes. This file remembers the values so search/load-more can re-render

 

// without going back to DSB.js.

 

function renderClientTrackerTable(docs, activeProjectId) {

 

    cachedClientDocs = docs || [];

 

    cachedActiveProjectId = activeProjectId || null;

 

 

 

    // Drop any selected id that no longer exists (deleted elsewhere, or by

 

    // this same bulk action) — keeps the bar's count honest.

 

    const liveIds = new Set(cachedClientDocs.map(item => item.id));

 

    selectedClientIds.forEach(id => { if (!liveIds.has(id)) selectedClientIds.delete(id); });

 

 

 

    renderClientTrackerFromCache();

 

}

 

window.renderClientTrackerTable = renderClientTrackerTable;

 

 

 

if (clientSearchInput) {

 

    clientSearchInput.addEventListener("input", () => {

 

        visibleClientCount = CLIENT_PAGE_SIZE; // fresh search always starts back at 10

 

        renderClientTrackerFromCache();

 

    });

 

}

 

 

 

if (loadMoreClientsBtn) {

 

    loadMoreClientsBtn.addEventListener("click", () => {

 

        visibleClientCount += CLIENT_PAGE_SIZE;

 

        renderClientTrackerFromCache();

 

    });

 

}