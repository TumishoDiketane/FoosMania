(function () {
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

    socket.on('rooms:update', renderRooms);
    socket.emit('rooms:update'); // request initial list of rooms

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
        socket.off('rooms:update');
    };
})();