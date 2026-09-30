import crypto from 'crypto';

import { createRoomModel } from '../models/room.js';
import { stopGame } from './game-handler.js';
import { planets, POWERUPS } from '../utils/constants.js';

const rooms = new Map();

export function getRoomById(id) {
	return rooms.get(id);
}

export function getRoomByCode(code) {
	for (const room of rooms.values()) {
		if (room.code === code) {
			return room;
		}
	}

	return null;
}

export function getRooms() {
	return rooms;
}

export function roomUrl(code) {
	return `/room/${encodeURIComponent(code)}/pregame`;
}

function doesCodeExist(code) {
	for (let room of rooms.values()) {
		if (room.code === code) return true;
	}

	return false;
}

function generateRoomCode() {
	const alphabet = 'abcdefghijklmnopqrstuvwxyz';

	while (true) {
		let code = '';

		for (let i = 0; i < 4; i++) {
			const randomIndex = Math.floor(Math.random() * alphabet.length);
			code += alphabet[randomIndex];
		}

		if (!doesCodeExist(code)) return code;
	}
}

export function createRoom(payload) {
	const room = createRoomModel(payload);

	const homeTeamNameIndex = Math.floor(Math.random() * planets.length);
	let awayTeamNameIndex = Math.floor(Math.random() * planets.length);

	while (awayTeamNameIndex === homeTeamNameIndex) {
		awayTeamNameIndex = Math.floor(Math.random() * planets.length);
	}

	room.homeTeamName = planets[homeTeamNameIndex];
	room.awayTeamName = planets[awayTeamNameIndex];

	room.code = generateRoomCode();
	rooms.set(room.id, room);
	return room;
}

export function removeRoom(roomId) {
	const room = rooms.get(roomId);

	if (room != null) {
		// stop the running simulation (if any) so its tick timer dies with
		// the room
		stopGame(room);
	}

	rooms.delete(roomId);
}

// Merge host-submitted settings into the room, keeping only known fields
// with sane values. Returns true if anything was applied.
export function updateRoomSettings(room, incoming) {
	if (incoming == null || typeof incoming !== 'object') {
		return false;
	}

	let changed = false;
	const settings = room.settings;

	if ('goalsToWin' in incoming) {
		const goals = Math.round(Number(incoming.goalsToWin));
		if (Number.isFinite(goals) && goals >= 1 && goals <= 25) {
			settings.goalsToWin = goals;
			changed = true;
		}
	}

	if ('maxDurationSeconds' in incoming) {
		if (incoming.maxDurationSeconds === null) {
			settings.maxDurationSeconds = null;
			changed = true;
		} else {
			const seconds = Math.round(Number(incoming.maxDurationSeconds));
			if (Number.isFinite(seconds) && seconds >= 30 && seconds <= 1800) {
				settings.maxDurationSeconds = seconds;
				changed = true;
			}
		}
	}

	if (incoming.powerups != null && typeof incoming.powerups === 'object') {
		for (const [id, config] of Object.entries(incoming.powerups)) {
			if (POWERUPS[id] == null || config == null || typeof config !== 'object') continue;
			if ('enabled' in config) {
				settings.powerups[id].enabled = Boolean(config.enabled);
				changed = true;
			}
			if ('spawnChance' in config) {
				const chance = Number(config.spawnChance);
				if (Number.isFinite(chance) && chance >= 0 && chance <= 1) {
					settings.powerups[id].spawnChance = chance;
					changed = true;
				}
			}
		}
	}

	return changed;
}

// Host-picked team planet; must be one of the known kit names.
export function setTeamName(room, team, planet) {
	if (!['home', 'away'].includes(team) || !planets.includes(planet)) {
		return false;
	}

	room[team === 'home' ? 'homeTeamName' : 'awayTeamName'] = planet;
	return true;
}

/*
	Overview of all current rooms.
*/
export function getRoomsList() {
	const roomsList = Array.from(rooms.values()).map((room) => {
		return {
			id: room.id,
			// private rooms never publish their code: it's their only key
			code: room.isPublic ? room.code : null,
			isPublic: room.isPublic,
			playerCount: Object.keys(room.users).length,
			spectatorCount: Object.keys(room.spectators).length,
			state: room.state,
		};
	});

	return roomsList;
}