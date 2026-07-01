import RAPIER from '@dimforge/rapier3d'

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })

const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0)
const body = world.createRigidBody(bodyDesc)
const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
world.createCollider(colliderDesc, body)
world.step()

console.log(world)
