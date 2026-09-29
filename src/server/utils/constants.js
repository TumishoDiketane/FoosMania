export const worldCupCountries = [
	'Argentina',
	'Australia',
	'Belgium',
	'Brazil',
	'Cameroon',
	'Canada',
	'Croatia',
	'Denmark',
	'England',
	'France',
	'Germany',
	'Ghana',
	'Iran',
	'Japan',
	'Mexico',
	'Morocco',
	'Netherlands',
	'Poland',
	'Portugal',
	'Qatar',
	'Senegal',
	'Serbia',
	'South Korea',
	'Spain',
	'Switzerland',
	'Tunisia',
	'Uruguay',
	'USA',
	'Saudi Arabia',
	'Ecuador',
	'Costa Rica',
	'Wales',
	'South Africa'
];
// Powerup metadata: single source of truth for server sim AND clients (sent
// inside the game:join constants) — ids double as audio names (powerup-<id>).
export const POWERUPS = {
	powershot: { label: 'Power Shot', color: '#ff5533', durationMs: 0, defaultSpawnChance: 0.3 },
	speed: { label: 'Speed Boost', color: '#33ddff', durationMs: 5000, defaultSpawnChance: 0.35 },
	getball: { label: 'Magnet', color: '#ffe14d', durationMs: 0, defaultSpawnChance: 0.25 },
	phonk: { label: 'Phonk', color: '#c266ff', durationMs: 10000, defaultSpawnChance: 0.2 },
	biggoal: { label: 'Big Goal', color: '#66ff88', durationMs: 8000, defaultSpawnChance: 0.2 },
};

// Room capacity. Pucks scale with the lobby (max(20, 2 * players), see
// game-handler makePucks), so this is a UX cap, not a puck-supply limit.
export const MAX_PLAYERS = 20;
