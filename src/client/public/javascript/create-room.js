// Create-room: send the form's room name + visibility to the server over the
// shared socket (see socket.js), then follow the creator into the pregame
// (waiting) screen.
(function () {
    const form = document.querySelector(".form-grid");
    const nameInput = document.getElementById("room-name");
    const visibilityInput = document.getElementById("room-visibility");
    const submitButton = form ? form.querySelector('button[type="submit"]') : null;
    const statusLabel = document.getElementById("create-status");

    if (!form || !nameInput || !visibilityInput) {
        return;
    }

    function showStatus(message) {
        if (statusLabel) {
            statusLabel.textContent = message;
        }
    }

    let creating = false;

    // Public/private toggle buttons write into the hidden #room-visibility
    // input the submit handler already reads.
    const toggleButtons = Array.from(document.querySelectorAll(".visibility-toggle .toggle-btn"));
    for (const button of toggleButtons) {
        button.addEventListener("click", () => {
            visibilityInput.value = button.dataset.visibility;
            for (const other of toggleButtons) {
                other.classList.toggle("is-active", other === button);
            }
        });
    }

    nameInput.addEventListener("input", () => {
        // Room names are lowercase a-z and hyphens only, max 15 chars.
        let filtered = nameInput.value.toLowerCase().replace(/[^a-z-]/g, "").slice(0, 15);
        if (nameInput.value !== filtered) {
            nameInput.value = filtered;
        }

        if (nameInput.validity.valueMissing) {
            nameInput.setCustomValidity("Please enter a room name.");
        } else {
            nameInput.setCustomValidity("");
        }
    });

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (creating) return;

        const roomName = nameInput.value.trim();

        creating = true;
        submitButton.disabled = true;

        showStatus("Creating room...");

        const response = await socket.emitWithAck("room:create", {
            id: roomName,
            isPublic: visibilityInput.value === 'public',
        });

        if (response.success) {
            navigateTo("/pregame");
        } else {
            showStatus("Room already exists. Please choose a different name.");
        }

        creating = false;
        submitButton.disabled = false;
    });

    window.cleanupView = function () { }
})();
