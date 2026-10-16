/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Send the current public room listing to the requesting socket.
 */
import { getRoomsList } from '../../handlers/rooms-handler.js';

export const event = 'rooms:update';

export function handler(io, socket, data) {
	socket.fireRoomsUpdate();
}