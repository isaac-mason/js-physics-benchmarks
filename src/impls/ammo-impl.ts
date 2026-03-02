import type { PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';
import { MotionType, ShapeType } from '../api';
import ammoWasmUrl from '../lib/ammo/ammo.wasm.wasm?url';
import { getAmmoFactory } from '../lib/ammo/ammo-factory';

type Ammo = any;

let A: Ammo = null;

type AmmoBodyHandle = {
    body: any; // btRigidBody
    motionState: any; // btDefaultMotionState
    // NOTE: shape is NOT stored here — it is owned by the PhysicsState shapes map
};

export type ImplState = {
    world: any; // btDiscreteDynamicsWorld
    dispatcher: any; // btCollisionDispatcher — needed to iterate manifolds
    _tmpTransform: any;
    _tmpVec: any;
    _tmpCb: any; // ClosestRayResultCallback — reused across raycastClosest calls
    _prevContactKeys: Set<string>;
    _contactCallback: ((hA: AmmoBodyHandle, hB: AmmoBodyHandle) => void) | null;
    _handleByPtr: Map<number, AmmoBodyHandle>;
};

function bodyPairKey(ptrA: number, ptrB: number): string {
    return ptrA < ptrB ? `${ptrA}:${ptrB}` : `${ptrB}:${ptrA}`;
}

export async function init(): Promise<void> {
    const instance: Ammo = await getAmmoFactory()({
        locateFile: (path: string) => (path === 'ammo.wasm.wasm' ? ammoWasmUrl : path),
    });
    A = instance;
}

export function createWorld(): ImplState {
    const collisionConfig = new A.btDefaultCollisionConfiguration();
    const dispatcher = new A.btCollisionDispatcher(collisionConfig);
    const broadphase = new A.btDbvtBroadphase();
    const solver = new A.btSequentialImpulseConstraintSolver();
    const world = new A.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, collisionConfig);
    world.setGravity(new A.btVector3(0, -9.81, 0));

    const origin = new A.btVector3(0, 0, 0);
    const tmpCb = new A.ClosestRayResultCallback(origin, origin);
    A.destroy(origin);

    return {
        world,
        dispatcher,
        _tmpTransform: new A.btTransform(),
        _tmpVec: new A.btVector3(0, 0, 0),
        _tmpCb: tmpCb,
        _prevContactKeys: new Set(),
        _contactCallback: null,
        _handleByPtr: new Map(),
    };
}

export function disposeWorld(state: ImplState): void {
    // Scratch objects
    A.destroy(state._tmpTransform);
    A.destroy(state._tmpVec);
    A.destroy(state._tmpCb);
    // Note: dispatcher, broadphase, solver, collisionConfig are owned by btDiscreteDynamicsWorld
    // in ammo.js and freed when the world is freed. We don't destroy them separately.
    A.destroy(state.world);
}

export function setGravity(state: ImplState, x: number, y: number, z: number): void {
    state._tmpVec.setValue(x, y, z);
    state.world.setGravity(state._tmpVec);
}

export function stepSimulation(state: ImplState, dt: number): void {
    // Use a single fixed sub-step of exactly dt so the caller's fixed timestep is respected
    state.world.stepSimulation(dt, 1, dt);

    if (!state._contactCallback) return;

    const dispatcher = state.dispatcher;
    const numManifolds: number = dispatcher.getNumManifolds();
    const currentKeys = new Set<string>();

    for (let i = 0; i < numManifolds; i++) {
        const manifold = dispatcher.getManifoldByIndexInternal(i);
        // Only fire if there is actual penetration
        if (manifold.getNumContacts() === 0) continue;

        const ptrA: number = A.getPointer(manifold.getBody0());
        const ptrB: number = A.getPointer(manifold.getBody1());
        const key = bodyPairKey(ptrA, ptrB);
        currentKeys.add(key);

        if (!state._prevContactKeys.has(key)) {
            const hA = state._handleByPtr.get(ptrA);
            const hB = state._handleByPtr.get(ptrB);
            if (hA && hB) {
                state._contactCallback(hA, hB);
            }
        }
    }

    state._prevContactKeys = currentKeys;
}

export function onContactAdded(state: ImplState, onContact: (hA: AmmoBodyHandle, hB: AmmoBodyHandle) => void): void {
    state._contactCallback = onContact;
    state._prevContactKeys = new Set();
}

export function disposeContactListener(state: ImplState): void {
    state._contactCallback = null;
    state._prevContactKeys = new Set();
}

export function createShape(_state: ImplState, desc: PhysicsShape): Ammo {
    switch (desc.type) {
        case ShapeType.BOX:
            return new A.btBoxShape(new A.btVector3(desc.halfExtents[0], desc.halfExtents[1], desc.halfExtents[2]));
        case ShapeType.SPHERE:
            return new A.btSphereShape(desc.radius);
        case ShapeType.CONVEX_HULL: {
            const hull = new A.btConvexHullShape();
            for (let i = 0; i < desc.points.length; i += 3) {
                const v = new A.btVector3(desc.points[i]!, desc.points[i + 1]!, desc.points[i + 2]!);
                hull.addPoint(v, i + 3 >= desc.points.length); // recalculate AABB on last point
                A.destroy(v);
            }
            return hull;
        }
        case ShapeType.TRIANGLE_MESH: {
            const mesh = new A.btTriangleMesh(true, true);
            const v0 = new A.btVector3(0, 0, 0);
            const v1 = new A.btVector3(0, 0, 0);
            const v2 = new A.btVector3(0, 0, 0);
            for (let i = 0; i < desc.indices.length; i += 3) {
                const a = desc.indices[i]! * 3;
                const b = desc.indices[i + 1]! * 3;
                const c = desc.indices[i + 2]! * 3;
                v0.setValue(desc.positions[a]!, desc.positions[a + 1]!, desc.positions[a + 2]!);
                v1.setValue(desc.positions[b]!, desc.positions[b + 1]!, desc.positions[b + 2]!);
                v2.setValue(desc.positions[c]!, desc.positions[c + 1]!, desc.positions[c + 2]!);
                mesh.addTriangle(v0, v1, v2, false);
            }
            A.destroy(v0);
            A.destroy(v1);
            A.destroy(v2);
            return new A.btBvhTriangleMeshShape(mesh, true, true);
        }
    }
}

/** Destroy a btCollisionShape. Must be called only after all bodies using it have been removed. */
export function destroyShape(_state: ImplState, implHandle: Ammo): void {
    A.destroy(implHandle);
}

export function createRigidBody(state: ImplState, options: RigidBodyOptions, implShape: Ammo): AmmoBodyHandle {
    const startTransform = new A.btTransform();
    startTransform.setIdentity();
    startTransform.setOrigin(new A.btVector3(options.position[0], options.position[1], options.position[2]));
    if (options.quaternion) {
        startTransform.setRotation(
            new A.btQuaternion(options.quaternion[0], options.quaternion[1], options.quaternion[2], options.quaternion[3]),
        );
    }

    const motionState = new A.btDefaultMotionState(startTransform);
    A.destroy(startTransform);

    const isDynamic = options.motionType === MotionType.DYNAMIC;
    const mass = isDynamic ? (options.mass ?? 1) : 0;

    const localInertia = new A.btVector3(0, 0, 0);
    if (mass > 0) {
        implShape.calculateLocalInertia(mass, localInertia);
    }

    const rbInfo = new A.btRigidBodyConstructionInfo(mass, motionState, implShape, localInertia);
    A.destroy(localInertia);

    if (options.friction !== undefined) rbInfo.set_m_friction(options.friction);
    if (options.restitution !== undefined) rbInfo.set_m_restitution(options.restitution);

    const body = new A.btRigidBody(rbInfo);
    A.destroy(rbInfo);

    if (options.motionType === MotionType.KINEMATIC) {
        body.setCollisionFlags(body.getCollisionFlags() | 2); // CF_KINEMATIC_OBJECT
        body.setActivationState(4); // DISABLE_DEACTIVATION
    }

    state.world.addRigidBody(body);

    const handle: AmmoBodyHandle = { body, motionState };
    state._handleByPtr.set(A.getPointer(body), handle);
    return handle;
}

export function removeRigidBody(state: ImplState, handle: AmmoBodyHandle): void {
    state._handleByPtr.delete(A.getPointer(handle.body));
    state.world.removeRigidBody(handle.body);
    A.destroy(handle.body);
    A.destroy(handle.motionState);
    // NOTE: shape is NOT destroyed here — it is owned by the PhysicsState shapes map
    // and must be destroyed via destroyShape() after all bodies using it are removed.
}

export function getBodyPosition(out: Vec3, state: ImplState, handle: AmmoBodyHandle): void {
    handle.body.getMotionState().getWorldTransform(state._tmpTransform);
    const o = state._tmpTransform.getOrigin();
    out[0] = o.x();
    out[1] = o.y();
    out[2] = o.z();
}

export function getBodyQuaternion(out: Quat, state: ImplState, handle: AmmoBodyHandle): void {
    handle.body.getMotionState().getWorldTransform(state._tmpTransform);
    const r = state._tmpTransform.getRotation();
    out[0] = r.x();
    out[1] = r.y();
    out[2] = r.z();
    out[3] = r.w();
}

export function setBodyPosition(state: ImplState, handle: AmmoBodyHandle, position: Vec3): void {
    handle.body.getMotionState().getWorldTransform(state._tmpTransform);
    state._tmpVec.setValue(position[0], position[1], position[2]);
    state._tmpTransform.setOrigin(state._tmpVec);
    handle.body.setWorldTransform(state._tmpTransform);
    handle.body.getMotionState().setWorldTransform(state._tmpTransform);
    handle.body.activate(true);
}

export function setBodyQuaternion(state: ImplState, handle: AmmoBodyHandle, quaternion: Quat): void {
    handle.body.getMotionState().getWorldTransform(state._tmpTransform);
    const q = new A.btQuaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    state._tmpTransform.setRotation(q);
    A.destroy(q);
    handle.body.setWorldTransform(state._tmpTransform);
    handle.body.getMotionState().setWorldTransform(state._tmpTransform);
    handle.body.activate(true);
}

export function setBodyLinearVelocity(state: ImplState, handle: AmmoBodyHandle, velocity: Vec3): void {
    state._tmpVec.setValue(velocity[0], velocity[1], velocity[2]);
    handle.body.setLinearVelocity(state._tmpVec);
    handle.body.activate(true);
}

export function getBodyLinearVelocity(out: Vec3, _state: ImplState, handle: AmmoBodyHandle): void {
    const v = handle.body.getLinearVelocity();
    out[0] = v.x();
    out[1] = v.y();
    out[2] = v.z();
}

export function setBodyTranslationRotation(state: ImplState, handle: AmmoBodyHandle, position: Vec3, quaternion: Quat): void {
    state._tmpVec.setValue(position[0], position[1], position[2]);
    state._tmpTransform.setOrigin(state._tmpVec);
    const q = new A.btQuaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    state._tmpTransform.setRotation(q);
    A.destroy(q);
    handle.body.setWorldTransform(state._tmpTransform);
    handle.body.getMotionState().setWorldTransform(state._tmpTransform);
    handle.body.activate(true);
}

export function raycastClosest(out: RaycastResult, state: ImplState, origin: Vec3, direction: Vec3, maxDistance: number): void {
    state._tmpCb.m_rayFromWorld.setValue(origin[0], origin[1], origin[2]);
    state._tmpCb.m_rayToWorld.setValue(
        origin[0] + direction[0] * maxDistance,
        origin[1] + direction[1] * maxDistance,
        origin[2] + direction[2] * maxDistance,
    );
    state._tmpCb.m_closestHitFraction = 1;
    state._tmpCb.m_collisionObject = A.NULL;
    state.world.rayTest(state._tmpCb.m_rayFromWorld, state._tmpCb.m_rayToWorld, state._tmpCb);
    if (state._tmpCb.hasHit()) {
        out.hit = true;
        out.fraction = state._tmpCb.get_m_closestHitFraction();
    } else {
        out.hit = false;
        out.fraction = 0;
    }
}
