import type { PhysicsImpl } from './impls/impl';

export type Vec3 = [x: number, y: number, z: number];

export type Quat = [x: number, y: number, z: number, w: number];

export enum MotionType {
    STATIC = 0,
    DYNAMIC = 1,
    KINEMATIC = 2,
}

export enum ShapeType {
    BOX = 0,
    SPHERE = 1,
    CONVEX_HULL = 2,
    TRIANGLE_MESH = 3,
}

export type BoxShape = {
    type: ShapeType.BOX;
    halfExtents: [number, number, number];
    convexRadius?: number;
};

export type SphereShape = {
    type: ShapeType.SPHERE;
    radius: number;
};

export type ConvexHullShape = {
    type: ShapeType.CONVEX_HULL;
    /** Flat array of input points [x,y,z, x,y,z, ...] — interior points are fine, engine will compute the hull */
    points: number[];
};

export type TriangleMeshShape = {
    type: ShapeType.TRIANGLE_MESH;
    /** Flat Float32Array of vertex positions [x,y,z, x,y,z, ...] */
    positions: Float32Array;
    /** Flat Uint32Array of triangle indices [i0,i1,i2, i3,i4,i5, ...] */
    indices: Uint32Array;
};

export type PhysicsShape = BoxShape | SphereShape | ConvexHullShape | TriangleMeshShape;

export type RaycastResult = {
    hit: boolean;
    fraction: number;
};

export function createRaycastResult(): RaycastResult {
    return { hit: false, fraction: 0 };
}

export type RigidBodyOptions = {
    /** Numeric shape ID returned by createShape() */
    shape: number;
    motionType: MotionType;
    position: Vec3;
    quaternion?: Quat;
    mass?: number;
    friction?: number;
    restitution?: number;
};

const DEFAULT_FRICTION = 0.5;
const DEFAULT_RESTITUTION = 0.0;

type ShapeEntry = {
    implHandle: any;
    desc: PhysicsShape;
};

export type BodyState = {
    handle: any;
    shapeDesc: PhysicsShape;
    motionType: MotionType;
    prevPosition: Vec3;
    prevQuaternion: Quat;
    currPosition: Vec3;
    currQuaternion: Quat;
};

export type PhysicsState = {
    impl: PhysicsImpl;
    world: any;
    bodies: Map<number, BodyState>;
    nextBodyId: number;
    handleToBodyId: Map<any, number>;
    contactCallback: ((bodyIdA: number, bodyIdB: number) => void) | null;
    shapes: Map<number, ShapeEntry>;
    nextShapeId: number;
};

const _pos: Vec3 = [0, 0, 0];
const _quat: Quat = [0, 0, 0, 1];

export function createPhysicsState(impl: PhysicsImpl, world: any): PhysicsState {
    const handleToBodyId = new Map<any, number>();
    const state: PhysicsState = {
        impl,
        world,
        bodies: new Map(),
        nextBodyId: 0,
        handleToBodyId,
        contactCallback: null,
        shapes: new Map(),
        nextShapeId: 0,
    };

    impl.onContactAdded(world, (hA, hB) => {
        if (!state.contactCallback) return;
        const idA = handleToBodyId.get(hA);
        const idB = handleToBodyId.get(hB);
        if (idA === undefined || idB === undefined) return;
        state.contactCallback(idA, idB);
    });

    return state;
}

export function setGravity(state: PhysicsState, x: number, y: number, z: number): void {
    state.impl.setGravity(state.world, x, y, z);
}

/** Create a shape from a descriptor. Returns a numeric shape ID for use with createRigidBody(). */
export function createShape(state: PhysicsState, desc: PhysicsShape): number {
    const implHandle = state.impl.createShape(state.world, desc);
    const shapeId = state.nextShapeId++;
    state.shapes.set(shapeId, { implHandle, desc });
    return shapeId;
}

/** Destroy a previously created shape. Must not be called while any body still references it. */
export function destroyShape(state: PhysicsState, shapeId: number): void {
    const entry = state.shapes.get(shapeId);
    if (!entry) return;
    state.impl.destroyShape(state.world, entry.implHandle);
    state.shapes.delete(shapeId);
}

export function createRigidBody(state: PhysicsState, options: RigidBodyOptions): number {
    const shapeEntry = state.shapes.get(options.shape);
    if (!shapeEntry) throw new Error(`createRigidBody: unknown shape id ${options.shape}`);
    const normalised: RigidBodyOptions = {
        ...options,
        friction: options.friction ?? DEFAULT_FRICTION,
        restitution: options.restitution ?? DEFAULT_RESTITUTION,
    };
    const handle = state.impl.createRigidBody(state.world, normalised, shapeEntry.implHandle);
    const bodyId = state.nextBodyId++;
    const pos: Vec3 = [options.position[0], options.position[1], options.position[2]];
    const quat: Quat = options.quaternion
        ? [options.quaternion[0], options.quaternion[1], options.quaternion[2], options.quaternion[3]]
        : [0, 0, 0, 1];
    state.bodies.set(bodyId, {
        handle,
        shapeDesc: shapeEntry.desc,
        motionType: options.motionType,
        prevPosition: [pos[0], pos[1], pos[2]],
        prevQuaternion: [quat[0], quat[1], quat[2], quat[3]],
        currPosition: pos,
        currQuaternion: quat,
    });
    state.handleToBodyId.set(handle, bodyId);
    return bodyId;
}

export function removeRigidBody(state: PhysicsState, bodyId: number): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    state.impl.removeRigidBody(state.world, body.handle);
    state.handleToBodyId.delete(body.handle);
    state.bodies.delete(bodyId);
}

export function getBodyPosition(out: Vec3, state: PhysicsState, bodyId: number): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    out[0] = body.currPosition[0];
    out[1] = body.currPosition[1];
    out[2] = body.currPosition[2];
}

export function getBodyQuaternion(out: Quat, state: PhysicsState, bodyId: number): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    out[0] = body.currQuaternion[0];
    out[1] = body.currQuaternion[1];
    out[2] = body.currQuaternion[2];
    out[3] = body.currQuaternion[3];
}

export function setBodyPosition(state: PhysicsState, bodyId: number, position: Vec3): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    state.impl.setBodyPosition(state.world, body.handle, position);
    // teleport — snap prev = curr so interpolation doesn't ghost
    body.prevPosition[0] = body.currPosition[0] = position[0];
    body.prevPosition[1] = body.currPosition[1] = position[1];
    body.prevPosition[2] = body.currPosition[2] = position[2];
}

export function setBodyQuaternion(state: PhysicsState, bodyId: number, quaternion: Quat): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    state.impl.setBodyQuaternion(state.world, body.handle, quaternion);
    body.prevQuaternion[0] = body.currQuaternion[0] = quaternion[0];
    body.prevQuaternion[1] = body.currQuaternion[1] = quaternion[1];
    body.prevQuaternion[2] = body.currQuaternion[2] = quaternion[2];
    body.prevQuaternion[3] = body.currQuaternion[3] = quaternion[3];
}

export function setBodyLinearVelocity(state: PhysicsState, bodyId: number, velocity: Vec3): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    state.impl.setBodyLinearVelocity(state.world, body.handle, velocity);
}

export function getBodyLinearVelocity(out: Vec3, state: PhysicsState, bodyId: number): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    state.impl.getBodyLinearVelocity(out, state.world, body.handle);
}

export function setBodyTranslationRotation(state: PhysicsState, bodyId: number, position: Vec3, quaternion: Quat): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    state.impl.setBodyTranslationRotation(state.world, body.handle, position, quaternion);
    // teleport — snap prev = curr for both position and quaternion
    body.prevPosition[0] = body.currPosition[0] = position[0];
    body.prevPosition[1] = body.currPosition[1] = position[1];
    body.prevPosition[2] = body.currPosition[2] = position[2];
    body.prevQuaternion[0] = body.currQuaternion[0] = quaternion[0];
    body.prevQuaternion[1] = body.currQuaternion[1] = quaternion[1];
    body.prevQuaternion[2] = body.currQuaternion[2] = quaternion[2];
    body.prevQuaternion[3] = body.currQuaternion[3] = quaternion[3];
}

export function raycastClosest(
    out: RaycastResult,
    state: PhysicsState,
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
): void {
    state.impl.raycastClosest(out, state.world, origin, direction, maxDistance);
}

/** Register a callback fired once per new contact pair per step. Replaces any existing callback. */
export function onContactAdded(state: PhysicsState, callback: (bodyIdA: number, bodyIdB: number) => void): void {
    state.contactCallback = callback;
}

/** Called by main.ts after each stepSimulation. Advances prev→curr for all bodies. */
export function snapshot(state: PhysicsState): void {
    for (const body of state.bodies.values()) {
        body.prevPosition[0] = body.currPosition[0];
        body.prevPosition[1] = body.currPosition[1];
        body.prevPosition[2] = body.currPosition[2];
        body.prevQuaternion[0] = body.currQuaternion[0];
        body.prevQuaternion[1] = body.currQuaternion[1];
        body.prevQuaternion[2] = body.currQuaternion[2];
        body.prevQuaternion[3] = body.currQuaternion[3];

        state.impl.getBodyPosition(_pos, state.world, body.handle);
        state.impl.getBodyQuaternion(_quat, state.world, body.handle);
        body.currPosition[0] = _pos[0];
        body.currPosition[1] = _pos[1];
        body.currPosition[2] = _pos[2];
        body.currQuaternion[0] = _quat[0];
        body.currQuaternion[1] = _quat[1];
        body.currQuaternion[2] = _quat[2];
        body.currQuaternion[3] = _quat[3];
    }
}
