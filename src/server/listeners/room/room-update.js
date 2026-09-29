import { getSpectatorRoom, getUserRoom } from '../../handlers/user-handler.js';

export const event = 'room:update';

export function handler(io, socket, data, callback) {
	// Spectators are room members too — they just watch.
	const room = getUserRoom(socket.id) ?? getSpectatorRoom(socket.id);

	if (room == null) {
		callback({ success: false }); // user is not in room
	} else {
		socket.fireRoomUpdate(room.id);
		callback({ success: true });
	}
}
