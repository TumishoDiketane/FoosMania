# Events

## `room:change-team`

**serverbound**

Change current team.

### Data

```json
{
    "team": "home|away"
}
```

## `room:create`

**serverbound**

Create a new room.

### Data

```json
{
    "id": "room ID",
    "isPublic": true
}
```

### Callback

```json
{
    "success": true // false if room with ID already exists
}
```

## `room:join`

**serverbound**

Make the user join a room from a code. If the room's match is already running,
or the room is at player capacity (`MAX_PLAYERS`), the user is added as a
read-only **spectator** instead of a player (one code path for both cases).

A room `id` may be sent instead of a `code`, but only together with
`spectate: true` — private rooms never publish their code, yet anyone may
watch them from the rooms list. An `id` without `spectate` fails as if the
room did not exist.

### Data

```json
{
    "code": "room code",  // omit and send "id" instead to spectate
    "id": "room id",      // spectate-only alternative to the code
    "spectate": false     // true = join as a watcher even if there is space
}
```

### Callback

```json
{
    "success": true,   // false if the room does not exist
    "spectator": false, // true = joined as a spectator, not a player
    "started": false    // spectators only: true if the match is live (go to the pitch)
}
```

## `room:leave`

**serverbound**

Leave the room currently in (works for players and spectators).

## `room:update-settings`

**serverbound**

Host-only. Merge match settings into the room (lobby state only). Unknown or
out-of-range fields are ignored. Broadcasts `room:update` on any change.

### Data

```json
{
    "settings": {
        "goalsToWin": 5,            // 1..25
        "maxDurationSeconds": 180,  // 30..1800, or null for no time cap
        "powerups": {
            "speed": { "enabled": true, "spawnChance": 0.35 }
        }
    }
}
```

### Callback

```json
{ "success": true } // false if not host / not in lobby / nothing changed
```

## `room:set-team-name`

**serverbound**

Host-only, lobby only. Set a team's planet (drives kit + stadium colors). The
existing `country` payload key is retained for compatibility and must contain
one of the known planet names. Broadcasts `room:update` on success.

### Data

```json
{
    "team": "home|away",
    "country": "Earth"
}
```

## `room:kick-player`

**serverbound**

Host-only. Remove another player from the room. The target receives
`room:kicked` and is dropped from the room channel.

### Data

```json
{
    "userId": "target socket id"
}
```

## `room:move-player`

**serverbound**

Host-only. Move another player onto a team.

### Data

```json
{
    "userId": "target socket id",
    "team": "home|away"
}
```

## `room:kicked`

**clientbound**

Sent to a player the host kicked; the client returns to the home page.

## `room:update` (clientbound)

**clientbound**

Fired when the connection's current room is updated.

### Data

```json
{
    "room": {} // room data
}
```

## `room:update` (serverbound)

**serverbound**

Request information about the current room.
Aftering sending this, the `room:update` event is sent to the client.

### Callback

```json
{
    "success": true // false if user is not in a room
}
```

## `rooms:update` (clientbound)

**clientbound**

Fired every time the list of rooms updates.

### Data

```json
{
    "rooms": [
        {
            "id": "room id",
            "name": "room name",
            "public": true,
            "code": "room code, null unless the room is public",
            "playerCount": 1,
            "state": "lobby" // lobby | game | stats
        }
    ]
}
```

## `rooms:update` (serverbound)

**serverbound**

Request a list of the current rooms.
Aftering sending this, the `rooms:update` event is sent to the client.
Aftering sending this, the `rooms:list` event is sent to the client.
## `game:start`

**serverbound**

Start the match in the user's current room (host only). Creates the pucks —
`max(20, 2 * playerCount)` in total, so every player always steers at least
two — splits each team's pucks across its users (recorded on
`puck.username`), and begins broadcasting `game:state`. The match opens with a 5-second kickoff
freeze (`freezeMs` counts down in the state) during which nothing moves.
Send an empty object as data.

### Callback

```json
{
    "status": "success|no_room|not_host"
}
```

## `game:started`

**clientbound**

Fired to the room channel when the match starts. Clients navigate to the
pitch view (or, if already there, re-send `game:join` to claim their pucks).

## `game:join`

**serverbound**

Join the running match in the user's current room (the pitch view sends this
when it loads and again on every reconnect). Send an empty object as data.

Spectators (joined a full / running room) send this too; their callback has
`spectator: true` and an empty `puckIds`.

### Callback

```json
{
    "status": "success|no_room",
    "spectator": false, // true = watching only, no pucks
    "started": true,
    "constants": {}, // field size, radii, tick/movement speeds, TOKEN_RADIUS,
                     // and POWERUPS metadata — everything needed to draw AND to
                     // client-side-predict your own puck (nothing hardcoded)
    "goalsToWin": 5, // this room's target (from settings), not the default
    "teamNames": { "home": "France", "away": "Japan" },
    "puckIds": [0, 1, 2], // the pucks this user steers (empty for spectators)
    "state": {}, // latest game state, null if not started
    "prediction": { // spectators only
        "points": 100,
        "rules": { "cost": 10, "reward": 25, "penalty": 10, "startingPoints": 100 },
        "pending": null,
        "history": []
    }
}
```

## `game:state`

**clientbound**

Broadcast to the room channel ~30 times per second while the match runs.
The single authoritative snapshot.

### Data

```json
{
    "pucks": [
        {
            "id": 0,
            "team": "home",
            "username": "alice", // who steers it, null = AI
            "number": 1,         // kit number, 1..10 within the team
            "x": 120, "y": 250,
            "homeX": 120, "homeY": 250, // center of its allowed area
            "speedActive": false, // speed powerup running
            "phonkActive": false, // phonk (tackle-immune + rainbow) running
            "powershot": false    // powershot armed for the next kick
        }
    ],
    "ball": { "x": 400, "y": 250, "vx": 0, "vy": 0 },
    "score": { "home": 0, "away": 0 },
    "controllingPuckId": 4, // puck carrying the ball, null = free ball
    "freezeMs": 4200, // remaining kickoff/goal countdown, 0 = play is live
    "tokens": [ { "id": 1, "type": "speed", "x": 300, "y": 200 } ], // powerup pickups
    "timeLeftMs": 175000, // remaining time, null if no time cap
    "goalHalfWidths": { "home": 80, "away": 136 } // live mouth sizes (biggoal expands one)
}
```

## `game:move`

**serverbound**

Push your puck's locally-predicted position (sent ~10x/sec); the server
mirrors it, clamped to the field and the puck's movement radius. No callback;
invalid input is dropped silently, and positions are ignored while a
kickoff/goal countdown (`freezeMs`) is running. The ball is carried along by
the moving puck while it has possession, until it is kicked or an opponent
tackles.

### Data

```json
{
    "puckId": 0,
    "x": 120, "y": 250, // predicted world position
    "inputX": 0.5, // movement input, -1..1 (dribble orientation)
    "inputY": -0.2
}
```

## `game:kick`

**serverbound**

Kick the ball with one of your pucks (must be within control radius). If the
puck was carrying the ball, this releases it. No callback. Fires `game:kicked`
to the room. If the puck had a powershot armed, this kick consumes it (higher
power cap, and the ball phases through pucks briefly).

### Data

```json
{
    "puckId": 0,
    "angle": 1.57, // world-space radians
    "power": 0.8 // 0..1
}
```

## `game:kicked`

**clientbound**

Fired to the room channel whenever a puck kicks (players and AI). Clients play
a kick sound and can react to powershots.

### Data

```json
{
    "puckId": 0,
    "powershot": false
}
```

## `game:powerup`

**clientbound**

Fired to the room channel when a powerup token spawns or is picked up.

### Data

```json
{
    "event": "spawn|pickup",
    "type": "speed",       // powerup id (see POWERUPS in constants.js)
    "puckId": 3,           // pickup only: the puck that grabbed it
    "username": "alice"    // pickup only: owner, null for an AI puck
}
```

## `game:goal`

**clientbound**

Fired to the room channel when a goal is scored. The ball is reset to the
center spot and play freezes for a 3-second countdown (`freezeMs` in
`game:state`) before anyone can move or take the ball.

### Data

```json
{
    "scorer": "home",
    "score": { "home": 1, "away": 0 }
}
```

## `game:prediction`

**serverbound**

Submit one next-goal prediction as a spectator during live play. One pick is
allowed per goal round. The 10-point entry cost is charged on submission; a
correct pick receives 25 points, an incorrect pick loses 10 additional points,
and a player pick is refunded if the goal has no officially credited player.
Pending picks expire and are refunded when the match ends.

### Data

```json
{ "type": "player", "target": "alice" }
```

or

```json
{ "type": "team", "target": "home" }
```

### Callback

```json
{
    "success": true,
    "prediction": { "type": "team", "target": "home", "round": 0 },
    "points": 90,
    "rules": { "cost": 10, "reward": 25, "penalty": 10, "startingPoints": 100 },
    "pending": null,
    "history": []
}
```

`pending` is null in the immediate submission callback; the `prediction` field
is the newly locked pick. A `game:join` response includes the current pending
pick when reconnecting.

## `game:prediction-update` (clientbound)

Broadcasts only the current round number and total pending picks. Individual
spectator selections are private.

```json
{ "round": 0, "pendingCount": 4 }
```

## `game:prediction-result` (clientbound)

Sent privately to the spectator when their pick resolves or expires.

```json
{
    "outcome": "correct|incorrect|void|expired",
    "type": "player|team",
    "target": "alice",
    "scorer": "home",
    "scorerUsername": "alice",
    "teamOnly": false,
    "pointsChange": 15,
    "points": 115,
    "round": 0
}
```

## `game:ended`

**clientbound**

Fired to the room channel when a team reaches the room's `goalsToWin`
(default 5, from settings) OR the match clock (`maxDurationSeconds`) runs out.
The sim stops, the room's state becomes `stats`, and clients navigate to the
stats view. Touches = possessions gained, passes = kicks received by a
teammate, shots = kicks taken; AI pucks are not tracked. A time-out with a
level score ends `"winner": "draw"`.

### Data

```json
{
    "score": { "home": 5, "away": 2 },
    "teamNames": { "home": "France", "away": "Japan" },
    "winner": "home", // or "away", or "draw"
    "stats": [
        {
            "username": "alice",
            "team": "home",
            "touches": 12,
            "passes": 4,
            "shots": 7,
            "goals": 3
        }
    ],
    "predictions": [
        { "username": "watcher", "correct": 1, "incorrect": 1, "void": 0, "expired": 0, "pointsChange": -5 }
    ]
}
```
