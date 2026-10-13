# Aurora penalty duel UI

This interface keeps the server as the source of truth for every penalty decision, while improving the spectator and player presentation around the shootout.

## What changed

- The shootout panel now reads as a large Aurora Circuit duel instead of a static form.
- The penalty gate expands visually and the three lanes read as left, center, and right target zones.
- Team/player identity cards are more legible and emphasize the kicker vs goalkeeper role.
- The shootout scoreboard and status copy are clearer, while still rendering from authoritative penalty score state.
- The existing `game:penalty-update` and `game:penalty-result` flow remains untouched; the client only animates and presents server data.

## Behavior

- The interface hides choices until the server confirms the attempt has resolved.
- The client does not determine goal/saved outcomes or modify the score.
- Lanes remain keyboard-accessible and responsive for small screens.
- Reduced-motion users keep the same hierarchy with lower visual intensity.

## Notes

The regular match simulation and server-side penalty rules are unchanged. Only the presentation layer was upgraded around the current implementation.
