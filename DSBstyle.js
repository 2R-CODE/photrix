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



document.getElementById('browseFilesBtn').addEventListener('click', function() {
    document.getElementById('realFileInput').click();
});

// Jab file select ho jaye, toh 'Start Cloud Upload' button dikhaye
document.getElementById('realFileInput').addEventListener('change', function() {
    if(this.files.length > 0) {
        document.getElementById('startCloudUploadBtn').style.display = 'inline-block';
    }
});

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
    });
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
        if (e.target.closest("button")) return; // action buttons stay DSB.js's job

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