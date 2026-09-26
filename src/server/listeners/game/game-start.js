import { getUserRoom } from '../../handlers/user-handler.js';
import { startGame } from '../../handlers/game-handler.js';

export const event = 'game:start';

export function handler(io, socket, data, callback) {
	const room = getUserRoom(socket.id);

	if (room == null) {
		callback({ status: 'no_room' });
		return;
	}

	if (room.hostUserId !== socket.id) {
		callback({ status: 'not_host' });
		return;
	}

	startGame(io, room);

	// Everyone in the room navigates to the pitch; the room list shows the
	// new state.
	io.to(room.id).emit('game:started');
	io.fireRoomUpdate(room.id);
	io.fireRoomsUpdate();

	callback({ status: 'success' });
}
