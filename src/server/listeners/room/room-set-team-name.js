import { getUserRoom } from '../../handlers/user-handler.js';
import { setTeamName } from '../../handlers/rooms-handler.js';

export const event = 'room:set-team-name';

// Host picks a team's planet (drives the kit + color panels on the pitch).
export function handler(io, socket, data, callback) {
	const room = getUserRoom(socket.id);

	if (room == null || room.hostUserId !== socket.id || room.state !== 'lobby') {
		callback?.({ success: false });
		return;
	}

	const applied = setTeamName(room, data?.team, data?.country);

	if (applied) {
		io.fireRoomUpdate(room.id);
	}

	callback?.({ success: applied });
}
