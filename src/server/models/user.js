export function createUserModel(changes = {}) {
    const user = {
        username: undefined,
        team: undefined, // home|away
    };

    Object.assign(user, changes);

    return user;
}