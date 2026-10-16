/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Forward substitution requests and responses to the handler that
 * checks eligibility, approval, expiry, and player replacement.
 */
import { handleSubstitution } from '../../handlers/substitution-handler.js';

export const event = 'game:substitution';

export function handler(io, socket, data, callback) {
	handleSubstitution(io, socket, data, callback);
}