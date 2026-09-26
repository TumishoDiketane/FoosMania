import { getUserRoom, setUserTeam } from '../../handlers/user-handler.js';

export const event = 'room:move-player';

// Host moves another player onto a specific team.
export function handler(io, socket, data, callback) {
	const room = getUserRoom(socket.id);
	const targetId = data?.userId;

	if (room == null || room.hostUserId !== socket.id) {
		callback?.({ success: false, reason: 'not_host' });
		return;
	}

	if (room.users[targetId] == null) {
		callback?.({ success: false, reason: 'bad_target' });
		return;
	}

	const updated = setUserTeam(targetId, data?.team);

	if (updated != null) {
		io.fireRoomUpdate(room.id);
	}

	callback?.({ success: updated != null });
}
