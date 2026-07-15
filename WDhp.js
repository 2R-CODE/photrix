// (Scroll Detection)
window.addEventListener('scroll', function() {
    const navbar = document.querySelector('.navbar');
    
    // scroll position 60px 
    if (window.scrollY > 60) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// ==========================================================================
// 🎛️ INTERACTIVE TABS FUNCTIONALITY FOR PRODUCT SHOWCASE
// ==========================================================================
window.switchShowcaseTab = function(buttonElement, tabId) {
    // 1. Saare tab buttons se 'active' class hatao
    const allButtons = document.querySelectorAll('.showcase-tab-btn');
    allButtons.forEach(btn => btn.classList.remove('active'));

    // 2. Jis button par click hua hai, use 'active' karo
    buttonElement.classList.add('active');

    // 3. Saare content panels ko chhupao (hide karo)
    const allPanels = document.querySelectorAll('.tab-content-panel');
    allPanels.forEach(panel => panel.classList.remove('active'));

    // 4. Jo selected tab id hai, sirf uske panel ko dikhao (show karo)
    const targetPanel = document.getElementById(tabId);
    if (targetPanel) {
        targetPanel.classList.add('active');
    }
}
// showcase
document.addEventListener("DOMContentLoaded", () => {
    const gridDataEngine = [
        {
            title: "Luxury Weddings",
            images: [
                "https://images.unsplash.com/photo-1519741497674-611481863552?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1606800052052-a08af7148866?w=600&auto=format&fit=crop&q=80"
            ]
        },
        {
            title: "Pre-Wedding & Teasers",
            images: [
                "https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1519225495810-7512c696505a?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1510076857177-7470066aa48b?w=600&auto=format&fit=crop&q=80"
            ]
        },
        {
            title: "Royal Engagements",
            images: [
                "https://images.unsplash.com/photo-1583939003579-730e3918a45a?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1507504038482-76214382c54c?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1607190074257-dd4b7af0309f?w=600&auto=format&fit=crop&q=80"
            ]
        },
        {
            title: "Fashion & Portraits",
            images: [
                "https://images.unsplash.com/photo-1532712938310-34cb3982ef74?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&auto=format&fit=crop&q=80"
            ]
        }
    ];

    let currentMasterIndex = 0;
    const isMobile = () => window.innerWidth <= 768;

    const headingNode = document.getElementById("triple-showcase-title");
    const gridContainerNode = document.getElementById("triple-media-wrapper");
    const paginationDots = document.querySelectorAll(".triple-dot");
    
    // Select desktop control nodes safely
    const prevBtn = document.querySelector(".prev-triple");
    const nextBtn = document.querySelector(".next-triple");

    function initShowcaseSystem() {
        if (isMobile()) {
            let mobileHTML = "";
            gridDataEngine.forEach((cat) => {
                cat.images.forEach((imgUrl) => {
                    mobileHTML += `
                        <div class="triple-luxury-card-frame">
                            <div class="triple-card-ratio-box">
                                <img src="${imgUrl}" alt="Gallery Frame">
                            </div>
                        </div>`;
                });
            });
            gridContainerNode.innerHTML = mobileHTML;
            updateTitleAndDots(0);
        } else {
            renderDesktopCategory(currentMasterIndex);
        }
    }

    function updateTitleAndDots(categoryIndex) {
        if (headingNode && headingNode.textContent !== gridDataEngine[categoryIndex].title) {
            headingNode.style.opacity = "0";
            setTimeout(() => {
                headingNode.textContent = gridDataEngine[categoryIndex].title;
                headingNode.style.opacity = "1";
            }, 100);
        }
        paginationDots.forEach((dot, idx) => {
            dot.classList.toggle("active", idx === categoryIndex);
        });
    }

    function renderDesktopCategory(index) {
        currentMasterIndex = index;
        const currentData = gridDataEngine[currentMasterIndex];
        gridContainerNode.innerHTML = `
            <div class="triple-luxury-card-frame"><div class="triple-card-ratio-box"><img src="${currentData.images[0]}" alt="Frame 1"></div></div>
            <div class="triple-luxury-card-frame"><div class="triple-card-ratio-box"><img src="${currentData.images[1]}" alt="Frame 2"></div></div>
            <div class="triple-luxury-card-frame"><div class="triple-card-ratio-box"><img src="${currentData.images[2]}" alt="Frame 3"></div></div>
        `;
        updateTitleAndDots(currentMasterIndex);
    }

    // 🚀 DESKTOP NAVIGATION INTERACTION LOGIC
    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            if (isMobile()) return; // Disables loop on native mobile scroll track
            let nextIndex = (currentMasterIndex + 1) % gridDataEngine.length;
            renderDesktopCategory(nextIndex);
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            if (isMobile()) return;
            let prevIndex = (currentMasterIndex - 1 + gridDataEngine.length) % gridDataEngine.length;
            renderDesktopCategory(prevIndex);
        });
    }

    // 🔘 DESKTOP DOTS INTERACTION LOGIC
    paginationDots.forEach((dot, idx) => {
        dot.addEventListener("click", () => {
            if (isMobile()) {
                // Smooth scrolls to the targeted card group on mobile view
                const card = gridContainerNode.querySelector('.triple-luxury-card-frame');
                if (!card) return;
                const cardWidth = card.clientWidth + 16;
                gridContainerNode.scrollTo({
                    left: idx * 3 * cardWidth,
                    behavior: "smooth"
                });
            } else {
                renderDesktopCategory(idx);
            }
        });
    });

    // Mobile Dynamic Scroll Mapping
    let scrollTimeout;
    if (gridContainerNode) {
        gridContainerNode.addEventListener("scroll", () => {
            if (!isMobile()) return;
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                const scrollLeft = gridContainerNode.scrollLeft;
                const card = gridContainerNode.querySelector('.triple-luxury-card-frame');
                if (!card) return;

                const cardWidth = card.clientWidth + 16;
                const currentCardIndex = Math.round(scrollLeft / cardWidth);
                const computedCategory = Math.floor(currentCardIndex / 3);

                if (computedCategory >= 0 && computedCategory < gridDataEngine.length) {
                    updateTitleAndDots(computedCategory);
                }
            }, 15);
        });
    }

    window.addEventListener("resize", () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(initShowcaseSystem, 100);
    });

    initShowcaseSystem();
});

/* ==========================================================================
   ✨ ETERNAL MEMORIES - HOW IT WORKS INTERACTIVE SHOWCASE LOGIC
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
    const stepItems = document.querySelectorAll('.step-item');
    const visualContents = document.querySelectorAll('.visual-content');

    if (stepItems.length > 0 && visualContents.length > 0) {
        stepItems.forEach(item => {
            item.addEventListener('mouseenter', () => {
                // 1. Sabhi text steps se active class remove karo
                stepItems.forEach(i => i.classList.remove('active'));
                
                // 2. Sabhi right-side visual containers se active class hatao
                visualContents.forEach(v => v.classList.remove('active'));
                
                // 3. Current hovered step ko active karo
                item.classList.add('active');
                
                // 4. Data attribute se step number nikaal kar sahi visual block toggle karo
                const stepNum = item.getAttribute('data-step');
                const targetVisual = document.getElementById(`visual-${stepNum}`);
                
                if (targetVisual) {
                    targetVisual.classList.add('active');
                }
            });
        });
    }
});
// ==========================================================================
// 🎛️ INTERACTIVE TABS FUNCTIONALITY FOR PRODUCT SHOWCASE
// ==========================================================================
function switchShowcaseTab(buttonElement, tabId) {
    // 1. Saare tab buttons se 'active' class hatao
    const allButtons = document.querySelectorAll('.showcase-tab-btn');
    allButtons.forEach(btn => btn.classList.remove('active'));

    // 2. Jis button par click hua hai, use 'active' karo
    buttonElement.classList.add('active');

    // 3. Saare content panels ko chhupao (hide karo)
    const allPanels = document.querySelectorAll('.tab-content-panel');
    allPanels.forEach(panel => panel.classList.remove('active'));

    // 4. Jo selected tab id hai, sirf uske panel ko dikhao (show karo)
    const targetPanel = document.getElementById(tabId);
    if (targetPanel) {
        targetPanel.classList.add('active');
    }
}
// showcase
document.addEventListener("DOMContentLoaded", () => {
    const gridDataEngine = [
        {
            title: "Luxury Weddings",
            images: [
                "https://images.unsplash.com/photo-1519741497674-611481863552?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1606800052052-a08af7148866?w=600&auto=format&fit=crop&q=80"
            ]
        },
        {
            title: "Pre-Wedding & Teasers",
            images: [
                "https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1519225495810-7512c696505a?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1510076857177-7470066aa48b?w=600&auto=format&fit=crop&q=80"
            ]
        },
        {
            title: "Royal Engagements",
            images: [
                "https://images.unsplash.com/photo-1583939003579-730e3918a45a?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1507504038482-76214382c54c?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1607190074257-dd4b7af0309f?w=600&auto=format&fit=crop&q=80"
            ]
        },
        {
            title: "Fashion & Portraits",
            images: [
                "https://images.unsplash.com/photo-1532712938310-34cb3982ef74?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&auto=format&fit=crop&q=80",
                "https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&auto=format&fit=crop&q=80"
            ]
        }
    ];

    let currentMasterIndex = 0;
    const isMobile = () => window.innerWidth <= 768;

    const headingNode = document.getElementById("triple-showcase-title");
    const gridContainerNode = document.getElementById("triple-media-wrapper");
    const paginationDots = document.querySelectorAll(".triple-dot");
    
    // Select desktop control nodes safely
    const prevBtn = document.querySelector(".prev-triple");
    const nextBtn = document.querySelector(".next-triple");

    function initShowcaseSystem() {
        if (isMobile()) {
            let mobileHTML = "";
            gridDataEngine.forEach((cat) => {
                cat.images.forEach((imgUrl) => {
                    mobileHTML += `
                        <div class="triple-luxury-card-frame">
                            <div class="triple-card-ratio-box">
                                <img src="${imgUrl}" alt="Gallery Frame">
                            </div>
                        </div>`;
                });
            });
            gridContainerNode.innerHTML = mobileHTML;
            updateTitleAndDots(0);
        } else {
            renderDesktopCategory(currentMasterIndex);
        }
    }

    function updateTitleAndDots(categoryIndex) {
        if (headingNode && headingNode.textContent !== gridDataEngine[categoryIndex].title) {
            headingNode.style.opacity = "0";
            setTimeout(() => {
                headingNode.textContent = gridDataEngine[categoryIndex].title;
                headingNode.style.opacity = "1";
            }, 100);
        }
        paginationDots.forEach((dot, idx) => {
            dot.classList.toggle("active", idx === categoryIndex);
        });
    }

    function renderDesktopCategory(index) {
        currentMasterIndex = index;
        const currentData = gridDataEngine[currentMasterIndex];
        gridContainerNode.innerHTML = `
            <div class="triple-luxury-card-frame"><div class="triple-card-ratio-box"><img src="${currentData.images[0]}" alt="Frame 1"></div></div>
            <div class="triple-luxury-card-frame"><div class="triple-card-ratio-box"><img src="${currentData.images[1]}" alt="Frame 2"></div></div>
            <div class="triple-luxury-card-frame"><div class="triple-card-ratio-box"><img src="${currentData.images[2]}" alt="Frame 3"></div></div>
        `;
        updateTitleAndDots(currentMasterIndex);
    }

    // 🚀 DESKTOP NAVIGATION INTERACTION LOGIC
    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            if (isMobile()) return; // Disables loop on native mobile scroll track
            let nextIndex = (currentMasterIndex + 1) % gridDataEngine.length;
            renderDesktopCategory(nextIndex);
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            if (isMobile()) return;
            let prevIndex = (currentMasterIndex - 1 + gridDataEngine.length) % gridDataEngine.length;
            renderDesktopCategory(prevIndex);
        });
    }

    // 🔘 DESKTOP DOTS INTERACTION LOGIC
    paginationDots.forEach((dot, idx) => {
        dot.addEventListener("click", () => {
            if (isMobile()) {
                // Smooth scrolls to the targeted card group on mobile view
                const card = gridContainerNode.querySelector('.triple-luxury-card-frame');
                if (!card) return;
                const cardWidth = card.clientWidth + 16;
                gridContainerNode.scrollTo({
                    left: idx * 3 * cardWidth,
                    behavior: "smooth"
                });
            } else {
                renderDesktopCategory(idx);
            }
        });
    });

    // Mobile Dynamic Scroll Mapping
    let scrollTimeout;
    if (gridContainerNode) {
        gridContainerNode.addEventListener("scroll", () => {
            if (!isMobile()) return;
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                const scrollLeft = gridContainerNode.scrollLeft;
                const card = gridContainerNode.querySelector('.triple-luxury-card-frame');
                if (!card) return;

                const cardWidth = card.clientWidth + 16;
                const currentCardIndex = Math.round(scrollLeft / cardWidth);
                const computedCategory = Math.floor(currentCardIndex / 3);

                if (computedCategory >= 0 && computedCategory < gridDataEngine.length) {
                    updateTitleAndDots(computedCategory);
                }
            }, 15);
        });
    }

    window.addEventListener("resize", () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(initShowcaseSystem, 100);
    });

    initShowcaseSystem();
});

/* ==========================================================================
   ✨ ETERNAL MEMORIES - HOW IT WORKS INTERACTIVE SHOWCASE LOGIC
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    const stepItems = document.querySelectorAll('.step-item');
    const visualContents = document.querySelectorAll('.visual-content');

    if (stepItems.length > 0 && visualContents.length > 0) {
        stepItems.forEach(item => {
            item.addEventListener('mouseenter', () => {
                // 1. Sabhi text steps se active class remove karo
                stepItems.forEach(i => i.classList.remove('active'));
                
                // 2. Sabhi right-side visual containers se active class hatao
                visualContents.forEach(v => v.classList.remove('active'));
                
                // 3. Current hovered step ko active karo
                item.classList.add('active');
                
                // 4. Data attribute se step number nikaal kar sahi visual block toggle karo
                const stepNum = item.getAttribute('data-step');
                const targetVisual = document.getElementById(`visual-${stepNum}`);
                
                if (targetVisual) {
                    targetVisual.classList.add('active');
                }
            });
        });
    }
});