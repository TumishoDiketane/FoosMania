/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Reuse the shared socket for the same username and replace it when
 * the active identity changes.
 */

let socket = null;

window.connectSocket = function (username) {
    if (!username) {
        return null;
    }

    // Keep the live connection when this view uses the same username.
    if (socket && socket.auth.username === username) {
        return socket;
    }

    // A changed username needs a new authenticated socket.
    if (socket) {
        socket.disconnect();
    }

    socket = window.io({ auth: { username } });
    return socket;
};

const savedUsername = sessionStorage.getItem('username');
if (savedUsername) {
    window.connectSocket(savedUsername);
}