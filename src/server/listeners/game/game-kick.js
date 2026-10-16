/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Find the connected player's room and pass their kick payload to the
 * authoritative game handler for ownership and match-state validation.
 */
import { getUserRoom } from '../../handlers/user-handler.js';
import { handleKick } from '../../handlers/game-handler.js';

export const event = 'game:kick';

export function handler(io, socket, data) {
	const { username } = socket;
	const room = getUserRoom(socket.id);

	if (room != null) {
		handleKick(io, room, username, data);
	}
}
