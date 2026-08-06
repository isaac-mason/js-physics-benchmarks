import Box3D from 'box3d.js'

const b3 = await Box3D()

const worldDef = b3.b3DefaultWorldDef()
worldDef.gravity = [0, -9.81, 0]
const world = b3.b3CreateWorld(worldDef)

const bodyDef = b3.b3DefaultBodyDef()
bodyDef.type = b3.b3BodyType.b3_dynamicBody
bodyDef.position = [0, 5, 0]
const body = b3.b3CreateBody(world, bodyDef)

const shapeDef = b3.b3DefaultShapeDef()
b3.b3CreateBoxShape(body, shapeDef, 0.5, 0.5, 0.5)

b3.b3World_Step(world, 1 / 60, 4)

console.log(world, body)
