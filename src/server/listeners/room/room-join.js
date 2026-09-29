import { getRoomByCode, getRoomById } from '../../handlers/rooms-handler.js';
import {
	addSpectatorToRoom,
	addUserToRoom,
	flushPendingRemoval,
	getSpectatorRoom,
	getUserRoom,
	removeSpectatorFromRoom,
	removeUserFromRoom,
} from '../../handlers/user-handler.js';
import { MAX_PLAYERS } from '../../utils/constants.js';

export const event = 'room:join';

export function handler(io, socket, data, callback) {
	const { username } = socket;
	const { code, id, spectate } = data;

	// Deliberately joining a room finalizes any membership still held open from
	// a recent match drop, so it can't later be reclaimed onto this socket.
	flushPendingRemoval(io, username);

	const currentRoom = getUserRoom(socket.id);
	if (currentRoom != null) {
		// remove user from current room
		removeUserFromRoom(socket.id, currentRoom);
	}
	const currentSpectatorRoom = getSpectatorRoom(socket.id);
	if (currentSpectatorRoom != null) {
		removeSpectatorFromRoom(socket.id, currentSpectatorRoom);
	}

	// A room id may be sent instead of a code, but only to spectate: private
	// rooms don't publish their codes, yet anyone may watch from the list.
	const room = code != null ? getRoomByCode(code) : spectate ? getRoomById(id) : null;

	if (room == null) {
		// room does not exist
		callback({ success: false });
		return;
	}

	if (spectate || room.state !== 'lobby' || Object.keys(room.users).length >= MAX_PLAYERS) {
		addSpectatorToRoom(socket.id, username, room);
		socket.join(room.id);
		io.fireRoomUpdate(room.id);
		io.fireRoomsUpdate(); // UPDATE: Broadcast spectator count change

		callback({ success: true, spectator: true, started: room.state === 'game' });
		return;
	}

	addUserToRoom(socket.id, username, room);

	socket.join(room.id);
	io.fireRoomUpdate(room.id);
	io.fireRoomsUpdate();

	callback({ success: true, spectator: false });
}
