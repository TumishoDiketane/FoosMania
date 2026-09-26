import { getSpectatorRoom, getUserRoom, removeSpectatorFromRoom, addUserToRoom, addSpectatorToRoom } from '../../handlers/user-handler.js';
import { removeRoom } from '../../handlers/rooms-handler.js';
import { MAX_PLAYERS } from '../../utils/constants.js';

export const event = 'room:change-team';

export function handler(io, socket, data, callback) {
	const { team } = data;
	const { username } = socket;

	if (!['home', 'away', 'spectator'].includes(team)) return;

	const userRoom = getUserRoom(socket.id);
	const spectatorRoom = getSpectatorRoom(socket.id);
	const room = userRoom || spectatorRoom;

	if (room == null) return;

	if (team === 'spectator') {
		if (userRoom != null) {
			// Move player to spectators
			addSpectatorToRoom(socket.id, username, room);
			delete room.users[socket.id]; // remove directly without triggering removeUserFromRoom cleanup

			// If that was the last player, kick all spectators and delete the room
			if (Object.keys(room.users).length === 0) {
				for (const spectatorId of Object.keys(room.spectators)) {
					io.to(spectatorId).emit('room:kicked');
				}
				removeRoom(room.id);
				io.fireRoomsUpdate();
				return;
			}

			// Otherwise, assign a new host if the leaver was host
			if (room.hostUserId === socket.id) {
				room.hostUserId = Object.keys(room.users)[0];
			}

			io.fireRoomUpdate(room.id);
			io.fireRoomsUpdate(); // Player count changed
		}
	} else {
		// user wants to join home/away
		if (userRoom != null) {
			// Already a player, just changing team
			userRoom.users[socket.id].team = team;
			io.fireRoomUpdate(room.id);
		} else if (spectatorRoom != null) {
			// Spectator wanting to become player
			// Only allowed if room is public and has space
			if (room.isPublic && Object.keys(room.users).length < MAX_PLAYERS) {
				removeSpectatorFromRoom(socket.id, room);
				addUserToRoom(socket.id, username, room);
				room.users[socket.id].team = team;
				io.fireRoomUpdate(room.id);
				io.fireRoomsUpdate(); // Player count changed
			}
		}
	}
}