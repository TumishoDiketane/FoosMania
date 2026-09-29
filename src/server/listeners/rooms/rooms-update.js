import { getRoomsList } from '../../handlers/rooms-handler.js';

export const event = 'rooms:update';

export function handler(io, socket, data) {
	socket.fireRoomsUpdate();
}