/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Route player goalkeeper selections and penalty directions to the
 * shootout handler and return its validation result.
 */
import { getUserRoom } from '../../handlers/user-handler.js';
import { chooseGoalkeeper, submitShootoutChoice } from '../../handlers/shootout-handler.js';

export const event = 'game:penalty';

export function handler(io, socket, data, callback) {
	const room = getUserRoom(socket.id);
	if (room == null) {
		callback?.({ success: false, reason: 'not_player' });
		return;
	}

	const response = data?.action === 'goalkeeper'
		? chooseGoalkeeper(io, room, socket.id, data.username)
		: data?.action === 'choice'
			? submitShootoutChoice(io, room, socket.id, data.direction)
			: { success: false, reason: 'invalid_action' };
	callback?.(response);
}