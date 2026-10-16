/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Restrict lobby setting changes to the host and delegate field
 * validation to the room handler.
 */
import { getUserRoom } from '../../handlers/user-handler.js';
import { updateRoomSettings } from '../../handlers/rooms-handler.js';

export const event = 'room:update-settings';

// Host edits the match settings from the pregame lobby.
export function handler(io, socket, data, callback) {
	const room = getUserRoom(socket.id);

	if (room == null) {
		callback?.({ success: false, reason: 'no_room' });
		return;
	}

	if (room.hostUserId !== socket.id) {
		callback?.({ success: false, reason: 'not_host' });
		return;
	}

	if (room.state !== 'lobby') {
		callback?.({ success: false, reason: 'match_running' });
		return;
	}

	const changed = updateRoomSettings(room, data?.settings);

	if (changed) {
		io.fireRoomUpdate(room.id);
	}

	callback?.({ success: changed });
}
