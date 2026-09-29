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
