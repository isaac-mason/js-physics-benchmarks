import * as crashcat from 'crashcat'

crashcat.registerShapes([crashcat.box.def])

const worldSettings = crashcat.createWorldSettings()
const bpLayer = crashcat.addBroadphaseLayer(worldSettings)
const objLayer = crashcat.addObjectLayer(worldSettings, bpLayer)
crashcat.enableCollision(worldSettings, objLayer, objLayer)
const world = crashcat.createWorld(worldSettings)

const shape = crashcat.box.create({
    halfExtents: [0.5, 0.5, 0.5],
    convexRadius: 0.05,
})
const body = crashcat.rigidBody.create(world, {
    shape,
    motionType: crashcat.MotionType.DYNAMIC,
    objectLayer: objLayer,
    position: [0, 5, 0],
    quaternion: [0, 0, 0, 1],
})
crashcat.updateWorld(world, undefined, 1 / 60)

console.log(world, body)
