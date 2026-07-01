import { BoxShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/BoxShape3D.js';
import EntityBuilder from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import { EntityComponentDataset } from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import { EntityManager } from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import { Transform } from '@woosh/meep-engine/src/engine/ecs/transform/Transform.js';
import { BodyKind } from '@woosh/meep-engine/src/engine/physics/ecs/BodyKind.js';
import { Collider } from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import { ColliderObserverSystem } from '@woosh/meep-engine/src/engine/physics/ecs/ColliderObserverSystem.js';
import { PhysicsSystem } from '@woosh/meep-engine/src/engine/physics/ecs/PhysicsSystem.js';
import { RigidBody } from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';

const em = new EntityManager();
const dataset = new EntityComponentDataset();
const physics = new PhysicsSystem();
em.addSystem(physics as any);
em.addSystem(new ColliderObserverSystem(physics) as any);
em.attachDataset(dataset);
em.startup();
physics.gravity.set(0, -9.81, 0);

const transform = new Transform();
transform.position.set(0, 5, 0);
const rb = new RigidBody();
rb.kind = BodyKind.Dynamic;
rb.mass = 1;
const collider = new Collider();
collider.shape = BoxShape3D.from(0.5, 0.5, 0.5) as any;

new EntityBuilder().add(transform).add(rb).add(collider).build(dataset);
em.simulate(1 / 60);

console.log(em);
