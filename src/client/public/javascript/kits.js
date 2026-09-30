// Team kits: two colours (base shirt + accent) and a shirt pattern
// per planet, plus the pairing logic that guarantees the two teams in a
// match never wear a similar design. Pure data + functions (no DOM, no
// socket), published on globalThis for pitch.js.

const KIT_PATTERNS = ["solid", "stripes", "hoop", "halves", "checks"];

// Planet -> { colors: [base, accent], pattern }; matches the planets list on the server.
const KITS = {
    "Mercury": { colors: ["#ffffff", "#74acdf"], pattern: "stripes" },
    "Venus": { colors: ["#ffcd00", "#00843d"], pattern: "solid" },
    "Earth": { colors: ["#ef3340", "#000000"], pattern: "solid" },
    "Mars": { colors: ["#ffdc02", "#009b3a"], pattern: "solid" },
    "Jupiter": { colors: ["#007a5e", "#ce1126"], pattern: "solid" },
    "Saturn": { colors: ["#d80621", "#ffffff"], pattern: "solid" },
    "Uranus": { colors: ["#ce1126", "#002b7f"], pattern: "hoop" },
    "Neptune": { colors: ["#ffffff", "#ff0000"], pattern: "checks" },
    "Aurelia-1b": { colors: ["#c8102e", "#ffffff"], pattern: "solid" },
    "Vesper-2c": { colors: ["#ffdd00", "#034ea2"], pattern: "solid" },
    "Nyxara-3d": { colors: ["#ffffff", "#002868"], pattern: "solid" },
    "Solara-4e": { colors: ["#1e2a5a", "#ffffff"], pattern: "solid" },
    "Elyra-5b": { colors: ["#ffffff", "#000000"], pattern: "hoop" },
    "Caelus-6c": { colors: ["#ffffff", "#006b3f"], pattern: "hoop" },
    "Lumora-7d": { colors: ["#ffffff", "#239f40"], pattern: "solid" },
    "Zephyria-8e": { colors: ["#ffffff", "#bc002d"], pattern: "hoop" },
    "Orionis-9b": { colors: ["#006847", "#ffffff"], pattern: "solid" },
    "Velaris-10c": { colors: ["#c1272d", "#006233"], pattern: "solid" },
    "Astralis-11d": { colors: ["#ff8200", "#ffffff"], pattern: "solid" },
    "Novara-12e": { colors: ["#ffffff", "#dc143c"], pattern: "halves" },
    "Cygnara-13b": { colors: ["#da291c", "#046a38"], pattern: "halves" },
    "Miravel-14c": { colors: ["#8a1538", "#ffffff"], pattern: "solid" },
    "Eclipta-15d": { colors: ["#006c35", "#ffffff"], pattern: "solid" },
    "Seraphel-16e": { colors: ["#ffffff", "#00853f"], pattern: "stripes" },
    "Caldris-17b": { colors: ["#c6363c", "#0c4076"], pattern: "solid" },
    "Aetheris-18c": { colors: ["#007a4d", "#ffb81c"], pattern: "hoop" },
    "Emberis-19d": { colors: ["#cd2e3a", "#0047a0"], pattern: "halves" },
    "Thalora-20e": { colors: ["#aa151b", "#f1bf00"], pattern: "solid" },
    "Noctara-21b": { colors: ["#d52b1e", "#ffffff"], pattern: "stripes" },
    "Ilyth-22c": { colors: ["#ffffff", "#e70013"], pattern: "solid" },
    "Ravena-23d": { colors: ["#55b5e5", "#ffffff"], pattern: "solid" },
    "Ophira-24e": { colors: ["#ffffff", "#3c3b6e"], pattern: "hoop" },
    "Caelora-25b": { colors: ["#c8102e", "#00b140"], pattern: "hoop" },
};

// Used when a team name has no kit entry.
const DEFAULT_KITS = {
    home: { colors: ["#e74c3c", "#ffffff"], pattern: "solid" },
    away: { colors: ["#3498db", "#ffffff"], pattern: "hoop" },
};

function kitColorDistance(a, b) {
    const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [r1, g1, b1] = parse(a);
    const [r2, g2, b2] = parse(b);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function kitColorsSimilar(a, b) {
    return kitColorDistance(a, b) < 100;
}

// The kit colour that reads best as text on the dark pitch backdrop:
// simply the lighter of the two.
function readableKitColor(kit) {
    const luminance = (hex) => {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    return luminance(kit.colors[0]) >= luminance(kit.colors[1]) ? kit.colors[0] : kit.colors[1];
}

// Two kits in one match must never look alike: base (shirt) colours always
// differ, and the patterns differ whenever the kits share any similar colour.
function resolveKits(homeName, awayName) {
    const home = structuredClone(KITS[homeName] ?? DEFAULT_KITS.home);
    const away = structuredClone(KITS[awayName] ?? DEFAULT_KITS.away);

    // Clashing shirts: the away side changes into its reversed colours
    // (accent shirt with base trim), and failing that a neutral base.
    if (kitColorsSimilar(home.colors[0], away.colors[0])) {
        away.colors = [away.colors[1], away.colors[0]];
    }
    if (kitColorsSimilar(home.colors[0], away.colors[0])) {
        for (const fallback of ["#3498db", "#f39c12", "#9b59b6"]) {
            if (!kitColorsSimilar(home.colors[0], fallback) && !kitColorsSimilar(away.colors[1], fallback)) {
                away.colors[0] = fallback;
                break;
            }
        }
    }

    // Kits that share a similar colour anywhere must at least differ in cut.
    const shareColor = home.colors.some((h) => away.colors.some((a) => kitColorsSimilar(h, a)));
    if (shareColor && home.pattern === away.pattern) {
        away.pattern = KIT_PATTERNS.find((pattern) => pattern !== home.pattern);
    }

    return { home, away };
}

Object.assign(globalThis, { KITS, KIT_PATTERNS, kitColorsSimilar, resolveKits, readableKitColor });
