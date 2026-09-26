# Audio naming convention

All game sounds live in `src/client/public/audio/` (served from `/audio/…`) and
are played through `playSound(name)` in `javascript/sounds.js`. That helper maps
a **logical event name** to one or more files; when several files are listed one
is picked at random (so repeated events, like kicks, vary).

Add a new sound by dropping the file here and adding it to the `SOUND_FILES`
map in `sounds.js`. A logical name whose file is missing simply no-ops, so it is
safe to wire an event before its audio exists.

## Logical events → files

| Event name       | File(s)                     | Fired by (client)                             |
| ---------------- | --------------------------- | --------------------------------------------- |
| `goal`           | `goal_celebration.mp3`      | `game:goal`                                   |
| `kick`           | `kick_1.mp3`, `kick_2.mp3`  | `game:kicked`                                 |
| `powerup`        | `power_up_pickup.mp3`       | `game:powerup` (pickup, non-phonk)            |
| `powerup-spawn`  | `power_up_spawn.mp3`        | `game:powerup` (spawn)                        |
| `phonk`          | `phonk.mp3`                 | `game:powerup` (pickup, phonk) — see below    |
| `endgame`        | `endgame.mp3`               | `game:ended`                                  |
| `countdown`      | `match_start_countdown.mp3` | `game:started`                                |
| `tackle`         | `tackle.mp3`                | possession flips teams (client-detected)      |

## Convention for new files

- Lowercase, words separated by `_`; a numeric suffix (`kick_1`, `kick_2`) marks
  interchangeable variants of the same event.
- Per-powerup cues, if added, should be named `powerup_<id>.mp3` (ids match
  `POWERUPS` in `src/server/utils/constants.js`: `powershot`, `speed`,
  `getball`, `phonk`, `biggoal`) and registered under a `powerup-<id>` logical
  name. The `phonk` power-up is the exception: it swaps its pickup cue for its
  own music track (see below).
- Keep clips short (< 2 s for effects) so the 3-deep pool in `sounds.js` never
  starves during rapid play. The `phonk` track is the exception — it is a longer
  musical clip.

## The phonk power-up music

`phonk.mp3` is played through `playTimedSound('phonk', durationMs)` instead of
the pooled one-shot path. It runs on a single dedicated Audio element and is
stopped after the phonk power-up's own duration (`POWERUPS.phonk.durationMs`,
currently 10 s), so it does not have to be trimmed to length and a fresh pickup
restarts it cleanly. Picking up the phonk power-up plays *only* this track — the
generic `powerup` pickup cue is suppressed for it.

## Currently shipped files

`endgame.mp3`, `goal_celebration.mp3`, `kick_1.mp3`, `kick_2.mp3`,
`match_start_countdown.mp3`, `phonk.mp3`, `power_up_pickup.mp3`,
`power_up_spawn.mp3`, `tackle.mp3`.

`power_up.mp3` is now unused (split into `power_up_pickup.mp3` /
`power_up_spawn.mp3`); safe to delete.
