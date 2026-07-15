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

// ==========================================================================
// ⭐ FIXED: SIDEBAR TOGGLE LOGIC (Desktop collapse + Mobile slide-in)
// Pehle ye "sidebarToggleBtn" aur "studioSidebar" IDs dhoondh raha tha,
// jabki HTML me actual IDs "testToggleBtn" aur "testSidebar" hain.
// Isi mismatch ki wajah se button kaam hi nahi kar raha tha.
// ==========================================================================
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