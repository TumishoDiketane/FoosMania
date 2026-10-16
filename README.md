# FoosMania
## University of the Free State - Computer Science and Informatics Department
### Work Intergated Learning- CSIS 3784

[![Node.js](https://img.shields.io/badge/Node.js-ESM-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?logo=socket.io&logoColor=white)](https://socket.io/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](./Dockerfile)
[![Deploy](https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render&logoColor=white)](./DEPLOYMENT.md)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](#license)

Multiplayer browser Table Soccer Game. The match plays on a shared screen; every player can use a phone as a controller. Choose Tilt, Joystick, or Buttons to move, then aim and release to shoot.

Built with Node/Express + Socket.IO and vanilla JS. No build step, no framework, no database — the entire game runs in server memory.

## Features

- **Phones as controllers** — choose Tilt, Joystick, or Buttons for mobile movement; drag to aim and release to shoot, with a phone flick adding kick power. Desktop uses WASD/arrows and hold-Space charging.
- **Real-time multiplayer** — the server runs the authoritative 30 Hz simulation. The selected puck moves from local prediction for immediate response; other pucks and the ball are smoothed toward server snapshots.
- **Rooms & lobbies** — create a room, share its four-letter code, and pick a team. Rooms get two random planet names and contrasting kits.
- **Spectator mode** — full rooms and in-progress games route extra joiners to a read-only view.
- **Reconnect grace** — a dropped connection mid-match holds your player/spectator slot for 30 seconds so a reconnect can reclaim it.
- **Power-ups** — collect Power Shot, Speed Boost, Phonk (tackle immunity), Magnet (grants instant possession), or Big Goal (temporarily widens a goal); effects and spawn rolls are handled by the server tick.
- **Predictions** — spectators can pick the next scoring player or team during live play. Correct picks earn points, incorrect picks lose points, and void or expired picks refund the stake.
- **Match settings** — the host controls match duration and substitution approval/limits; goals-to-win and power-up defaults are set by the server.
- **Stats** — end-of-match summary with score, per-player touches/passes/shots/goals, prediction results, shootout results, and a golden-boot race.
- **Sound & polish** — kick/goal/power-up audio, per-planet kit designs, stadium frame, goal confetti.

## How to Play

1. Open the site on a shared screen (laptop, TV) and on each player's phone.
2. Enter a username.
3. One player **creates a room** and shares the four-letter code.
4. Everyone else **joins** with the room code and picks a team. Players can also spectate full rooms or matches in progress.
5. The host adjusts settings and presses **Start**.
6. On a phone, select **Tilt**, **Joystick**, or **Buttons** to move. Tilt may require motion permission; drag from your puck and release to shoot, with a quick phone flick adding power. On a computer, move with WASD/arrows and hold Space to charge a kick.

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
| `npm test` | Run the Node.js handler tests |

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

## Documentation

- [`docs/sockets.md`](docs/sockets.md) — the Socket.IO event protocol
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — Render + GHCR deploy pipeline and rollback
- [`CLAUDE.md`](CLAUDE.md) — architecture notes and conventions

## Members

| Member | GitHub |
|---|---|
|Tumisho Diketane|https://github.com/TumishoDiketane|
|Lesiba Ledwaba|https://github.com/lesib-a|

## License

ISC
