import AmmoFactory from '../../src/lib/ammo/ammo.wasm.js';

const A = await AmmoFactory();

const collisionConfig = new A.btDefaultCollisionConfiguration();
const dispatcher = new A.btCollisionDispatcher(collisionConfig);
const broadphase = new A.btDbvtBroadphase();
const solver = new A.btSequentialImpulseConstraintSolver();
const world = new A.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, collisionConfig);
world.setGravity(new A.btVector3(0, -9.81, 0));

const shape = new A.btBoxShape(new A.btVector3(0.5, 0.5, 0.5));
const transform = new A.btTransform();
transform.setIdentity();
transform.setOrigin(new A.btVector3(0, 5, 0));
const motionState = new A.btDefaultMotionState(transform);
const localInertia = new A.btVector3(0, 0, 0);
shape.calculateLocalInertia(1, localInertia);
const rbInfo = new A.btRigidBodyConstructionInfo(1, motionState, shape, localInertia);
const body = new A.btRigidBody(rbInfo);
world.addRigidBody(body);

world.stepSimulation(1 / 60, 1, 1 / 60);

console.log(world);
