import * as CANNON from 'cannon-es'

const world = new CANNON.World()
world.gravity.set(0, -9.81, 0)
console.log(world)
