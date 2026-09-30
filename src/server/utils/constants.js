export const planets = [
	'Mercury',
	'Venus',
	'Earth',
	'Mars',
	'Jupiter',
	'Saturn',
	'Uranus',
	'Neptune',
	'Aurelia-1b',
	'Vesper-2c',
	'Nyxara-3d',
	'Solara-4e',
	'Elyra-5b',
	'Caelus-6c',
	'Lumora-7d',
	'Zephyria-8e',
	'Orionis-9b',
	'Velaris-10c',
	'Astralis-11d',
	'Novara-12e',
	'Cygnara-13b',
	'Miravel-14c',
	'Eclipta-15d',
	'Seraphel-16e',
	'Caldris-17b',
	'Aetheris-18c',
	'Emberis-19d',
	'Thalora-20e',
	'Noctara-21b',
	'Ilyth-22c',
	'Ravena-23d',
	'Ophira-24e',
	'Caelora-25b'
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
