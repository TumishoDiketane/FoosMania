import crypto from 'crypto';

import { serializeJoinInfo, serializeState } from './game-handler.js';
import { getPredictionSnapshot } from './prediction-handler.js';
import { getSpectatorRoom, getUserRoom } from './user-handler.js';

const REQUEST_TTL_MS = 15000;
const HOST_OVERRIDE_TTL_MS = 15000;
const expiryTimers = new Map();
const processingRooms = new Set();

function requestList(room) {
	return Object.values(room.substitutions ?? {});
}

function emitUpdate(io, room) {
	const players = Object.entries(room.users).map(([id, user]) => ({ id, username: user.username, team: user.team }));
	const requests = requestList(room).map((request) => ({ ...request }));
	io.to(room.id).emit('game:substitution-update', {
		players,
		requests,
		hostUserId: room.hostUserId,
		approvalMode: room.settings.substitutionApproval ?? 'player',
		limitPerTeam: room.settings.substitutionsPerTeam ?? 3,
		counts: room.game?.substitutionsByTeam ?? { home: 0, away: 0 },
	});
}

export function getSubstitutionView(room) {
	return {
		players: Object.entries(room.users).map(([id, user]) => ({ id, username: user.username, team: user.team })),
		requests: requestList(room).map((request) => ({ ...request })),
		hostUserId: room.hostUserId,
		approvalMode: room.settings.substitutionApproval ?? 'player',
		limitPerTeam: room.settings.substitutionsPerTeam ?? 3,
		counts: room.game?.substitutionsByTeam ?? { home: 0, away: 0 },
	};
}

function findRequest(room, requestId) {
	return room.substitutions?.[requestId] ?? null;
}

function hasSlotRequest(room, targetPlayerId) {
	return requestList(room).some((request) => request.targetPlayerId === targetPlayerId);
}

function clearRequest(room, requestId) {
	const timer = expiryTimers.get(requestId);
	if (timer) clearTimeout(timer);
	expiryTimers.delete(requestId);
	delete room.substitutions[requestId];
}

function validLiveMatch(room) {
	return room.state === 'game' && room.game != null && room.game.phase === 'regular' && Date.now() >= room.game.freezeUntil;
}

function fail(callback, reason) {
	callback?.({ success: false, reason });
}

function startExpiry(io, room, request) {
	const timer = setTimeout(() => {
		if (findRequest(room, request.id) !== request) return;
		if (room.state !== 'game' || room.game == null) {
			clearRequest(room, request.id);
			emitUpdate(io, room);
			return;
		}
		request.status = 'expired';
		request.hostExpiresAt = Date.now() + HOST_OVERRIDE_TTL_MS;
		emitUpdate(io, room);
		const hostTimer = setTimeout(() => {
			if (findRequest(room, request.id) === request) {
				clearRequest(room, request.id);
				emitUpdate(io, room);
			}
		}, HOST_OVERRIDE_TTL_MS);
		if (typeof hostTimer.unref === 'function') hostTimer.unref();
		expiryTimers.set(request.id, hostTimer);
	}, Math.max(0, request.expiresAt - Date.now()));
	if (typeof timer.unref === 'function') timer.unref();
	expiryTimers.set(request.id, timer);
}

function requestSubstitution(io, socket, data, callback) {
	const room = getSpectatorRoom(socket.id);
	if (room == null || room.spectators[socket.id] == null) return fail(callback, 'not_spectator');
	if (!validLiveMatch(room)) return fail(callback, 'match_not_playing');
	if (requestList(room).some((request) => request.spectatorId === socket.id)) {
		return fail(callback, 'request_exists');
	}

	const targetPlayerId = data?.targetPlayerId;
	const target = room.users[targetPlayerId];
	if (target == null) return fail(callback, 'invalid_target');
	if (!Object.values(room.pucks).some((puck) => puck.username === target.username && puck.team === target.team)) {
		return fail(callback, 'invalid_target');
	}
	if (hasSlotRequest(room, targetPlayerId)) return fail(callback, 'slot_requested');

	const limit = room.settings.substitutionsPerTeam ?? 3;
	if ((room.game.substitutionsByTeam?.[target.team] ?? 0) >= limit) {
		return fail(callback, 'substitution_limit');
	}

	const now = Date.now();
	const request = {
		id: crypto.randomUUID(),
		roomId: room.id,
		spectatorId: socket.id,
		spectatorName: room.spectators[socket.id].username,
		targetPlayerId,
		targetPlayerName: target.username,
		targetTeam: target.team,
		createdAt: now,
		expiresAt: now + REQUEST_TTL_MS,
		status: 'pending',
		targetDisconnected: false,
	};
	room.substitutions[request.id] = request;
	startExpiry(io, room, request);
	io.to(targetPlayerId).emit('game:substitution-notice', { request: { ...request } });
	io.to(room.hostUserId).emit('game:substitution-notice', { request: { ...request } });
	emitUpdate(io, room);
	callback?.({ success: true, requestId: request.id });
}

function approveSubstitution(io, room, request, socket) {
	if (!validLiveMatch(room)) return { success: false, reason: 'match_not_playing' };
	if (processingRooms.has(room.id)) return { success: false, reason: 'substitution_in_progress' };
	if (request.roomId !== room.id || room.users[request.targetPlayerId] == null || room.spectators[request.spectatorId] == null) {
		return { success: false, reason: 'membership_changed' };
	}
	const currentTarget = room.users[request.targetPlayerId];
	if (currentTarget.team !== request.targetTeam || !Object.values(room.pucks).some(
		(puck) => puck.username === currentTarget.username && puck.team === request.targetTeam
	)) return { success: false, reason: 'membership_changed' };

	const isTarget = socket.id === request.targetPlayerId;
	const isHost = socket.id === room.hostUserId;
	const targetConnected = io.sockets.sockets.has(request.targetPlayerId);
	const hostOverrideAllowed = isHost && (
		room.settings.substitutionApproval === 'host' ||
		!targetConnected ||
		request.targetDisconnected ||
		(request.status === 'expired' && Date.now() <= request.hostExpiresAt)
	);
	if (request.status === 'pending' && !isTarget && !hostOverrideAllowed) return { success: false, reason: 'approval_required' };
	if (request.status === 'expired' && !hostOverrideAllowed) return { success: false, reason: 'request_expired' };
	if (!isTarget && !hostOverrideAllowed) return { success: false, reason: 'not_authorized' };
	if (isTarget && request.status !== 'pending') return { success: false, reason: 'request_expired' };

	const limit = room.settings.substitutionsPerTeam ?? 3;
	if ((room.game.substitutionsByTeam?.[request.targetTeam] ?? 0) >= limit) return { success: false, reason: 'substitution_limit' };

	processingRooms.add(room.id);
	try {
		const outgoing = room.users[request.targetPlayerId];
		const incoming = room.spectators[request.spectatorId];
		delete room.users[request.targetPlayerId];
		delete room.spectators[request.spectatorId];
		room.users[request.spectatorId] = { username: incoming.username, team: outgoing.team };
		room.spectators[request.targetPlayerId] = { username: outgoing.username };

		for (const puck of Object.values(room.pucks)) {
			if (puck.username === outgoing.username) {
				puck.username = incoming.username;
				puck.inputX = 0;
				puck.inputY = 0;
			}
		}
		room.game.stats[incoming.username] = { touches: 0, passes: 0, shots: 0, goals: 0 };
		room.game.substitutionsByTeam[request.targetTeam] = (room.game.substitutionsByTeam[request.targetTeam] ?? 0) + 1;
		clearRequest(room, request.id);

		io.to(request.spectatorId).emit('game:substitution-role', {
			spectator: false,
			puckIds: Object.values(room.pucks).filter((puck) => puck.username === incoming.username).map((puck) => puck.id),
			state: serializeState(room),
			joinInfo: serializeJoinInfo(room, incoming.username),
		});
		io.to(request.targetPlayerId).emit('game:substitution-role', {
			spectator: true,
			puckIds: [],
			state: serializeState(room),
			joinInfo: serializeJoinInfo(room, null),
			prediction: getPredictionSnapshot(outgoing.username, room.game),
		});
		io.to(room.id).emit('game:substituted', {
			team: request.targetTeam,
			outgoing: outgoing.username,
			incoming: incoming.username,
		});
		io.to(room.id).emit('game:state', serializeState(room));
		io.fireRoomUpdate(room.id);
		io.fireRoomsUpdate();
		emitUpdate(io, room);
		return { success: true };
	} finally {
		processingRooms.delete(room.id);
	}
}

function respondToSubstitution(io, socket, data, callback) {
	const room = getUserRoom(socket.id) ?? getSpectatorRoom(socket.id);
	const request = room == null ? null : findRequest(room, data?.requestId);
	if (room == null || request == null) return fail(callback, 'request_not_found');

	if (data.action === 'approve') {
		callback?.(approveSubstitution(io, room, request, socket));
		return;
	}

	const isHost = socket.id === room.hostUserId;
	const isTarget = socket.id === request.targetPlayerId;
	const isRequester = socket.id === request.spectatorId;
	if (data.action === 'reject' && (isTarget || isHost)) {
		clearRequest(room, request.id);
		emitUpdate(io, room);
		callback?.({ success: true });
		return;
	}
	if (data.action === 'cancel' && (isHost || isRequester)) {
		clearRequest(room, request.id);
		emitUpdate(io, room);
		callback?.({ success: true });
		return;
	}
	fail(callback, 'not_authorized');
}

export function handleSubstitution(io, socket, data, callback) {
	if (data?.action === 'request') return requestSubstitution(io, socket, data, callback);
	return respondToSubstitution(io, socket, data, callback);
}

export function cancelSubstitutionForSpectator(io, room, socketId) {
	for (const request of requestList(room)) {
		if (request.spectatorId === socketId) {
			clearRequest(room, request.id);
			emitUpdate(io, room);
		}
	}
}

export function markSubstitutionTargetDisconnected(io, room, socketId) {
	for (const request of requestList(room)) {
		if (request.targetPlayerId === socketId) {
			request.targetDisconnected = true;
			io.to(room.hostUserId).emit('game:substitution-notice', { request: { ...request } });
			emitUpdate(io, room);
		}
	}
}

export function rebindSubstitutionTarget(io, room, socketId, username) {
	if (room.users[socketId]?.username !== username) return;
	let changed = false;
	for (const request of requestList(room)) {
		if (request.targetPlayerName === username) {
			request.targetPlayerId = socketId;
			request.targetDisconnected = false;
			changed = true;
		}
	}
	if (changed) emitUpdate(io, room);
}