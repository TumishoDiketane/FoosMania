import { getSpectatorRoom, getUserRoom, reclaimMembership } from '../../handlers/user-handler.js';
import { serializeJoinInfo } from '../../handlers/game-handler.js';

export const event = 'game:join';

export function handler(io, socket, data, callback) {
	const { username } = socket;

	// A reconnect lands on a fresh socket id; reclaim any membership held open
	// during the disconnect grace window before deciding we have no room.
	const reclaimed = reclaimMembership(socket.id, username);
	if (reclaimed != null) {
		io.fireRoomUpdate(reclaimed.id);
		io.fireRoomsUpdate();
	}

	const room = getUserRoom(socket.id);

	if (room != null) {
		// Re-join the room channel to receive game:state / game:started
		// broadcasts (idempotent for a socket already in the channel).
		socket.join(room.id);

		callback({
			status: 'success',
			spectator: false,
			...serializeJoinInfo(room, username),
		});
		return;
	}

	// Spectators watch the same match feed, they just never own pucks.
	const spectatorRoom = getSpectatorRoom(socket.id);

	if (spectatorRoom != null) {
		socket.join(spectatorRoom.id);

		callback({
			status: 'success',
			spectator: true,
			...serializeJoinInfo(spectatorRoom, null),
		});
		return;
	}

	callback({ status: 'no_room' });
}
