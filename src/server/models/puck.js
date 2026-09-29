export function createPuckModel(changes = {}) {
    const puck = {
        id: undefined,
        team: undefined, // home|away
        username: undefined, // user steering this puck, null = AI
        number: undefined, // kit number, 1..10 within the team

        x: undefined,
        y: undefined,
        homeX: undefined, // center of the fixed area this puck may move in
        homeY: undefined,

        // latest movement input (-1..1), from the controlling user's gyro
        inputX: 0,
        inputY: 0,

        // powerup effects, expired by the tick loop (timestamps, ms)
        speedUntil: 0,
        phonkUntil: 0,
        powershot: false, // armed: the next kick is a powershot
    };

    Object.assign(puck, changes);

    return puck;
}
