import * as crashcat from 'crashcat';
import type { PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';
import { MotionType, ShapeType } from '../api';

type ImplState = {
    world: crashcat.World;
    objectLayerMoving: number;
    objectLayerNotMoving: number;
    onContactAdded?: (hA: crashcat.RigidBody, hB: crashcat.RigidBody) => void;
};

type RigidBody = crashcat.RigidBody;

function motionTypeToImpl(motionType: MotionType): crashcat.MotionType {
    switch (motionType) {
        case MotionType.STATIC:
            return crashcat.MotionType.STATIC;
        case MotionType.DYNAMIC:
            return crashcat.MotionType.DYNAMIC;
        case MotionType.KINEMATIC:
            return crashcat.MotionType.KINEMATIC;
    }
}

export function init(): Promise<void> {
    crashcat.registerAll();
    return Promise.resolve();
}

export function disposeWorld(_state: ImplState): void {
    // no-op
}

export function createWorld(): ImplState {
    const worldSettings = crashcat.createWorldSettings();

    const broadphaseLayerMoving = crashcat.addBroadphaseLayer(worldSettings);
    const broadphaseLayerNotMoving = crashcat.addBroadphaseLayer(worldSettings);

    const objectLayerMoving = crashcat.addObjectLayer(worldSettings, broadphaseLayerMoving);
    const objectLayerNotMoving = crashcat.addObjectLayer(worldSettings, broadphaseLayerNotMoving);

    crashcat.enableCollision(worldSettings, objectLayerMoving, objectLayerMoving);
    crashcat.enableCollision(worldSettings, objectLayerMoving, objectLayerNotMoving);

    const world = crashcat.createWorld(worldSettings);

    return { world, objectLayerMoving, objectLayerNotMoving };
}

export function setGravity(state: ImplState, x: number, y: number, z: number): void {
    state.world.settings.gravity = [x, y, z];
}

export function stepSimulation(state: ImplState, deltaTime: number): void {
    let listener: crashcat.Listener | undefined;
    if (state.onContactAdded) {
        const cb = state.onContactAdded;
        listener = {
            onContactAdded: (bodyA, bodyB) => {
                cb(bodyA, bodyB);
            },
        };
    }
    crashcat.updateWorld(state.world, listener, deltaTime);
}

export function onContactAdded(state: ImplState, onContact: (hA: crashcat.RigidBody, hB: crashcat.RigidBody) => void): void {
    state.onContactAdded = onContact;
}

export function disposeContactListener(_state: ImplState): void {
    // no-op
}

export function createShape(_state: ImplState, desc: PhysicsShape): crashcat.Shape {
    switch (desc.type) {
        case ShapeType.BOX:
            return crashcat.box.create({
                halfExtents: desc.halfExtents,
                convexRadius: desc.convexRadius ?? 0.05,
            });
        case ShapeType.SPHERE:
            return crashcat.sphere.create({
                radius: desc.radius,
            });
        case ShapeType.CONVEX_HULL:
            return crashcat.convexHull.create({
                positions: desc.points,
            });
        case ShapeType.TRIANGLE_MESH:
            return crashcat.triangleMesh.create({
                positions: Array.from(desc.positions),
                indices: Array.from(desc.indices),
            });
    }
}

export function destroyShape(_state: ImplState, _implHandle: crashcat.Shape): void {
    // no-op
}

export function createRigidBody(state: ImplState, options: RigidBodyOptions, implShape: crashcat.Shape): RigidBody {
    return crashcat.rigidBody.create(state.world, {
        shape: implShape,
        motionType: motionTypeToImpl(options.motionType),
        objectLayer: state.objectLayerMoving,
        position: options.position,
        quaternion: options.quaternion ?? [0, 0, 0, 1],
        mass: options.mass,
        friction: options.friction ?? 0.5,
        restitution: options.restitution ?? 0,
    });
}

export function removeRigidBody(state: ImplState, handle: RigidBody): void {
    crashcat.rigidBody.remove(state.world, handle);
}

export function getBodyPosition(out: Vec3, _state: ImplState, handle: RigidBody): void {
    out[0] = handle.position[0];
    out[1] = handle.position[1];
    out[2] = handle.position[2];
}

export function getBodyQuaternion(out: Quat, _state: ImplState, handle: RigidBody): void {
    out[0] = handle.quaternion[0];
    out[1] = handle.quaternion[1];
    out[2] = handle.quaternion[2];
    out[3] = handle.quaternion[3];
}

export function setBodyPosition(state: ImplState, handle: RigidBody, position: Vec3): void {
    crashcat.rigidBody.setPosition(state.world, handle, position, true);
}

export function setBodyQuaternion(state: ImplState, handle: RigidBody, quaternion: Quat): void {
    crashcat.rigidBody.setQuaternion(state.world, handle, quaternion, true);
}

export function setBodyLinearVelocity(state: ImplState, handle: RigidBody, velocity: Vec3): void {
    crashcat.rigidBody.setLinearVelocity(state.world, handle, velocity);
}

export function getBodyLinearVelocity(out: Vec3, _state: ImplState, handle: RigidBody): void {
    const vel = handle.motionProperties.linearVelocity;
    out[0] = vel[0];
    out[1] = vel[1];
    out[2] = vel[2];
}

export function setBodyTranslationRotation(state: ImplState, handle: RigidBody, position: Vec3, quaternion: Quat): void {
    crashcat.rigidBody.setTransform(state.world, handle, position, quaternion, true);
}

const _raycastClosest_closestCollector = crashcat.createClosestCastRayCollector();
const _raycastClosest_castRaySettings = crashcat.createDefaultCastRaySettings();

export function raycastClosest(out: RaycastResult, state: ImplState, origin: Vec3, direction: Vec3, maxDistance: number): void {
    _raycastClosest_closestCollector.reset();
    const filter = crashcat.filter.forWorld(state.world);
    crashcat.castRay(state.world, _raycastClosest_closestCollector, _raycastClosest_castRaySettings, origin, direction, maxDistance, filter);
    if (_raycastClosest_closestCollector.hit.status !== crashcat.CastRayStatus.COLLIDING) {
        out.hit = false;
        out.fraction = 0;
        return;
    }
    out.hit = true;
    out.fraction = _raycastClosest_closestCollector.hit.fraction;
}
