import * as crashcat from 'crashcat'

crashcat.registerAll();

const worldSettings = crashcat.createWorldSettings()
const world = crashcat.createWorld(worldSettings);

console.log(world);
