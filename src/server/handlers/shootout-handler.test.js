import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';

import { createRoom, removeRoom } from './rooms-handler.js';
import { handleKick, handleMove, startGame, stopGame } from './game-handler.js';
import {
	cancelShootout,
	chooseGoalkeeper,
	getShootoutSnapshot,
	startShootout,
	submitShootoutChoice,
} from './shootout-handler.js';

const rooms = [];

afterEach(() => {
	for (const room of rooms.splice(0)) {
		cancelShootout(room);
		stopGame(room);
		room.game = null;
		removeRoom(room.id);
	}
});

function makeRoom() {
	const room = createRoom({ id: `shootout-test-${randomUUID()}` });
	room.state = 'game';
	room.users = {
		homeOne: { username: 'A-home', team: 'home' },
		homeTwo: { username: 'Z-home', team: 'home' },
		awayOne: { username: 'A-away', team: 'away' },
		awayTwo: { username: 'Z-away', team: 'away' },
	};
	room.pucks = Object.fromEntries(Object.entries(room.users).map(([id, user]) => [id, {
		id,
		username: user.username,
		team: user.team,
	}]));
	room.game = { phase: 'regular', score: { home: 2, away: 2 } };
	rooms.push(room);
	return room;
}

function makeIo() {
	const events = [];
	const waiters = [];
	return {
		events,
		to(id) {
			return {
				emit(event, data) {
					const entry = { id, event, data };
					events.push(entry);
					for (let index = waiters.length - 1; index >= 0; index--) {
						if (waiters[index].event === event && waiters[index].predicate(data)) {
						waiters.splice(index, 1)[0].resolve(data);
					}
					}
				},
			};
		},
		waitFor(event, predicate = () => true) {
			const existing = events.find((entry) => entry.event === event && predicate(entry.data));
			if (existing) return Promise.resolve(existing.data);
			return new Promise((resolve) => waiters.push({ event, predicate, resolve }));
		},
	};
}

test('a tied regular-time timeout pauses the match and starts penalties without changing score', async () => {
	const room = makeRoom();
	room.game = null;
	room.pucks = {};
	room.hostUserId = 'homeOne';
	const io = makeIo();
	const setup = io.waitFor('game:penalty-update', (data) => data.phase === 'penalty_setup');
	startGame(io, room);
	room.game.score = { home: 1, away: 1 };
	room.game.endsAt = Date.now() - 1;

	await setup;

	assert.equal(room.game.phase, 'penalty_setup');
	assert.deepEqual(room.game.score, { home: 1, away: 1 });
	assert.equal(room.state, 'game');
	assert.ok(io.events.some((entry) => entry.event === 'game:state' && entry.data.phase === 'penalty_setup'));
});

function choose(io, room, username, direction) {
	const playerId = Object.keys(room.users).find((id) => room.users[id].username === username);
	return submitShootoutChoice(io, room, playerId, direction);
}

async function waitForAttempt(io, number) {
	return io.waitFor('game:penalty-update', (data) => data.phase === 'penalty_attempt' && data.attempt?.number === number);
}

test('goalkeepers are selected from active players and locked after setup', async () => {
	const room = makeRoom();
	const io = makeIo();
	const firstAttempt = waitForAttempt(io, 1);
	startShootout(io, room, () => {}, { setupDurationMs: 2, choiceDurationMs: 1000 });
	const attempt = await firstAttempt;

	assert.deepEqual(attempt.goalkeepers, { home: 'A-home', away: 'A-away' });
	assert.notEqual(attempt.attempt.kicker, attempt.attempt.goalkeeper);
	assert.equal(chooseGoalkeeper(io, room, 'homeOne', 'Z-home').reason, 'setup_closed');
	const puck = room.pucks.homeOne;
	puck.x = 10;
	puck.y = 20;
	handleMove(room, 'A-home', { puckId: 'homeOne', x: 99, y: 88 });
	handleKick(io, room, 'A-home', { puckId: 'homeOne', angle: 0, power: 1 });
	assert.equal(puck.x, 10);
	assert.equal(puck.y, 20);
	assert.equal(room.game.score.home, 2);
	assert.equal(room.game.score.away, 2);
});

test('automatic setup reuses the previous active goalkeeper and rejects other teams', async () => {
	const room = makeRoom();
	room.shootoutGoalkeepers = { home: 'Z-home', away: 'Z-away' };
	const io = makeIo();
	const firstAttempt = waitForAttempt(io, 1);
	startShootout(io, room, () => {}, { setupDurationMs: 2, choiceDurationMs: 1000 });
	assert.equal(chooseGoalkeeper(io, room, 'homeOne', 'A-away').reason, 'invalid_goalkeeper');
	const attempt = await firstAttempt;

	assert.deepEqual(attempt.goalkeepers, { home: 'Z-home', away: 'Z-away' });
});

test('goalkeeper choices are hidden until both roles lock their direction', async () => {
	const room = makeRoom();
	const io = makeIo();
	const firstAttempt = waitForAttempt(io, 1);
	startShootout(io, room, () => {}, { setupDurationMs: 1000, choiceDurationMs: 1000 });
	assert.equal(chooseGoalkeeper(io, room, 'homeOne', 'Z-home').success, true);
	assert.equal(chooseGoalkeeper(io, room, 'awayOne', 'Z-away').success, true);
	const attempt = await firstAttempt;

	const kicker = attempt.attempt.kicker;
	const goalkeeper = attempt.attempt.goalkeeper;
	assert.equal(choose(io, room, kicker, 'left').success, true);
	assert.equal(io.events.some((entry) => entry.event === 'game:penalty-result'), false);
	assert.equal(JSON.stringify(io.events.filter((entry) => entry.event === 'game:penalty-update')).includes('left'), false);
	assert.equal(choose(io, room, goalkeeper, 'left').success, true);

	const result = io.events.find((entry) => entry.event === 'game:penalty-result').data;
	assert.equal(result.scored, false);
	assert.equal(result.kickerChoice, 'left');
	assert.equal(result.goalkeeperChoice, 'left');
});

test('attempt timeout treats an unsubmitted kick as a miss', async () => {
	const room = makeRoom();
	const io = makeIo();
	const resultReady = io.waitFor('game:penalty-result');
	const firstAttempt = waitForAttempt(io, 1);
	startShootout(io, room, () => {}, { setupDurationMs: 1, choiceDurationMs: 5, resultPauseMs: 1000 });
	await firstAttempt;
	const result = await resultReady;

	assert.equal(result.kickerTimedOut, true);
	assert.equal(result.scored, false);
	assert.deepEqual(result.penaltyScore, { home: 0, away: 0 });
});

test('five tied rounds proceed to sudden death and finish on a split round', async () => {
	const room = makeRoom();
	const io = makeIo();
	let completed;
	const finished = new Promise((resolve) => { completed = resolve; });
	const firstAttempt = waitForAttempt(io, 1);
	startShootout(io, room, completed, { setupDurationMs: 1, choiceDurationMs: 1000, resultPauseMs: 0, finalResultPauseMs: 0 });
	await firstAttempt;

	for (let number = 1; number <= 12; number++) {
		const attempt = getShootoutSnapshot(room).attempt;
		const kickDirection = number === 11 ? 'left' : 'middle';
		const saveDirection = number === 11 ? 'middle' : 'middle';
		assert.equal(choose(io, room, attempt.kicker, kickDirection).success, true);
		assert.equal(choose(io, room, attempt.goalkeeper, saveDirection).success, true);
		if (number < 12) await waitForAttempt(io, number + 1);
	}

	const result = await finished;
	assert.equal(result.winner, 'home');
	assert.equal(result.attempts.length, 12);
	assert.equal(result.attempts[9].scored, false);
	assert.equal(result.attempts[10].scored, true);
	assert.equal(result.suddenDeath, true);
});