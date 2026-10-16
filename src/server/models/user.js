/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Create a player's default username and team fields.
 */
export function createUserModel(changes = {}) {
    const user = {
        username: undefined,
        team: undefined, // home|away
    };

    Object.assign(user, changes);

    return user;
}