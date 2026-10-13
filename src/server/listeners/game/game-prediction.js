import { submitPrediction } from '../../handlers/prediction-handler.js';

export const event = 'game:prediction';

export function handler(io, socket, data, callback) {
	submitPrediction(io, socket, data, callback);
}