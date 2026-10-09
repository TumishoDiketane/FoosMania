// Authoritative game simulation, one per room.
// The game listeners in ../listeners/game are the only callers; they pass io
// so state can be broadcast to the room's socket channel (the room id).
//
// Sim state lives on `room.game`, so deleting the room deletes the game with
// it. The one exception is the tick timer: room:update broadcasts the whole
// room and a Node timer cannot be serialized, so timers live in the
// module-level `tickTimers` map (keyed by room id) and are cleared by
// stopGame — which rooms-handler.removeRoom calls on room deletion.
//
// The home team defends the left goal (x = 0), away the right.
import { createPuckModel } from '../models/puck.js';
import { POWERUPS } from '../utils/constants.js';

// Shared with clients via the game:join ack; the movement constants are
// included so a client can predict its own puck with the exact same math.
export const CONSTANTS = {
	FIELD: { width: 800, height: 500 },
	PUCK_RADIUS: 14,
	BALL_RADIUS: 8,
	CONTROL_RADIUS: 60, // a free ball within this of a puck = they pick it up
	TACKLE_RADIUS: 34, // opponent this close to a carried ball takes it over
	GOAL_HALF_WIDTH: 80, // goal mouth spans height/2 +- this
	TICK_MS: 1000 / 30,
	MOVE_SPEED: 4, // world units per tick at full tilt
	CARRY_OFFSET: 20, // carried ball sits at the feet: PUCK_RADIUS + BALL_RADIUS - 2
	GOALS_TO_WIN: 5, // default; per-room override via room.settings.goalsToWin
	TOKEN_RADIUS: 12, // powerup pickup token size
	POWERUPS, // metadata (label/color/duration) so clients hardcode nothing
};

const FRICTION = 0.985;
const TACKLE_LOCK_MS = 800; // no counter-tackle right after a takeover (stops ping-pong)
const KICK_BASE_SPEED = 4;
const KICK_POWER_RANGE = 22; // baseline cap, kept below powershot so it feels distinct
const POWERSHOT_POWER_RANGE = 40;
const POWERSHOT_PHASE_MS = 1200; // a powershot ball can't be trapped this long
const SPEED_MULTIPLIER = 1.8; // speed powerup movement boost
const GOAL_BOOST_MULTIPLIER = 1.7; // biggoal powerup mouth expansion
const TOKEN_SPAWN_ROLL_MS = 5000; // how often each enabled powerup rolls its spawn chance
const MAX_TOKENS = 3; // on the field at once
const TRAP_GRACE_MS = 300; // a just-kicked ball cannot be trapped instantly
const START_FREEZE_MS = 5000; // kickoff countdown before the match starts
const GOAL_FREEZE_MS = 3000; // countdown after a goal, ball held at center
const AI_KICK_MIN_DELAY_MS = 400;
const AI_KICK_MAX_DELAY_MS = 1600;
const NUDGE_INTERVAL_MS = 2000;
const EMPTY_STOP_MS = 30000; // stop the sim when nobody has listened this long

const TEAMS = ['home', 'away'];

const tickTimers = new Map(); // room id -> tick interval (never serialized)

const PUCK_COLUMN_MAX = 4; // pucks per column before the formation adds a column
const COLUMN_NEAR = 0.15; // x-fraction of the column nearest the own goal
const COLUMN_FAR = 0.8; // x-fraction of the most advanced column

// Pucks in foosball columns: defenders near their own goal, attackers near
// the opponent's. The formation scales with the lobby so every player always
// steers at least two pucks: puckCount = max(20, 2 * playerCount), split as
// max(10, playerCount) per team, laid out in evenly-spaced columns and rows.
function makePucks(playerCount) {
	const perTeam = Math.max(10, playerCount);
	const columnCount = Math.max(3, Math.ceil(perTeam / PUCK_COLUMN_MAX));

	// Split the team over the columns as evenly as possible, defence first,
	// e.g. 10 over 3 -> [4, 3, 3].
	const rows = [];
	for (let column = 0, left = perTeam; column < columnCount; column++) {
		const size = Math.ceil(left / (columnCount - column));
		rows.push(size);
		left -= size;
	}

	// Column x-fractions run evenly from the own goal toward the opponent's;
	// the away side mirrors them so the two formations interleave.
	const columnFraction = (index) =>
		COLUMN_NEAR + (index * (COLUMN_FAR - COLUMN_NEAR)) / (columnCount - 1);

	const pucks = {};
	let id = 0;

	for (const team of TEAMS) {
		let number = 1; // kit number, per team: 1..perTeam in roster (column) order
		rows.forEach((count, columnIndex) => {
			const xFraction = team === 'home' ? columnFraction(columnIndex) : 1 - columnFraction(columnIndex);
			for (let row = 0; row < count; row++) {
				const x = CONSTANTS.FIELD.width * xFraction;
				const y = (CONSTANTS.FIELD.height * (row + 1)) / (count + 1);
				pucks[id] = createPuckModel({ id, team, username: null, number, x, y, homeX: x, homeY: y });
				id++;
				number++;
			}
		});
	}

	return pucks;
}

// Split a team's pucks across its users as evenly as possible,
// e.g. 10 pucks over 3 users -> 4/3/3.
function splitEvenly(ids, userCount) {
	if (userCount <= 0) {
		return [];
	}

	const chunks = [];
	let start = 0;

	for (let chunk = 0; chunk < userCount; chunk++) {
		const size = Math.ceil((ids.length - start) / (userCount - chunk));
		chunks.push(ids.slice(start, start + size));
		start += size;
	}

	return chunks;
}

// Hand every user their share of their team's pucks (recorded on
// puck.username); pucks without a user are steered by the built-in AI.
function assignPucks(room) {
	const pucks = Object.values(room.pucks);

	for (const team of TEAMS) {
		const users = Object.values(room.users).filter((user) => user.team === team);
		const teamPuckIds = pucks.filter((puck) => puck.team === team).map((puck) => puck.id);
		const chunks = splitEvenly(teamPuckIds, users.length);

		users.forEach((user, index) => {
			for (const puckId of chunks[index]) {
				room.pucks[puckId].username = user.username;
			}
		});
	}
}

// Idempotent: returns true if a new game was created, false if one was running.
export function startGame(io, room) {
	if (room.game != null) {
		return false;
	}

	const settings = room.settings ?? {};

	room.pucks = makePucks(Object.keys(room.users).length);
	assignPucks(room);
	room.state = 'game';
	room.lastMatch = null;
	room.game = {
		ball: { x: CONSTANTS.FIELD.width / 2, y: CONSTANTS.FIELD.height / 2, vx: 3, vy: 2 },
		score: { home: 0, away: 0 },
		goalsToWin: settings.goalsToWin ?? CONSTANTS.GOALS_TO_WIN,
		// nothing moves until then; clients render the remaining time as a
		// countdown (kickoff and after every goal)
		freezeUntil: Date.now() + START_FREEZE_MS,
		// time-capped match: reaching endsAt ends it with the current score
		// (freezes extend it, so the cap only spends playing time)
		endsAt: settings.maxDurationSeconds
			? Date.now() + settings.maxDurationSeconds * 1000 + START_FREEZE_MS
			: null,
		controllingPuckId: null,
		carryDir: { x: 1, y: 0 }, // where the carried ball sits relative to the carrier
		tackleLockUntil: 0,
		noTrapUntil: 0,
		ballPhaseUntil: 0, // powershot: nobody can trap the ball until then
		aiKickAt: null,
		lastNudgeAt: Date.now(),
		emptySince: null,
		stats: {}, // username -> { touches, passes, shots, goals }
		substitutionsByTeam: { home: 0, away: 0 },
		lastKick: null, // { puckId, team, username } of the most recent kick
		tokens: [], // powerup pickups on the field: { id, type, x, y }
		nextTokenId: 1,
		lastTokenRollAt: Date.now(),
		goalBoost: null, // { goal: 'home'|'away' (defending side), until }
	};
	tickTimers.set(room.id, setInterval(() => tick(io, room), CONSTANTS.TICK_MS));

	return true;
}

export function stopGame(room) {
	const timer = tickTimers.get(room.id);
	if (timer) {
		clearInterval(timer);
		tickTimers.delete(room.id);
	}
	room.game = null;
	room.state = 'lobby';
}

export function serializeState(room) {
	const game = room.game;
	const now = Date.now();

	return {
		pucks: Object.values(room.pucks).map((puck) => ({
			id: puck.id,
			team: puck.team,
			username: puck.username,
			number: puck.number,
			x: puck.x,
			y: puck.y,
			homeX: puck.homeX,
			homeY: puck.homeY,
			// active powerup effects, as booleans (client clocks differ)
			speedActive: puck.speedUntil > now,
			phonkActive: puck.phonkUntil > now,
			powershot: puck.powershot,
		})),
		ball: { x: game.ball.x, y: game.ball.y, vx: game.ball.vx, vy: game.ball.vy },
		score: { home: game.score.home, away: game.score.away },
		controllingPuckId: game.controllingPuckId,
		// remaining kickoff/goal countdown; 0 = play is live
		freezeMs: Math.max(0, game.freezeUntil - now),
		tokens: game.tokens.map((token) => ({ id: token.id, type: token.type, x: token.x, y: token.y })),
		timeLeftMs: game.endsAt === null ? null : Math.max(0, game.endsAt - now),
		// effective mouth size per defending side (biggoal powerup expands one)
		goalHalfWidths: {
			home: goalHalfWidth(game, 'home', now),
			away: goalHalfWidth(game, 'away', now),
		},
	};
}

// Everything a client needs when (re)joining the pitch view.
// username null = spectator: never owns pucks (AI pucks also have null!).
export function serializeJoinInfo(room, username) {
	return {
		started: room.game != null,
		constants: CONSTANTS,
		goalsToWin: room.game?.goalsToWin ?? room.settings?.goalsToWin ?? CONSTANTS.GOALS_TO_WIN,
		teamNames: { home: room.homeTeamName, away: room.awayTeamName },
		puckIds: username == null
			? []
			: Object.values(room.pucks)
				.filter((puck) => puck.username === username)
				.map((puck) => puck.id),
		state: room.game != null ? serializeState(room) : null,
	};
}

export function handleMove(room, username, data) {
	const puck = ownPuck(room, username, data.puckId);
	if (!puck) {
		return;
	}
	if (Date.now() < room.game.freezeUntil) {
		return; // countdown running: client-sent positions are ignored
	}

	// Client sends its locally-predicted position; apply it directly so the
	// server mirrors the client's physics. Clamp to the same boundaries the
	// client enforces so a cheating/buggy client can't escape the field.
	const { FIELD, PUCK_RADIUS } = CONSTANTS;

	if (data.x != null && data.y != null) {
		let nx = Number(data.x);
		let ny = Number(data.y);

		// Keep inside field
		nx = Math.min(Math.max(nx, PUCK_RADIUS), FIELD.width - PUCK_RADIUS);
		ny = Math.min(Math.max(ny, PUCK_RADIUS), FIELD.height - PUCK_RADIUS);

		puck.x = nx;
		puck.y = ny;
	}

	// Keep input direction for dribbling orientation (carry direction).
	puck.inputX = Math.min(Math.max(Number(data.inputX) || 0, -1), 1);
	puck.inputY = Math.min(Math.max(Number(data.inputY) || 0, -1), 1);
}

export function handleKick(io, room, username, data) {
	const game = room.game;
	const puck = ownPuck(room, username, data.puckId);
	if (!puck || Math.hypot(puck.x - game.ball.x, puck.y - game.ball.y) > CONSTANTS.CONTROL_RADIUS) {
		return;
	}
	if (Date.now() < game.freezeUntil) {
		return; // no kicks during a countdown
	}

	const stats = statsFor(game, username);
	if (stats) stats.shots++;
	game.lastKick = { puckId: puck.id, team: puck.team, username };

	const power = Math.min(Math.max(Number(data.power) || 0, 0), 1);
	const angle = Number(data.angle) || 0;

	// An armed powershot is consumed by this kick: harder cap, and the ball
	// phases (untrappable) for a moment so it flies through everyone.
	const powershot = puck.powershot;
	if (powershot) {
		puck.powershot = false;
		game.ballPhaseUntil = Date.now() + POWERSHOT_PHASE_MS;
	}

	const speed = KICK_BASE_SPEED + power * (powershot ? POWERSHOT_POWER_RANGE : KICK_POWER_RANGE);
	game.ball.vx = Math.cos(angle) * speed;
	game.ball.vy = Math.sin(angle) * speed;

	io.to(room.id).emit('game:kicked', { puckId: puck.id, powershot });

	// Kicking your own carried ball releases it (with a short grace period
	// so it isn't re-trapped on the very next tick).
	if (game.controllingPuckId === puck.id) {
		releaseBall(game, Date.now());
	}
}

// The puck, but only if the game is running and this user steers it.
function ownPuck(room, username, puckId) {
	if (room.game == null) {
		return null;
	}

	const puck = room.pucks[Number(puckId)];
	return puck && puck.username === username ? puck : null;
}

// Per-player match stats; AI pucks (username null) are not tracked.
function statsFor(game, username) {
	if (username == null) {
		return null;
	}
	game.stats[username] ??= { touches: 0, passes: 0, shots: 0, goals: 0 };
	return game.stats[username];
}

// A puck gained possession (trap or tackle): a touch for the new owner, and
// a completed pass for the previous kicker if the ball reached a teammate.
function recordPossession(game, puck) {
	const stats = statsFor(game, puck.username);
	if (stats) stats.touches++;

	const kick = game.lastKick;
	if (kick && kick.username != null && kick.team === puck.team && kick.puckId !== puck.id) {
		statsFor(game, kick.username).passes++;
	}
	game.lastKick = null;
}

// Who gets the goal: the carrier that walked it in, or the last kicker —
// but never an own goal.
function creditGoal(room, game, scorer) {
	const carrier = game.controllingPuckId === null ? null : room.pucks[game.controllingPuckId];
	let username = null;

	if (carrier && carrier.team === scorer) {
		username = carrier.username;
	} else if (!carrier && game.lastKick && game.lastKick.team === scorer) {
		username = game.lastKick.username;
	}

	const stats = statsFor(game, username);
	if (stats) stats.goals++;
	game.lastKick = null;
}

// The ball leaves the carrier's feet (kick, goal reset); a short grace period
// stops it from being re-trapped on the very next tick.
function releaseBall(game, now) {
	game.controllingPuckId = null;
	game.aiKickAt = null;
	game.noTrapUntil = now + TRAP_GRACE_MS;
}

// After a goal the ball returns to the center spot and everything freezes
// for a short countdown before play resumes.
function resetForKickoff(room) {
	const game = room.game;

	game.ball.x = CONSTANTS.FIELD.width / 2;
	game.ball.y = CONSTANTS.FIELD.height / 2;
	game.ball.vx = 0;
	game.ball.vy = 0;

	game.freezeUntil = Date.now() + GOAL_FREEZE_MS;
	if (game.endsAt !== null) game.endsAt += GOAL_FREEZE_MS;
	// hold the resting ball a moment after kickoff before the auto-nudge
	game.lastNudgeAt = game.freezeUntil;
}

// Effective goal mouth half-width for a defending side; the biggoal powerup
// temporarily expands one goal, and clients render from the same value.
function goalHalfWidth(game, defendingTeam, now) {
	const boosted = game.goalBoost !== null && game.goalBoost.goal === defendingTeam && game.goalBoost.until > now;
	return CONSTANTS.GOAL_HALF_WIDTH * (boosted ? GOAL_BOOST_MULTIPLIER : 1);
}

function inGoalMouth(game, defendingTeam, y) {
	return Math.abs(y - CONSTANTS.FIELD.height / 2) < goalHalfWidth(game, defendingTeam, Date.now());
}

// Returns true if the ball just crossed a goal line inside the mouth (works
// for flying balls and for balls dribbled over the line). Ends the match
// (room.game becomes null!) when the scorer reaches GOALS_TO_WIN.
function handleGoals(io, room) {
	const game = room.game;
	const ball = game.ball;

	if (ball.x < CONSTANTS.BALL_RADIUS && inGoalMouth(game, 'home', ball.y)) {
		scoreGoal(io, room, 'away');
		return true;
	}
	if (ball.x > CONSTANTS.FIELD.width - CONSTANTS.BALL_RADIUS && inGoalMouth(game, 'away', ball.y)) {
		scoreGoal(io, room, 'home');
		return true;
	}
	return false;
}

function scoreGoal(io, room, scorer) {
	const game = room.game;

	game.score[scorer]++;
	creditGoal(room, game, scorer);
	resetForKickoff(room);
	io.to(room.id).emit('game:goal', { scorer, score: { ...game.score } });

	if (game.score[scorer] >= game.goalsToWin) {
		endGame(io, room);
	}
}

// The match is over: freeze the summary on room.lastMatch, stop the sim and
// send everyone to the stats screen.
function endGame(io, room) {
	const game = room.game;
	const summary = {
		score: { ...game.score },
		teamNames: { home: room.homeTeamName, away: room.awayTeamName },
		// a time-capped match can end level: that's a draw
		winner:
			game.score.home === game.score.away
				? 'draw'
				: game.score.home > game.score.away
					? 'home'
					: 'away',
		stats: Object.values(room.users).map((user) => ({
			username: user.username,
			team: user.team,
			...(game.stats[user.username] ?? { touches: 0, passes: 0, shots: 0, goals: 0 }),
		})),
	};

	room.lastMatch = summary;
	stopGame(room);
	room.state = 'stats';

	io.to(room.id).emit('game:ended', summary);
	io.fireRoomUpdate(room.id);
	io.fireRoomsUpdate();
}

function tick(io, room) {
	const game = room.game;
	const now = Date.now();
	const { FIELD, PUCK_RADIUS, BALL_RADIUS, CONTROL_RADIUS, MOVE_SPEED, CARRY_OFFSET } = CONSTANTS;
	const pucks = Object.values(room.pucks);

	// Time-capped match: the clock running out ends it with the current
	// score (a level score is a draw).
	if (game.endsAt !== null && now >= game.endsAt) {
		endGame(io, room);
		return;
	}

	// Stop simulating once nobody has been listening for a while.
	const listenerCount = io.sockets.adapter.rooms.get(room.id)?.size || 0;
	if (listenerCount === 0) {
		game.emptySince = game.emptySince ?? now;
		if (now - game.emptySince > EMPTY_STOP_MS) {
			stopGame(room);
			return;
		}
	} else {
		game.emptySince = null;
	}

	// Countdown (kickoff / after a goal): keep broadcasting so clients can
	// render the timer, but the ball and possession stay exactly as they are
	// (handleMove/handleKick reject player input while frozen).
	if (now < game.freezeUntil) {
		io.to(room.id).emit('game:state', serializeState(room));
		return;
	}

	const ball = game.ball;
	const previousController = game.controllingPuckId;
	const carrier = game.controllingPuckId === null ? null : room.pucks[game.controllingPuckId];

	if (carrier) {
		// Dribbling: the carrier keeps the ball at their feet — it moves with
		// them (in their movement direction) until they kick it or an
		// opponent tackles them.
		if (carrier.inputX !== 0 || carrier.inputY !== 0) {
			const length = Math.hypot(carrier.inputX, carrier.inputY);
			game.carryDir = { x: carrier.inputX / length, y: carrier.inputY / length };
		}
		ball.x = carrier.x + game.carryDir.x * CARRY_OFFSET;
		ball.y = carrier.y + game.carryDir.y * CARRY_OFFSET;
		ball.vx = 0;
		ball.vy = 0;

		// A carried ball can be walked over the goal line.
		if (handleGoals(io, room)) {
			releaseBall(game, now);
		} else {
			ball.x = Math.min(Math.max(ball.x, BALL_RADIUS), FIELD.width - BALL_RADIUS);
			ball.y = Math.min(Math.max(ball.y, BALL_RADIUS), FIELD.height - BALL_RADIUS);

			// Tackle: any other puck reaching the ball takes it over. The
			// short lock after a takeover stops possession ping-ponging while
			// the two pucks are still on top of each other. A phonked
			// carrier is immune to tackles entirely.
			if (now >= game.tackleLockUntil && carrier.phonkUntil <= now) {
				let tackler = null;
				let nearestDistance = Infinity;
				for (const puck of pucks) {
					if (puck.id === carrier.id) continue;
					const distance = Math.hypot(puck.x - ball.x, puck.y - ball.y);
					if (distance < CONSTANTS.TACKLE_RADIUS && distance < nearestDistance) {
						nearestDistance = distance;
						tackler = puck;
					}
				}
				if (tackler) {
					game.controllingPuckId = tackler.id;
					game.carryDir = { x: tackler.team === 'home' ? 1 : -1, y: 0 };
					game.tackleLockUntil = now + TACKLE_LOCK_MS;
					recordPossession(game, tackler);
				}
			}
		}
	} else {
		// Free ball: normal physics.
		ball.x += ball.vx;
		ball.y += ball.vy;
		ball.vx *= FRICTION;
		ball.vy *= FRICTION;

		if (handleGoals(io, room)) {
			// ball is on the center spot, frozen for the kickoff countdown
		} else {
			if (ball.x < BALL_RADIUS) {
				ball.x = BALL_RADIUS;
				ball.vx = -ball.vx;
			}
			if (ball.x > FIELD.width - BALL_RADIUS) {
				ball.x = FIELD.width - BALL_RADIUS;
				ball.vx = -ball.vx;
			}
			if (ball.y < BALL_RADIUS) {
				ball.y = BALL_RADIUS;
				ball.vy = -ball.vy;
			}
			if (ball.y > FIELD.height - BALL_RADIUS) {
				ball.y = FIELD.height - BALL_RADIUS;
				ball.vy = -ball.vy;
			}

			// Nearest puck within control radius picks the ball up and
			// becomes the carrier (unless it was kicked a moment ago, or a
			// powershot ball is still phasing through everyone).
			if (now >= game.noTrapUntil && now >= game.ballPhaseUntil) {
				let nearestDistance = Infinity;
				for (const puck of pucks) {
					const distance = Math.hypot(puck.x - ball.x, puck.y - ball.y);
					if (distance < CONTROL_RADIUS && distance < nearestDistance) {
						nearestDistance = distance;
						game.controllingPuckId = puck.id;
					}
				}
				if (game.controllingPuckId !== null) {
					const newCarrier = room.pucks[game.controllingPuckId];
					game.carryDir = { x: newCarrier.team === 'home' ? 1 : -1, y: 0 };
					recordPossession(game, newCarrier);
				}
			}
		}
	}

	// A winning goal ends the match inside handleGoals: the sim is gone and
	// this tick (already unscheduled by stopGame) must not touch it further.
	if (room.game === null) {
		return;
	}

	// AI carriers (pucks nobody steers) kick a moment after gaining the ball.
	// User-steered carriers dribble until they kick or are tackled.
	const controller = game.controllingPuckId === null ? null : room.pucks[game.controllingPuckId];
	if (!controller || controller.username !== null) {
		game.aiKickAt = null;
	} else {
		if (game.controllingPuckId !== previousController || game.aiKickAt === null) {
			game.aiKickAt = now + AI_KICK_MIN_DELAY_MS + Math.random() * (AI_KICK_MAX_DELAY_MS - AI_KICK_MIN_DELAY_MS);
		}
		if (now >= game.aiKickAt) {
			const angle = Math.random() * Math.PI * 2;
			const speed = 5 + Math.random() * 10;
			ball.vx = Math.cos(angle) * speed;
			ball.vy = Math.sin(angle) * speed;
			game.lastKick = { puckId: controller.id, team: controller.team, username: null };
			io.to(room.id).emit('game:kicked', { puckId: controller.id, powershot: false });
			releaseBall(game, now);
		}
	}

	// If the ball dies in open space, nudge it in a random direction.
	if (game.controllingPuckId === null && Math.hypot(ball.vx, ball.vy) < 1 && now - game.lastNudgeAt > NUDGE_INTERVAL_MS) {
		const angle = Math.random() * Math.PI * 2;
		const speed = 4 + Math.random() * 8;
		ball.vx = Math.cos(angle) * speed;
		ball.vy = Math.sin(angle) * speed;
		game.lastNudgeAt = now;
		game.lastKick = null; // a nudged ball is nobody's pass
	}

	updatePowerups(io, room, now);

	io.to(room.id).emit('game:state', serializeState(room));
}

// --- Powerups: spawn tokens, hand out effects on pickup, expire boosts. ---
// Every effect is a timestamp in room.game / on a puck and dies with the
// tick loop — never a setTimeout, so teardown stays clean.

function updatePowerups(io, room, now) {
	const game = room.game;
	const { FIELD, PUCK_RADIUS, TOKEN_RADIUS } = CONSTANTS;

	// Expire the goal boost.
	if (game.goalBoost !== null && game.goalBoost.until <= now) {
		game.goalBoost = null;
	}

	// Roll spawns on a slow cadence, per enabled type, capped field-wide.
	if (now - game.lastTokenRollAt >= TOKEN_SPAWN_ROLL_MS) {
		game.lastTokenRollAt = now;
		const configured = room.settings?.powerups ?? {};

		for (const type of Object.keys(POWERUPS)) {
			const config = configured[type];
			if (!config?.enabled || game.tokens.length >= MAX_TOKENS) continue;
			if (Math.random() >= config.spawnChance) continue;

			game.tokens.push({
				id: game.nextTokenId++,
				type,
				// keep clear of walls and the goal areas
				x: 120 + Math.random() * (FIELD.width - 240),
				y: 60 + Math.random() * (FIELD.height - 120),
			});
			io.to(room.id).emit('game:powerup', { event: 'spawn', type });
		}
	}

	// Pickups: first puck touching a token claims it.
	for (let i = game.tokens.length - 1; i >= 0; i--) {
		const token = game.tokens[i];
		const picker = Object.values(room.pucks).find(
			(puck) => Math.hypot(puck.x - token.x, puck.y - token.y) <= PUCK_RADIUS + TOKEN_RADIUS
		);

		if (picker) {
			game.tokens.splice(i, 1);
			applyPowerup(room, picker, token.type, now);
			io.to(room.id).emit('game:powerup', {
				event: 'pickup',
				type: token.type,
				puckId: picker.id,
				username: picker.username,
			});
		}
	}
}

function applyPowerup(room, puck, type, now) {
	const game = room.game;

	switch (type) {
		case 'speed':
			puck.speedUntil = now + CONSTANTS.POWERUPS.speed.durationMs;
			break;
		case 'phonk':
			puck.phonkUntil = now + CONSTANTS.POWERUPS.phonk.durationMs;
			break;
		case 'powershot':
			puck.powershot = true; // consumed by the next kick
			break;
		case 'getball':
			// Instant possession, same shape as a tackle takeover.
			game.controllingPuckId = puck.id;
			game.carryDir = { x: puck.team === 'home' ? 1 : -1, y: 0 };
			game.tackleLockUntil = now + TACKLE_LOCK_MS;
			game.aiKickAt = null;
			game.ballPhaseUntil = 0;
			recordPossession(game, puck);
			break;
		case 'biggoal':
			// Expand the goal this puck attacks (the opponent defends it).
			game.goalBoost = {
				goal: puck.team === 'home' ? 'away' : 'home',
				until: now + CONSTANTS.POWERUPS.biggoal.durationMs,
			};
			break;
	}
}
