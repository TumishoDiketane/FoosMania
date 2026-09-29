import path from 'path';
import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';

import { registerSocketListeners } from './socket-listeners.js';
import routes from './routes/index.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Render (and most hosts) inject the port to bind via $PORT.
const PORT = process.env.PORT || 3000

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client', 'public')));
app.use('/flag-icons', express.static(path.join(__dirname, '..', '..', 'node_modules', 'flag-icons')));
app.use('/', routes);

registerSocketListeners(io);

server.listen(PORT, () => {
    console.info(`Server running on http://localhost:${PORT}`);
});