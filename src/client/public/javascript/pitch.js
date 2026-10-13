// The entire game experience: full zoomed-out pitch, always. Controlling a
// puck never zooms in — your selected puck gets a green circle, and input
// drives it directly from this view.
//
// SPA view: uses the shared `socket` / `username` globals (socket.js), the kit
// helpers (kits.js) and playSound (sounds.js), and registers window.cleanupView
// so navigating away stops the render loop, the move interval and all listeners.
//
// The server stays authoritative, but the puck YOU steer is rendered from a
// local prediction (same math and constants as the server tick), softly
// reconciled against every game:state snapshot — so your own input feels
// instant while everyone else's pucks render straight from the server.
//
// Controls:
//   - Tap one of your (ringed) pucks to select it.
//   - Mobile: tilt to move; while you hold the ball, drag from the puck to aim
//     and release to kick (flick the phone during the drag for more power).
//   - Desktop: WASD/arrows to move; while you hold the ball, hold Space to
//     charge a kick in your current facing (or toward goal) and release to fire.
//
// Spectators (joined a full / in-progress room) get the same view with no
// controls bound.
(function () {
    const canvas = document.getElementById("pitch");
    const ctx = canvas.getContext("2d");
    const scoreA = document.getElementById("score-a");
    const scoreB = document.getElementById("score-b");
    const clockEl = document.getElementById("match-clock");
    const gaugeFill = document.getElementById("gauge-fill");
    const gauge = document.getElementById("gauge");
    const enableBtn = document.getElementById("enable-motion");
    const flickLabel = document.getElementById("flick");
    const hint = document.getElementById("hint");
    const container = document.getElementById("pitch-container");
    const confettiHolder = document.getElementById("confetti");
    const countdownEl = document.getElementById("countdown");
    const substitutionPanel = document.getElementById("substitution-panel");
    const substitutionForm = document.getElementById("substitution-form");
    const substitutionTarget = document.getElementById("substitution-target");
    const substitutionRequestButton = document.getElementById("substitution-request");
    const substitutionRequests = document.getElementById("substitution-requests");
    const substitutionMessage = document.getElementById("substitution-message");
    const predictionPanel = document.getElementById("prediction-panel");
    const predictionTarget = document.getElementById("prediction-target");
    const predictionSubmit = document.getElementById("prediction-submit");
    const predictionRules = document.getElementById("prediction-rules");
    const predictionBalance = document.getElementById("prediction-balance");
    const predictionMessage = document.getElementById("prediction-message");
    const predictionHistory = document.getElementById("prediction-history");

    const FALLBACK_COLORS = { home: "#e74c3c", away: "#3498db" }; // until kits resolve
    const MAX_FLICK_ACCEL = 25; // m/s^2 that counts as a full-power kick
    const MAX_DRAG = 180; // world-units of drag = full-power kick (no sensor)
    const CHARGE_MS = 1000; // hold Space this long for a full-power kick
    const TILT_FULL = 30; // degrees of tilt for full movement speed
    const TILT_DEAD = 5; // degrees of tilt ignored (phone at rest)
    const MOVE_EMIT_MS = 100; // how often to push position to server
    const MOVE_TICK_MS = 8;  // fixed movement integration interval (~60 Hz)
    const RECONCILE_RATE = 0.15; // fraction of the server error corrected per snapshot
    const RECONCILE_SNAP = 60; // error beyond this = teleport to the server position
    const SMOOTH_PUCK_MS = 80; // time constant easing others' pucks toward server positions
    const SMOOTH_BALL_MS = 40; // faster for the ball so hard kicks don't visibly lag
    const SMOOTH_SNAP = 80; // gap beyond this = teleport (goal reset, rejoin)
    const TACKLE_SOUND_CHANCE = 0.3;

    let constants = null; // sent by the server in the game:join ack
    let teamNames = { home: "Home", away: "Away" };
    let kits = null; // resolved 2-colour shirt designs, one per team
    let started = false;
    let spectator = false;
    let myTeam = null; // 'home' | 'away' from our pucks; null = spectator/AI-only
    let state = null;
    let myPuckIds = [];
    let selectedId = null; // which of my pucks is being steered right now
    let iControl = false; // does one of my pucks have the ball?
    let portrait = false;
    let flip = false; // portrait + home team: rotate 180 so our goal is up top
    let inputBound = false;
    let socketId = null;
    let substitutionData = null;
    let predictionData = null;
    let predictionTargetsSignature = null;

    // Kick-in-progress (mobile drag OR desktop Space charge).
    let aiming = false; // mobile: pointer down, dragging an aim
    let spaceCharging = false; // desktop: Space held
    let spaceChargeStart = 0;
    let kickPuckId = null; // the puck the pending kick fires from (the carrier)
    let aimAngle = null; // world-space aim
    let dragDist = 0; // world-units dragged (fallback power source)
    let peakAccel = 0; // hardest flick during the current aim

    let tiltX = 0; // screen-frame tilt, degrees; 0 = phone flat on a table
    let tiltY = 0;
    const keys = new Set(); // held movement keys (desktop)
    let rafId = null;
    let lastFrameAt = null;
    let predicted = null; // locally-simulated position of the selected puck
    let inputDir = { x: 0, y: 0 }; // current world-space input, -1..1
    let carryDir = { x: 1, y: 0 }; // local mirror of where a carried ball sits
    let prevControllerId = null; // for tackle-sound detection
    let prevControllerTeam = null;
    const smoothPucks = new Map(); // puck id -> displayed {x, y}, eased toward the server's
    let smoothBall = null; // displayed ball position, eased the same way
    let countdownShown = 0; // countdown number currently animating, 0 = hidden

    function updateFlip() {
        flip = portrait && myTeam === "home";
    }

    // On mobile (portrait) the field is drawn vertically: the world stays
    // landscape, the canvas is rotated 90 degrees at render time.
    function fitOrientation() {
        if (!constants) return;
        portrait = window.innerHeight > window.innerWidth;
        canvas.width = portrait ? constants.FIELD.height : constants.FIELD.width;
        canvas.height = portrait ? constants.FIELD.width : constants.FIELD.height;
        updateFlip();
    }
    window.addEventListener("resize", fitOrientation);

    // World -> canvas point, matching the active render transform (used for
    // labels and tap mapping, which must be read/drawn un-rotated).
    function toCanvas(wx, wy) {
        if (!portrait) return { x: wx, y: wy };
        if (flip) return { x: wy, y: constants.FIELD.width - wx };
        return { x: constants.FIELD.height - wy, y: wx };
    }

    // Canvas point -> world point (inverse of the active transform).
    function canvasToWorld(cx, cy) {
        if (!portrait) return { x: cx, y: cy };
        if (flip) return { x: constants.FIELD.width - cy, y: cx };
        return { x: cy, y: constants.FIELD.height - cx };
    }

    // Screen-space direction -> world-space direction (inverse of the portrait
    // rotation), so the puck moves the way the phone leans / the key points.
    function viewToWorld(dx, dy) {
        if (!portrait) return { x: dx, y: dy };
        if (flip) return { x: -dy, y: dx };
        return { x: dy, y: -dx };
    }

    // Where a puck is drawn: your selected puck uses the local prediction,
    // everything else its smoothed position (eased toward the server's).
    function displayPos(puck) {
        if (puck.id === selectedId && predicted !== null) return predicted;
        return smoothPucks.get(puck.id) ?? puck;
    }

    function updateHint() {
        if (spectator) {
            hint.textContent = "Spectating this match.";
        } else if (!started) {
            hint.textContent = "Waiting for the game to start...";
        } else if (!myPuckIds.length) {
            hint.textContent = "You have no pucks in this match.";
        } else if (selectedId === null) {
            hint.textContent = "Tap one of your highlighted pucks to select it";
        } else if (iControl) {
            hint.textContent = "You have the ball! Drag to aim and release, or hold Space.";
        } else {
            hint.textContent = "Move with tilt / WASD. Win the ball to unlock the kick.";
        }
    }

    function matchIsLive() {
        return started && state !== null && (state.freezeMs ?? 0) <= 0;
    }

    function refreshSubstitutionAvailability() {
        if (!substitutionPanel || !substitutionData) return;
        const ownRequest = substitutionData.requests.find((request) => request.spectatorId === socketId);
        const hasCapacity = substitutionData.players.some((player) =>
            (substitutionData.counts[player.team] ?? 0) < substitutionData.limitPerTeam
        );
        const canRequest = spectator && matchIsLive() && !ownRequest && hasCapacity;
        substitutionRequestButton.disabled = !canRequest || !substitutionTarget.value;
    }

    function renderPredictionTargets() {
        if (!predictionTarget) return;
        const players = [...new Set((state?.pucks ?? [])
            .map((puck) => puck.username)
            .filter((username) => username !== null))];
        const signature = JSON.stringify([players, teamNames]);
        if (signature === predictionTargetsSignature) return;
        predictionTargetsSignature = signature;
        const selected = predictionTarget.value;
        predictionTarget.replaceChildren();
        const playerGroup = document.createElement("optgroup");
        playerGroup.label = "Players";
        for (const username of players) {
            const option = document.createElement("option");
            option.value = `player:${username}`;
            option.textContent = username;
            playerGroup.append(option);
        }
        predictionTarget.append(playerGroup);

        const teamGroup = document.createElement("optgroup");
        teamGroup.label = "Teams";
        for (const team of ["home", "away"]) {
            const option = document.createElement("option");
            option.value = `team:${team}`;
            option.textContent = teamNames[team];
            teamGroup.append(option);
        }
        predictionTarget.append(teamGroup);
        if ([...predictionTarget.options].some((option) => option.value === selected)) {
            predictionTarget.value = selected;
        }
    }

    function renderPredictionHistory() {
        predictionHistory.replaceChildren();
        for (const entry of (predictionData?.history ?? []).slice(-5).reverse()) {
            const item = document.createElement("li");
            const outcome = entry.outcome === "void" ? "void, team result only" : entry.outcome;
            const choice = entry.targetName ?? (entry.type === "player" ? entry.target : teamNames[entry.target] ?? entry.target);
            const delta = Number(entry.pointsChange ?? 0);
            item.textContent = `${choice}: ${outcome} (${delta > 0 ? "+" : ""}${delta} points)`;
            predictionHistory.append(item);
        }
    }

    function refreshPredictionPanel() {
        if (!predictionPanel) return;
        predictionPanel.hidden = !spectator;
        if (!spectator || !predictionData) return;
        const rules = predictionData.rules;
        predictionRules.textContent = `Cost: ${rules.cost} points. Correct: +${rules.reward}. Incorrect: -${rules.penalty}.`;
        predictionBalance.textContent = `Points: ${predictionData.points}`;
        if (spectator) renderPredictionTargets();
        const canPredict = spectator && matchIsLive() && predictionData.pending === null && predictionData.points >= rules.cost;
        predictionTarget.disabled = !canPredict;
        predictionSubmit.disabled = !canPredict || !predictionTarget.value;
        renderPredictionHistory();
    }

    async function submitPrediction() {
        if (!predictionTarget.value) return;
        const separator = predictionTarget.value.indexOf(":");
        const type = predictionTarget.value.slice(0, separator);
        const target = predictionTarget.value.slice(separator + 1);
        predictionSubmit.disabled = true;
        const response = await socket.emitWithAck("game:prediction", { type, target });
        if (response.success) {
            predictionData = { ...predictionData, ...response, pending: response.prediction };
            predictionMessage.textContent = "Prediction locked until the next goal.";
        } else {
            const messages = {
                match_not_playing: "Predictions are available during live play.",
                prediction_exists: "Your prediction is already locked for this goal.",
                insufficient_points: "You do not have enough points to predict.",
                invalid_target: "That player or team is no longer available.",
            };
            predictionMessage.textContent = messages[response.reason] ?? "Prediction could not be submitted.";
        }
        refreshPredictionPanel();
    }

    function renderSubstitutionPanel() {
        if (!substitutionPanel || !substitutionData) return;

        const requests = substitutionData.requests;
        const isHost = substitutionData.hostUserId === socketId;
        const relevantRequests = requests.filter((request) =>
            isHost || request.targetPlayerId === socketId || request.spectatorId === socketId
        );
        substitutionPanel.hidden = !spectator && relevantRequests.length === 0;
        substitutionForm.hidden = !spectator;

        const selectedIdBeforeRender = substitutionTarget.value;
        substitutionTarget.replaceChildren();
        const availablePlayers = substitutionData.players.filter((player) =>
            (substitutionData.counts[player.team] ?? 0) < substitutionData.limitPerTeam
        );
        for (const player of availablePlayers) {
            const option = document.createElement("option");
            option.value = player.id;
            option.textContent = `${player.username} (${player.team})`;
            substitutionTarget.append(option);
        }
        if (availablePlayers.some((player) => player.id === selectedIdBeforeRender)) {
            substitutionTarget.value = selectedIdBeforeRender;
        }
        substitutionTarget.disabled = availablePlayers.length === 0;
        substitutionRequestButton.textContent = availablePlayers.length ? "Request Substitution" : "Substitution limit reached";

        substitutionRequests.replaceChildren();
        for (const request of relevantRequests) {
            const row = document.createElement("div");
            row.className = "substitution-request";
            const description = document.createElement("span");
            const requestStatus = request.status === "expired" ? "Player approval expired; host may force approve" : "Awaiting approval";
            description.textContent = `${request.spectatorName} requests ${request.targetPlayerName}'s ${request.targetTeam} slot. ${requestStatus}.`;
            row.append(description);

            const actions = document.createElement("div");
            actions.className = "substitution-actions";
            const isTarget = request.targetPlayerId === socketId;
            const isRequester = request.spectatorId === socketId;
            const hostCanApprove = isHost && (
                substitutionData.approvalMode === "host" ||
                request.targetDisconnected ||
                (request.status === "expired" && Date.now() <= request.hostExpiresAt)
            );

            if (isTarget && request.status === "pending") {
                actions.append(
                    makeSubstitutionButton("Approve", request.id, "approve"),
                    makeSubstitutionButton("Reject", request.id, "reject")
                );
            }
            if (isHost) {
                if (hostCanApprove && (!isTarget || request.status === "expired")) {
                    actions.append(makeSubstitutionButton(request.status === "expired" ? "Force approve" : "Approve", request.id, "approve"));
                }
                if (request.status === "pending") {
                    if (!isTarget) actions.append(makeSubstitutionButton("Reject", request.id, "reject"));
                    actions.append(makeSubstitutionButton("Cancel", request.id, "cancel"));
                } else {
                    actions.append(makeSubstitutionButton("Cancel", request.id, "cancel"));
                }
            } else if (isRequester) {
                actions.append(makeSubstitutionButton("Cancel", request.id, "cancel"));
            }
            row.append(actions);
            substitutionRequests.append(row);
        }
        refreshSubstitutionAvailability();
    }

    function makeSubstitutionButton(label, requestId, action) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "substitution-button";
        button.textContent = label;
        button.addEventListener("click", () => sendSubstitutionAction({ action, requestId }));
        return button;
    }

    async function sendSubstitutionAction(action) {
        const response = await socket.emitWithAck("game:substitution", action);
        if (!response.success) {
            substitutionMessage.textContent = response.reason === "request_expired"
                ? "That substitution request has expired."
                : "The substitution could not be completed.";
        } else {
            substitutionMessage.textContent = "";
        }
    }

    async function requestSubstitution() {
        const response = await socket.emitWithAck("game:substitution", {
            action: "request",
            targetPlayerId: substitutionTarget.value,
        });
        substitutionMessage.textContent = response.success
            ? "Request sent. The player or host must approve."
            : response.reason === "substitution_limit"
                ? "That team has reached its substitution limit."
                : "A substitution request could not be sent.";
    }

    function resetKick() {
        aiming = false;
        spaceCharging = false;
        kickPuckId = null;
        aimAngle = null;
        dragDist = 0;
        peakAccel = 0;
        gaugeFill.style.width = "0%";
    }

    async function join() {
        const info = await socket.emitWithAck("game:join", {});

        if (info.status !== "success") {
            navigateTo("/home");
            return;
        }

        constants = info.constants;
        socketId = info.socketId;
        teamNames = info.teamNames;
        myPuckIds = info.puckIds;
        started = info.started;
        spectator = Boolean(info.spectator);
        substitutionData = info.substitutions;
        predictionData = spectator ? info.prediction : null;
        if (info.state) state = info.state;
        if (selectedId === null && myPuckIds.length) {
            selectedId = myPuckIds[0];
        }
        resolveMyTeam();

        kits = resolveKits(teamNames.home, teamNames.away);
        scoreA.style.color = readableKitColor(kits.home);
        scoreB.style.color = readableKitColor(kits.away);

        setupStadium();
        fitOrientation();

        if (!spectator) {
            bindInput();
            maybeShowMotionButton();
        } else {
            enableBtn.hidden = true;
            gauge.hidden = true;
        }

        updateHint();
        renderSubstitutionPanel();
        refreshPredictionPanel();
    }

    function resolveMyTeam() {
        if (myTeam !== null || !myPuckIds.length || !state) return;
        const mine = state.pucks.find((p) => myPuckIds.includes(p.id));
        myTeam = mine ? mine.team : null;
        updateFlip();
    }

    // Landscape (desktop / spectators) gets the stadium chrome; each side panel
    // is filled with the team's alternating kit colours.
    // Portrait mobile players see the bare pitch (CSS hides the chrome below the media query).
    function setupStadium() {
        if (!kits) return;
        container.classList.add("in-stadium");

        function fillKitPanel(el, kit) {
            el.innerHTML = "";
            for (let i = 0; i < 4; i++) {
                const tile = document.createElement("span");
                tile.className = "team-kit-tile";
                tile.style.background = kit.colors[i % kit.colors.length];
                el.append(tile);
            }
        }

        const homeKitPanel = document.getElementById("home-kit-panel");
        const awayKitPanel = document.getElementById("away-kit-panel");
        if (homeKitPanel) fillKitPanel(homeKitPanel, kits.home);
        if (awayKitPanel) fillKitPanel(awayKitPanel, kits.away);
    }

    function updateClock(s) {
        if (s.timeLeftMs == null) {
            clockEl.hidden = true;
            return;
        }
        clockEl.hidden = false;
        const total = Math.ceil(s.timeLeftMs / 1000);
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        clockEl.textContent = `${mins}:${String(secs).padStart(2, "0")}`;
    }

    // Kickoff / post-goal freeze: pop the remaining seconds up big, one at a
    // time; replacing the digit restarts the zoom-and-fade CSS animation.
    function updateCountdown(freezeMs) {
        const num = Math.ceil(freezeMs / 1000);
        if (num === countdownShown) return;
        countdownShown = num;
        countdownEl.innerHTML = "";
        countdownEl.hidden = num <= 0;
        if (num > 0) {
            const digit = document.createElement("span");
            digit.textContent = num;
            countdownEl.append(digit);
        }
    }

    function onState(s) {
        state = s;
        resolveMyTeam();
        scoreA.textContent = `${teamNames.home} ${s.score.home}`;
        scoreB.textContent = `${s.score.away} ${teamNames.away}`;
        updateClock(s);
        updateCountdown(s.freezeMs ?? 0);

        // Tackle sound: possession jumped straight from one team to the other.
        if (prevControllerId !== null && s.controllingPuckId !== null && prevControllerId !== s.controllingPuckId) {
            const nowTeam = s.pucks.find((p) => p.id === s.controllingPuckId)?.team;
            if (prevControllerTeam && nowTeam && prevControllerTeam !== nowTeam) {
                if (Math.random() < TACKLE_SOUND_CHANCE) {
                    playSound("tackle");
                }
            }
        }
        prevControllerId = s.controllingPuckId;
        prevControllerTeam = s.controllingPuckId === null
            ? null
            : (s.pucks.find((p) => p.id === s.controllingPuckId)?.team ?? null);

        // Removed server reconciliation for the locally controlled puck.
        // The client is the sole source of truth for its own puck's position
        // and locally enforces the same bounds as the server.

        const controlMine = s.controllingPuckId !== null && myPuckIds.includes(s.controllingPuckId);
        if (controlMine && !iControl) {
            // Just won the ball: it sits toward the opponent goal, like the server.
            const carrier = s.pucks.find((p) => p.id === s.controllingPuckId);
            carryDir = { x: carrier && carrier.team === "away" ? -1 : 1, y: 0 };
        }
        if (!controlMine && (aiming || spaceCharging)) {
            resetKick(); // lost the ball mid-aim
        }
        if (controlMine !== iControl) {
            iControl = controlMine;
            updateHint();
        }
        refreshSubstitutionAvailability();
        refreshPredictionPanel();
    }

    // Match over: stash the summary for the stats view and go there.
    function onEnded(summary) {
        playSound("endgame");
        confettiBurst();
        sessionStorage.setItem("matchStats", JSON.stringify(summary));
        navigateTo("/stats");
    }

    function onStarted() {
        playSound("countdown");
        join();
    }

    function onSubstitutionUpdate(data) {
        substitutionData = data;
        renderSubstitutionPanel();
    }

    function onSubstitutionNotice(data) {
        if (data?.request?.targetPlayerId === socketId) {
            substitutionMessage.textContent = `${data.request.spectatorName} requested your slot.`;
        } else if (data?.request && substitutionData?.hostUserId === socketId) {
            substitutionMessage.textContent = `Substitution requested for ${data.request.targetPlayerName}.`;
        }
    }

    function onSubstitutionRole(data) {
        spectator = Boolean(data.spectator);
        predictionData = spectator ? data.prediction : null;
        myPuckIds = data.puckIds ?? [];
        selectedId = myPuckIds[0] ?? null;
        predicted = null;
        myTeam = null;
        state = data.state;
        started = true;
        inputDir = { x: 0, y: 0 };
        keys.clear();
        resetKick();

        if (spectator) {
            unbindInput();
            enableBtn.hidden = true;
            gauge.hidden = true;
        } else {
            bindInput();
            gauge.hidden = false;
            maybeShowMotionButton();
        }

        resolveMyTeam();
        fitOrientation();
        onState(data.state);
        renderSubstitutionPanel();
        refreshPredictionPanel();
        updateHint();
        substitutionMessage.textContent = spectator ? "You are now spectating." : "Substitution approved. You are in the match.";
    }

    function onSubstituted(data) {
        substitutionMessage.textContent = `${data.incoming} replaced ${data.outgoing} on ${data.team}.`;
    }

    const goalOverlay = document.getElementById("goal-overlay");
    let goalOverlayTimer = null;

    function showGoalOverlay() {
        if (!goalOverlay) return;
        goalOverlay.classList.add("visible");
        clearTimeout(goalOverlayTimer);
        goalOverlayTimer = setTimeout(() => {
            goalOverlay.classList.remove("visible");
        }, 2500);
    }

    function onGoal() {
        playSound("goal");
        confettiBurst();
        showGoalOverlay();
    }

    function onPredictionResult(result) {
        predictionData = {
            ...predictionData,
            points: result.points,
            pending: null,
            history: [...(predictionData?.history ?? []), result],
        };
        predictionMessage.textContent = result.outcome === "void"
            ? "Team result only. Your player prediction was voided and refunded."
            : result.outcome === "expired"
                ? "Match ended. Your pending prediction was refunded."
                : `${result.outcome === "correct" ? "Correct" : "Incorrect"}: ${result.pointsChange > 0 ? "+" : ""}${result.pointsChange} points.`;
        refreshPredictionPanel();
    }

    function onKicked() {
        playSound("kick");
    }

    const powerupToast = document.getElementById("powerup-toast");
    let powerupToastTimer = null;

    // Bottom-center toast naming the powerup that was just grabbed (and by
    // whom), tinted in the powerup's own colour.
    function showPowerupToast(type, username) {
        if (!powerupToast) return;
        const meta = constants?.POWERUPS?.[type];
        const label = meta?.label ?? type;
        powerupToast.textContent = username ? `${username} picked up ${label}!` : `${label} picked up!`;
        powerupToast.style.setProperty("--powerup-color", meta?.color ?? "#ffe14d");
        powerupToast.classList.remove("visible");
        void powerupToast.offsetWidth; // restart the transition on back-to-back pickups
        powerupToast.classList.add("visible");
        clearTimeout(powerupToastTimer);
        powerupToastTimer = setTimeout(() => powerupToast.classList.remove("visible"), 2200);
    }

    function onPowerup(data) {
        if (!data) return;
        if (data.event === "spawn") {
            playSound("powerup-spawn");
        } else if (data.event === "pickup") {
            showPowerupToast(data.type, data.username);
            // The phonk power-up swaps its pickup cue for its music track, held
            // for the power-up's own duration (the server's single source).
            if (data.type === "phonk") {
                const ms = constants?.POWERUPS?.phonk?.durationMs ?? 10000;
                playTimedSound("phonk", ms);
            } else {
                playSound("powerup");
            }
        }
    }

    join();

    // Rejoin after a reconnect / when the game starts while this view is open.
    socket.on("connect", join);
    socket.on("game:started", onStarted);
    socket.on("game:state", onState);
    socket.on("game:ended", onEnded);
    socket.on("game:goal", onGoal);
    socket.on("game:prediction-result", onPredictionResult);
    socket.on("game:kicked", onKicked);
    socket.on("game:powerup", onPowerup);
    socket.on("game:substitution-update", onSubstitutionUpdate);
    socket.on("game:substitution-notice", onSubstitutionNotice);
    socket.on("game:substitution-role", onSubstitutionRole);
    socket.on("game:substituted", onSubstituted);

    substitutionRequestButton.addEventListener("click", requestSubstitution);
    substitutionTarget.addEventListener("change", refreshSubstitutionAvailability);
    predictionSubmit.addEventListener("click", submitPrediction);

    // ---- Drawing --------------------------------------------------------

    function drawField() {
        const { FIELD } = constants;
        const half = state.goalHalfWidths ?? { home: constants.GOAL_HALF_WIDTH, away: constants.GOAL_HALF_WIDTH };

        ctx.fillStyle = "#2e8b57";
        ctx.fillRect(0, 0, FIELD.width, FIELD.height);

        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.strokeRect(5, 5, FIELD.width - 10, FIELD.height - 10);

        // Halfway line and center circle
        ctx.beginPath();
        ctx.moveTo(FIELD.width / 2, 5);
        ctx.lineTo(FIELD.width / 2, FIELD.height - 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(FIELD.width / 2, FIELD.height / 2, 60, 0, Math.PI * 2);
        ctx.stroke();

        // Goal boxes
        ctx.strokeRect(5, FIELD.height / 2 - 80, 80, 160);
        ctx.strokeRect(FIELD.width - 85, FIELD.height / 2 - 80, 80, 160);

        // Goal mouths (thick lines on the end lines), using the LIVE mouth
        // widths so the biggoal powerup visibly matches hit detection.
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(4, FIELD.height / 2 - half.home);
        ctx.lineTo(4, FIELD.height / 2 + half.home);
        ctx.moveTo(FIELD.width - 4, FIELD.height / 2 - half.away);
        ctx.lineTo(FIELD.width - 4, FIELD.height / 2 + half.away);
        ctx.stroke();
    }

    // A puck in its national shirt: base colour with the accent laid on in
    // the kit's pattern, clipped to the circle.
    function drawKitPuck(x, y, r, kit) {
        const [base, accent] = kit.colors;

        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.clip();

        ctx.fillStyle = base;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);

        ctx.fillStyle = accent;
        switch (kit.pattern) {
            case "stripes": // three vertical accent stripes
                for (const off of [-r * 0.66, 0, r * 0.66]) {
                    ctx.fillRect(x + off - r * 0.16, y - r, r * 0.32, r * 2);
                }
                break;
            case "hoop": // one horizontal accent band
                ctx.fillRect(x - r, y - r * 0.3, r * 2, r * 0.6);
                break;
            case "halves": // accent right half
                ctx.fillRect(x, y - r, r, r * 2);
                break;
            case "checks": // two accent quadrants
                ctx.fillRect(x, y - r, r, r);
                ctx.fillRect(x - r, y, r, r);
                break;
            // "solid": base shirt only, the accent goes into the trim ring
        }
        ctx.restore();

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = kit.pattern === "solid" ? accent : "rgba(0, 0, 0, 0.55)";
        ctx.lineWidth = kit.pattern === "solid" ? 3 : 1.5;
        ctx.stroke();
    }

    // Active-powerup rings around a puck (read straight from the state flags).
    function drawEffects(puck, pos) {
        const r = constants.PUCK_RADIUS;
        if (puck.phonkActive) {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, r + 7, 0, Math.PI * 2);
            ctx.strokeStyle = `hsl(${(Date.now() / 8) % 360}, 100%, 60%)`;
            ctx.lineWidth = 3;
            ctx.stroke();
        }
        if (puck.speedActive) {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, r + 4, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(51, 221, 255, 0.9)";
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        if (puck.powershot) {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, r + 6, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255, 85, 51, 0.95)";
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    }

    function drawTokens() {
        if (!state.tokens) return;
        for (const token of state.tokens) {
            const meta = constants.POWERUPS[token.type];
            ctx.beginPath();
            ctx.arc(token.x, token.y, constants.TOKEN_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = meta ? meta.color : "#fff";
            ctx.fill();
            ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    function drawPucks() {
        for (const puck of state.pucks) {
            const pos = displayPos(puck);

            drawEffects(puck, pos);

            // Whoever traps the ball gets a thin white marker.
            if (state.controllingPuckId === puck.id) {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, constants.PUCK_RADIUS + 9, 0, Math.PI * 2);
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            // Your pucks are ringed; the selected one is green, the rest yellow.
            if (myPuckIds.includes(puck.id)) {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, constants.PUCK_RADIUS + 5, 0, Math.PI * 2);
                ctx.strokeStyle = puck.id === selectedId ? "#0f0" : "#ff0";
                ctx.lineWidth = puck.id === selectedId ? 4 : 3;
                ctx.stroke();
            }

            if (kits) {
                drawKitPuck(pos.x, pos.y, constants.PUCK_RADIUS, kits[puck.team]);
            } else {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, constants.PUCK_RADIUS, 0, Math.PI * 2);
                ctx.fillStyle = FALLBACK_COLORS[puck.team];
                ctx.fill();
            }
        }
    }

    // The ball: smoothed server position, except while OUR selected puck
    // carries it — then it rides at the predicted puck's feet so the dribble
    // looks smooth.
    function ballPos() {
        if (state.controllingPuckId !== null && state.controllingPuckId === selectedId && predicted !== null) {
            const { FIELD, BALL_RADIUS, CARRY_OFFSET } = constants;
            return {
                x: Math.min(Math.max(predicted.x + carryDir.x * CARRY_OFFSET, BALL_RADIUS), FIELD.width - BALL_RADIUS),
                y: Math.min(Math.max(predicted.y + carryDir.y * CARRY_OFFSET, BALL_RADIUS), FIELD.height - BALL_RADIUS),
            };
        }
        return smoothBall ?? state.ball;
    }

    function drawBall() {
        const pos = ballPos();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, constants.BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
    }

    // While aiming (mobile drag) or charging (desktop Space): aim line.
    function drawAim() {
        if (!aiming && !spaceCharging) return;
        if (kickPuckId === null || aimAngle === null) return;
        const puck = state.pucks.find((p) => p.id === kickPuckId);
        if (!puck) return;
        const pos = displayPos(puck);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x + Math.cos(aimAngle) * 80, pos.y + Math.sin(aimAngle) * 80);
        ctx.strokeStyle = "#ff0";
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    // Text overlays (usernames, kit numbers, token letters); drawn without the
    // rotation transform so text stays upright in portrait mode.
    function drawLabels() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.textAlign = "center";

        // Kit numbers, centered on each puck.
        ctx.font = "bold 11px sans-serif";
        for (const puck of state.pucks) {
            if (puck.number == null) continue;
            const v = toCanvas(displayPos(puck).x, displayPos(puck).y);
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
            ctx.strokeText(puck.number, v.x, v.y + 4);
            ctx.fillStyle = "#fff";
            ctx.fillText(puck.number, v.x, v.y + 4);
        }

        // Usernames above steered pucks.
        ctx.font = "13px sans-serif";
        ctx.fillStyle = "#fff";
        for (const puck of state.pucks) {
            if (!puck.username) continue;
            const v = toCanvas(displayPos(puck).x, displayPos(puck).y);
            ctx.fillText(puck.username, v.x, v.y - constants.PUCK_RADIUS - 10);
        }

        // Powerup token labels (first letter).
        if (state.tokens) {
            ctx.font = "bold 12px sans-serif";
            for (const token of state.tokens) {
                const meta = constants.POWERUPS[token.type];
                const letter = (meta ? meta.label : token.type).charAt(0).toUpperCase();
                const v = toCanvas(token.x, token.y);
                ctx.lineWidth = 3;
                ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
                ctx.strokeText(letter, v.x, v.y + 4);
                ctx.fillStyle = "#fff";
                ctx.fillText(letter, v.x, v.y + 4);
            }
        }
    }

    // ---- Input (movement) ------------------------------------------------

    function tiltToInput(deg) {
        if (Math.abs(deg) < TILT_DEAD) return 0;
        return Math.min(Math.max(deg / TILT_FULL, -1), 1);
    }

    // Current movement input in view/screen space: keyboard (desktop) wins,
    // else the gyro tilt.
    function currentViewInput() {
        if (keys.size) {
            let x = 0;
            let y = 0;
            if (keys.has("a") || keys.has("arrowleft")) x -= 1;
            if (keys.has("d") || keys.has("arrowright")) x += 1;
            if (keys.has("w") || keys.has("arrowup")) y -= 1;
            if (keys.has("s") || keys.has("arrowdown")) y += 1;
            const len = Math.hypot(x, y);
            if (len > 0) {
                x /= len;
                y /= len;
            }
            return { x, y };
        }
        return { x: tiltToInput(tiltX), y: tiltToInput(tiltY) };
    }

    // Advance the local prediction of the selected puck by the current input.
    // Called from the fixed-interval movement tick, not from the RAF.
    // dtMs is always MOVE_TICK_MS for deterministic speed on all devices.
    function predict() {
        if (selectedId === null || !state || !constants) {
            predicted = null;
            return;
        }
        const puck = state.pucks.find((p) => p.id === selectedId);
        if (!puck) {
            predicted = null;
            return;
        }
        if (predicted === null) {
            predicted = { x: puck.x, y: puck.y };
        }

        // During a countdown the server rejects game:move: pin the prediction
        // to the authoritative spot so the puck can't drift locally.
        if (state.freezeMs > 0) {
            predicted.x = puck.x;
            predicted.y = puck.y;
            return;
        }

        const view = currentViewInput();
        inputDir = viewToWorld(view.x, view.y);
        if (inputDir.x !== 0 || inputDir.y !== 0) {
            const { FIELD, PUCK_RADIUS, MOVE_SPEED, TICK_MS } = constants;
            // Match the server's speed powerup so the prediction keeps up.
            const speed = puck.speedActive ? MOVE_SPEED * 1.8 : MOVE_SPEED;
            // Scale by MOVE_TICK_MS so speed is the same regardless of sensor rate.
            const step = (speed * MOVE_TICK_MS) / TICK_MS;
            predicted.x += inputDir.x * step;
            predicted.y += inputDir.y * step;

            predicted.x = Math.min(Math.max(predicted.x, PUCK_RADIUS), FIELD.width - PUCK_RADIUS);
            predicted.y = Math.min(Math.max(predicted.y, PUCK_RADIUS), FIELD.height - PUCK_RADIUS);

            // Mirror the server's dribble: the carried ball leads the movement.
            const length = Math.hypot(inputDir.x, inputDir.y);
            carryDir = { x: inputDir.x / length, y: inputDir.y / length };
        }
    }

    // Fixed-interval movement ticker: runs at MOVE_TICK_MS regardless of frame
    // rate or gyro event frequency, so movement speed is consistent on all devices.
    const movementTick = setInterval(() => {
        if (spectator) return;
        predict();
    }, MOVE_TICK_MS);

    // Ease a displayed position toward its server target instead of jumping
    // snapshot-to-snapshot; teleports across big gaps (goal reset, rejoin).
    function easeToward(pos, target, dtMs, tauMs) {
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        if (Math.hypot(dx, dy) > SMOOTH_SNAP) {
            pos.x = target.x;
            pos.y = target.y;
            return;
        }
        const blend = 1 - Math.exp(-dtMs / tauMs);
        pos.x += dx * blend;
        pos.y += dy * blend;
    }

    // Interpolate everyone else's pucks (and the ball) between server
    // snapshots so remote movement renders smoothly at frame rate. The puck
    // you steer is untouched: it renders from the local prediction.
    function smoothStep(dtMs) {
        for (const puck of state.pucks) {
            let pos = smoothPucks.get(puck.id);
            if (!pos) {
                pos = { x: puck.x, y: puck.y };
                smoothPucks.set(puck.id, pos);
            }
            easeToward(pos, puck, dtMs, SMOOTH_PUCK_MS);
        }
        if (smoothBall === null) {
            smoothBall = { x: state.ball.x, y: state.ball.y };
        }
        easeToward(smoothBall, state.ball, dtMs, SMOOTH_BALL_MS);
    }

    function render(nowMs) {
        const dtMs = lastFrameAt === null ? 16 : Math.min(nowMs - lastFrameAt, 100);
        lastFrameAt = nowMs;

        if (state && constants) {
            // Movement is now driven by the fixed movementTick interval;
            // the RAF only reads `predicted` for rendering.
            smoothStep(dtMs);

            // Desktop Space charge continuously re-aims in the current facing.
            if (spaceCharging) {
                aimAngle = keyboardAimAngle();
            }

            // World (landscape) coordinates; this transform turns them 90
            // degrees when portrait, flipped 180 more for the home side so
            // each player attacks the goal at the top of their screen.
            if (portrait) {
                if (flip) {
                    ctx.setTransform(0, -1, 1, 0, 0, constants.FIELD.width);
                } else {
                    ctx.setTransform(0, 1, -1, 0, constants.FIELD.height, 0);
                }
            } else {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
            }

            drawField();
            drawTokens();
            drawPucks();
            drawBall();
            drawAim();
            drawLabels();

            // Kick charge / power gauge.
            flickLabel.hidden = !aiming;
            if (aiming) {
                gaugeFill.style.width = `${currentAimPower() * 100}%`;
            } else if (spaceCharging) {
                gaugeFill.style.width = `${Math.min((Date.now() - spaceChargeStart) / CHARGE_MS, 1) * 100}%`;
            }
        }
        rafId = requestAnimationFrame(render);
    }
    rafId = requestAnimationFrame(render);

    // ---- Input (kicking) -------------------------------------------------

    function currentAimPower() {
        // Flick (phone) sets power if the sensor fired; otherwise drag distance.
        const power = peakAccel > 0 ? peakAccel / MAX_FLICK_ACCEL : dragDist / MAX_DRAG;
        return Math.min(Math.max(power, 0.15), 1);
    }

    function keyboardAimAngle() {
        const view = currentViewInput();
        const w = viewToWorld(view.x, view.y);
        if (w.x !== 0 || w.y !== 0) return Math.atan2(w.y, w.x);
        return Math.atan2(carryDir.y, carryDir.x); // idle: toward opponent goal
    }

    function fireKick(puckId, angle, power) {
        if (puckId === null || angle === null) return;
        socket.emit("game:kick", { puckId, angle, power });
    }

    function aimFromPointer(x, y) {
        const carrier = state.pucks.find((p) => p.id === kickPuckId);
        if (!carrier) return;
        const pos = displayPos(carrier);
        aimAngle = Math.atan2(y - pos.y, x - pos.x);
        dragDist = Math.hypot(x - pos.x, y - pos.y);
    }

    function onPointerDown(e) {
        if (!state || !constants) return;
        const rect = canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
        const { x, y } = canvasToWorld(cx, cy);

        // Tap one of your pucks to select it.
        for (const puck of state.pucks) {
            const pos = displayPos(puck);
            if (myPuckIds.includes(puck.id) && Math.hypot(pos.x - x, pos.y - y) <= constants.PUCK_RADIUS + 5) {
                if (puck.id !== selectedId) {
                    if (selectedId !== null) {
                        // Park the puck we are leaving: tell the server its last known position so it stops.
                        const prevPuck = state.pucks.find((p) => p.id === selectedId);
                        if (prevPuck && predicted !== null) {
                            socket.emit("game:move", { puckId: selectedId, x: predicted.x, y: predicted.y, inputX: 0, inputY: 0 });
                        }
                    }
                    selectedId = puck.id;
                    predicted = null;
                }
                resetKick();
                updateHint();
                return;
            }
        }

        // Otherwise, if we hold the ball, begin aiming a kick from the carrier.
        const carrierId = state.controllingPuckId;
        if (carrierId !== null && myPuckIds.includes(carrierId)) {
            aiming = true;
            spaceCharging = false;
            kickPuckId = carrierId;
            peakAccel = 0;
            aimFromPointer(x, y);
        }
    }

    function onPointerMove(e) {
        if (!aiming || !state) return;
        const rect = canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
        const { x, y } = canvasToWorld(cx, cy);
        aimFromPointer(x, y);
    }

    function onPointerUp() {
        if (!aiming) return;
        fireKick(kickPuckId, aimAngle, currentAimPower());
        resetKick();
    }

    function onKeyDown(e) {
        const k = e.key.toLowerCase();
        if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
            keys.add(k);
            e.preventDefault();
        } else if (k === " " || e.code === "Space") {
            if (!spaceCharging && iControl) {
                const carrierId = state?.controllingPuckId;
                if (carrierId !== null && myPuckIds.includes(carrierId)) {
                    spaceCharging = true;
                    aiming = false;
                    kickPuckId = carrierId;
                    spaceChargeStart = Date.now();
                }
            }
            e.preventDefault();
        }
    }

    function onKeyUp(e) {
        const k = e.key.toLowerCase();
        keys.delete(k);
        if (k === " " || e.code === "Space") {
            if (spaceCharging) {
                const power = Math.min((Date.now() - spaceChargeStart) / CHARGE_MS, 1);
                fireKick(kickPuckId, keyboardAimAngle(), Math.max(power, 0.15));
                resetKick();
            }
            e.preventDefault();
        }
    }

    function bindInput() {
        if (inputBound) return;
        inputBound = true;
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
    }

    function unbindInput() {
        if (!inputBound) return;
        inputBound = false;
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
    }

    const moveTimer = setInterval(() => {
        if (spectator || !state || selectedId === null || predicted === null) return;
        const view = currentViewInput();
        const w = viewToWorld(view.x, view.y);
        // Send the locally-predicted position directly so the server mirrors it.
        // Also send input direction for dribble orientation.
        socket.emit("game:move", { puckId: selectedId, x: predicted.x, y: predicted.y, inputX: w.x, inputY: w.y });
    }, MOVE_EMIT_MS);

    // ---- Motion sensors (mobile) ----------------------------------------

    function screenAngle() {
        const angle =
            (window.screen && window.screen.orientation && window.screen.orientation.angle) ??
            window.orientation ??
            0;
        return ((angle % 360) + 360) % 360;
    }

    function onOrientation(e) {
        const beta = e.beta || 0;
        const gamma = e.gamma || 0;
        switch (screenAngle()) {
            case 90:
                tiltX = beta;
                tiltY = -gamma;
                break;
            case 180:
                tiltX = -gamma;
                tiltY = -beta;
                break;
            case 270:
                tiltX = -beta;
                tiltY = gamma;
                break;
            default:
                tiltX = gamma;
                tiltY = beta;
        }
    }

    function onMotion(e) {
        let mag = 0;
        const a = e.acceleration;
        if (a && a.x !== null) {
            mag = Math.hypot(a.x, a.y, a.z);
        } else {
            const g = e.accelerationIncludingGravity;
            if (g && g.x !== null) mag = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
        }
        if (aiming && mag > peakAccel) peakAccel = mag;
    }

    const orientationEvent =
        "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";

    // Only touch devices get the "Enable motion controls" button; desktop
    // uses WASD and never needs it.
    function maybeShowMotionButton() {
        const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
        enableBtn.hidden = !(touch && typeof DeviceOrientationEvent !== "undefined");
    }

    // iOS only delivers sensor events after requestPermission() from a tap;
    // hide the button once permission is resolved either way.
    enableBtn.addEventListener("click", async () => {
        try {
            if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
                await DeviceOrientationEvent.requestPermission();
            }
            if (typeof DeviceMotionEvent !== "undefined" && DeviceMotionEvent.requestPermission) {
                await DeviceMotionEvent.requestPermission();
            }
        } catch (err) {
            // Permission denied or unsupported: listeners just never fire.
        }
        window.addEventListener(orientationEvent, onOrientation);
        window.addEventListener("devicemotion", onMotion);
        enableBtn.hidden = true;
    });

    // ---- Cosmetics ------------------------------------------------------

    function confettiBurst() {
        if (!confettiHolder) return;
        const colors = kits
            ? [...kits.home.colors, ...kits.away.colors]
            : ["#e74c3c", "#3498db", "#ffffff", "#ffe14d"];
        for (let i = 0; i < 40; i++) {
            const bit = document.createElement("div");
            bit.className = "confetti-bit";
            bit.style.left = `${Math.random() * 100}%`;
            bit.style.background = colors[Math.floor(Math.random() * colors.length)];
            bit.style.animationDelay = `${Math.random() * 0.2}s`;
            confettiHolder.append(bit);
            setTimeout(() => bit.remove(), 1800);
        }
    }

    // ---- Teardown -------------------------------------------------------

    window.cleanupView = () => {
        cancelAnimationFrame(rafId);
        clearInterval(moveTimer);
        clearInterval(movementTick);
        clearTimeout(goalOverlayTimer);
        clearTimeout(powerupToastTimer);
        socket.off("connect", join);
        socket.off("game:started", onStarted);
        socket.off("game:state", onState);
        socket.off("game:ended", onEnded);
        socket.off("game:goal", onGoal);
        socket.off("game:prediction-result", onPredictionResult);
        socket.off("game:kicked", onKicked);
        socket.off("game:powerup", onPowerup);
        socket.off("game:substitution-update", onSubstitutionUpdate);
        socket.off("game:substitution-notice", onSubstitutionNotice);
        socket.off("game:substitution-role", onSubstitutionRole);
        socket.off("game:substituted", onSubstituted);
        substitutionRequestButton.removeEventListener("click", requestSubstitution);
        substitutionTarget.removeEventListener("change", refreshSubstitutionAvailability);
        predictionSubmit.removeEventListener("click", submitPrediction);
        unbindInput();
        window.removeEventListener("resize", fitOrientation);
        window.removeEventListener(orientationEvent, onOrientation);
        window.removeEventListener("devicemotion", onMotion);
    };
})();
