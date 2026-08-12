// 💳 PREMIUM SUBSCRIPTION TAB MODULE (`subscription.js`)

document.addEventListener("DOMContentLoaded", () => {
    // Custom logic for FAQ smooth toggling (Optional but feels premium)
    const faqs = document.querySelectorAll('.payment-faq-item');
    faqs.forEach(faq => {
        faq.addEventListener('click', (e) => {
            // Close other open FAQs
            faqs.forEach(otherFaq => {
                if (otherFaq !== faq && otherFaq.hasAttribute('open')) {
                    otherFaq.removeAttribute('open');
                }
            });
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
                statusTextEl.innerHTML = "<i class='fas fa-check-circle' style='margin-right:6px;'></i>Your subscription is active and running smoothly.";
                statusTextEl.style.color = "#4ade80"; // Premium neon green
            }
        } else {
            const daysLeft = getTrialDaysLeft(data);

            if (planNameEl) planNameEl.innerText = "Free Trial";
            if (statusTextEl) {
                if (daysLeft > 0) {
                    statusTextEl.innerHTML = `<i class='fas fa-hourglass-half' style='margin-right:6px;'></i>${daysLeft} day(s) left in your free trial.`;
                    statusTextEl.style.color = "#fbbf24"; // Premium warning yellow
                } else {
                    statusTextEl.innerHTML = "<i class='fas fa-exclamation-circle' style='margin-right:6px;'></i>Your trial has ended. Subscribe below to continue.";
                    statusTextEl.style.color = "#f87171"; // Premium soft red
                }
            }
            const banner = document.getElementById("trialStatusBanner");
            if (banner) {
                banner.style.display = daysLeft <= 0 ? "block" : "none";
                banner.innerText = "⏳ Your 7-day free trial has ended. Upgrade to keep adding new clients.";
            }
        }
    }).catch(err => console.error("Subscription UI error:", err));
}