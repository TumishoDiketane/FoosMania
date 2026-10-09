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