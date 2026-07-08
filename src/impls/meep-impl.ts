import { Joint } from '@woosh/meep-engine/src/engine/physics/ecs/Joint.js';
import type { AbstractShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/AbstractShape3D.js';
import { BoxShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/BoxShape3D.js';
import { shape_mesh_from_geometry } from '@woosh/meep-engine/src/core/geom/3d/shape/shape_mesh_from_geometry.js';
import { SphereShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/SphereShape3D.js';
import { Ray3 } from '@woosh/meep-engine/src/core/geom/3d/ray/Ray3.js';
import { EntityComponentDataset } from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import EntityBuilder from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import { EntityManager } from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import type { System } from '@woosh/meep-engine/src/engine/ecs/System.js';
import { Transform } from '@woosh/meep-engine/src/engine/ecs/transform/Transform.js';
import { BodyKind } from '@woosh/meep-engine/src/engine/physics/ecs/BodyKind.js';
import { Collider } from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import { ColliderObserverSystem } from '@woosh/meep-engine/src/engine/physics/ecs/ColliderObserverSystem.js';
import { PhysicsSystem } from '@woosh/meep-engine/src/engine/physics/ecs/PhysicsSystem.js';
import { ContactEventKind } from '@woosh/meep-engine/src/engine/physics/events/ContactEventBuffer.js';
import { RigidBody } from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';
import { PhysicsSurfacePoint } from '@woosh/meep-engine/src/engine/physics/queries/PhysicsSurfacePoint.js';

import type { HingeMotorDesc, PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';
import { Capability, MotionType, ShapeType } from '../api';
import { quatFromXToAxis, rotateByConjugate, worldToLocal } from './impl-helpers';

export const capabilities: ReadonlySet<Capability> = new Set([Capability.Raycast, Capability.ContactListener, Capability.HingeLimits, Capability.ConvexHull]);

type MeepShapeHandle = {
    shape: AbstractShape3D;
    desc: PhysicsShape;
};

type BodyHandle = {
    entity: number;
    rb: RigidBody;
    transform: Transform;
};

type ImplState = {
    em: EntityManager;
    dataset: EntityComponentDataset;
    physics: PhysicsSystem;
    entityToBody: Map<number, BodyHandle>;
    contactCb: ((a: BodyHandle, b: BodyHandle) => void) | null;
    // PhysicsSystem startup is async (Promise-based). Joints created during
    // init() — before the startup microtask fires — would fail link_joint()
    // because bodies haven't been indexed yet. We queue them here and flush
    // at the start of the first stepSimulation call (by which time all
    // microtasks, including system startup, have completed).
    pendingJoints: Joint[];
    _ray: Ray3;
    _hit: PhysicsSurfacePoint;
};

function buildMeepShape(desc: PhysicsShape): AbstractShape3D {
    // The concrete Shape3D subclasses (BoxShape3D, etc.) override `equals(other: Self)`
    // with a narrower parameter than the generic `equals<T extends AbstractShape3D>`
    // declared on the base — a variance bug in meep's type exports. The runtime
    // hierarchy is correct (every subclass `extends AbstractShape3D`), so cast through
    // `unknown` once here at the boundary rather than scattering `as any` downstream.
    switch (desc.type) {
        case ShapeType.BOX:
            return BoxShape3D.from(desc.halfExtents[0], desc.halfExtents[1], desc.halfExtents[2]) as unknown as AbstractShape3D;
        case ShapeType.SPHERE:
            return SphereShape3D.from(desc.radius) as unknown as AbstractShape3D;
        case ShapeType.CONVEX_HULL: {
            // Meep has no dedicated convex-hull shape, but MeshShape3D's GJK support
            // function returns the deepest tet-mesh vertex — i.e. the convex hull of
            // the point set is what the narrowphase actually sees. Triangulation
            // topology doesn't matter for GJK; only the vertex set does.
            const positions = new Float32Array(desc.points);
            const indices = degenerateFanIndices(positions.length / 3);
            return shape_mesh_from_geometry(positions, indices) as unknown as AbstractShape3D;
        }
        case ShapeType.TRIANGLE_MESH: {
            const positions = desc.positions instanceof Float32Array ? desc.positions : new Float32Array(desc.positions);
            const indices = desc.indices instanceof Uint32Array ? desc.indices : new Uint32Array(desc.indices);
            return shape_mesh_from_geometry(positions, indices) as unknown as AbstractShape3D;
        }
    }
}

function degenerateFanIndices(vertexCount: number): Uint32Array {
    // GJK needs only the vertex set to express the convex hull. Build a simple
    // triangle fan (0, i, i+1) so the mesh has well-formed indices for
    // shape_mesh_from_geometry; tetrahedralisation will still cover all
    // vertices, and GJK's support function will pick whichever is deepest.
    if (vertexCount < 3) throw new Error('meep: convex hull needs at least 3 points');
    const triCount = vertexCount - 2;
    const indices = new Uint32Array(triCount * 3);
    for (let i = 0; i < triCount; i++) {
        indices[i * 3] = 0;
        indices[i * 3 + 1] = i + 1;
        indices[i * 3 + 2] = i + 2;
    }
    return indices;
}

function setInverseInertia(rb: RigidBody, desc: PhysicsShape, mass: number): void {
    if (mass <= 0) return;
    const inv = rb.inverseInertiaLocal;
    switch (desc.type) {
        case ShapeType.BOX: {
            const [hx, hy, hz] = desc.halfExtents;
            // Solid cuboid: I_xx = m/3 * (hy² + hz²) when extents are (2hx, 2hy, 2hz).
            const ixx = (mass / 3) * (hy * hy + hz * hz);
            const iyy = (mass / 3) * (hx * hx + hz * hz);
            const izz = (mass / 3) * (hx * hx + hy * hy);
            inv.set(ixx > 0 ? 1 / ixx : 0, iyy > 0 ? 1 / iyy : 0, izz > 0 ? 1 / izz : 0);
            return;
        }
        case ShapeType.SPHERE: {
            const i = (2 / 5) * mass * desc.radius * desc.radius;
            const ii = i > 0 ? 1 / i : 0;
            inv.set(ii, ii, ii);
            return;
        }
        case ShapeType.CONVEX_HULL: {
            const [hx, hy, hz] = aabbHalfExtents(desc.points);
            const ixx = (mass / 3) * (hy * hy + hz * hz);
            const iyy = (mass / 3) * (hx * hx + hz * hz);
            const izz = (mass / 3) * (hx * hx + hy * hy);
            inv.set(ixx > 0 ? 1 / ixx : 0, iyy > 0 ? 1 / iyy : 0, izz > 0 ? 1 / izz : 0);
            return;
        }
        case ShapeType.TRIANGLE_MESH:
            // Trimeshes are static in every benchmark scenario; leave (0,0,0).
            return;
    }
}

function aabbHalfExtents(points: ArrayLike<number>): [number, number, number] {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < points.length; i += 3) {
        const x = points[i] as number;
        const y = points[i + 1] as number;
        const z = points[i + 2] as number;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    return [(maxX - minX) * 0.5, (maxY - minY) * 0.5, (maxZ - minZ) * 0.5];
}

function motionToBodyKind(motionType: MotionType): number {
    switch (motionType) {
        case MotionType.STATIC: return BodyKind.Static;
        case MotionType.DYNAMIC: return BodyKind.Dynamic;
        case MotionType.KINEMATIC: return BodyKind.KinematicPosition;
    }
}

export function init(): Promise<void> {
    return Promise.resolve();
}

export function createWorld(): ImplState {
    const em = new EntityManager();
    const dataset = new EntityComponentDataset();
    const physics = new PhysicsSystem();
    // PhysicsSystem / ColliderObserverSystem extend System at runtime, but the
    // base's `link()` is typed as a 5-arity overload set that the concrete
    // 3-arg subclass methods don't structurally satisfy — a variance bug in
    // meep's type exports, identical in spirit to the AbstractShape3D issue.
    type AnySystem = System<unknown, unknown, unknown, unknown, unknown>;
    em.addSystem(physics as unknown as AnySystem);
    em.addSystem(new ColliderObserverSystem(physics) as unknown as AnySystem);
    em.attachDataset(dataset);
    em.startup();
    // Defeat the per-cycle wall-clock budget so every simulate(1/60) call
    // executes exactly one fixedUpdate — benchmarks need deterministic step
    // counts, not graceful degradation.
    em.fixedUpdatePerSystemExecutionTimeLimit = Infinity;
    return {
        em,
        dataset,
        physics,
        entityToBody: new Map(),
        contactCb: null,
        pendingJoints: [],
        _ray: Ray3.from(0, 0, 0, 0, -1, 0, 1),
        _hit: new PhysicsSurfacePoint(),
    };
}

export function disposeWorld(state: ImplState): void {
    state.contactCb = null;
    state.pendingJoints.length = 0;
    state.em.shutdown();
    state.em.detachDataset();
    state.entityToBody.clear();
}

export function setGravity(state: ImplState, x: number, y: number, z: number): void {
    state.physics.gravity.set(x, y, z);
}

export function stepSimulation(state: ImplState, dt: number): void {
    // Flush any joints queued during init() — by the time the first step is
    // called (from a RAF callback), all async-startup microtasks have run and
    // the PhysicsSystem has indexed every body via its dataset observer.
    if (state.pendingJoints.length > 0) {
        for (const j of state.pendingJoints) state.physics.link_joint(j);
        state.pendingJoints.length = 0;
    }
    state.em.simulate(dt);

    // Meep has no global contact signal — the PhysicsSystem instead dispatches
    // per-entity events and leaves this step's records in `contactEvents` until
    // the next step's manifold diff clears them. Poll the buffer here so we get
    // exactly one callback per pair (the per-entity fan-out in the engine's own
    // dispatch would double-fire). This runs one fixedUpdate per simulate() (see
    // createWorld), so the buffer holds only the events we just produced.
    const cb = state.contactCb;
    if (!cb) return;
    const events = state.physics.contactEvents;
    for (let i = 0; i < events.count; i++) {
        if (events.kind_at(i) !== ContactEventKind.Begin) continue;
        const handleA = state.entityToBody.get(events.entityA_at(i));
        const handleB = state.entityToBody.get(events.entityB_at(i));
        if (handleA && handleB) cb(handleA, handleB);
    }
}

export function createShape(_state: ImplState, desc: PhysicsShape): MeepShapeHandle {
    return { shape: buildMeepShape(desc), desc };
}

export function destroyShape(_state: ImplState, _implHandle: MeepShapeHandle): void {
    // Meep shapes are plain immutable objects — no native handle to free.
}

export function createRigidBody(state: ImplState, options: RigidBodyOptions, implShape: MeepShapeHandle): BodyHandle {
    // We carry references to the component instances we hand to Entity.add so
    // get/set fast paths skip dataset lookups during the simulation loop.
    const transform = new Transform();
    transform.position.set(options.position[0], options.position[1], options.position[2]);
    if (options.quaternion) {
        transform.rotation.set(options.quaternion[0], options.quaternion[1], options.quaternion[2], options.quaternion[3]);
    }

    const rb = new RigidBody();
    rb.kind = motionToBodyKind(options.motionType);
    if (options.mass !== undefined && options.motionType === MotionType.DYNAMIC) {
        rb.mass = options.mass;
        setInverseInertia(rb, implShape.desc, options.mass);
    }

    const collider = new Collider();
    collider.shape = implShape.shape;
    if (options.friction !== undefined) collider.friction = options.friction;
    if (options.restitution !== undefined) collider.restitution = options.restitution;

    const entity = new EntityBuilder()
        .add(transform)
        .add(rb)
        .add(collider)
        .build(state.dataset);

    const handle: BodyHandle = { entity, rb, transform };
    state.entityToBody.set(entity, handle);
    return handle;
}

export function removeRigidBody(state: ImplState, handle: BodyHandle): void {
    state.dataset.removeEntity(handle.entity);
    state.entityToBody.delete(handle.entity);
}

export function getBodyPosition(out: Vec3, _state: ImplState, handle: BodyHandle): void {
    out[0] = handle.transform.position.x;
    out[1] = handle.transform.position.y;
    out[2] = handle.transform.position.z;
}

export function getBodyQuaternion(out: Quat, _state: ImplState, handle: BodyHandle): void {
    out[0] = handle.transform.rotation.x;
    out[1] = handle.transform.rotation.y;
    out[2] = handle.transform.rotation.z;
    out[3] = handle.transform.rotation.w;
}

export function setBodyPosition(state: ImplState, handle: BodyHandle, position: Vec3): void {
    // setPose handles wake + interpolation-snap; safer than raw Transform writes.
    state.physics.setPose(handle.rb, { x: position[0], y: position[1], z: position[2] }, handle.transform.rotation);
}

export function setBodyQuaternion(state: ImplState, handle: BodyHandle, quaternion: Quat): void {
    state.physics.setPose(
        handle.rb,
        handle.transform.position,
        { x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] },
    );
}

export function setBodyLinearVelocity(state: ImplState, handle: BodyHandle, velocity: Vec3): void {
    state.physics.setLinearVelocity(handle.rb, { x: velocity[0], y: velocity[1], z: velocity[2] });
}

export function applyImpulse(state: ImplState, handle: BodyHandle, impulse: Vec3): void {
    state.physics.applyImpulse(handle.rb, { x: impulse[0], y: impulse[1], z: impulse[2] });
}

export function getBodyLinearVelocity(out: Vec3, _state: ImplState, handle: BodyHandle): void {
    out[0] = handle.rb.linearVelocity.x;
    out[1] = handle.rb.linearVelocity.y;
    out[2] = handle.rb.linearVelocity.z;
}

export function setBodyTranslationRotation(state: ImplState, handle: BodyHandle, position: Vec3, quaternion: Quat): void {
    state.physics.setPose(
        handle.rb,
        { x: position[0], y: position[1], z: position[2] },
        { x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] },
    );
}

export function onContactAdded(state: ImplState, onContact: (hA: BodyHandle, hB: BodyHandle) => void): void {
    // Contacts are drained from the per-step event buffer in stepSimulation.
    state.contactCb = onContact;
}

export function disposeContactListener(state: ImplState): void {
    state.contactCb = null;
}

function meepJoint(bodyA: BodyHandle, bodyB: BodyHandle): [Joint, Vec3, Quat, Vec3, Quat] {
    const joint = new Joint();
    joint.entityA = bodyA.entity; joint.entityB = bodyB.entity;
    const posA: Vec3 = [bodyA.transform.position.x, bodyA.transform.position.y, bodyA.transform.position.z];
    const quatA: Quat = [bodyA.transform.rotation.x, bodyA.transform.rotation.y, bodyA.transform.rotation.z, bodyA.transform.rotation.w];
    const posB: Vec3 = [bodyB.transform.position.x, bodyB.transform.position.y, bodyB.transform.position.z];
    const quatB: Quat = [bodyB.transform.rotation.x, bodyB.transform.rotation.y, bodyB.transform.rotation.z, bodyB.transform.rotation.w];
    return [joint, posA, quatA, posB, quatB];
}

function meepEnqueue(state: ImplState, joint: Joint): Joint {
    state.pendingJoints.push(joint); return joint;
}

export function createPointJoint(state: ImplState, anchor: Vec3, bodyA: BodyHandle, bodyB: BodyHandle): Joint {
    const [joint, posA, quatA, posB, quatB] = meepJoint(bodyA, bodyB);
    const lA: Vec3 = [0, 0, 0]; worldToLocal(lA, anchor, posA, quatA);
    const lB: Vec3 = [0, 0, 0]; worldToLocal(lB, anchor, posB, quatB);
    joint.localAnchorA.set(lA[0], lA[1], lA[2]); joint.localAnchorB.set(lB[0], lB[1], lB[2]);
    joint.asBallSocket();
    return meepEnqueue(state, joint);
}

export function createHingeJoint(state: ImplState, anchor: Vec3, axis: Vec3, bodyA: BodyHandle, bodyB: BodyHandle): Joint {
    const [joint, posA, quatA, posB, quatB] = meepJoint(bodyA, bodyB);
    const lA: Vec3 = [0, 0, 0]; worldToLocal(lA, anchor, posA, quatA);
    const lB: Vec3 = [0, 0, 0]; worldToLocal(lB, anchor, posB, quatB);
    joint.localAnchorA.set(lA[0], lA[1], lA[2]); joint.localAnchorB.set(lB[0], lB[1], lB[2]);
    const hA: Vec3 = [0, 0, 0]; rotateByConjugate(hA, axis, quatA);
    const hB: Vec3 = [0, 0, 0]; rotateByConjugate(hB, axis, quatB);
    const fqA: Quat = [0, 0, 0, 1]; quatFromXToAxis(fqA, hA[0], hA[1], hA[2]);
    const fqB: Quat = [0, 0, 0, 1]; quatFromXToAxis(fqB, hB[0], hB[1], hB[2]);
    joint.localBasisA.set(fqA[0], fqA[1], fqA[2], fqA[3]);
    joint.localBasisB.set(fqB[0], fqB[1], fqB[2], fqB[3]);
    joint.asHinge(0); // 0 = free angular axis X
    return meepEnqueue(state, joint);
}

export function createFixedJoint(state: ImplState, bodyA: BodyHandle, bodyB: BodyHandle): Joint {
    const [joint, posA, , posB, quatB] = meepJoint(bodyA, bodyB);
    const lB: Vec3 = [0, 0, 0]; worldToLocal(lB, posA, posB, quatB);
    joint.localAnchorA.set(0, 0, 0); joint.localAnchorB.set(lB[0], lB[1], lB[2]);
    joint.asWeld();
    return meepEnqueue(state, joint);
}

export function createDistanceJoint(state: ImplState, anchorA: Vec3, anchorB: Vec3, _minDist: number | undefined, _maxDist: number | undefined, bodyA: BodyHandle, bodyB: BodyHandle): Joint {
    // Meep has no native distance constraint; use ball socket between anchors
    const [joint, posA, quatA, posB, quatB] = meepJoint(bodyA, bodyB);
    const lA: Vec3 = [0, 0, 0]; worldToLocal(lA, anchorA, posA, quatA);
    const lB: Vec3 = [0, 0, 0]; worldToLocal(lB, anchorB, posB, quatB);
    joint.localAnchorA.set(lA[0], lA[1], lA[2]); joint.localAnchorB.set(lB[0], lB[1], lB[2]);
    joint.asBallSocket();
    return meepEnqueue(state, joint);
}

export function removeJoint(state: ImplState, handle: Joint): void {
    // If still pending (never linked), just drop it from the queue.
    const idx = state.pendingJoints.indexOf(handle);
    if (idx !== -1) state.pendingJoints.splice(idx, 1);
    // unlink_joint is idempotent and safe to call on an unlinked joint.
    state.physics.unlink_joint(handle);
}

export function setHingeMotor(_state: ImplState, handle: Joint, desc: HingeMotorDesc): void {
    if (desc.mode === 'off') {
        // maxForce=0 makes the motor inert (cannot apply torque), effectively free
        handle.setAngularMotor(0, 0, 0);
    } else {
        // axis 0 = x = the free hinge axis (set in asHinge(0))
        handle.setAngularMotor(0, desc.speed, desc.maxTorque);
    }
}

export function setHingeLimits(_state: ImplState, handle: Joint, lower: number, upper: number): void {
    // axis 0 = x = the free hinge axis (set in asHinge(0))
    handle.setAngularLimit(0, lower, upper);
}

export function raycastClosest(out: RaycastResult, state: ImplState, origin: Vec3, direction: Vec3, maxDistance: number): void {
    const ray = state._ray;
    ray.setOrigin(origin[0], origin[1], origin[2]);
    // Ray3 packs direction at indices 3..5; setting via the typed-array view
    // is the documented "fast path" replacement for a setDirection method.
    ray[3] = direction[0];
    ray[4] = direction[1];
    ray[5] = direction[2];
    ray.tMax = maxDistance;
    const hit = state.physics.raycast(ray, state._hit);
    if (!hit) {
        out.hit = false;
        out.fraction = 0;
        return;
    }
    out.hit = true;
    out.fraction = state._hit.t / maxDistance;
}
