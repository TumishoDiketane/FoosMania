// Full-time stats view. The match summary arrives via the game:ended event
// on the pitch, which stashes it in sessionStorage before navigating here —
// so a refresh (or arriving with no match played) falls back to home.
//
// Uses the shared `socket` and `username` globals from socket.js and the kit
// helpers from kits.js.
(function () {
    const raw = sessionStorage.getItem("matchStats");
    if (raw == null) {
        navigateTo("/home");
        return;
    }
    const summary = JSON.parse(raw);
    const username = sessionStorage.getItem("username") ?? null;

    const finalScore = document.getElementById("final-score");
    const winnerLine = document.getElementById("winner-line");
    const myStatsSection = document.getElementById("my-stats-section");
    const bootList = document.getElementById("boot-list");
    const predictionStatsSection = document.getElementById("prediction-stats-section");
    const predictionList = document.getElementById("prediction-list");
    const shootoutStatsSection = document.getElementById("shootout-stats-section");
    const shootoutFinalScore = document.getElementById("shootout-final-score");
    const shootoutGoalkeepers = document.getElementById("shootout-goalkeepers");
    const shootoutAttemptList = document.getElementById("shootout-attempt-list");
    const homeButton = document.getElementById("home-button");

    const kits = resolveKits(summary.teamNames.home, summary.teamNames.away);
    const teamColor = {
        home: readableKitColor(kits.home),
        away: readableKitColor(kits.away),
    };

    // Final score, team names in their kit colours.
    finalScore.innerHTML = "";
    const homeSpan = document.createElement("span");
    homeSpan.textContent = `${summary.teamNames.home} ${summary.score.home}`;
    homeSpan.style.color = teamColor.home;
    const dash = document.createElement("span");
    dash.textContent = "-";
    const awaySpan = document.createElement("span");
    awaySpan.textContent = `${summary.score.away} ${summary.teamNames.away}`;
    awaySpan.style.color = teamColor.away;
    finalScore.append(homeSpan, dash, awaySpan);

    winnerLine.textContent = summary.shootout
        ? `${summary.teamNames[summary.shootout.winner]} win the penalty shootout!`
        : summary.winner === "draw"
            ? "It's a draw!"
            : `${summary.teamNames[summary.winner]} win the match!`;

    // Full-time whistle (no-ops if the file is blocked/missing).
    if (typeof playSound === "function") {
        playSound("endgame");
    }

    // Your detailed stats.
    const mine = summary.stats.find((entry) => entry.username === username);
    if (mine) {
        document.getElementById("stat-touches").textContent = mine.touches;
        document.getElementById("stat-passes").textContent = mine.passes;
        document.getElementById("stat-shots").textContent = mine.shots;
        document.getElementById("stat-goals").textContent = mine.goals;
    } else {
        myStatsSection.hidden = true; // spectator
    }

    // Golden boot race: everyone, top scorer first.
    const ranked = [...summary.stats].sort(
        (a, b) => b.goals - a.goals || b.shots - a.shots || a.username.localeCompare(b.username)
    );
    const maxGoals = Math.max(1, ...ranked.map((entry) => entry.goals));

    bootList.innerHTML = "";
    ranked.forEach((entry, index) => {
        const row = document.createElement("div");
        row.className = "boot-row";

        const rank = document.createElement("span");
        rank.className = "boot-rank";
        rank.textContent = index === 0 && entry.goals > 0 ? "👢" : `${index + 1}.`;

        const player = document.createElement("div");
        player.className = "boot-player";
        const name = document.createElement("div");
        name.className = "boot-name";
        name.textContent = entry.username;
        name.style.color = teamColor[entry.team] ?? "#fff";
        if (entry.username === username) {
            const you = document.createElement("span");
            you.className = "you-tag";
            you.textContent = " (you)";
            name.append(you);
        }
        const bar = document.createElement("div");
        bar.className = "boot-bar";
        const fill = document.createElement("div");
        fill.className = "boot-bar-fill";
        fill.style.width = `${(entry.goals / maxGoals) * 100}%`;
        fill.style.background = teamColor[entry.team] ?? "#fff";
        bar.append(fill);
        player.append(name, bar);

        const goals = document.createElement("span");
        goals.className = "boot-goals";
        goals.textContent = entry.goals;

        row.append(rank, player, goals);
        bootList.append(row);
    });

    const predictionStats = summary.predictions ?? [];
    predictionStatsSection.hidden = predictionStats.length === 0;
    for (const entry of predictionStats) {
        const row = document.createElement("div");
        row.className = "prediction-stat-row";
        const spectator = document.createElement("strong");
        spectator.textContent = entry.username;
        const record = document.createElement("span");
        const pointsChange = Number(entry.pointsChange ?? 0);
        record.textContent = `${entry.correct} correct, ${entry.incorrect} incorrect, ${entry.void} void, ${entry.expired ?? 0} expired · ${pointsChange > 0 ? "+" : ""}${pointsChange} points`;
        row.append(spectator, record);
        predictionList.append(row);
    }

    const shootout = summary.shootout;
    shootoutStatsSection.hidden = shootout == null;
    if (shootout) {
        shootoutFinalScore.textContent = `Penalties: ${summary.teamNames.home} ${shootout.penaltyScore.home} - ${shootout.penaltyScore.away} ${summary.teamNames.away}`;
        shootoutGoalkeepers.textContent = `Goalkeepers: ${summary.teamNames.home} ${shootout.goalkeepers.home}; ${summary.teamNames.away} ${shootout.goalkeepers.away}`;
        for (const attempt of shootout.attempts) {
            const row = document.createElement("div");
            row.className = "shootout-attempt-row";
            const kickerChoice = attempt.kickerChoice ?? "no kick (timeout)";
            const outcome = attempt.scored ? "goal" : "saved";
            row.textContent = `Attempt ${attempt.number}${attempt.suddenDeath ? " (sudden death)" : ""}: ${summary.teamNames[attempt.team]} · ${attempt.kicker ?? "No kicker"} (${kickerChoice}) vs ${attempt.goalkeeper} (${attempt.goalkeeperChoice}) · ${outcome}`;
            shootoutAttemptList.append(row);
        }
    }

    // The match is done: leave the room and head home. Use a hard navigation
    // here so the redirect still works even if the socket round-trip is slow.
    homeButton.addEventListener("click", () => {
        try {
            socket?.emit?.("room:leave", null);
        } catch (error) {
            console.warn("Failed to leave room from stats screen:", error);
        }

        sessionStorage.removeItem("matchStats");
        window.location.assign("/home");
    });
})();
