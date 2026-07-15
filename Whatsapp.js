document.addEventListener("DOMContentLoaded", function () {
    
    const dropdown = document.getElementById('luxuryDropdown');
    if (dropdown) {
        const selectedVal = dropdown.querySelector('.dropdown-selected-val');
        const hiddenInput = document.getElementById('role');
        const optionsList = dropdown.querySelectorAll('.luxury-option');

        selectedVal.addEventListener('click', function (e) {
            e.stopPropagation();
            dropdown.classList.toggle('open');
        });

        
        optionsList.forEach(option => {
            option.addEventListener('click', function (e) {
                e.stopPropagation();
                const text = this.textContent;
                const value = this.getAttribute('data-value');
                
                selectedVal.textContent = text; 
                hiddenInput.value = value;
                
                optionsList.forEach(opt => opt.classList.remove('active'));
                this.classList.add('active');
                
                dropdown.classList.remove('open');
            });
        });

        // Close dropdown when clicking outside anywhere on screen
        document.addEventListener('click', function () {
            dropdown.classList.remove('open');
        });
    }

    // --- 📞 2. ORIGINAL WHATSAPP FORM SUBMIT ENGINE ---
    const orderForm = document.getElementById("orderForm");

    if (orderForm) {
        orderForm.addEventListener("submit", function (e) {
            e.preventDefault();

            // Data input fields se nikaalo
            const name = document.getElementById("name").value.trim();
            const phone = document.getElementById("phone").value.trim();
            const role = document.getElementById("role").value;
            const message = document.getElementById("message").value.trim();
            const myWhatsAppNumber = "919265536548"; 

            
            const textMessage = `*🔥 New Inquiry Received on PHOTRIX!* \n\n` +
                                `Name: ${name}\n` +
                                `WhatsApp: ${phone}\n` +
                                `Role: ${role === "photographer" ? "Professional Studio/Photographer" : "Wedding Couple (Direct Lead)"}\n` +
                                `Message: ${message}\n\n` +
                                `_Sent automatically via website platform._`;

            // Message ko URL compatible banao
            const encodedMessage = encodeURIComponent(textMessage);

            // URL string ready karo
            const whatsappUrl = `https://wa.me/${myWhatsAppNumber}?text=${encodedMessage}`;

            // User ko naye window tab par bhej do
            window.open(whatsappUrl, "_blank");
            
            // Form ko clear kar do aur dropdown display reset karo
            orderForm.reset();
            if (dropdown) {
                dropdown.querySelector('.dropdown-selected-val').textContent = "Professional Photographer / Studio";
                document.getElementById('role').value = "photographer";
                dropdown.querySelectorAll('.luxury-option').forEach(opt => opt.classList.remove('active'));
                dropdown.querySelectorAll('.luxury-option')[0].classList.add('active');
            }
        });
    }
});