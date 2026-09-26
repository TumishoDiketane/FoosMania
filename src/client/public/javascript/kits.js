// National team kits: two colours (base shirt + accent) and a shirt pattern
// per country, plus the pairing logic that guarantees the two teams in a
// match never wear a similar design. Pure data + functions (no DOM, no
// socket), published on globalThis for pitch.js.

const KIT_PATTERNS = ["solid", "stripes", "hoop", "halves", "checks"];

// Country -> { colors: [base, accent], pattern }; matches the
// worldCupCountries list on the server.
const KITS = {
    "Argentina": { colors: ["#ffffff", "#74acdf"], pattern: "stripes" },
    "Australia": { colors: ["#ffcd00", "#00843d"], pattern: "solid" },
    "Belgium": { colors: ["#ef3340", "#000000"], pattern: "solid" },
    "Brazil": { colors: ["#ffdc02", "#009b3a"], pattern: "solid" },
    "Cameroon": { colors: ["#007a5e", "#ce1126"], pattern: "solid" },
    "Canada": { colors: ["#d80621", "#ffffff"], pattern: "solid" },
    "Costa Rica": { colors: ["#ce1126", "#002b7f"], pattern: "hoop" },
    "Croatia": { colors: ["#ffffff", "#ff0000"], pattern: "checks" },
    "Denmark": { colors: ["#c8102e", "#ffffff"], pattern: "solid" },
    "Ecuador": { colors: ["#ffdd00", "#034ea2"], pattern: "solid" },
    "England": { colors: ["#ffffff", "#002868"], pattern: "solid" },
    "France": { colors: ["#1e2a5a", "#ffffff"], pattern: "solid" },
    "Germany": { colors: ["#ffffff", "#000000"], pattern: "hoop" },
    "Ghana": { colors: ["#ffffff", "#006b3f"], pattern: "hoop" },
    "Iran": { colors: ["#ffffff", "#239f40"], pattern: "solid" },
    "Japan": { colors: ["#ffffff", "#bc002d"], pattern: "hoop" },
    "Mexico": { colors: ["#006847", "#ffffff"], pattern: "solid" },
    "Morocco": { colors: ["#c1272d", "#006233"], pattern: "solid" },
    "Netherlands": { colors: ["#ff8200", "#ffffff"], pattern: "solid" },
    "Poland": { colors: ["#ffffff", "#dc143c"], pattern: "halves" },
    "Portugal": { colors: ["#da291c", "#046a38"], pattern: "halves" },
    "Qatar": { colors: ["#8a1538", "#ffffff"], pattern: "solid" },
    "Saudi Arabia": { colors: ["#006c35", "#ffffff"], pattern: "solid" },
    "Senegal": { colors: ["#ffffff", "#00853f"], pattern: "stripes" },
    "Serbia": { colors: ["#c6363c", "#0c4076"], pattern: "solid" },
    "South Africa": { colors: ["#007a4d", "#ffb81c"], pattern: "hoop" },
    "South Korea": { colors: ["#cd2e3a", "#0047a0"], pattern: "halves" },
    "Spain": { colors: ["#aa151b", "#f1bf00"], pattern: "solid" },
    "Switzerland": { colors: ["#d52b1e", "#ffffff"], pattern: "stripes" },
    "Tunisia": { colors: ["#ffffff", "#e70013"], pattern: "solid" },
    "Uruguay": { colors: ["#55b5e5", "#ffffff"], pattern: "solid" },
    "USA": { colors: ["#ffffff", "#3c3b6e"], pattern: "hoop" },
    "Wales": { colors: ["#c8102e", "#00b140"], pattern: "hoop" },
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
