import { type Body, type CastResult, Ray, Vec3 as BounceVec3, World } from '@perplexdotgg/bounce';
import type { PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';
import { MotionType, ShapeType } from '../api';

type ImplState = {
    world: World;
    onContactAdded: ((hA: Body, hB: Body) => void) | null;
    prevContactKeys: Set<string>;
};

function buildBounceShape(world: World, desc: PhysicsShape) {
    switch (desc.type) {
        case ShapeType.BOX:
            return world.createBox({
                width: desc.halfExtents[0] * 2,
                height: desc.halfExtents[1] * 2,
                depth: desc.halfExtents[2] * 2,
                convexRadius: desc.convexRadius,
            });
        case ShapeType.SPHERE:
            return world.createSphere({ radius: desc.radius });
        case ShapeType.CONVEX_HULL:
            return world.createConvexHull(new Float32Array(desc.points));
        case ShapeType.TRIANGLE_MESH: {
            const idxU32 = desc.indices instanceof Uint32Array ? desc.indices : new Uint32Array(desc.indices);
            return world.createTriangleMesh({
                vertexPositions: desc.positions,
                faceIndices: idxU32,
            });
        }
    }
}

export function init(): Promise<void> {
    return Promise.resolve();
}

export function createWorld(): ImplState {
    const world = new World({
        gravity: { x: 0, y: -9.81, z: 0 },
    });
    return {
        world,
        onContactAdded: null,
        prevContactKeys: new Set(),
    };
}

export function disposeWorld(_state: ImplState): void {
    // no-op
}

export function setGravity(state: ImplState, x: number, y: number, z: number): void {
    state.world.gravity.set({ x, y, z });
}

export function stepSimulation(state: ImplState, dt: number): void {
    state.world.takeOneStep(dt);

    if (state.onContactAdded) {
        const currKeys = new Set<string>();
        for (const manifold of state.world.iterateContactManifolds()) {
            if (!state.prevContactKeys.has(manifold.key)) {
                state.onContactAdded(manifold.bodyA as Body, manifold.bodyB as Body);
            }
            currKeys.add(manifold.key);
        }

        state.prevContactKeys = currKeys;
    }
}

export function onContactAdded(state: ImplState, onContact: (hA: Body, hB: Body) => void): void {
    state.onContactAdded = onContact;
}

export function disposeContactListener(state: ImplState): void {
    state.onContactAdded = null;
    state.prevContactKeys.clear();
}

export function createShape(_state: ImplState, desc: PhysicsShape): PhysicsShape {
    return desc;
}

export function destroyShape(_state: ImplState, _implHandle: PhysicsShape): void {
    _state.world.destroyShape(_implHandle as any);
}

export function createRigidBody(state: ImplState, options: RigidBodyOptions, implShape: PhysicsShape): Body {
    const shape = buildBounceShape(state.world, implShape);

    // bounce's body-creation field for initial rotation is `orientation`, not
    // `quaternion` — map it across (default identity) or the initial rotation
    // is silently dropped.
    const bodyOptions = {
        ...options,
        orientation: options.quaternion ?? [0, 0, 0, 1],
        shape,
    };

    let body: Body;
    if (options.motionType === MotionType.STATIC) {
        body = state.world.createStaticBody(bodyOptions);
    } else if (options.motionType === MotionType.KINEMATIC) {
        body = state.world.createKinematicBody(bodyOptions);
    } else {
        body = state.world.createDynamicBody(bodyOptions);
    }
    return body;
}

export function removeRigidBody(state: ImplState, handle: Body): void {
    state.world.destroyBody(handle);
}

export function getBodyPosition(out: Vec3, _state: ImplState, handle: Body): void {
    out[0] = handle.position.x;
    out[1] = handle.position.y;
    out[2] = handle.position.z;
}

export function getBodyQuaternion(out: Quat, _state: ImplState, handle: Body): void {
    out[0] = handle.orientation.x;
    out[1] = handle.orientation.y;
    out[2] = handle.orientation.z;
    out[3] = handle.orientation.w;
}

export function setBodyPosition(_state: ImplState, handle: Body, position: Vec3): void {
    handle.position.set(position);
    handle.commitChanges();
    handle.wakeUp();
}

export function setBodyQuaternion(_state: ImplState, handle: Body, quaternion: Quat): void {
    handle.orientation.set(quaternion);
    handle.commitChanges();
    handle.wakeUp();
}

export function setBodyLinearVelocity(_state: ImplState, handle: Body, velocity: Vec3): void {
    handle.linearVelocity.set(velocity);
}

const _bounceImpulse = new BounceVec3();

export function applyImpulse(_state: ImplState, handle: Body, impulse: Vec3): void {
    _bounceImpulse.set(impulse);
    handle.applyLinearImpulse(_bounceImpulse);
    handle.wakeUp();
}

export function getBodyLinearVelocity(out: Vec3, _state: ImplState, handle: Body): void {
    out[0] = handle.linearVelocity.x;
    out[1] = handle.linearVelocity.y;
    out[2] = handle.linearVelocity.z;
}

export function setBodyTranslationRotation(_state: ImplState, handle: Body, position: Vec3, quaternion: Quat): void {
    handle.position.set(position);
    handle.orientation.set(quaternion);
    handle.commitChanges();
    handle.wakeUp();
}

// Ray.create's input is required by the derived monomorph type, even though
// every field is overwritten by raycastClosest on each call.
const _raycastClosest_ray = Ray.create({
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 1, z: 0 },
    length: 0,
});
let _raycastClosest_out: RaycastResult | null = null;

function _raycastClosest_cb(result: CastResult): undefined {
    _raycastClosest_out!.hit = true;
    _raycastClosest_out!.fraction = result.fraction;
}

export function raycastClosest(out: RaycastResult, state: ImplState, origin: Vec3, direction: Vec3, maxDistance: number): void {
    _raycastClosest_ray.origin.set(origin);
    _raycastClosest_ray.direction.set(direction);
    _raycastClosest_ray.direction.normalize();
    _raycastClosest_ray.length = maxDistance;

    out.hit = false;
    out.fraction = 0;
    _raycastClosest_out = out;
    state.world.castRay(_raycastClosest_cb, _raycastClosest_ray, true);
    _raycastClosest_out = null;
}
