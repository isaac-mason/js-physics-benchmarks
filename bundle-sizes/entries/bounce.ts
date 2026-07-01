import * as bounce from '@perplexdotgg/bounce'

const world = new bounce.World({
    gravity: { x: 0, y: -9.81, z: 0 },
})

const shape = world.createBox({ width: 1, height: 1, depth: 1 })
const body = world.createDynamicBody({
    shape,
    position: { x: 0, y: 5, z: 0 },
})
world.takeOneStep(1 / 60)

console.log(world, body)
