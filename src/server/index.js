/*
 * Authors:
 * Lesiba Ledwaba — Student No. 2025717063
 * Tumisho Diketane — Student No. 2024965994
 * Purpose: Configure the Express app, static assets, HTTP server, routes, and
 * Socket.IO listeners, then start listening on the configured port.
 */
import path from 'path';
import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';

import { registerSocketListeners } from './socket-listeners.js';
import routes from './routes/index.js';

const app = express();
// Socket.IO shares the HTTP server for live match events.
const server = http.createServer(app);
const io = new Server(server);

// Render (and most hosts) inject the port to bind via $PORT.
const PORT = process.env.PORT || 3000

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve browser files before routing page and partial requests.
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client', 'public')));
app.use('/flag-icons', express.static(path.join(__dirname, '..', '..', 'node_modules', 'flag-icons')));
app.use('/', routes);

// Register room and game events before the server accepts connections.
registerSocketListeners(io);

server.listen(PORT, () => {
    console.info(`Server running on http://localhost:${PORT}`);
});