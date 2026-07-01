import * as CANNON from 'cannon-es'

const world = new CANNON.World()
world.gravity.set(0, -9.81, 0)

const shape = new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5))
const body = new CANNON.Body({
    mass: 1,
    shape,
    position: new CANNON.Vec3(0, 5, 0),
})
world.addBody(body)
world.step(1 / 60)

console.log(world)
