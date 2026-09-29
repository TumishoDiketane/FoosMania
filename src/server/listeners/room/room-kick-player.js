import { getUserRoom, removeUserFromRoom } from '../../handlers/user-handler.js';

export const event = 'room:kick-player';

// Host removes a player from the lobby. The target is told via room:kicked
// and dropped from the room channel.
export function handler(io, socket, data, callback) {
	const room = getUserRoom(socket.id);
	const targetId = data?.userId;

	if (room == null || room.hostUserId !== socket.id) {
		callback?.({ success: false, reason: 'not_host' });
		return;
	}

	if (targetId === socket.id || room.users[targetId] == null) {
		callback?.({ success: false, reason: 'bad_target' });
		return;
	}

	removeUserFromRoom(targetId, room);

	const targetSocket = io.sockets.sockets.get(targetId);
	if (targetSocket) {
		targetSocket.leave(room.id);
		targetSocket.emit('room:kicked', {});
	}

	io.fireRoomUpdate(room.id);
	io.fireRoomsUpdate();

	callback?.({ success: true });
}
