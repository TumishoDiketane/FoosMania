import { getSpectatorRoom } from './user-handler.js';

export const PREDICTION_RULES = Object.freeze({
	cost: 10,
	reward: 25,
	penalty: 10,
	startingPoints: 100,
});

const profiles = new Map();
const matchStates = new WeakMap();

function matchStateFor(game) {
	let state = matchStates.get(game);
	if (state == null) {
		state = { predictions: [], round: 0, stats: {} };
		matchStates.set(game, state);
	}
	return state;
}

export function initializePredictionMatch(game) {
	matchStates.set(game, { predictions: [], round: 0, stats: {} });
}

function getProfile(username) {
	if (!profiles.has(username)) {
		profiles.set(username, { points: PREDICTION_RULES.startingPoints, history: [] });
	}
	return profiles.get(username);
}

export function getPredictionSnapshot(username, game = null) {
	const profile = getProfile(username);
	const pending = game == null ? null : matchStateFor(game).predictions.find((prediction) =>
		prediction.username === username && prediction.status === 'pending'
	);
	return {
		points: profile.points,
		rules: PREDICTION_RULES,
		history: profile.history.slice(-20),
		pending: pending ? { type: pending.type, target: pending.target, round: pending.round } : null,
	};
}

function fail(callback, reason) {
	callback?.({ success: false, reason });
}

function emitPublicUpdate(io, room) {
	const game = room.game;
	if (game == null) return;
	const matchState = matchStateFor(game);
	io.to(room.id).emit('game:prediction-update', {
		round: matchState.round,
		pendingCount: matchState.predictions.filter((prediction) => prediction.status === 'pending').length,
	});
}

export function submitPrediction(io, socket, data, callback) {
	const room = getSpectatorRoom(socket.id);
	const spectator = room?.spectators[socket.id];
	if (room == null || spectator == null) return fail(callback, 'not_spectator');
	const game = room.game;
	if (room.state !== 'game' || game == null || Date.now() < game.freezeUntil) {
		return fail(callback, 'match_not_playing');
	}

	const type = data?.type;
	const target = data?.target;
	if (type === 'player') {
		const isActive = typeof target === 'string' && Object.values(room.pucks).some(
			(puck) => puck.username === target && puck.username !== null
		);
		if (!isActive) return fail(callback, 'invalid_target');
	} else if (type === 'team') {
		if (!['home', 'away'].includes(target)) return fail(callback, 'invalid_target');
	} else {
		return fail(callback, 'invalid_target');
	}

	const matchState = matchStateFor(game);
	if (matchState.predictions.some((prediction) =>
		prediction.username === spectator.username && prediction.round === matchState.round && prediction.status === 'pending'
	)) return fail(callback, 'prediction_exists');

	const profile = getProfile(spectator.username);
	if (profile.points < PREDICTION_RULES.cost) return fail(callback, 'insufficient_points');

	profile.points -= PREDICTION_RULES.cost;
	matchState.predictions.push({
		username: spectator.username,
		type,
		target,
		targetName: type === 'team' ? (target === 'home' ? room.homeTeamName : room.awayTeamName) : target,
		round: matchState.round,
		status: 'pending',
		cost: PREDICTION_RULES.cost,
	});

	emitPublicUpdate(io, room);
	callback?.({ success: true, prediction: { type, target, round: matchState.round }, ...getPredictionSnapshot(spectator.username) });
}

function updateMatchStats(game, username, outcome, pointsChange) {
	const matchState = matchStateFor(game);
	const stats = matchState.stats[username] ??= { correct: 0, incorrect: 0, void: 0, expired: 0, pointsChange: 0 };
	stats[outcome]++;
	stats.pointsChange += pointsChange;
}

function resolvePrediction(io, room, game, prediction, scorer, scorerUsername) {
	const profile = getProfile(prediction.username);
	const teamOnly = scorerUsername == null;
	let outcome;
	let pointsChange = -prediction.cost;

	if (prediction.type === 'player' && teamOnly) {
		outcome = 'void';
		profile.points += prediction.cost;
		pointsChange = 0;
	} else {
		const correct = prediction.type === 'player'
			? prediction.target === scorerUsername
			: prediction.target === scorer;
		outcome = correct ? 'correct' : 'incorrect';
		if (correct) {
			profile.points += PREDICTION_RULES.reward;
			pointsChange += PREDICTION_RULES.reward;
		} else {
			profile.points -= PREDICTION_RULES.penalty;
			pointsChange -= PREDICTION_RULES.penalty;
		}
	}

	prediction.status = outcome;
	const result = {
		outcome,
		type: prediction.type,
		target: prediction.target,
		targetName: prediction.targetName,
		scorer,
		scorerUsername,
		teamOnly,
		pointsChange,
		points: profile.points,
		round: prediction.round,
	};
	profile.history.push({ ...result, roomId: room.id, resolvedAt: Date.now() });
	updateMatchStats(game, prediction.username, outcome, pointsChange);

	const spectatorId = Object.keys(room.spectators).find(
		(id) => room.spectators[id].username === prediction.username
	);
	if (spectatorId) io.to(spectatorId).emit('game:prediction-result', result);
}

export function resolvePredictions(io, room, scorer, scorerUsername) {
	const game = room.game;
	if (game == null) return;
	const matchState = matchStateFor(game);
	for (const prediction of matchState.predictions) {
		if (prediction.status === 'pending') {
			resolvePrediction(io, room, game, prediction, scorer, scorerUsername);
		}
	}
	matchState.round++;
	emitPublicUpdate(io, room);
}

export function expirePredictions(io, room) {
	const game = room.game;
	if (game == null) return;
	const matchState = matchStateFor(game);
	for (const prediction of matchState.predictions) {
		if (prediction.status !== 'pending') continue;
		const profile = getProfile(prediction.username);
		profile.points += prediction.cost;
		prediction.status = 'expired';
		const result = {
			outcome: 'expired',
			type: prediction.type,
			target: prediction.target,
			targetName: prediction.targetName,
			pointsChange: 0,
			points: profile.points,
			round: prediction.round,
		};
		profile.history.push({ ...result, roomId: room.id, resolvedAt: Date.now() });
		updateMatchStats(game, prediction.username, 'expired', 0);
		const spectatorId = Object.keys(room.spectators).find(
			(id) => room.spectators[id].username === prediction.username
		);
		if (spectatorId) io?.to(spectatorId).emit('game:prediction-result', result);
	}
}

export function getMatchPredictionStats(game) {
	return Object.entries(game == null ? {} : matchStateFor(game).stats).map(([username, stats]) => ({ username, ...stats }));
}