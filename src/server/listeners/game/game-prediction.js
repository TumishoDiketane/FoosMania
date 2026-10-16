/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Pass a spectator's prediction request and acknowledgement callback
 * to the prediction rules handler.
 */
import { submitPrediction } from '../../handlers/prediction-handler.js';

export const event = 'game:prediction';

export function handler(io, socket, data, callback) {
	submitPrediction(io, socket, data, callback);
}