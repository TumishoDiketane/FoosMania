import { POWERUPS } from '../utils/constants.js';

export function createRoomModel(changes = {}) {
    const room = {
        id: undefined,
        code: undefined,
        isPublic: true,

        users: {}, // socket ID, user model
        spectators: {}, // socket ID -> { username }; read-only members
        substitutions: {}, // request ID -> pending/expired substitution request
        hostUserId: undefined, // socket ID of host user socket connection

        // host-editable match settings, broadcast with room:update
        settings: {
            maxDurationSeconds: 60,
            goalsToWin: 5,
            substitutionApproval: 'player',
            substitutionsPerTeam: 3,
            // label/color ride along so lobby UIs hardcode nothing; the
            // host only ever edits enabled/spawnChance
            powerups: Object.fromEntries(
                Object.entries(POWERUPS).map(([id, meta]) => [
                    id,
                    { enabled: true, spawnChance: meta.defaultSpawnChance, label: meta.label, color: meta.color },
                ])
            ),
        },

        pucks: {}, // list of puck models

        // running simulation state (ball, score, ...), created by
        // game-handler.startGame; null while no match is running
        game: null,

        // summary of the finished match (score, winner, per-player stats),
        // set by game-handler when a team reaches GOALS_TO_WIN
        lastMatch: null,

        homeTeamName: undefined,
        awayTeamName: undefined,

        // state can be 'lobby', 'game', 'stats'
        state: 'lobby',
    };

    Object.assign(room, changes);

    return room;
}