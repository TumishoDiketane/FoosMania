/*
    Socket connection handling.
*/

let socket = null;

window.connectSocket = function (username) {
    if (!username) {
        return null;
    }

    if (socket && socket.auth.username === username) {
        return socket;
    }

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