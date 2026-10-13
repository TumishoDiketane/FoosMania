import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';

import { addSpectatorToRoom } from './user-handler.js';
import { createRoom, removeRoom } from './rooms-handler.js';
import {
	expirePredictions,
	getMatchPredictionStats,
	getPredictionSnapshot,
	initializePredictionMatch,
	resolvePredictions,
	submitPrediction,
} from './prediction-handler.js';

const rooms = [];

afterEach(() => {
	for (const room of rooms.splice(0)) {
		room.game = null;
		removeRoom(room.id);
	}
});

function makeRoom() {
	const room = createRoom({ id: `prediction-test-${randomUUID()}` });
	room.state = 'game';
	room.game = { phase: 'regular', freezeUntil: 0 };
	room.pucks = { player: { username: 'credited-player', team: 'home' } };
	initializePredictionMatch(room.game);
	rooms.push(room);
	return room;
}

function makeIo() {
	const events = [];
	return {
		events,
		to(id) {
			return { emit: (event, data) => events.push({ id, event, data }) };
		},
	};
}

function submit(io, room, socketId, username, type, target) {
	addSpectatorToRoom(socketId, username, room);
	let response;
	submitPrediction(io, { id: socketId }, { type, target }, (result) => { response = result; });
	return response;
}

test('spectators can make one pick per goal round and receive correct rewards', () => {
	const room = makeRoom();
	const io = makeIo();
	const submitted = submit(io, room, 'spectator-1', 'prediction-correct', 'player', 'credited-player');
	const teamSubmitted = submit(io, room, 'spectator-2', 'prediction-team-correct', 'team', 'home');

	assert.equal(submitted.success, true);
	assert.equal(submitted.points, 90);
	assert.equal(teamSubmitted.success, true);
	assert.equal(submit(io, room, 'spectator-1', 'prediction-correct', 'team', 'home').reason, 'prediction_exists');
	assert.deepEqual(Object.keys(io.events[0].data).sort(), ['pendingCount', 'round']);

	resolvePredictions(io, room, 'home', 'credited-player');

	assert.equal(getPredictionSnapshot('prediction-correct').points, 115);
	assert.equal(getPredictionSnapshot('prediction-team-correct').points, 115);
	assert.deepEqual(getMatchPredictionStats(room.game)[0], {
		username: 'prediction-correct',
		correct: 1,
		incorrect: 0,
		void: 0,
		expired: 0,
		pointsChange: 15,
	});
});

test('incorrect picks lose the penalty and team-only goals void player picks', () => {
	const room = makeRoom();
	const io = makeIo();
	submit(io, room, 'spectator-2', 'prediction-incorrect', 'team', 'away');
	submit(io, room, 'spectator-3', 'prediction-void', 'player', 'credited-player');

	resolvePredictions(io, room, 'home', null);

	assert.equal(getPredictionSnapshot('prediction-incorrect').points, 80);
	assert.equal(getPredictionSnapshot('prediction-void').points, 100);
	assert.ok(io.events.some((entry) => entry.id === 'spectator-3' && entry.event === 'game:prediction-result' && entry.data.outcome === 'void'));
});

test('pending picks are refunded when a match expires', () => {
	const room = makeRoom();
	const io = makeIo();
	submit(io, room, 'spectator-4', 'prediction-expired', 'team', 'home');

	expirePredictions(io, room);

	assert.equal(getPredictionSnapshot('prediction-expired').points, 100);
	assert.ok(io.events.some((entry) => entry.id === 'spectator-4' && entry.event === 'game:prediction-result' && entry.data.outcome === 'expired'));
	assert.equal(getMatchPredictionStats(room.game)[0].expired, 1);
});

test('non-spectators, invalid targets, and frozen matches cannot submit', () => {
	const room = makeRoom();
	const io = makeIo();
	let response;
	submitPrediction(io, { id: 'not-a-spectator' }, { type: 'team', target: 'home' }, (result) => { response = result; });
	assert.equal(response.reason, 'not_spectator');
	assert.equal(submit(io, room, 'spectator-5', 'prediction-invalid', 'player', 'inactive-player').reason, 'invalid_target');
	assert.equal(submit(io, room, 'spectator-7', 'prediction-invalid-team', 'team', 'mars').reason, 'invalid_target');
	room.game.freezeUntil = Date.now() + 10000;
	assert.equal(submit(io, room, 'spectator-6', 'prediction-frozen', 'team', 'home').reason, 'match_not_playing');
	assert.equal(getPredictionSnapshot('prediction-invalid').points, 100);
	assert.equal(getPredictionSnapshot('prediction-invalid-team').points, 100);
	assert.equal(getPredictionSnapshot('prediction-frozen').points, 100);
});