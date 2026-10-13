import {
    getSpectatorRoom,
    getUserRoom,
    removeSpectatorFromRoom,
    removeUserFromRoom,
    removeUsername,
    scheduleMembershipRemoval,
} from '../handlers/user-handler.js';
import { cancelSubstitutionForSpectator, markSubstitutionTargetDisconnected } from '../handlers/substitution-handler.js';

export const event = 'disconnect';

export function handler(io, socket) {
    const { username } = socket;
    removeUsername(username);

    const room = getUserRoom(socket.id) ?? getSpectatorRoom(socket.id);

    if (room != null) {
        cancelSubstitutionForSpectator(io, room, socket.id);
        markSubstitutionTargetDisconnected(io, room, socket.id);
    }

    // During a running match, a disconnect is usually a transient network blip.
    // Hold the membership open briefly so the reconnect (which arrives on a new
    // socket id) can reclaim it instead of being bounced to /home. Players keep
    // their pucks (owned by username); spectators keep watching.
    if (room != null && room.state === 'game') {
        scheduleMembershipRemoval(io, socket.id, username, room);
        return;
    }

    // Lobby / stats: remove immediately, as before.
    if (room != null && room.users[socket.id] != null) {
        removeUserFromRoom(socket.id, room, io);

        io.fireRoomsUpdate();
        io.fireRoomUpdate(room.id);
        return;
    }

    if (room != null) {
        removeSpectatorFromRoom(socket.id, room);
        io.fireRoomUpdate(room.id);
        io.fireRoomsUpdate(); // spectator count changed
    }
}
