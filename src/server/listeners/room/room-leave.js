import {
	flushPendingRemoval,
	getSpectatorRoom,
	getUserRoom,
	removeSpectatorFromRoom,
	removeUserFromRoom,
} from '../../handlers/user-handler.js';

export const event = 'room:leave';

export function handler(io, socket, data, callback) {
	// Leaving finalizes any membership held open from a recent match drop.
	flushPendingRemoval(io, socket.username);

	const room = getUserRoom(socket.id);

	if (room != null) {
		removeUserFromRoom(socket.id, room, io);

		socket.leave(room.id);
		io.fireRoomsUpdate();
		io.fireRoomUpdate(room.id);
		return;
	}

	const spectatorRoom = getSpectatorRoom(socket.id);

	if (spectatorRoom != null) {
		removeSpectatorFromRoom(socket.id, spectatorRoom);

		socket.leave(spectatorRoom.id);
		io.fireRoomUpdate(spectatorRoom.id);
		io.fireRoomsUpdate();
	}
}
