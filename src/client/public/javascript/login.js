/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Validate and store the username for the session, then route into
 * the lobby or a room code without opening a short-lived socket.
 */

(function () {
    // Shared contract: other pages read the username from this same key.
    const STORAGE_KEY = "username";

    // Extensionless Express route (not "home.html", which the server won't serve).
    const REDIRECT_TO = "/home";

    const form = document.querySelector(".form-grid");
    const usernameInput = document.getElementById("username");

    if (!form || !usernameInput) {
        return;
    }

    usernameInput.addEventListener("input", () => {
        if (usernameInput.validity.valueMissing) {
            usernameInput.setCustomValidity("Please enter a username.");
        } else {
            usernameInput.setCustomValidity("");
        }

        fetch("/username-exists?username=" + encodeURIComponent(usernameInput.value))
            .then(async (response) => {
                const data = await response.json();

                // Styled inline message next to the field (no browser popups).
                const message = document.getElementById("validation-message");
                message.textContent = data.exists
                    ? "This username is already taken. Please choose a different one."
                    : "";
                message.classList.toggle("visible", data.exists);
                usernameInput.classList.toggle("is-invalid", data.exists);

                if (!data.exists) {
                    usernameInput.setCustomValidity("");
                }

                document.getElementById("submit-button").disabled = data.exists;
            });
    });

    form.addEventListener("submit", function (event) {
        event.preventDefault();

        const username = usernameInput.value.trim();

        sessionStorage.setItem(STORAGE_KEY, username);

        const code = new URLSearchParams(location.search).get("code");

        if (code !== null) {
            window.location.href = `/pregame?code=${code}`;
            return;
        }

        window.location.href = REDIRECT_TO;
    });
})();

// Enter button stays disabled until a username is typed
function initEnterButtonGate() {
    const usernameInput = document.getElementById('username');
    const enterButton = document.querySelector('.enter-btn');
    if (!usernameInput || !enterButton) return;

    usernameInput.maxLength = 25; // hard cap of 25 characters

    const sync = () => {
        enterButton.disabled = usernameInput.value.trim().length === 0;
    };

    sync(); // disabled on load — the field starts empty
    usernameInput.addEventListener('input', sync);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEnterButtonGate);
} else {
    initEnterButtonGate();
}