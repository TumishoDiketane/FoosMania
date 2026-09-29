/*
    Socket connection handling.
*/

// globally available
const username = sessionStorage.getItem('username');

if (username == null) {
    // redirect to login if no username is set
    window.location.href = "/";
}

// globally available
const socket = window.io({
    auth: {
        username
    }
});