const DIRECTIONS = new Set(['left', 'middle', 'right']);
const TEAMS = ['home', 'away'];
const SETUP_DURATION_MS = 10000;
const CHOICE_DURATION_MS = 15000;
const RESULT_PAUSE_MS = 3200;
const FINAL_RESULT_PAUSE_MS = 3200;
const STANDARD_ATTEMPTS_PER_TEAM = 5;

const shootouts = new WeakMap();

function activeRoster(room, team) {
	const usernames = new Set(Object.values(room.pucks ?? {})
		.filter((puck) => puck.team === team && puck.username != null)
		.map((puck) => puck.username));
	return Object.entries(room.users ?? {})
		.filter(([, user]) => user.team === team && usernames.has(user.username))
		.map(([id, user]) => ({ id, username: user.username }))
		.sort((first, second) => first.username.localeCompare(second.username) || first.id.localeCompare(second.id));
}

function getShootout(room) {
	return room.game == null ? null : shootouts.get(room.game) ?? null;
}

function clearTimer(state) {
	if (state.timer != null) {
		clearTimeout(state.timer);
		state.timer = null;
	}
}

function schedule(state, callback, delay) {
	clearTimer(state);
	state.timer = setTimeout(() => {
		state.timer = null;
		callback();
	}, Math.max(0, delay));
}

function publicState(state) {
	return {
		phase: state.phase,
		notice: state.phase === 'penalty_setup' ? 'MATCH TIED. Penalty shootout starting. Each team gets 5 attempts.' : null,
		setupEndsAt: state.phase === 'penalty_setup' ? state.setupEndsAt : null,
		goalkeepers: { ...state.goalkeepers },
		players: {
			home: state.rosters.home.map((player) => player.username),
			away: state.rosters.away.map((player) => player.username),
		},
		penaltyScore: { ...state.penaltyScore },
		standardAttemptsPerTeam: STANDARD_ATTEMPTS_PER_TEAM,
		suddenDeath: state.suddenDeath,
		attempt: state.currentAttempt == null ? null : {
			number: state.currentAttempt.number,
			team: state.currentAttempt.team,
			kicker: state.currentAttempt.kicker,
			goalkeeper: state.currentAttempt.goalkeeper,
			deadline: state.currentAttempt.deadline,
			kickerLocked: state.currentAttempt.choices.kicker !== null,
			goalkeeperLocked: state.currentAttempt.choices.goalkeeper !== null,
		},
	};
}

function broadcast(io, state) {
	io.to(state.room.id).emit('game:penalty-update', publicState(state));
}

function selectGoalkeeper(state, team) {
	const roster = state.rosters[team];
	const previous = state.room.shootoutGoalkeepers?.[team];
	if (roster.some((player) => player.username === previous)) return previous;
	return roster[0]?.username ?? null;
}

function completeShootout(state) {
	clearTimer(state);
	state.phase = 'complete';
	state.room.game.phase = state.phase;
	state.room.shootoutGoalkeepers = { ...state.goalkeepers };
	const result = {
		winner: state.winner,
		penaltyScore: { ...state.penaltyScore },
		goalkeepers: { ...state.goalkeepers },
		attempts: state.attempts.map((attempt) => ({ ...attempt })),
		suddenDeath: state.suddenDeath,
	};
	state.io.to(state.room.id).emit('game:penalty-finished', result);
	schedule(state, () => state.onComplete(result), state.finalResultPauseMs);
}

function determineWinner(state) {
	if (state.penaltyScore.home !== state.penaltyScore.away) {
		state.winner = state.penaltyScore.home > state.penaltyScore.away ? 'home' : 'away';
		completeShootout(state);
		return true;
	}
	return false;
}

function startAttempt(state) {
	if (state.phase === 'complete') return;
	const team = state.attemptIndex % 2 === 0 ? 'home' : 'away';
	const teamAttempt = Math.floor(state.attemptIndex / 2);
	const roster = state.rosters[team];
	const goalkeeper = state.goalkeepers[team === 'home' ? 'away' : 'home'];
	const eligibleKickers = roster.filter((player) => player.username !== goalkeeper);
	const kicker = eligibleKickers.length > 0
		? eligibleKickers[teamAttempt % eligibleKickers.length].username
		: null;
	const now = Date.now();
	state.phase = 'penalty_attempt';
	state.room.game.phase = state.phase;
	state.currentAttempt = {
		number: state.attemptIndex + 1,
		team,
		kicker,
		goalkeeper,
		deadline: now + state.choiceDurationMs,
		choices: { kicker: null, goalkeeper: null },
	};
	state.attemptIndex++;
	broadcast(state.io, state);
	schedule(state, () => resolveAttempt(state), state.choiceDurationMs);
}

function resolveAttempt(state) {
	if (state.phase !== 'penalty_attempt' || state.currentAttempt == null) return;
	const attempt = state.currentAttempt;
	const kickerTimedOut = attempt.choices.kicker === null;
	const goalkeeperTimedOut = attempt.choices.goalkeeper === null;
	const kickerChoice = attempt.choices.kicker;
	const goalkeeperChoice = goalkeeperTimedOut
		? (kickerChoice ?? 'middle')
		: attempt.choices.goalkeeper;
	const scored = !kickerTimedOut && kickerChoice !== goalkeeperChoice;
	if (scored) state.penaltyScore[attempt.team]++;
	const result = {
		number: attempt.number,
		team: attempt.team,
		kicker: attempt.kicker,
		goalkeeper: attempt.goalkeeper,
		kickerChoice,
		goalkeeperChoice,
		kickerTimedOut,
		goalkeeperTimedOut,
		scored,
		penaltyScore: { ...state.penaltyScore },
		suddenDeath: state.suddenDeath,
	};
	state.attempts.push(result);
	state.currentAttempt = null;
	state.phase = 'penalty_result';
	state.room.game.phase = state.phase;
	state.io.to(state.room.id).emit('game:penalty-result', result);
	broadcast(state.io, state);

	const completedPair = attempt.team === 'away';
	if (completedPair && state.attemptIndex >= STANDARD_ATTEMPTS_PER_TEAM * 2) {
		if (determineWinner(state)) return;
		state.suddenDeath = true;
	}
	if (completedPair && state.suddenDeath && state.attemptIndex > STANDARD_ATTEMPTS_PER_TEAM * 2) {
		if (determineWinner(state)) return;
	}

	schedule(state, () => startAttempt(state), state.resultPauseMs);
}

export function startShootout(io, room, onComplete, options = {}) {
	if (room.game == null || room.game.phase !== 'regular') return false;
	const rosters = { home: activeRoster(room, 'home'), away: activeRoster(room, 'away') };
	if (rosters.home.length === 0 || rosters.away.length === 0) return false;

	const state = {
		io,
		room,
		onComplete,
		phase: 'penalty_setup',
		setupEndsAt: Date.now() + (options.setupDurationMs ?? SETUP_DURATION_MS),
		choiceDurationMs: options.choiceDurationMs ?? CHOICE_DURATION_MS,
		resultPauseMs: options.resultPauseMs ?? RESULT_PAUSE_MS,
		finalResultPauseMs: options.finalResultPauseMs ?? FINAL_RESULT_PAUSE_MS,
		rosters,
		goalkeepers: { home: null, away: null },
		penaltyScore: { home: 0, away: 0 },
		attempts: [],
		attemptIndex: 0,
		currentAttempt: null,
		suddenDeath: false,
		winner: null,
		timer: null,
	};
	shootouts.set(room.game, state);
	room.game.phase = state.phase;
	broadcast(io, state);
	schedule(state, () => {
		for (const team of TEAMS) {
			if (state.goalkeepers[team] == null) state.goalkeepers[team] = selectGoalkeeper(state, team);
		}
		state.phase = 'penalty_setup_complete';
		broadcast(io, state);
		startAttempt(state);
	}, state.setupDurationMs);
	return true;
}

export function chooseGoalkeeper(io, room, socketId, targetUsername) {
	const state = getShootout(room);
	const user = room.users?.[socketId];
	if (state == null || state.phase !== 'penalty_setup') return { success: false, reason: 'setup_closed' };
	if (user == null || !state.rosters[user.team]?.some((player) => player.username === targetUsername)) {
		return { success: false, reason: 'invalid_goalkeeper' };
	}
	state.goalkeepers[user.team] = targetUsername;
	broadcast(io, state);
	return { success: true, goalkeepers: { ...state.goalkeepers } };
}

export function submitShootoutChoice(io, room, socketId, direction) {
	const state = getShootout(room);
	const attempt = state?.currentAttempt;
	const user = room.users?.[socketId];
	if (state == null || state.phase !== 'penalty_attempt' || attempt == null) {
		return { success: false, reason: 'no_active_attempt' };
	}
	if (!DIRECTIONS.has(direction)) return { success: false, reason: 'invalid_direction' };
	if (user == null) return { success: false, reason: 'not_player' };

	let role;
	if (user.username === attempt.kicker && user.team === attempt.team) role = 'kicker';
	else if (user.username === attempt.goalkeeper && user.team !== attempt.team) role = 'goalkeeper';
	else return { success: false, reason: 'not_assigned' };
	if (attempt.choices[role] !== null) return { success: false, reason: 'choice_locked' };

	attempt.choices[role] = direction;
	if (attempt.choices.kicker !== null && attempt.choices.goalkeeper !== null) {
		clearTimer(state);
		resolveAttempt(state);
	} else {
		broadcast(io, state);
	}
	return { success: true, role, locked: true };
}

export function getShootoutSnapshot(room) {
	const state = getShootout(room);
	return state == null ? null : publicState(state);
}

export function cancelShootout(room) {
	const state = getShootout(room);
	if (state == null) return;
	clearTimer(state);
	shootouts.delete(room.game);
	room.game.shootoutGoalkeepers = { ...state.goalkeepers };
}