import {
    addBroadphaseLayer,
    addObjectLayer,
    box,
    createWorld,
    createWorldSettings,
    enableCollision,
    init,
    MotionType,
    rigidBody,
    updateWorld,
} from 'tumble.js'

await init()

const worldSettings = createWorldSettings()
const bpLayer = addBroadphaseLayer(worldSettings)
const objLayer = addObjectLayer(worldSettings, bpLayer)
enableCollision(worldSettings, objLayer, objLayer)
const world = createWorld(worldSettings)

const shape = box.create({
    halfExtents: [0.5, 0.5, 0.5],
    convexRadius: 0.05,
})
const body = rigidBody.create(world, {
    shape,
    motionType: MotionType.DYNAMIC,
    objectLayer: objLayer,
    position: [0, 5, 0],
    quaternion: [0, 0, 0, 1],
})
updateWorld(world, undefined, 1 / 60)

console.log(world, body)
