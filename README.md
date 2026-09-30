# Foofa-Street

[![Node.js](https://img.shields.io/badge/Node.js-ESM-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?logo=socket.io&logoColor=white)](https://socket.io/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](./Dockerfile)
[![Deploy](https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render&logoColor=white)](./DEPLOYMENT.md)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](#license)

Multiplayer browser foosball. The match plays on a shared screen; every player uses their phone as a controller. Tilt to move, drag-and-flick to shoot, no app to install.

Built with Node/Express + Socket.IO and vanilla JS. No build step, no framework, no database — the entire game runs in server memory.

## Features

- **Phones as controllers** — mobile tilt steering + drag-to-aim / flick-to-shoot; desktop WASD + hold-Space to charge a kick.
- **Real-time multiplayer** — authoritative 30 Hz server simulation over Socket.IO, with client-side prediction softly reconciled every snapshot.
- **Rooms & lobbies** — create a room, share the 6-letter code, pick a team. Rooms get two random planet names and matching kits.
- **Spectator mode** — full-match rooms and in-progress games route extra joiners to a read-only view.
- **Reconnect grace** — a dropped connection mid-match holds your player/spectator slot for 30s instead of bouncing you home.
- **Power-ups** — power shots, speed, phonk (tackle immunity), get-ball, and a widened goal, all tick-driven and configurable per room.
- **Match settings** — goals-to-win, match duration, and which power-ups are enabled, all host-controlled.
- **Stats** — end-of-match summary with score, per-player touches/passes/shots/goals, and a golden-boot race.
- **Sound & polish** — kick/goal/power-up audio, per-planet kit designs, stadium frame, goal confetti.

## How to Play

1. Open the site on a shared screen (laptop, TV) and on each player's phone.
2. Enter a username.
3. One player **creates a room** and shares the 6-letter code.
4. Everyone else **joins** with the code and picks a team.
5. The host adjusts settings and presses **Start**.
6. Play from your phone — tilt to move, drag and release to shoot.

## Quick Start

Requires Node.js (ES modules) and npm.

```sh
npm install
npm run dev        # nodemon on http://localhost:3000
```

Or run exactly what production runs:

```sh
npm start          # node src/server/index.js (PORT env or 3000)
```

Docker:

```sh
docker build -t table-soccer .
docker run --rm -p 3000:3000 table-soccer
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run with nodemon (auto-restart on change) |
| `npm start` | Start the server |
| `npm run check` | Syntax-check every tracked `.js` file (`node --check`) — the only "lint" |
| `npm test` | Stub — no tests exist |

## Tech Stack

- **Server:** Node.js, Express, Socket.IO
- **Client:** Vanilla JS SPA (client-side router loading HTML partials), Canvas renderer
- **State:** In-memory only (no database)
- **Deploy:** Docker image → GitHub Container Registry → Render

## Project Structure

```
src/
  server/
    index.js            Express + Socket.IO bootstrap
    socket-listeners.js Auto-discovers listeners/ (drop a file to add an event)
    listeners/          Thin socket event handlers (room:* / rooms:* / game:*)
    handlers/           Game logic — rooms, users, and the authoritative game sim
    models/             Plain-object factories (room, user, puck)
    routes/             login page, view partials, SPA shell
    utils/constants.js  Field size, radii, tick speeds, power-up metadata
  client/
    views/              SPA shell + login page
    views/partials/     home, create-room, pregame, pitch, stats
    public/javascript/  Router, socket, pitch renderer, kits, sounds
    public/css/         Styles
    public/audio/       Sound effects
    public/images/      Backgrounds
```

Stadium side panels use each planet team's kit colors.

## Documentation

- [`docs/sockets.md`](docs/sockets.md) — the Socket.IO event protocol
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — Render + GHCR deploy pipeline and rollback
- [`CLAUDE.md`](CLAUDE.md) — architecture notes and conventions

## Members

| Member | GitHub |
|---|---|

## License

ISC
