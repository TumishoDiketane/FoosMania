/*
    Single page application handling.
    Saving/getting current room code.
*/

const appContent = document.getElementById('app-content');

// client side router
//
// The old view stays live (and keeps rendering) until the replacement HTML
// has arrived — fetching first and swapping once kills the "Loading..."
// flicker. cleanupView runs right before the swap so the old view's socket
// listeners / render loops / intervals never overlap the new view.
let navigationToken = 0;

async function render(path) {
    const token = ++navigationToken;
    const viewPath = path === '/' ? '/home' : path;

    try {
        const response = await fetch(`/views${viewPath}`);
        const htmlString = await response.text();

        if (token !== navigationToken) {
            return; // superseded by a newer navigation while fetching
        }

        if (window.cleanupView != null) {
            window.cleanupView();
            window.cleanupView = null;
        }

        appContent.replaceChildren(document.createRange().createContextualFragment(htmlString));
    } catch (err) {
        console.error('Failed to load page content:', err);
    }
}
async function navigateTo(path) {
    window.history.pushState(null, null, path);
    render(path);
}

// intercept clicks on navigation links
document.body.addEventListener('click', (e) => {
    if (e.target.matches('.nav-link')) {
        e.preventDefault(); // stop browser from refreshing
        const url = e.target.getAttribute('href');
        navigateTo(url);
    }
});

// browser back/forward moves through the same render path
window.addEventListener('popstate', () => render(location.pathname));

const isLobbyPath = location.pathname === '/' || location.pathname === '/home';
if (!sessionStorage.getItem('username') && !isLobbyPath) {
    window.location.replace(`/${location.search}`);
} else {
    render(location.pathname);
}