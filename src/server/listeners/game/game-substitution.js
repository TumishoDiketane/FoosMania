import { handleSubstitution } from '../../handlers/substitution-handler.js';

export const event = 'game:substitution';

export function handler(io, socket, data, callback) {
	handleSubstitution(io, socket, data, callback);
}