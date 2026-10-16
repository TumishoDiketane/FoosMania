/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Allow only the room host to start the match, then notify room
 * members and refresh the room listings.
 */
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
