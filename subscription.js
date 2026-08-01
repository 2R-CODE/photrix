// 💳 SUBSCRIPTION TAB MODULE (`subscription.js`)
// Mirrors themes.js's pattern: a self-contained module loaded after DSB.js,
// relying on DSB.js's globals (db, currentUid, getTrialDaysLeft) which are
// available in shared script scope. No Firebase writes happen here — plan
// purchases go through WhatsApp + manual verification (see index.js notes),
// so this file only ever reads and renders.

// PLAN TOGGLE — Pattern 5: one card, toggle swaps its content.
// Pure UI, no Firebase — mirrors the mobile client-list accordion pattern
// already used in DSBstyle.js (self-contained, re-queries its own DOM).
document.addEventListener("DOMContentLoaded", () => {
    const toggleBtns = document.querySelectorAll(".plan-toggle-btn");
    const contents = document.querySelectorAll(".plan-content");
    const card = document.querySelector(".plan-single-card");
    if (!toggleBtns.length || !card) return;

    toggleBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const plan = btn.getAttribute("data-plan");

            toggleBtns.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");

            contents.forEach((c) => {
                c.classList.toggle("active", c.getAttribute("data-plan-content") === plan);
            });

            card.classList.toggle("is-growth", plan === "growth");
        });
    });
});

function updateSubscriptionUI() {
    if (!currentUid) return;
    db.collection("users").doc(currentUid).get().then((doc) => {
        if (!doc.exists) return;
        const data = doc.data();

        const planNameEl = document.getElementById("currentPlanName");
        const statusTextEl = document.getElementById("subscriptionStatusText");

        if (data.subscriptionStatus === "active") {
            if (planNameEl) planNameEl.innerText = data.planName || "Active Plan";
            if (statusTextEl) {
                statusTextEl.innerText = "✅ Your subscription is active.";
                statusTextEl.style.color = "#15803d";
            }
        } else {
            const daysLeft = getTrialDaysLeft(data);

            if (planNameEl) planNameEl.innerText = "Free Trial";
            if (statusTextEl) {
                if (daysLeft > 0) {
                    statusTextEl.innerText = `⏳ ${daysLeft} day(s) left in your free trial.`;
                    statusTextEl.style.color = "";
                } else {
                    statusTextEl.innerText = "❌ Your trial has ended. Please subscribe to continue adding clients.";
                    statusTextEl.style.color = "#ef4444";
                }
            }
            const banner = document.getElementById("trialStatusBanner");
            if (banner) {
                banner.innerText = daysLeft > 0
                    ? `Your free trial has ${daysLeft} day(s) remaining.`
                    : "Your 7-day free trial has ended. Subscribe to keep adding new clients.";
            }
        }
    }).catch(err => console.error("Subscription UI error:", err));
}