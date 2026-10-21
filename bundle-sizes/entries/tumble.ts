import { Box, init, MotionType, RigidBody, World, WorldSettings } from 'tumble'

await init()

const worldSettings = WorldSettings.create()
const bpLayer = WorldSettings.addBroadphaseLayer(worldSettings)
const objLayer = WorldSettings.addObjectLayer(worldSettings, bpLayer)
WorldSettings.enableCollision(worldSettings, objLayer, objLayer)
const world = World.create(worldSettings)

const shape = Box.create({
    halfExtents: [0.5, 0.5, 0.5],
    convexRadius: 0.05,
})
const body = RigidBody.create(world, {
    shape,
    motionType: MotionType.DYNAMIC,
    objectLayer: objLayer,
    position: [0, 5, 0],
    quaternion: [0, 0, 0, 1],
})
World.step(world, undefined, 1 / 60)

console.log(world, body)
