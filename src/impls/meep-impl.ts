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
import { RigidBody } from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';
import { PhysicsSurfacePoint } from '@woosh/meep-engine/src/engine/physics/queries/PhysicsSurfacePoint.js';

import type { PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';
import { MotionType, ShapeType } from '../api';

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
    contactListener: ((payload: { entityA: number; entityB: number }) => void) | null;
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
        contactListener: null,
        _ray: Ray3.from(0, 0, 0, 0, -1, 0, 1),
        _hit: new PhysicsSurfacePoint(),
    };
}

export function disposeWorld(state: ImplState): void {
    if (state.contactListener) {
        state.physics.onContactBegin.remove(state.contactListener);
        state.contactListener = null;
    }
    state.em.shutdown();
    state.em.detachDataset();
    state.entityToBody.clear();
}

export function setGravity(state: ImplState, x: number, y: number, z: number): void {
    state.physics.gravity.set(x, y, z);
}

export function stepSimulation(state: ImplState, dt: number): void {
    state.em.simulate(dt);
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
    state.contactCb = onContact;
    state.contactListener = (payload) => {
        // Payload is reused across dispatches — read entityA/entityB immediately.
        const handleA = state.entityToBody.get(payload.entityA);
        const handleB = state.entityToBody.get(payload.entityB);
        if (handleA && handleB) onContact(handleA, handleB);
    };
    state.physics.onContactBegin.add(state.contactListener);
}

export function disposeContactListener(state: ImplState): void {
    if (state.contactListener) {
        state.physics.onContactBegin.remove(state.contactListener);
        state.contactListener = null;
    }
    state.contactCb = null;
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
