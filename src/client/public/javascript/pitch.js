/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Render and control the match pitch, including player input, match
 * events, mobile controls, and spectator panels.
 *
 * The server owns match state. The selected puck is simulated locally for
 * immediate input and is not reconciled to snapshots; other pucks and the ball
 * are eased toward server snapshots. Portrait mode rotates the landscape world
 * for the screen and flips it for the home team so its goal stays at the top.
 *
 * Players can select Tilt, Joystick, or Buttons on touch devices; the choice
 * is saved for later visits. Tilt/drag aiming and desktop WASD/arrows with
 * Space charging are also supported. Spectators see the match without controls.
 * The shared socket and kit/sound helpers are reused, and cleanupView removes
 * this view's listeners, timers, and animation loops when navigation changes.
 */
(function () {
    const canvas = document.getElementById("pitch");
    const ctx = canvas.getContext("2d");
    const scoreA = document.getElementById("score-a");
    const scoreB = document.getElementById("score-b");
    const teamNameA = document.getElementById("team-name-a");
    const teamNameB = document.getElementById("team-name-b");
    const teamScoreA = document.getElementById("team-score-a");
    const teamScoreB = document.getElementById("team-score-b");
    const flagA = document.getElementById("flag-a");
    const flagB = document.getElementById("flag-b");
    const clockEl = document.getElementById("match-clock");
    const gaugeFill = document.getElementById("gauge-fill");
    const gauge = document.getElementById("gauge");
    const enableBtn = document.getElementById("enable-motion");
    const flickLabel = document.getElementById("flick");
    const hint = document.getElementById("hint");
    const container = document.getElementById("pitch-container");
    const confettiHolder = document.getElementById("confetti");
    const countdownEl = document.getElementById("countdown");
    const mobileControls = document.getElementById("mobile-controls");
    const controlModeButtons = [...document.querySelectorAll("[data-control-mode]")];
    const joystickBase = document.getElementById("joystick-base");
    const joystickKnob = document.getElementById("joystick-knob");
    const buttonPad = document.getElementById("button-pad");
    const directionButtons = [...document.querySelectorAll("[data-move-direction]")];
    const chargeReadout = document.getElementById("gauge-value");
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
    const shootoutPanel = document.getElementById("shootout-panel");
    const shootoutHeading = document.getElementById("shootout-heading");
    const shootoutStatus = document.getElementById("shootout-status");
    const shootoutRegularScore = document.getElementById("shootout-regular-score");
    const shootoutPenaltyScore = document.getElementById("shootout-penalty-score");
    const shootoutRoundLabel = document.getElementById("shootout-round-label");
    const shootoutMatchupLabel = document.getElementById("shootout-matchup-label");
    const duelStage = document.getElementById("duel-stage");
    const duelPulse = document.getElementById("duel-pulse");
    const duelKickerAvatar = document.getElementById("duel-kicker-avatar");
    const duelKickerName = document.getElementById("duel-kicker-name");
    const duelKickerTeam = document.getElementById("duel-kicker-team");
    const duelKeeperAvatar = document.getElementById("duel-keeper-avatar");
    const duelKeeperName = document.getElementById("duel-keeper-name");
    const duelKeeperTeam = document.getElementById("duel-keeper-team");
    const shootoutGoalkeeperForm = document.getElementById("shootout-goalkeeper-form");
    const shootoutGoalkeeper = document.getElementById("shootout-goalkeeper");
    const shootoutGoalkeeperSubmit = document.getElementById("shootout-goalkeeper-submit");
    const shootoutChoicePrompt = document.getElementById("shootout-choice-prompt");
    const shootoutMessage = document.getElementById("shootout-message");
    const shootoutDirectionButtons = [...document.querySelectorAll(".shootout-direction")];

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
    // Disable decorative movement and trails when the user requests less motion.
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const touchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches;

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
    let motionControlsEnabled = false;
    let motionPermissionPending = false;
    let motionDetectionTimer = null;
    let orientationDetected = false;
    let socketId = null;
    let substitutionData = null;
    let predictionData = null;
    let predictionTargetsSignature = null;
    let shootoutData = null;
    let shootoutPlayersSignature = null;
    let lastShootoutResult = null;
    let displayedPenaltyScore = null;
    let cinematicRunning = false;
    const cinematicTimers = [];

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
    let controlMode = readControlPreference();
    let motionEnabled = false;
    let joystickPointerId = null;
    let joystickInput = { x: 0, y: 0 };
    const pressedDirections = new Set();
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

    let lastBallSnapshot = null;
    const ballTrail = [];
    const puckReactionUntil = new Map();

    // Keep the last touch-control choice when storage is available.
    function readControlPreference() {
        try {
            const saved = localStorage.getItem("foosmania-control-mode");
            return ["tilt", "joystick", "buttons"].includes(saved) ? saved : "tilt";
        } catch {
            return "tilt";
        }
    }

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
        if (!spectator && state?.phase && state.phase !== "regular") {
            hint.textContent = "Penalty shootout underway.";
        } else if (spectator) {
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
        return started && state !== null && (state.phase ?? "regular") === "regular" && (state.freezeMs ?? 0) <= 0;
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
        predictionPanel.hidden = !spectator || (state?.phase ?? "regular") !== "regular";
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

    function renderShootout() {
        if (!shootoutPanel) return;
        shootoutPanel.hidden = shootoutData == null || shootoutData.phase === "complete";
        document.querySelector(".pitch-shell")?.classList.toggle("shootout-active", !shootoutPanel.hidden);
        if (shootoutPanel.hidden) return;

        const data = shootoutData;
        const standardAttemptsPerTeam = data.standardAttemptsPerTeam ?? 2;
        const secondsLeft = data.phase === "penalty_setup"
            ? Math.max(0, Math.ceil((data.setupEndsAt - Date.now()) / 1000))
            : null;
        const attempt = data.attempt;
        const displayAttempt = attempt ?? (data.phase === "penalty_result" ? lastShootoutResult : null);
        const attemptSecondsLeft = attempt == null
            ? null
            : Math.max(0, Math.ceil((attempt.deadline - Date.now()) / 1000));
        const attackingTeam = displayAttempt?.team ?? null;
        const defendingTeam = attackingTeam == null ? null : (attackingTeam === "home" ? "away" : "home");
        const username = sessionStorage.getItem("username");
        const role = attempt && !spectator
            ? attempt.kicker === username
                ? "kicker"
                : attempt.goalkeeper === username
                    ? "goalkeeper"
                    : null
            : null;
        const roleLocked = role === "kicker" ? attempt?.kickerLocked : role === "goalkeeper" ? attempt?.goalkeeperLocked : true;

        shootoutHeading.textContent = data.phase === "penalty_setup" ? "MATCH TIED" : "PENALTY DUEL";
        shootoutRegularScore.textContent = `${state?.score.home ?? 0} — ${state?.score.away ?? 0}`;
        displayedPenaltyScore ??= data.penaltyScore;
        shootoutPenaltyScore.textContent = `${displayedPenaltyScore.home} — ${displayedPenaltyScore.away}`;
        shootoutRoundLabel.textContent = data.phase === "penalty_setup"
            ? `${standardAttemptsPerTeam} ATTEMPTS EACH`
            : displayAttempt == null
                ? "SHOOTOUT IN PROGRESS"
                : data.suddenDeath
                    ? `SUDDEN DEATH — ROUND ${Math.max(1, Math.ceil((displayAttempt.number - standardAttemptsPerTeam * 2) / 2))}`
                    : `ATTEMPT ${displayAttempt.number} · ROUND ${Math.ceil(displayAttempt.number / 2)} OF ${standardAttemptsPerTeam}`;
        shootoutMatchupLabel.textContent = attackingTeam == null
            ? `${teamNames.home} vs ${teamNames.away}`
            : `${teamNames[attackingTeam]} attacking · ${teamNames[defendingTeam]} defending`;

        if (!(cinematicRunning && data.phase === "penalty_result")) {
            if (data.phase === "penalty_setup") {
                shootoutStatus.textContent = `AURORA SETUP · ${secondsLeft}s remaining`;
            } else if (data.phase === "penalty_attempt") {
                if (role === "kicker") {
                    shootoutStatus.textContent = roleLocked ? `SHOT LOCKED · ${attemptSecondsLeft}s to reveal` : `CHOOSE YOUR SHOT · ${attemptSecondsLeft}s remaining`;
                } else if (role === "goalkeeper") {
                    shootoutStatus.textContent = roleLocked ? `GUESS LOCKED · waiting on the kicker` : `GUESS THE SHOT · ${attemptSecondsLeft}s remaining`;
                } else {
                    shootoutStatus.textContent = `DUEL LIVE · ${attemptSecondsLeft}s remaining`;
                }
            } else if (data.phase === "penalty_result") {
                shootoutStatus.textContent = "REVEALING · RESULT IN FLIGHT";
            } else {
                shootoutStatus.textContent = "AURORA CIRCUIT · SHOOTOUT LIVE";
            }
        }

        duelStage.classList.toggle("is-away", attackingTeam === "away");
        duelKickerName.textContent = displayAttempt?.kicker ?? "Next attacker";
        duelKickerTeam.textContent = attackingTeam == null ? "Attacking team" : `${teamNames[attackingTeam]} · ATTACK`;
        duelKeeperName.textContent = displayAttempt?.goalkeeper ?? data.goalkeepers[defendingTeam] ?? "Keeper pending";
        duelKeeperTeam.textContent = defendingTeam == null ? "Defending team" : `${teamNames[defendingTeam]} · DEFEND`;
        setDuelAvatar(duelKickerAvatar, attempt?.kicker, attackingTeam);
        setDuelAvatar(duelKeeperAvatar, attempt?.goalkeeper ?? data.goalkeepers[defendingTeam], defendingTeam);

        for (const button of shootoutDirectionButtons) {
            const isLocked = data.phase === "penalty_attempt" && role !== null && roleLocked && button.dataset.direction === (role === "kicker" ? (attempt?.kickerLocked ? "left" : null) : null);
            const isAvailable = data.phase === "penalty_attempt" && role !== null && !roleLocked;
            const laneName = button.dataset.direction === "middle" ? "Center" : button.dataset.direction === "left" ? "Left" : "Right";
            button.disabled = data.phase !== "penalty_attempt" || role === null || roleLocked;
            button.setAttribute("aria-label", `${role === "goalkeeper" ? "Defend" : "Shoot"} ${laneName}`);
            button.classList.toggle("locked", Boolean(isLocked));
            button.classList.toggle("active", Boolean(isAvailable));
        }

        const teamPlayers = myTeam == null ? [] : (data.players[myTeam] ?? []);
        const signature = JSON.stringify([myTeam, teamPlayers, data.goalkeepers]);
        if (signature !== shootoutPlayersSignature) {
            shootoutPlayersSignature = signature;
            const selected = data.goalkeepers[myTeam] ?? shootoutGoalkeeper.value;
            shootoutGoalkeeper.replaceChildren();
            for (const username of teamPlayers) {
                const option = document.createElement("option");
                option.value = username;
                option.textContent = username;
                shootoutGoalkeeper.append(option);
            }
            if (teamPlayers.includes(selected)) shootoutGoalkeeper.value = selected;
        }
        shootoutGoalkeeperForm.hidden = data.phase !== "penalty_setup" || spectator || teamPlayers.length === 0;
        shootoutGoalkeeperSubmit.disabled = teamPlayers.length === 0;

        shootoutChoicePrompt.textContent = data.phase === "penalty_setup"
            ? spectator ? "Spectators are watching the setup." : myTeam ? `Select your ${teamNames[myTeam]} goalkeeper.` : "Waiting for team assignments."
            : data.phase !== "penalty_attempt"
                ? "Watch the duel. Player choices stay hidden until reveal."
                : role === "kicker"
                    ? roleLocked ? "SHOT LOCKED · waiting for the keeper." : "CHOOSE YOUR SHOT · select one lane."
                    : role === "goalkeeper"
                        ? roleLocked ? "GUESS LOCKED · waiting for the strike." : "GUESS THE SHOT · choose the lane to cover."
                        : "Spectators and teammates see the reveal with everyone else.";
        for (const button of shootoutDirectionButtons) {
            button.disabled = data.phase !== "penalty_attempt" || role === null || roleLocked;
            button.setAttribute("aria-label", `${role === "goalkeeper" ? "Defend" : "Shoot"} ${button.dataset.direction}`);
        }
    }

    function setDuelAvatar(element, username, team) {
        const colors = team && kits?.[team]?.colors ? kits[team].colors : ["#377b66", "#d5be72"];
        element.textContent = username
            ? username.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()
            : "?";
        element.style.setProperty("--duel-base", colors[0]);
        element.style.setProperty("--duel-accent", colors[1] ?? colors[0]);
    }

    function clearCinematicTimers() {
        while (cinematicTimers.length) clearTimeout(cinematicTimers.pop());
    }

    function clearDuelAnimation() {
        clearCinematicTimers();
        cinematicRunning = false;
        duelStage.classList.remove("cinematic-reveal", "cinematic-charge", "cinematic-flight", "cinematic-dive", "cinematic-goal", "cinematic-save");
        duelStage.style.removeProperty("--flight-x");
        duelStage.style.removeProperty("--flight-y");
        duelStage.style.removeProperty("--keeper-dive");
        duelStage.style.removeProperty("--keeper-tilt");
        for (const direction of ["left", "middle", "right"]) {
            document.querySelector(`.duel-lane[data-direction="${direction}"]`)?.classList.remove("result-goal", "result-save");
            document.getElementById(`duel-kicker-marker-${direction}`).textContent = "SHOT";
            document.getElementById(`duel-keeper-marker-${direction}`).textContent = "SAVE";
        }
    }

    function scheduleCinematic(callback, delay) {
        cinematicTimers.push(setTimeout(callback, delay));
    }

    async function chooseShootoutGoalkeeper() {
        const response = await socket.emitWithAck("game:penalty", {
            action: "goalkeeper",
            username: shootoutGoalkeeper.value,
        });
        if (response.success) {
            navigator.vibrate?.([30, 40, 60]);
        }
        shootoutMessage.textContent = response.success
            ? `${shootoutGoalkeeper.value} set as goalkeeper.`
            : response.reason === "setup_closed"
                ? "Goalkeeper selection has closed."
                : "That player cannot be selected as goalkeeper.";
    }

    async function submitShootoutDirection(event) {
        const response = await socket.emitWithAck("game:penalty", {
            action: "choice",
            direction: event.currentTarget.dataset.direction,
        });
        if (!response.success) {
            shootoutMessage.textContent = response.reason === "choice_locked"
                ? "Your direction is already locked."
                : "You are not assigned to this attempt.";
        } else {
            navigator.vibrate?.([30, 40, 60]);
            shootoutMessage.textContent = "Direction locked. Waiting for the other player.";
        }
    }

    function renderSubstitutionPanel() {
        if (!substitutionPanel || !substitutionData) return;

        const requests = substitutionData.requests;
        const isHost = substitutionData.hostUserId === socketId;
        const relevantRequests = requests.filter((request) =>
            isHost || request.targetPlayerId === socketId || request.spectatorId === socketId
        );
        substitutionPanel.hidden = (state?.phase ?? "regular") !== "regular" || (!spectator && relevantRequests.length === 0);
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
        shootoutData = info.shootout;
        if (info.state) state = info.state;
        if (selectedId === null && myPuckIds.length) {
            selectedId = myPuckIds[0];
        }
        resolveMyTeam();

        kits = resolveKits(teamNames.home, teamNames.away);
        scoreA.style.color = readableKitColor(kits.home);
        scoreB.style.color = readableKitColor(kits.away);
        teamNameA.textContent = teamNames.home;
        teamNameB.textContent = teamNames.away;
        teamScoreA.textContent = state?.score.home ?? 0;
        teamScoreB.textContent = state?.score.away ?? 0;
        setTeamFlag(flagA, kits.home);
        setTeamFlag(flagB, kits.away);

        setupStadium();
        fitOrientation();

        if (!spectator && (state?.phase ?? "regular") === "regular") {
            bindInput();
        } else {
            enableBtn.hidden = true;
            gauge.hidden = true;
        }

        updateMobileControls();
        updateHint();
        renderSubstitutionPanel();
        refreshPredictionPanel();
        renderShootout();
    }

    function resolveMyTeam() {
        if (myTeam !== null || !myPuckIds.length || !state) return;
        const mine = state.pucks.find((p) => myPuckIds.includes(p.id));
        myTeam = mine ? mine.team : null;
        updateFlip();
    }

    // Landscape uses the CSS stadium surround; portrait keeps the bare pitch.
    function setupStadium() {
        container.classList.add("in-stadium");
    }

    function setTeamFlag(flag, kit) {
        const [primary, secondary] = kit.colors;
        flag.style.background = `linear-gradient(180deg, ${primary} 0 33%, ${secondary} 33% 66%, ${primary} 66% 100%)`;
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
        const now = Date.now();
        if (lastBallSnapshot && !reduceMotion && Math.hypot(s.ball.vx, s.ball.vy) >= 18) {
            const moved = Math.hypot(s.ball.x - lastBallSnapshot.x, s.ball.y - lastBallSnapshot.y);
            if (moved > 1) {
                ballTrail.push({ x: lastBallSnapshot.x, y: lastBallSnapshot.y, at: now });
                if (ballTrail.length > 10) ballTrail.shift();
            }
        }
        lastBallSnapshot = { x: s.ball.x, y: s.ball.y };
        if ((s.phase ?? "regular") !== "regular") {
            keys.clear();
            inputDir = { x: 0, y: 0 };
            resetKick();
            unbindInput();
            gauge.hidden = true;
            enableBtn.hidden = true;
        } else if (!spectator) {
            bindInput();
            gauge.hidden = false;
        }
        updateMobileControls();
        resolveMyTeam();
        teamScoreA.textContent = s.score.home;
        teamScoreB.textContent = s.score.away;
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
        if (s.controllingPuckId !== null && s.controllingPuckId !== prevControllerId) {
            puckReactionUntil.set(s.controllingPuckId, now + 260);
        }
        prevControllerId = s.controllingPuckId;
        prevControllerTeam = s.controllingPuckId === null
            ? null
            : (s.pucks.find((p) => p.id === s.controllingPuckId)?.team ?? null);

        // Snapshots refresh shared state, but do not overwrite the selected
        // puck's local prediction; other pucks and the ball are smoothed below.

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
        renderShootout();
        if ((s.phase ?? "regular") !== "regular") updateHint();
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
        }

        updateMobileControls();
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
    let goalFlashTimer = null;

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
        container.classList.add("goal-flash");
        clearTimeout(goalFlashTimer);
        goalFlashTimer = setTimeout(() => container.classList.remove("goal-flash"), 520);
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

    function onShootoutUpdate(data) {
        const previousAttempt = shootoutData?.attempt?.number;
        shootoutData = data;
        const attemptChanged = data.attempt?.number != null && data.attempt.number !== previousAttempt;
        if (attemptChanged) {
            clearDuelAnimation();
            lastShootoutResult = null;
            displayedPenaltyScore = data.penaltyScore;
            shootoutMessage.textContent = "";
        }
        if (!(cinematicRunning && data.phase === "penalty_result")) renderShootout();
    }

    function onShootoutResult(result) {
        lastShootoutResult = result;
        if (shootoutData) {
            shootoutData = { ...shootoutData, phase: "penalty_result", penaltyScore: result.penaltyScore, attempt: null };
        }
        clearDuelAnimation();
        cinematicRunning = true;
        renderShootout();
        duelStage.classList.add("cinematic-reveal");
        shootoutStatus.textContent = "CHOICES REVEALED";
        if (result.kickerChoice) {
            document.getElementById(`duel-kicker-marker-${result.kickerChoice}`).textContent = "SHOT";
        }
        if (result.goalkeeperChoice) {
            document.getElementById(`duel-keeper-marker-${result.goalkeeperChoice}`).textContent = "SAVE";
        }
        const targetDirection = result.kickerChoice ?? "middle";
        const targetLane = shootoutDirectionButtons.find((button) => button.dataset.direction === targetDirection);
        const pulseBounds = duelPulse.getBoundingClientRect();
        const laneBounds = targetLane?.getBoundingClientRect() ?? pulseBounds;
        const flightX = laneBounds.left + laneBounds.width / 2 - (pulseBounds.left + pulseBounds.width / 2);
        const flightY = laneBounds.top + laneBounds.height / 2 - (pulseBounds.top + pulseBounds.height / 2);
        const keeperOffset = { left: -56, middle: 0, right: 56 }[result.goalkeeperChoice] ?? 0;
        const keeperDirection = result.team === "home" ? 1 : -1;
        duelStage.style.setProperty("--flight-x", `${flightX}px`);
        duelStage.style.setProperty("--flight-y", `${flightY}px`);
        duelStage.style.setProperty("--keeper-dive", `${keeperDirection * keeperOffset}px`);
        duelStage.style.setProperty("--keeper-tilt", result.goalkeeperChoice === "left" ? "-18deg" : result.goalkeeperChoice === "right" ? "18deg" : "0deg");

        scheduleCinematic(() => {
            duelStage.classList.add("cinematic-charge");
            shootoutStatus.textContent = "PULSE CHARGING";
        }, 280);
        scheduleCinematic(() => {
            duelStage.classList.remove("cinematic-charge");
            duelStage.classList.add("cinematic-flight");
            shootoutStatus.textContent = "PULSE IN FLIGHT";
        }, 760);
        scheduleCinematic(() => {
            duelStage.classList.add("cinematic-dive");
            shootoutStatus.textContent = "THE KEEPER DIVES";
        }, 1280);
        scheduleCinematic(() => {
            duelStage.classList.add(result.scored ? "cinematic-goal" : "cinematic-save");
            if (result.kickerChoice) {
                const shotLane = shootoutDirectionButtons.find((button) => button.dataset.direction === result.kickerChoice);
                shotLane?.classList.add(result.scored ? "result-goal" : "result-save");
            }
            displayedPenaltyScore = result.penaltyScore;
            shootoutPenaltyScore.textContent = `${displayedPenaltyScore.home} — ${displayedPenaltyScore.away}`;
            shootoutStatus.textContent = result.scored ? "GOAL · GATE BREACHED" : "SAVED · GATE HELD";
            const kickerChoice = result.kickerChoice ?? "no kick (timeout)";
            shootoutMessage.textContent = `${result.kicker}: ${kickerChoice} · ${result.goalkeeper}: ${result.goalkeeperChoice}`;
        }, 1840);
        renderShootout();
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
    socket.on("game:penalty-update", onShootoutUpdate);
    socket.on("game:penalty-result", onShootoutResult);
    socket.on("game:kicked", onKicked);
    socket.on("game:powerup", onPowerup);
    socket.on("game:substitution-update", onSubstitutionUpdate);
    socket.on("game:substitution-notice", onSubstitutionNotice);
    socket.on("game:substitution-role", onSubstitutionRole);
    socket.on("game:substituted", onSubstituted);

    substitutionRequestButton.addEventListener("click", requestSubstitution);
    substitutionTarget.addEventListener("change", refreshSubstitutionAvailability);
    predictionSubmit.addEventListener("click", submitPrediction);
    shootoutGoalkeeperSubmit.addEventListener("click", chooseShootoutGoalkeeper);
    for (const button of shootoutDirectionButtons) button.addEventListener("click", submitShootoutDirection);
    const shootoutClockTimer = setInterval(renderShootout, 250);

    // ---- Drawing --------------------------------------------------------

    function drawField() {
        const { FIELD } = constants;
        const half = state.goalHalfWidths ?? { home: constants.GOAL_HALF_WIDTH, away: constants.GOAL_HALF_WIDTH };

        ctx.fillStyle = "#2e8b57";
        ctx.fillRect(0, 0, FIELD.width, FIELD.height);

        const stripeWidth = FIELD.width / 10;
        for (let stripe = 0; stripe < 10; stripe++) {
            ctx.fillStyle = stripe % 2 === 0 ? "rgba(255, 255, 255, 0.035)" : "rgba(0, 0, 0, 0.035)";
            ctx.fillRect(stripe * stripeWidth, 0, stripeWidth, FIELD.height);
        }

        const edgeShade = ctx.createRadialGradient(
            FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.18,
            FIELD.width / 2, FIELD.height / 2, FIELD.width * 0.62
        );
        edgeShade.addColorStop(0, "rgba(0, 0, 0, 0)");
        edgeShade.addColorStop(1, "rgba(0, 0, 0, 0.2)");
        ctx.fillStyle = edgeShade;
        ctx.fillRect(0, 0, FIELD.width, FIELD.height);

        ctx.save();
        ctx.strokeStyle = "rgba(220, 255, 235, 0.13)";
        ctx.lineWidth = 1;
        for (const goalX of [5, FIELD.width - 85]) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(goalX, FIELD.height / 2 - 80, 80, 160);
            ctx.clip();
            for (let x = goalX; x <= goalX + 80; x += 12) {
                ctx.beginPath();
                ctx.moveTo(x, FIELD.height / 2 - 80);
                ctx.lineTo(x, FIELD.height / 2 + 80);
                ctx.stroke();
            }
            for (let y = FIELD.height / 2 - 80; y <= FIELD.height / 2 + 80; y += 12) {
                ctx.beginPath();
                ctx.moveTo(goalX, y);
                ctx.lineTo(goalX + 80, y);
                ctx.stroke();
            }
            ctx.restore();
        }
        ctx.restore();

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

    function drawPlayerFigure(puck, pos, radius) {
        const angle = puck.facingAngle ?? (puck.team === "home" ? 0 : Math.PI);
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(angle);

        ctx.fillStyle = "rgba(10, 20, 22, 0.72)";
        ctx.beginPath();
        ctx.ellipse(-radius * 0.22, 0, radius * 0.3, radius * 0.38, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#f2d0a8";
        ctx.strokeStyle = "rgba(15, 22, 25, 0.85)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(radius * 0.48, 0, radius * 0.31, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(radius * 0.72, -radius * 0.14);
        ctx.lineTo(radius * 0.98, 0);
        ctx.lineTo(radius * 0.72, radius * 0.14);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // Active-powerup rings around a puck (read straight from the state flags).
    function drawEffects(puck, pos) {
        const r = constants.PUCK_RADIUS;
        const powerups = constants.POWERUPS;
        drawEffectTimer(pos, r + 5, puck.speedRemainingMs, powerups.speed.durationMs, powerups.speed.color);
        drawEffectTimer(pos, r + 9, puck.phonkRemainingMs, powerups.phonk.durationMs, powerups.phonk.color);
        if (puck.powershot) {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, r + 6, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255, 85, 51, 0.95)";
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    }

    // The arc shrinks with the server-reported time left in the effect.
    function drawEffectTimer(pos, radius, remainingMs, durationMs, color) {
        if (!Number.isFinite(remainingMs) || remainingMs <= 0 || durationMs <= 0) return;
        const progress = Math.min(remainingMs / durationMs, 1);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
    }

    function drawTokens() {
        if (!state.tokens) return;
        for (const token of state.tokens) {
            const meta = constants.POWERUPS[token.type];
            const pulse = reduceMotion ? 0 : Math.sin(Date.now() / 240 + token.id) * 1.2;
            const radius = constants.TOKEN_RADIUS + pulse;
            ctx.save();
            ctx.shadowColor = meta ? meta.color : "#fff";
            ctx.shadowBlur = reduceMotion ? 0 : 10;
            ctx.beginPath();
            ctx.arc(token.x, token.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = meta ? meta.color : "#fff";
            ctx.fill();
            ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            drawPowerupIcon(token);
        }
    }

    function drawPowerupIcon(token) {
        ctx.save();
        ctx.translate(token.x, token.y);
        ctx.strokeStyle = "rgba(12, 24, 28, 0.92)";
        ctx.fillStyle = "rgba(12, 24, 28, 0.92)";
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        if (token.type === "powershot") {
            ctx.beginPath();
            ctx.moveTo(1, -8);
            ctx.lineTo(-5, 1);
            ctx.lineTo(-1, 1);
            ctx.lineTo(-3, 8);
            ctx.lineTo(5, -2);
            ctx.lineTo(1, -2);
            ctx.closePath();
            ctx.fill();
        } else if (token.type === "speed") {
            for (const y of [-5, 0, 5]) {
                ctx.beginPath();
                ctx.moveTo(-7, y);
                ctx.lineTo(2, y);
                ctx.lineTo(-1, y - 3);
                ctx.moveTo(2, y);
                ctx.lineTo(-1, y + 3);
                ctx.stroke();
            }
        } else if (token.type === "getball") {
            ctx.beginPath();
            ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(0, 0, 8, -0.8, 0.8);
            ctx.stroke();
        } else if (token.type === "phonk") {
            ctx.beginPath();
            ctx.moveTo(2, -7);
            ctx.lineTo(2, 3);
            ctx.lineTo(7, 1);
            ctx.lineTo(7, -6);
            ctx.lineTo(2, -7);
            ctx.moveTo(2, 3);
            ctx.ellipse(-1, 5, 3, 2, -0.3, 0, Math.PI * 2);
            ctx.stroke();
        } else if (token.type === "biggoal") {
            ctx.strokeRect(-7, -7, 14, 14);
            ctx.beginPath();
            ctx.moveTo(-2, -7);
            ctx.lineTo(-2, 7);
            ctx.moveTo(3, -7);
            ctx.lineTo(3, 7);
            ctx.moveTo(-7, -2);
            ctx.lineTo(7, -2);
            ctx.moveTo(-7, 3);
            ctx.lineTo(7, 3);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawPucks() {
        for (const puck of state.pucks) {
            const sourcePos = displayPos(puck);
            const moving = puck.moving || (puck.id === selectedId && Math.hypot(inputDir.x, inputDir.y) > 0);
            const bounce = moving && !reduceMotion ? Math.abs(Math.sin(Date.now() / 70 + puck.id)) * 1.4 : 0;
            const pos = { x: sourcePos.x, y: sourcePos.y - bounce };

            drawEffects(puck, pos);

            const reactionRemaining = (puckReactionUntil.get(puck.id) ?? 0) - Date.now();
            if (reactionRemaining > 0) {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, constants.PUCK_RADIUS + 10 * (1 - reactionRemaining / 260), 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(reactionRemaining / 120, 0.8)})`;
                ctx.lineWidth = 2;
                ctx.stroke();
            }

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
            drawPlayerFigure(puck, pos, constants.PUCK_RADIUS);
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

    // Brief trail points come from fast server snapshots and are skipped for reduced motion.
    function drawBall() {
        const pos = ballPos();
        const now = Date.now();
        while (ballTrail.length && now - ballTrail[0].at > 260) ballTrail.shift();
        for (const point of ballTrail) {
            const alpha = 1 - (now - point.at) / 260;
            ctx.beginPath();
            ctx.arc(point.x, point.y, constants.BALL_RADIUS * (0.45 + alpha * 0.45), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 238, 172, ${alpha * 0.42})`;
            ctx.fill();
        }
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
        const previewLength = 170;
        const tipX = pos.x + Math.cos(aimAngle) * previewLength;
        const tipY = pos.y + Math.sin(aimAngle) * previewLength;

        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(tipX, tipY);
        ctx.setLineDash([5, 7]);
        ctx.strokeStyle = "rgba(255, 246, 170, 0.88)";
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.setLineDash([]);

        const headLength = 13;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - Math.cos(aimAngle - 0.48) * headLength, tipY - Math.sin(aimAngle - 0.48) * headLength);
        ctx.lineTo(tipX - Math.cos(aimAngle + 0.48) * headLength, tipY - Math.sin(aimAngle + 0.48) * headLength);
        ctx.closePath();
        ctx.fillStyle = "#fff2a6";
        ctx.fill();
    }

    // Text overlays (usernames and kit numbers); drawn without the
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

        if (state.goalBoost) {
            const team = state.goalBoost.team;
            const worldX = team === "home" ? 48 : constants.FIELD.width - 48;
            const point = toCanvas(worldX, constants.FIELD.height / 2 + 96);
            ctx.font = "bold 10px sans-serif";
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
            ctx.strokeText(`BIG GOAL ${Math.ceil(state.goalBoost.remainingMs / 1000)}s`, point.x, point.y);
            ctx.fillStyle = constants.POWERUPS.biggoal.color;
            ctx.fillText(`BIG GOAL ${Math.ceil(state.goalBoost.remainingMs / 1000)}s`, point.x, point.y);
        }

    }

    // ---- Input (movement) ------------------------------------------------

    function tiltToInput(deg) {
        if (Math.abs(deg) < TILT_DEAD) return 0;
        return Math.min(Math.max(deg / TILT_FULL, -1), 1);
    }

    // Input priority is keyboard, selected visible touch control, then tilt.
    // The result stays in view space until the movement tick rotates it to world space.
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
        if (!mobileControls?.hidden && controlMode === "joystick") return joystickInput;
        if (!mobileControls?.hidden && controlMode === "buttons") {
            let x = Number(pressedDirections.has("right")) - Number(pressedDirections.has("left"));
            let y = Number(pressedDirections.has("down")) - Number(pressedDirections.has("up"));
            const length = Math.hypot(x, y);
            if (length > 1) {
                x /= length;
                y /= length;
            }
            return { x, y };
        }
        return { x: tiltToInput(tiltX), y: tiltToInput(tiltY) };
    }

    // Changing modes clears stale input, updates the controls, and saves the preference.
    function setControlMode(mode) {
        if (!["tilt", "joystick", "buttons"].includes(mode)) return;
        controlMode = mode;
        try {
            localStorage.setItem("foosmania-control-mode", mode);
        } catch {
            // The mode remains usable for this page even if storage is unavailable.
        }
        joystickInput = { x: 0, y: 0 };
        pressedDirections.clear();
        joystickKnob.style.transform = "translate(-50%, -50%)";
        for (const button of directionButtons) button.classList.remove("is-pressed");
        for (const button of controlModeButtons) {
            button.setAttribute("aria-pressed", String(button.dataset.controlMode === mode));
        }
        joystickBase.hidden = mode !== "joystick";
        buttonPad.hidden = mode !== "buttons";

        if (mode === "tilt" && motionEnabled) {
            window.addEventListener(orientationEvent, onOrientation);
            window.addEventListener("devicemotion", onMotion);
        } else {
            window.removeEventListener(orientationEvent, onOrientation);
            window.removeEventListener("devicemotion", onMotion);
        }
        maybeShowMotionButton();
    }

    function updateMobileControls() {
        const visible = touchDevice && !spectator && (state?.phase ?? "regular") === "regular";
        mobileControls.hidden = !visible;
        document.querySelector(".pitch-shell")?.classList.toggle("mobile-controls-active", visible);
        if (!visible) {
            enableBtn.hidden = true;
            return;
        }
        for (const button of controlModeButtons) {
            button.setAttribute("aria-pressed", String(button.dataset.controlMode === controlMode));
        }
        joystickBase.hidden = controlMode !== "joystick";
        buttonPad.hidden = controlMode !== "buttons";
        maybeShowMotionButton();
    }

    // Clamp diagonal drags to the joystick's circular travel limit.
    function updateJoystick(e) {
        const rect = joystickBase.getBoundingClientRect();
        const radius = Math.min(rect.width, rect.height) / 2 - 17;
        let x = (e.clientX - (rect.left + rect.width / 2)) / radius;
        let y = (e.clientY - (rect.top + rect.height / 2)) / radius;
        const length = Math.hypot(x, y);
        if (length > 1) {
            x /= length;
            y /= length;
        }
        joystickInput = { x, y };
        joystickKnob.style.transform = `translate(calc(-50% + ${x * radius}px), calc(-50% + ${y * radius}px))`;
    }

    // Capture the pointer so drags continue even when the finger leaves the base.
    function onJoystickDown(e) {
        e.preventDefault();
        joystickPointerId = e.pointerId;
        joystickBase.setPointerCapture(e.pointerId);
        updateJoystick(e);
    }

    function onJoystickMove(e) {
        if (e.pointerId === joystickPointerId) updateJoystick(e);
    }

    // Release/cancel/lost capture all return movement input to neutral.
    function resetJoystick(e) {
        if (e.pointerId !== joystickPointerId) return;
        joystickPointerId = null;
        joystickInput = { x: 0, y: 0 };
        joystickKnob.style.transform = "translate(-50%, -50%)";
    }

    function onDirectionDown(e) {
        e.preventDefault();
        const direction = e.currentTarget.dataset.moveDirection;
        pressedDirections.add(direction);
        e.currentTarget.classList.add("is-pressed");
        e.currentTarget.setPointerCapture(e.pointerId);
    }

    function onDirectionUp(e) {
        const direction = e.currentTarget.dataset.moveDirection;
        pressedDirections.delete(direction);
        e.currentTarget.classList.remove("is-pressed");
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

        if ((state.phase ?? "regular") !== "regular") {
            predicted.x = puck.x;
            predicted.y = puck.y;
            inputDir = { x: 0, y: 0 };
            return;
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
        if (spectator || !matchIsLive()) return;
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
            let charge = 0;
            if (aiming) {
                charge = currentAimPower();
            } else if (spaceCharging) {
                charge = Math.min((Date.now() - spaceChargeStart) / CHARGE_MS, 1);
            }
            gaugeFill.style.width = `${charge * 100}%`;
            chargeReadout.textContent = `POWER ${Math.round(charge * 100)}%`;
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
        if (spectator || !matchIsLive() || selectedId === null || predicted === null) return;
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
        if (Number.isFinite(e.beta) && Number.isFinite(e.gamma)) {
            orientationDetected = true;
            motionControlsEnabled = true;
            motionPermissionPending = false;
            enableBtn.disabled = false;
            enableBtn.hidden = true;
            clearTimeout(motionDetectionTimer);
            motionDetectionTimer = null;
        }

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

    const orientationEvent = "deviceorientation";

    function onControlModeClick(e) {
        setControlMode(e.currentTarget.dataset.controlMode);
    }

    // Only touch devices get the "Enable motion controls" button; desktop
    // uses WASD and never needs it.
    function maybeShowMotionButton() {
        const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
        const supportsOrientation = typeof DeviceOrientationEvent !== "undefined";
        enableBtn.hidden = !(touch && supportsOrientation) || motionControlsEnabled || motionPermissionPending;
    }

    // iOS only delivers sensor events after requestPermission() from a tap.
    // Start both permission prompts before awaiting either one to preserve
    // the browser's transient user activation for both APIs.
    async function enableMotionControls() {
        if (motionPermissionPending || motionControlsEnabled) return;
        if (window.isSecureContext === false) {
            hint.textContent = "Motion controls require HTTPS on mobile. Open this game using a secure connection.";
            return;
        }

        motionPermissionPending = true;
        orientationDetected = false;
        enableBtn.disabled = true;
        try {
            const requests = [];
            if (typeof DeviceOrientationEvent !== "undefined" &&
                typeof DeviceOrientationEvent.requestPermission === "function") {
                requests.push({
                    type: "orientation",
                    promise: DeviceOrientationEvent.requestPermission(),
                });
            }
            if (typeof DeviceMotionEvent !== "undefined" &&
                typeof DeviceMotionEvent.requestPermission === "function") {
                requests.push({
                    type: "motion",
                    promise: DeviceMotionEvent.requestPermission(),
                });
            }

            const permissionResults = await Promise.allSettled(requests.map((request) => request.promise));
            const orientationIndex = requests.findIndex((request) => request.type === "orientation");
            if (orientationIndex !== -1) {
                const orientationResult = permissionResults[orientationIndex];
                if (orientationResult.status === "rejected" || orientationResult.value !== "granted") {
                    throw orientationResult.status === "rejected"
                        ? orientationResult.reason
                        : new Error("Device orientation permission was denied.");
                }
            }

            window.addEventListener(orientationEvent, onOrientation, { passive: true });
            window.addEventListener("devicemotion", onMotion, { passive: true });
            motionPermissionPending = true;
            enableBtn.hidden = true;
            const motionIndex = requests.findIndex((request) => request.type === "motion");
            const motionDenied = motionIndex !== -1 &&
                (permissionResults[motionIndex].status === "rejected" || permissionResults[motionIndex].value !== "granted");
            if (motionDenied) {
                hint.textContent = "Tilt controls are enabled. Drag to aim kicks if motion access is unavailable.";
            }
            motionDetectionTimer = setTimeout(() => {
                motionDetectionTimer = null;
                if (orientationDetected) return;
                motionPermissionPending = false;
                enableBtn.disabled = false;
                maybeShowMotionButton();
                hint.textContent = "No tilt data received. Check your browser's motion permissions and try again.";
            }, 2500);
        } catch (err) {
            motionPermissionPending = false;
            enableBtn.disabled = false;
            maybeShowMotionButton();
            hint.textContent = "Motion permission was not granted. Allow motion access in your browser settings, then try again.";
            console.warn("Unable to enable motion controls:", err);
        }
    }
    enableBtn.addEventListener("click", enableMotionControls);

    for (const button of controlModeButtons) {
        button.addEventListener("click", onControlModeClick);
    }
    joystickBase.addEventListener("pointerdown", onJoystickDown);
    joystickBase.addEventListener("pointermove", onJoystickMove);
    joystickBase.addEventListener("pointerup", resetJoystick);
    joystickBase.addEventListener("pointercancel", resetJoystick);
    joystickBase.addEventListener("lostpointercapture", resetJoystick);
    for (const button of directionButtons) {
        button.addEventListener("pointerdown", onDirectionDown);
        button.addEventListener("pointerup", onDirectionUp);
        button.addEventListener("pointercancel", onDirectionUp);
        button.addEventListener("lostpointercapture", onDirectionUp);
    }

    // ---- Cosmetics ------------------------------------------------------

    function confettiBurst() {
        if (!confettiHolder || reduceMotion) return;
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
        clearTimeout(goalFlashTimer);
        clearTimeout(powerupToastTimer);
        clearTimeout(motionDetectionTimer);
        clearInterval(shootoutClockTimer);
        socket.off("connect", join);
        socket.off("game:started", onStarted);
        socket.off("game:state", onState);
        socket.off("game:ended", onEnded);
        socket.off("game:goal", onGoal);
        socket.off("game:prediction-result", onPredictionResult);
        socket.off("game:penalty-update", onShootoutUpdate);
        socket.off("game:penalty-result", onShootoutResult);
        socket.off("game:kicked", onKicked);
        socket.off("game:powerup", onPowerup);
        socket.off("game:substitution-update", onSubstitutionUpdate);
        socket.off("game:substitution-notice", onSubstitutionNotice);
        socket.off("game:substitution-role", onSubstitutionRole);
        socket.off("game:substituted", onSubstituted);
        substitutionRequestButton.removeEventListener("click", requestSubstitution);
        enableBtn.removeEventListener("click", enableMotionControls);
        substitutionTarget.removeEventListener("change", refreshSubstitutionAvailability);
        predictionSubmit.removeEventListener("click", submitPrediction);
        shootoutGoalkeeperSubmit.removeEventListener("click", chooseShootoutGoalkeeper);
        for (const button of shootoutDirectionButtons) button.removeEventListener("click", submitShootoutDirection);
        for (const button of controlModeButtons) button.removeEventListener("click", onControlModeClick);
        joystickBase.removeEventListener("pointerdown", onJoystickDown);
        joystickBase.removeEventListener("pointermove", onJoystickMove);
        joystickBase.removeEventListener("pointerup", resetJoystick);
        joystickBase.removeEventListener("pointercancel", resetJoystick);
        joystickBase.removeEventListener("lostpointercapture", resetJoystick);
        for (const button of directionButtons) {
            button.removeEventListener("pointerdown", onDirectionDown);
            button.removeEventListener("pointerup", onDirectionUp);
            button.removeEventListener("pointercancel", onDirectionUp);
            button.removeEventListener("lostpointercapture", onDirectionUp);
        }
        unbindInput();
        window.removeEventListener("resize", fitOrientation);
        window.removeEventListener(orientationEvent, onOrientation);
        window.removeEventListener("devicemotion", onMotion);
    };
})();
