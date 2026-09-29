import { getRoomById, getRooms, removeRoom } from './rooms-handler.js';
import { createUserModel } from '../models/user.js';

const usernames = [];

// --- Reconnect grace --------------------------------------------------------
// A dropped socket reconnects on a BRAND NEW socket id, but room membership is
// keyed by socket id — so a naive disconnect purge strands a reconnecting
// player/spectator (game:join finds no room and the client bounces to /home).
// Instead, during an active match we hold the membership for a short window and
// let the returning socket reclaim it by username. The timers live at module
// scope (never serialized), like the game tick timers.
const RECONNECT_GRACE_MS = 30000;
const pendingRemovals = new Map(); // username -> { timer, oldSocketId, roomId, kind }

function performRemoval(io, entry) {
    const room = getRoomById(entry.roomId);
    if (room == null) return;

    if (entry.kind === 'spectator') {
        removeSpectatorFromRoom(entry.oldSocketId, room);
        io.fireRoomUpdate(room.id);
        io.fireRoomsUpdate();
    } else {
        removeUserFromRoom(entry.oldSocketId, room, io);
        io.fireRoomsUpdate();
        io.fireRoomUpdate(room.id);
    }
}

// Called on disconnect during a running match: keep the membership in place for
// RECONNECT_GRACE_MS so a quick reconnect can reclaim it. Returns true if a
// removal was deferred (the caller should NOT remove immediately).
export function scheduleMembershipRemoval(io, socketId, username, room) {
    const kind = room.users[socketId] != null ? 'user' : 'spectator';

    const existing = pendingRemovals.get(username);
    if (existing) clearTimeout(existing.timer);

    const entry = { oldSocketId: socketId, roomId: room.id, kind };
    entry.timer = setTimeout(() => {
        pendingRemovals.delete(username);
        performRemoval(io, entry);
    }, RECONNECT_GRACE_MS);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();

    pendingRemovals.set(username, entry);
    return true;
}

// Called when a socket (re)joins: if this username has membership held open
// from a recent drop, re-key it onto the new socket id and cancel the timer.
// Returns the room it was reclaimed into, or null.
export function reclaimMembership(newSocketId, username) {
    const entry = pendingRemovals.get(username);
    if (entry == null) return null;

    clearTimeout(entry.timer);
    pendingRemovals.delete(username);

    const room = getRoomById(entry.roomId);
    if (room == null) return null;

    if (entry.kind === 'spectator') {
        delete room.spectators[entry.oldSocketId];
        room.spectators[newSocketId] = { username };
    } else {
        const user = room.users[entry.oldSocketId];
        delete room.users[entry.oldSocketId];
        if (user != null) room.users[newSocketId] = user;
        if (room.hostUserId === entry.oldSocketId) room.hostUserId = newSocketId;
    }
    return room;
}

// Explicitly joining/leaving another room finalizes any pending removal so the
// stale membership can't be reclaimed later.
export function flushPendingRemoval(io, username) {
    const entry = pendingRemovals.get(username);
    if (entry == null) return;

    clearTimeout(entry.timer);
    pendingRemovals.delete(username);
    performRemoval(io, entry);
}

export function getUserRoom(userId) {
    for (let room of getRooms().values()) {
        if (room.users[userId] != null) {
            return room;
        }
    }

    return null;
}

export function addUserToRoom(userId, username, room) {
    const user = createUserModel({ username, team: 'home' });
    room.users[userId] = user;
}

// --- Spectators: read-only room members (match running or room full). ---
// They receive room:update / game:state but never get pucks, and they do not
// keep an empty room alive.

export function getSpectatorRoom(userId) {
    for (let room of getRooms().values()) {
        if (room.spectators[userId] != null) {
            return room;
        }
    }

    return null;
}

export function addSpectatorToRoom(userId, username, room) {
    room.spectators[userId] = { username };
}

export function removeSpectatorFromRoom(userId, room) {
    delete room.spectators[userId];
}

export function removeUserFromRoom(userId, room, io) {
    delete room.users[userId];

    if (Object.keys(room.users).length == 0) {
        // No more players — kick all spectators back to the home screen before
        // deleting the room so they aren't stranded in a ghost lobby.
        if (io) {
            for (const spectatorId of Object.keys(room.spectators)) {
                io.to(spectatorId).emit('room:kicked');
            }
        }
        removeRoom(room.id);
    } else if (room.hostUserId === userId) {
        // user that left was host -> make another player host
        const selectedUserId = Object.keys(room.users)[0];
        room.hostUserId = selectedUserId;
    }
}

// returns room if success, otherwise null
export function setUserTeam(userId, team) {
    if (!['away', 'home'].includes(team)) return null; // invalid team

    const room = getUserRoom(userId);
    if (room == null) return null;

    const user = room.users[userId];
    if (user == null) return null;

    user.team = team;
    return room;
}

export function addUsername(username) {
    usernames.push(username);
}

export function removeUsername(username) {
    const index = usernames.indexOf(username);

    if (index != -1) {
        usernames.splice(index, 1);
        return true;
    }

    return false;
}

export function usernameExists(username) {
    return usernames.includes(username)
}