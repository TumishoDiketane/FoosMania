import { getUserRoom } from '../../handlers/user-handler.js';
import { handleMove } from '../../handlers/game-handler.js';

export const event = 'game:move';

// Arrives ~10x/sec per user while tilting; invalid input is dropped silently.
export function handler(io, socket, data) {
	const { username } = socket;
	const room = getUserRoom(socket.id);

	if (room != null) {
		handleMove(room, username, data);
	}
}
