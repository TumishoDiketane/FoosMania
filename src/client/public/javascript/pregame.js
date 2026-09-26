// Pregame (waiting room): join the room's socket channel, render the live
// roster for each team, let the host start the game, tune match settings
// (goals, time limit, powerups, team countries) and manage players
// (kick / move team). Everyone else sees the settings read-only. Spectators
// (joined a full room) watch the lobby without team controls.
// Gameplay itself (pitch/player views) is out of scope here.
(async function () {
    const roomNameEl = document.getElementById("room-name");
    const roomCodeEl = document.getElementById("room-code");
    const hostPill = document.getElementById("host-pill");
    const roomStatus = document.getElementById("room-status");
    const copyCodeButton = document.getElementById("copy-code");
    const copyState = document.getElementById("copy-state");
    const startGameButton = document.getElementById("start-game-button");
    const leaveRoomButton = document.getElementById("leave-room-button");
    const unassignedSection = document.getElementById("unassigned-section");
    const unassignedPlayers = document.getElementById("unassigned-players");
    const spectatorList = document.getElementById("spectator-list");
    const spectatorsCount = document.getElementById("spectators-count");
    const spectatorJoinBtn = document.getElementById("spectator-join");
    const sessionCodeContainer = document.getElementById("session-code-container");
    const qrcodeEl = document.getElementById("qrcode");

    const settingsPanel = document.getElementById("settings-panel");
    const settingsLock = document.getElementById("settings-lock");
    const goalsInput = document.getElementById("setting-goals");
    const durationSelect = document.getElementById("setting-duration");
    const powerupsContainer = document.getElementById("setting-powerups");

    let roomCodeForCopying = null;
    let lastRenderedCode = null;
    let currentRoom = null; // latest room snapshot

    const teamEls = {
        'home': {
            card: document.querySelector('.team-card[data-team="1"]'),
            name: document.getElementById("team1-name"),
            count: document.getElementById("team1-count"),
            players: document.getElementById("team1-players"),
            join: document.getElementById("team1-join"),
            country: document.getElementById("team1-country"),
        },
        'away': {
            card: document.querySelector('.team-card[data-team="2"]'),
            name: document.getElementById("team2-name"),
            count: document.getElementById("team2-count"),
            players: document.getElementById("team2-players"),
            join: document.getElementById("team2-join"),
            country: document.getElementById("team2-country"),
        },
    };

    function hexToRgba(hex, alpha) {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // Tint a team card with the selected country's two kit colours: a
    // two-colour gradient for the top strip and the soft fills, and the
    // lighter colour for text. Falls back to the CSS red/blue when the
    // country has no kit entry.
    function applyTeamColors(card, country) {
        const kit = KITS[country];
        if (!kit) {
            for (const prop of ["--team-grad", "--team-soft", "--team-border", "--team-text"]) {
                card.style.removeProperty(prop);
            }
            return;
        }

        const [base, accent] = kit.colors;
        card.style.setProperty("--team-grad", `linear-gradient(90deg, ${base}, ${accent})`);
        card.style.setProperty("--team-soft", `linear-gradient(90deg, ${hexToRgba(base, 0.16)}, ${hexToRgba(accent, 0.16)})`);
        card.style.setProperty("--team-border", hexToRgba(base, 0.42));
        card.style.setProperty("--team-text", readableKitColor(kit));
    }

    // Country pickers: options come from the kit table (kits.js), the same
    // names the server validates against.
    for (const teamId of ['home', 'away']) {
        const select = teamEls[teamId].country;
        for (const country of Object.keys(KITS)) {
            const option = document.createElement("option");
            option.value = country;
            option.textContent = country;
            select.append(option);
        }
        select.addEventListener("change", () => {
            socket.emit("room:set-team-name", { team: teamId, country: select.value });
        });
    }

    const code = new URLSearchParams(location.search).get("code");

    if (code !== null) {
        const joinResponse = await socket.emitWithAck("room:join", { code });
        history.replaceState(null, "", "/pregame");

        // A full or already-playing room joins as spectator; if the match is
        // on, skip the lobby entirely.
        if (joinResponse.success && joinResponse.spectator && joinResponse.started) {
            navigateTo("/pitch");
            return;
        }
    }

    // ---- Settings --------------------------------------------------------

    function collectAndSendSettings() {
        const powerups = {};
        for (const row of powerupsContainer.querySelectorAll("[data-powerup]")) {
            powerups[row.dataset.powerup] = {
                enabled: row.querySelector("input[type=checkbox]").checked,
                spawnChance: Number(row.querySelector("input[type=range]").value),
            };
        }

        socket.emit("room:update-settings", {
            settings: {
                goalsToWin: Number(goalsInput.value),
                maxDurationSeconds: durationSelect.value === "" ? null : Number(durationSelect.value),
                powerups,
            },
        });
    }

    goalsInput.addEventListener("change", collectAndSendSettings);
    durationSelect.addEventListener("change", collectAndSendSettings);
    powerupsContainer.addEventListener("change", collectAndSendSettings);

    const goalsDisplay = document.getElementById("setting-goals-display");
    const durationDisplay = document.getElementById("setting-duration-display");
    const powerupsDisplayContainer = document.getElementById("setting-powerups-display");

    const DURATION_LABELS = { "": "No limit", "60": "1 minute", "120": "2 minutes", "180": "3 minutes", "300": "5 minutes", "600": "10 minutes" };

    function renderSettings(room, isHost) {
        settingsPanel.dataset.readonly = String(!isHost);
        settingsLock.textContent = isHost ? "" : "(set by host)";

        // While an input inside the panel is focused, skip re-rendering so
        // the host's in-progress edit isn't clobbered by our own echo.
        if (settingsPanel.contains(document.activeElement)) {
            return;
        }

        const settings = room.settings ?? {};
        const goalsVal = settings.goalsToWin ?? 5;
        const durationVal = settings.maxDurationSeconds == null ? "" : String(settings.maxDurationSeconds);

        goalsInput.value = goalsVal;
        durationSelect.value = durationVal;

        // Update read-only display chips
        goalsDisplay.textContent = `${goalsVal} goal${goalsVal === 1 ? "" : "s"}`;
        durationDisplay.textContent = DURATION_LABELS[durationVal] ?? durationVal;

        // Host editable powerups grid
        powerupsContainer.innerHTML = "";
        // Non-host readonly powerups pills grid
        powerupsDisplayContainer.innerHTML = "";

        for (const [id, config] of Object.entries(settings.powerups ?? {})) {
            // Host row — full controls
            const row = document.createElement("label");
            row.className = "setting-row";
            row.dataset.powerup = id;

            const name = document.createElement("span");
            name.className = "setting-label powerup-name";
            const dot = document.createElement("span");
            dot.className = "powerup-dot";
            dot.style.background = config.color ?? "#fff";
            name.append(dot, document.createTextNode(config.label ?? id));

            const controls = document.createElement("span");
            controls.className = "row-actions";
            const chance = document.createElement("input");
            chance.type = "range";
            chance.min = "0";
            chance.max = "1";
            chance.step = "0.05";
            chance.value = String(config.spawnChance ?? 0.25);
            chance.title = "Spawn chance";
            const enabled = document.createElement("input");
            enabled.type = "checkbox";
            enabled.checked = Boolean(config.enabled);
            controls.append(chance, enabled);

            row.append(name, controls);
            powerupsContainer.append(row);

            // Non-host pill
            const pill = document.createElement("span");
            pill.className = `powerup-pill${config.enabled ? " active" : ""}`;
            const pillDot = document.createElement("span");
            pillDot.className = "powerup-dot";
            pillDot.style.background = config.color ?? "#fff";
            pill.append(pillDot, document.createTextNode(config.label ?? id));
            powerupsDisplayContainer.append(pill);
        }
    }


    // ---- Roster ----------------------------------------------------------

    // entries: [userId, user][] so host buttons can target players.
    function renderPlayerList(container, entries, { isHost, team }) {
        container.innerHTML = "";

        if (entries.length == 0) {
            const empty = document.createElement("p");
            empty.className = "small-note";
            empty.textContent = "No players yet";
            container.append(empty);
            return;
        }

        for (const [userId, user] of entries) {
            const row = document.createElement("div");
            row.className = "player-row";

            const label = document.createElement("strong");
            label.textContent = user.username;
            row.append(label);

            // Host management: move to the other team / kick (never on self).
            if (isHost && userId !== socket.id) {
                const actions = document.createElement("span");
                actions.className = "row-actions";

                const move = document.createElement("button");
                move.type = "button";
                move.className = "row-btn";
                move.textContent = "Switch team";
                const otherTeam = team === "home" ? "away" : "home";
                move.addEventListener("click", () => {
                    socket.emit("room:move-player", { userId, team: otherTeam });
                });

                const kick = document.createElement("button");
                kick.type = "button";
                kick.className = "row-btn kick";
                kick.textContent = "Kick";
                kick.addEventListener("click", () => {
                    socket.emit("room:kick-player", { userId });
                });

                actions.append(move, kick);
                row.append(actions);
            }

            container.append(row);
        }
    }

    function renderSpectators(room) {
        const entries = Object.values(room.spectators ?? {});
        spectatorsCount.textContent = `${entries.length} spectator${entries.length === 1 ? "" : "s"}`;
        spectatorList.innerHTML = "";

        if (entries.length === 0) {
            const empty = document.createElement("p");
            empty.className = "small-note";
            empty.textContent = "No spectators yet";
            spectatorList.append(empty);
            return;
        }

        for (const spectator of entries) {
            const row = document.createElement("div");
            row.className = "player-row";
            const label = document.createElement("strong");
            label.textContent = `${spectator.username} 👁`;
            row.append(label);
            spectatorList.append(row);
        }
    }

    function renderRoom(room) {
        currentRoom = room;
        const isHost = room.hostUserId === socket.id;
        const localUser = room.users[socket.id];        // undefined for spectators
        const isSpectator = localUser == null;
        const isPrivate = !room.isPublic;

        roomNameEl.textContent = room.id;
        roomCodeEl.textContent = room.code;

        hostPill.hidden = !isHost;
        startGameButton.hidden = !isHost;

        // Hide session code & QR for spectators in private rooms — don't expose
        // the join mechanism to read-only viewers.
        const showCode = !(isSpectator && isPrivate);
        sessionCodeContainer.hidden = !showCode;
        if (!showCode) {
            qrcodeEl.innerHTML = "";
        }

        renderSettings(room, isHost);
        renderSpectators(room);

        const teamsEntries = { home: [], away: [] };
        for (const [userId, user] of Object.entries(room.users)) {
            if (teamsEntries[user.team]) {
                teamsEntries[user.team].push([userId, user]);
            }
        }

        const selfTeam = localUser?.team ?? null;

        for (const teamId of ['home', 'away']) {
            const els = teamEls[teamId];
            const entries = teamsEntries[teamId];

            els.name.textContent = room[`${teamId}TeamName`];
            els.count.textContent = `${entries.length} player${entries.length === 1 ? "" : "s"}`;
            applyTeamColors(els.card, room[`${teamId}TeamName`]);

            // The host picks countries from the dropdown; everyone else just
            // reads the heading.
            els.country.hidden = !isHost;
            if (isHost && document.activeElement !== els.country) {
                els.country.value = room[`${teamId}TeamName`];
            }

            renderPlayerList(els.players, entries, { isHost, team: teamId });

            const onThisTeam = selfTeam === teamId;

            if (isSpectator) {
                // Spectators can only join teams in public rooms with space
                const canJoin = !isPrivate && Object.keys(room.users).length < 20;
                els.join.hidden = false;
                els.join.disabled = !canJoin;
                els.join.textContent = canJoin ? "Join this team" : (isPrivate ? "Private game" : "Room full");
            } else {
                els.join.hidden = false;
                els.join.disabled = onThisTeam;
                els.join.textContent = onThisTeam ? "You're on this team" : "Join this team";
            }
        }

        // Spectate button: players can become spectators, spectators already are
        spectatorJoinBtn.hidden = isSpectator; // already spectating — hide
        if (!isSpectator) {
            spectatorJoinBtn.disabled = false;
            spectatorJoinBtn.textContent = "Become spectator";
        }

        if (isSpectator) {
            roomStatus.textContent = "You are spectating this room.";
        } else if (room.state === 'stats') {
            roomStatus.textContent = "The match has ended. Viewing statistics.";
        } else {
            roomStatus.textContent = "Players are split into two teams. Pick a side when you're ready.";
        }
    }

    // Guarded so the near-simultaneous game:started and room:update events
    // don't both trigger a navigation.
    function goToPitch() {
        if (window.location.pathname === "/pitch") return;
        navigateTo("/pitch");
    }

    function onKicked() {
        navigateTo("/home");
    }

    socket.on("game:started", goToPitch);
    socket.on("room:kicked", onKicked);

    socket.on("room:update", (data) => {
        const { room } = data;

        // Joined a room whose match is already running: straight to the pitch.
        if (room.state === "game") {
            goToPitch();
            return;
        }

        roomCodeForCopying = room.code;
        renderRoom(room);

        // Rebuilding the QR image on every roster change makes it blink:
        // only redraw when the code actually changes.
        const isSpectator = room.users[socket.id] == null;
        const isPrivate = !room.isPublic;
        const showCode = !(isSpectator && isPrivate);

        if (showCode && room.code !== lastRenderedCode) {
            lastRenderedCode = room.code;
            const link = `${window.location.origin}?code=${room.code}`;
            qrcodeEl.innerHTML = "";
            new QRCode(qrcodeEl, link);
        }
    });

    const roomUpdateResponse = await socket.emitWithAck("room:update", null); // request update

    copyCodeButton.addEventListener("click", async () => {
        if (roomCodeForCopying == null) return;

        await navigator.clipboard.writeText(roomCodeForCopying);
        copyState.textContent = "Copied!";

        setTimeout(() => {
            copyState.textContent = "";
        }, 1500);
    });

    teamEls.home.join.addEventListener("click", () => {
        socket.emit("room:change-team", { team: "home" });
    });
    teamEls.away.join.addEventListener("click", () => {
        socket.emit("room:change-team", { team: "away" });
    });

    spectatorJoinBtn.addEventListener("click", () => {
        socket.emit("room:change-team", { team: "spectator" });
    });

    leaveRoomButton.addEventListener("click", () => {
        socket.emit("room:leave", null);
        navigateTo("/home");
    });

    startGameButton.addEventListener("click", async () => {
        startGameButton.disabled = true;
        const response = await socket.emitWithAck("game:start", {});

        if (response.status !== "success") {
            startGameButton.disabled = false;
        }
        // On success everyone (host included) navigates via game:started.
    });

    window.cleanupView = () => {
        socket.off("room:update");
        socket.off("game:started", goToPitch);
        socket.off("room:kicked", onKicked);
    };

    if (!roomUpdateResponse.success) {
        navigateTo('/home');
    }
})();
