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
