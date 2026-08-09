// ==========================================================================
// ✨ SCROLL-REVEAL — fade + rise elements in as they enter the viewport.
// One-time reveal (unobserves after showing) so it never re-triggers on
// scrolling back up, which would feel gimmicky instead of premium.
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    const revealTargets = document.querySelectorAll(
        '.section-title, .section-subtitle, .service-card, .showcase-tabs-wrapper, ' +
        '.showcase-mockup-frame, .step-item, #pricing .plan-single-card, #book .form-container'
    );

    if (!revealTargets.length) return;

    revealTargets.forEach(el => el.classList.add('reveal-up'));

    if (!('IntersectionObserver' in window)) {
        // Old browser fallback — just show everything, no animation.
        revealTargets.forEach(el => el.classList.add('in-view'));
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    revealTargets.forEach(el => observer.observe(el));
});

// ==========================================================================
// 🌐 NAVBAR SCROLL STATE
// ==========================================================================
window.addEventListener('scroll', function () {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    if (window.scrollY > 60) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// ==========================================================================
// 🎛️ INTERACTIVE TABS — PRODUCT SHOWCASE ("Ultimate Digital Canvas")
// ==========================================================================
window.switchShowcaseTab = function (buttonElement, tabId) {
    const allButtons = document.querySelectorAll('.showcase-tab-btn');
    allButtons.forEach(btn => btn.classList.remove('active'));
    buttonElement.classList.add('active');

    const allPanels = document.querySelectorAll('.tab-content-panel');
    allPanels.forEach(panel => panel.classList.remove('active'));

    const targetPanel = document.getElementById(tabId);
    if (targetPanel) {
        targetPanel.classList.add('active');
    }
};

// ==========================================================================
// ✨ HOW IT WORKS — INTERACTIVE STEP SHOWCASE
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    const stepItems = document.querySelectorAll('.step-item');
    const visualContents = document.querySelectorAll('.visual-content');

    if (stepItems.length > 0 && visualContents.length > 0) {
        stepItems.forEach(item => {
            item.addEventListener('mouseenter', () => {
                stepItems.forEach(i => i.classList.remove('active'));
                visualContents.forEach(v => v.classList.remove('active'));
                item.classList.add('active');

                const stepNum = item.getAttribute('data-step');
                const targetVisual = document.getElementById(`visual-${stepNum}`);
                if (targetVisual) {
                    targetVisual.classList.add('active');
                }
            });
        });
    }
});