(function () {
    const currentUser = document.getElementById('current-user');
    const usernameForm = document.getElementById('username-form');
    const usernameInput = document.getElementById('username');
    const usernameStatus = document.getElementById('username-status');
    const usernameSubmit = document.getElementById('username-submit');
    const lobbyControls = document.getElementById('lobby-controls');
    const createRoomLink = document.getElementById('create-room-link');
    const roomList = document.getElementById('room-list');
    const emptyRoomState = document.getElementById('empty-room-state');
    const joinWithCodeButton = document.getElementById('join-with-code-button');
    const roomCodeInput = document.getElementById('room-code');
    const joinStatus = document.getElementById('join-status');

    function createBadge(label, kind) {
        const badge = document.createElement('span');
        badge.className = `pill ${kind}`;
        badge.textContent = label;
        return badge;
    }

    function renderRooms({ rooms }) {
        roomList.innerHTML = '';

        if (rooms.length === 0) {
            emptyRoomState.hidden = false;
            emptyRoomState.querySelector('p').textContent = 'No active rooms yet.';
            return;
        }

        emptyRoomState.hidden = true;

        for (const room of rooms) {
            const card = document.createElement('article');
            card.className = 'card room-card';

            const topRow = document.createElement('div');
            topRow.className = 'room-top';

            const heading = document.createElement('div');

            const title = document.createElement('h3');
            title.className = 'room-name';
            title.textContent = room.id;

            heading.append(title);

            // Private rooms keep their code secret (the server sends null).
            if (room.code) {
                const code = document.createElement('p');
                code.className = 'meta-line';
                code.textContent = `Code ${room.code}`;
                heading.append(code);
            }

            const badgeKind = room.isPublic ? 'public' : 'private';
            const visibilityBadge = createBadge(badgeKind, badgeKind);

            topRow.append(heading, visibilityBadge);

            const summary = document.createElement('div');
            summary.className = 'room-summary';

            const memberCount = document.createElement('span');
            memberCount.className = 'meta-line';
            let countText = `${room.playerCount} player${room.playerCount === 1 ? '' : 's'}`;
            if (room.spectatorCount > 0) {
                countText += `, ${room.spectatorCount} watching`;
            }
            memberCount.textContent = countText;

            const state = document.createElement('span');
            state.className = 'meta-line';
            state.textContent = room.state === 'game' ? 'Match in progress' : 'Waiting for players';

            summary.append(memberCount, state);

            const actions = document.createElement('div');
            actions.className = 'card-actions';

            // Always show the Spectate option for every room (public or private)
            const spectateButton = document.createElement('button');
            spectateButton.className = 'btn btn-secondary';
            spectateButton.type = 'button';
            spectateButton.textContent = 'Spectate';
            // Spectating works without a code: private rooms join by room id.
            spectateButton.addEventListener('click', () => joinRoom({ id: room.id, spectate: true }));
            actions.append(spectateButton);

            if (room.isPublic && room.state !== 'game') {
                const joinButton = document.createElement('button');
                joinButton.className = 'btn btn-primary';
                joinButton.type = 'button';
                joinButton.textContent = 'Join game';
                joinButton.addEventListener('click', () => joinRoom({ code: room.code }));

                actions.append(joinButton);
            }

            card.append(topRow, summary, actions);
            roomList.append(card);
        }
    }

    async function joinRoom({ code = null, id = null, spectate = false }) {
        const response = await socket.emitWithAck('room:join', { code, id, spectate });

        if (!response.success) {
            joinStatus.textContent = 'That room does not exist!';
            return;
        }

        // Full rooms and running matches come back as spectator joins:
        // straight to the pitch if the match is on, else watch the lobby.
        if (response.spectator && response.started) {
            navigateTo('/pitch');
        } else {
            navigateTo('/pregame');
        }
    }

    async function joinRoomByCode() {
        const code = roomCodeInput ? roomCodeInput.value.trim() : '';

        if (!code) {
            if (joinStatus) {
                joinStatus.textContent = 'Enter a room code first.';
            }

            return;
        }

        await joinRoom({ code });
    }

    function activateLobby(username) {
        sessionStorage.setItem('username', username);
        currentUser.textContent = `Welcome, ${username}`;
        lobbyControls.hidden = false;
        createRoomLink.classList.remove('is-disabled');
        createRoomLink.removeAttribute('aria-disabled');
        createRoomLink.removeAttribute('tabindex');
        roomCodeInput.disabled = false;
        joinWithCodeButton.disabled = false;

        window.connectSocket(username);
        socket.off('rooms:update', renderRooms);
        socket.on('rooms:update', renderRooms);
        socket.emit('rooms:update');
    }

    usernameForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const username = usernameInput.value.trim();
        const savedUsername = sessionStorage.getItem('username');
        usernameStatus.textContent = '';

        if (!username) {
            usernameStatus.textContent = 'Enter a username to continue.';
            usernameInput.focus();
            return;
        }

        usernameSubmit.disabled = true;
        try {
            if (username !== savedUsername) {
                const response = await fetch(`/username-exists?username=${encodeURIComponent(username)}`);
                const result = await response.json();
                if (result.exists) {
                    usernameStatus.textContent = 'That username is already taken. Choose another.';
                    usernameInput.focus();
                    return;
                }
            }

            activateLobby(username);

            const code = new URLSearchParams(location.search).get('code');
            if (code !== null) {
                navigateTo(`/pregame?code=${encodeURIComponent(code)}`);
            }
        } catch (error) {
            usernameStatus.textContent = 'Could not check that username. Try again.';
        } finally {
            usernameSubmit.disabled = false;
        }
    });

    const savedUsername = sessionStorage.getItem('username');
    if (savedUsername) {
        usernameInput.value = savedUsername;
        activateLobby(savedUsername);

        const code = new URLSearchParams(location.search).get('code');
        if (code !== null) {
            navigateTo(`/pregame?code=${encodeURIComponent(code)}`);
        }
    }

    joinWithCodeButton.addEventListener('click', joinRoomByCode);

    roomCodeInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            joinRoomByCode();
        }
    });

    // Room codes are lowercase a-z only: normalize on every keystroke.
    roomCodeInput.addEventListener('input', () => {
        const filtered = roomCodeInput.value.toLowerCase().replace(/[^a-z]/g, '');
        if (roomCodeInput.value !== filtered) {
            roomCodeInput.value = filtered;
        }
    });

    window.cleanupView = () => {
        if (socket) {
            socket.off('rooms:update', renderRooms);
        }
    };
})();