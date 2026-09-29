// Tiny sound helper shared by the pitch and stats views. Maps logical game
// events to the audio files in /audio (see audio/naming.md) and plays them
// with a small pool so rapid repeats (kicks) don't cut each other off.
//
// Loaded as a classic script; publishes playSound() (pooled one-shots) and
// playTimedSound() (a longer clip stopped after a set duration, for the phonk
// power-up) on globalThis. A missing file just no-ops (a browser that blocks
// autoplay until first gesture also no-ops silently), so callers never guard.
(function () {
    // event name -> file(s) under /audio. Multiple files = pick at random.
    const SOUND_FILES = {
        goal: ['goal_celebration.mp3'],
        kick: ['kick_1.mp3', 'kick_2.mp3'],
        powerup: ['power_up_pickup.mp3'],
        'powerup-spawn': ['power_up_spawn.mp3'],
        endgame: ['endgame.mp3'],
        countdown: ['match_start_countdown.mp3'],
        tackle: ['tackle.mp3'],
        phonk: ['phonk.mp3'], // phonk power-up music; played via playTimedSound
    };

    // A few Audio clones per sound so overlapping plays don't clip.
    const POOL_SIZE = 3;
    const pools = {};

    function poolFor(file) {
        if (pools[file]) return pools[file];
        const clips = [];
        for (let i = 0; i < POOL_SIZE; i++) {
            const audio = new Audio(`/audio/${file}`);
            audio.preload = 'auto';
            clips.push(audio);
        }
        pools[file] = { clips, next: 0 };
        return pools[file];
    }

    function playSound(name, volume = 1) {
        const files = SOUND_FILES[name];
        if (!files) return;

        const file = files[Math.floor(Math.random() * files.length)];
        const pool = poolFor(file);
        const clip = pool.clips[pool.next];
        pool.next = (pool.next + 1) % pool.clips.length;

        try {
            clip.currentTime = 0;
            clip.volume = volume;
            const played = clip.play();
            if (played && typeof played.catch === 'function') {
                played.catch(() => { }); // autoplay blocked / file missing
            }
        } catch (err) {
            // Unsupported or not yet loaded: ignore.
        }
    }

    globalThis.playSound = playSound;

    // Longer musical cues (the phonk power-up) play on their own single Audio
    // element and stop after a fixed duration rather than running to the end of
    // the file. Re-triggering restarts the clip and resets the stop timer, so a
    // fresh pickup extends the music instead of stacking overlapping copies.
    const timed = {};

    function playTimedSound(name, durationMs, volume = 1) {
        const files = SOUND_FILES[name];
        if (!files) return;

        const file = files[Math.floor(Math.random() * files.length)];
        let entry = timed[name];
        if (!entry) {
            const audio = new Audio(`/audio/${file}`);
            audio.preload = 'auto';
            entry = timed[name] = { audio, timer: null };
        }

        if (entry.timer) clearTimeout(entry.timer);
        try {
            entry.audio.currentTime = 0;
            entry.audio.volume = volume;
            const played = entry.audio.play();
            if (played && typeof played.catch === 'function') {
                played.catch(() => { }); // autoplay blocked / file missing
            }
            entry.timer = setTimeout(() => {
                entry.audio.pause();
                entry.audio.currentTime = 0;
                entry.timer = null;
            }, durationMs);
        } catch (err) {
            // Unsupported or not yet loaded: ignore.
        }
    }

    globalThis.playTimedSound = playTimedSound;
})();
