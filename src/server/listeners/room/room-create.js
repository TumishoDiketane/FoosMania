import { createRoom, getRoomById } from '../../handlers/rooms-handler.js';
import { addUserToRoom } from '../../handlers/user-handler.js';

export const event = 'room:create';

export function handler(io, socket, data, callback) {
	const { username } = socket;
	const { id, isPublic } = data;

	if (typeof id !== 'string' || id.length === 0 || id.length > 15) {
		callback({ success: false, reason: 'invalid-name' });
		return;
	}

	if (getRoomById(id) != null) {
		// room with ID already exists
		callback({ success: false });
		return;
	}

	const room = createRoom({ id, isPublic, hostUserId: socket.id });
	addUserToRoom(socket.id, username, room);

	socket.join(id);
	io.fireRoomsUpdate();

	callback({ success: true });
}