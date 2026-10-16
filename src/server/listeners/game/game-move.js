/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Forward a player's puck movement payload to the authoritative
 * handler, which ignores invalid ownership or match states.
 */
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
