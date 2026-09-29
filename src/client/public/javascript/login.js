// Login: capture the username, stash it for the rest of the session, and head
// to the lobby.
//
// No socket is opened here on purpose. Every page in this app is a full reload,
// so a socket created on the login page would be torn down the instant we
// navigate away. Identity is carried across that boundary in sessionStorage;
// later pages read the username back out and identify themselves to the server
// on their own connection.

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