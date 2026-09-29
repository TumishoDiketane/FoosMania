import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getRoomById, getRoomsList } from './handlers/rooms-handler.js';
import { addUsername } from './handlers/user-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadListeners(listenersPath) {
	return fs
		.readdirSync(listenersPath, { recursive: true })
		.filter((file) => file.endsWith('.js'))
		.map(async (file) => {
			const listenerPath = path.join(listenersPath, file);
			const { event, handler } = await import(`file://${listenerPath}`);

			return { file, event, handler };
		});
}

function attachHelperFunctionsIo(io) {
	io.fireRoomsUpdate = () => {
		io.emit('rooms:update', { rooms: getRoomsList() });
	}

	io.fireRoomUpdate = (roomId) => {
		const room = getRoomById(roomId);
		io.to(roomId).emit('room:update', { room });
	}
}

function attachHelperFunctionsSocket(socket) {
	socket.fireRoomsUpdate = () => {
		socket.emit('rooms:update', { rooms: getRoomsList() });
	}

	socket.fireRoomUpdate = (roomId) => {
		const room = getRoomById(roomId);
		socket.emit('room:update', { room });
	}
}

export function registerSocketListeners(io) {
	const listenersPath = path.join(__dirname, 'listeners');
	const listeners = loadListeners(listenersPath);

	attachHelperFunctionsIo(io);

	io.on('connection', async (socket) => {
		attachHelperFunctionsSocket(socket);

		const username = socket.handshake.auth.username;
		socket.username = username; // for easy access in event handlers

		addUsername(username);

		for (const listener of listeners) {
			const { file, event, handler } = await listener;

			if (event == null || typeof handler !== 'function') {
				console.error(`Listener ${file} missing required property "event" or "handler"`);
				continue;
			}

			socket.on(event, (data, callback) => {
				Promise.resolve(handler(io, socket, data, callback)).catch((error) => {
					console.error(`Listener ${file} failed for event "${event}"`, error);
				});
			});
		}
	});
}