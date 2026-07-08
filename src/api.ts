import type { PhysicsImpl } from './impls/impl';

export type Vec3 = [x: number, y: number, z: number];

export type Quat = [x: number, y: number, z: number, w: number];

export type HingeMotorDesc = { mode: 'velocity'; speed: number; maxTorque: number } | { mode: 'off' };

export enum Capability {
    Raycast = 'Raycast',
    ContactListener = 'ContactListener',
    HingeLimits = 'HingeLimits',
    ConvexHull = 'ConvexHull',
}

export enum JointType {
    POINT = 0,
    HINGE = 1,
    FIXED = 2,
    DISTANCE = 3,
}

export type PointJointDesc = {
    type: JointType.POINT;
    anchor: Vec3;
};

export type HingeJointDesc = {
    type: JointType.HINGE;
    anchor: Vec3;
    axis: Vec3;
};

export type FixedJointDesc = {
    type: JointType.FIXED;
};

export type DistanceJointDesc = {
    type: JointType.DISTANCE;
    anchorA: Vec3;
    anchorB: Vec3;
    minDistance?: number;
    maxDistance?: number;
};

export type JointDesc = PointJointDesc | HingeJointDesc | FixedJointDesc | DistanceJointDesc;

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
    points: number[];
};

export type TriangleMeshShape = {
    type: ShapeType.TRIANGLE_MESH;
    positions: Float32Array;
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

type ShapeEntry<TShape extends object> = {
    implHandle: TShape;
    desc: PhysicsShape;
};

export type BodyState<TBody extends object = object> = {
    handle: TBody;
    shapeDesc: PhysicsShape;
    motionType: MotionType;
    position: Vec3;
    prevPosition: Vec3;
    quaternion: Quat;
    prevQuaternion: Quat;
};

type ConstraintEntry<TJoint extends object> = { type: JointType; implHandle: TJoint };

export type PhysicsState<
    TWorld = unknown,
    TBody extends object = object,
    TJoint extends object = object,
    TShape extends object = object,
> = {
    impl: PhysicsImpl<TWorld, TBody, TJoint, TShape>;
    world: TWorld;
    bodies: Map<number, BodyState<TBody>>;
    nextBodyId: number;
    handleToBodyId: Map<TBody, number>;
    contactCallback: ((bodyIdA: number, bodyIdB: number) => void) | null;
    shapes: Map<number, ShapeEntry<TShape>>;
    nextShapeId: number;
    constraints: Map<number, ConstraintEntry<TJoint>>;
    nextConstraintId: number;
};

const _pos: Vec3 = [0, 0, 0];
const _quat: Quat = [0, 0, 0, 1];

export function createPhysicsState<W, B extends object, J extends object, S extends object>(
    impl: PhysicsImpl<W, B, J, S>,
    world: W,
): PhysicsState<W, B, J, S> {
    const handleToBodyId = new Map<B, number>();
    const state: PhysicsState<W, B, J, S> = {
        impl,
        world,
        bodies: new Map(),
        nextBodyId: 0,
        handleToBodyId,
        contactCallback: null,
        shapes: new Map(),
        nextShapeId: 0,
        constraints: new Map(),
        nextConstraintId: 0,
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

export function setGravity<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, x: number, y: number, z: number): void {
    state.impl.setGravity(state.world, x, y, z);
}

export function createShape<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, desc: PhysicsShape): number {
    const implHandle = state.impl.createShape(state.world, desc);
    const shapeId = state.nextShapeId++;
    state.shapes.set(shapeId, { implHandle, desc });
    return shapeId;
}

export function destroyShape<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, shapeId: number): void {
    const entry = state.shapes.get(shapeId);
    if (!entry) return;
    state.impl.destroyShape(state.world, entry.implHandle);
    state.shapes.delete(shapeId);
}

export function createRigidBody<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, options: RigidBodyOptions): number {
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
        position: pos,
        quaternion: quat,
    });
    state.handleToBodyId.set(handle, bodyId);
    return bodyId;
}

export function removeRigidBody<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, bodyId: number): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    state.impl.removeRigidBody(state.world, body.handle);
    state.handleToBodyId.delete(body.handle);
    state.bodies.delete(bodyId);
}

export function getBodyPosition<W, B extends object, J extends object, S extends object>(out: Vec3, state: PhysicsState<W, B, J, S>, bodyId: number): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    out[0] = body.position[0];
    out[1] = body.position[1];
    out[2] = body.position[2];
}

export function getBodyQuaternion<W, B extends object, J extends object, S extends object>(out: Quat, state: PhysicsState<W, B, J, S>, bodyId: number): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    out[0] = body.quaternion[0];
    out[1] = body.quaternion[1];
    out[2] = body.quaternion[2];
    out[3] = body.quaternion[3];
}

export function setBodyPosition<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, bodyId: number, position: Vec3): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    state.impl.setBodyPosition(state.world, body.handle, position);
    body.prevPosition[0] = body.position[0] = position[0];
    body.prevPosition[1] = body.position[1] = position[1];
    body.prevPosition[2] = body.position[2] = position[2];
}

export function setBodyQuaternion<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, bodyId: number, quaternion: Quat): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    state.impl.setBodyQuaternion(state.world, body.handle, quaternion);
    body.prevQuaternion[0] = body.quaternion[0] = quaternion[0];
    body.prevQuaternion[1] = body.quaternion[1] = quaternion[1];
    body.prevQuaternion[2] = body.quaternion[2] = quaternion[2];
    body.prevQuaternion[3] = body.quaternion[3] = quaternion[3];
}

export function setBodyLinearVelocity<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, bodyId: number, velocity: Vec3): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    state.impl.setBodyLinearVelocity(state.world, body.handle, velocity);
}

export function applyImpulse<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, bodyId: number, impulse: Vec3): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    state.impl.applyImpulse(state.world, body.handle, impulse);
}

export function getBodyLinearVelocity<W, B extends object, J extends object, S extends object>(out: Vec3, state: PhysicsState<W, B, J, S>, bodyId: number): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    state.impl.getBodyLinearVelocity(out, state.world, body.handle);
}

export function setBodyTranslationRotation<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, bodyId: number, position: Vec3, quaternion: Quat): void {
    const body = state.bodies.get(bodyId);
    if (!body) return;
    state.impl.setBodyTranslationRotation(state.world, body.handle, position, quaternion);
    body.prevPosition[0] = body.position[0] = position[0];
    body.prevPosition[1] = body.position[1] = position[1];
    body.prevPosition[2] = body.position[2] = position[2];
    body.prevQuaternion[0] = body.quaternion[0] = quaternion[0];
    body.prevQuaternion[1] = body.quaternion[1] = quaternion[1];
    body.prevQuaternion[2] = body.quaternion[2] = quaternion[2];
    body.prevQuaternion[3] = body.quaternion[3] = quaternion[3];
}

export function raycastClosest<W, B extends object, J extends object, S extends object>(
    out: RaycastResult,
    state: PhysicsState<W, B, J, S>,
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
): void {
    state.impl.raycastClosest(out, state.world, origin, direction, maxDistance);
}

export function onContactAdded<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, callback: (bodyIdA: number, bodyIdB: number) => void): void {
    state.contactCallback = callback;
}

function _bodies<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, bodyIdA: number, bodyIdB: number, ctx: string): [B, B] {
    const bodyA = state.bodies.get(bodyIdA);
    const bodyB = state.bodies.get(bodyIdB);
    if (!bodyA || !bodyB) throw new Error(`${ctx}: unknown body id`);
    return [bodyA.handle, bodyB.handle];
}

function _addJoint<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, type: JointType, implHandle: J): number {
    const id = state.nextConstraintId++;
    state.constraints.set(id, { type, implHandle });
    return id;
}

export function createHingeConstraint<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, bodyIdA: number, bodyIdB: number, anchor: Vec3, axis: Vec3): number {
    const [bA, bB] = _bodies(state, bodyIdA, bodyIdB, 'createHingeConstraint');
    return _addJoint(state, JointType.HINGE, state.impl.createHingeJoint(state.world, anchor, axis, bA, bB));
}

export function createFixedConstraint<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, bodyIdA: number, bodyIdB: number): number {
    const [bA, bB] = _bodies(state, bodyIdA, bodyIdB, 'createFixedConstraint');
    return _addJoint(state, JointType.FIXED, state.impl.createFixedJoint(state.world, bA, bB));
}

export function createPointConstraint<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, bodyIdA: number, bodyIdB: number, anchor: Vec3): number {
    const [bA, bB] = _bodies(state, bodyIdA, bodyIdB, 'createPointConstraint');
    return _addJoint(state, JointType.POINT, state.impl.createPointJoint(state.world, anchor, bA, bB));
}

export function createDistanceConstraint<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, bodyIdA: number, bodyIdB: number, anchorA: Vec3, anchorB: Vec3, minDistance?: number, maxDistance?: number): number {
    const [bA, bB] = _bodies(state, bodyIdA, bodyIdB, 'createDistanceConstraint');
    return _addJoint(state, JointType.DISTANCE, state.impl.createDistanceJoint(state.world, anchorA, anchorB, minDistance, maxDistance, bA, bB));
}

export function removeConstraint<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, id: number): void {
    const entry = state.constraints.get(id);
    if (!entry) return;
    state.impl.removeJoint(state.world, entry.implHandle);
    state.constraints.delete(id);
}

export function setHingeMotor<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, id: number, desc: HingeMotorDesc): void {
    const entry = state.constraints.get(id);
    if (!entry || entry.type !== JointType.HINGE) return;
    state.impl.setHingeMotor(state.world, entry.implHandle, desc);
}

export function setHingeLimits<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, id: number, lower: number, upper: number): void {
    const entry = state.constraints.get(id);
    if (!entry || entry.type !== JointType.HINGE) return;
    state.impl.setHingeLimits(state.world, entry.implHandle, lower, upper);
}

export function createJoint<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, desc: JointDesc, bodyIdA: number, bodyIdB: number): number {
    switch (desc.type) {
        case JointType.POINT:    return createPointConstraint(state, bodyIdA, bodyIdB, desc.anchor);
        case JointType.HINGE:    return createHingeConstraint(state, bodyIdA, bodyIdB, desc.anchor, desc.axis);
        case JointType.FIXED:    return createFixedConstraint(state, bodyIdA, bodyIdB);
        case JointType.DISTANCE: return createDistanceConstraint(state, bodyIdA, bodyIdB, desc.anchorA, desc.anchorB, desc.minDistance, desc.maxDistance);
    }
}

export function removeJoint<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>, jointId: number): void {
    removeConstraint(state, jointId);
}

export function snapshot<W, B extends object, J extends object, S extends object>(state: PhysicsState<W, B, J, S>): void {
    for (const body of state.bodies.values()) {
        body.prevPosition[0] = body.position[0];
        body.prevPosition[1] = body.position[1];
        body.prevPosition[2] = body.position[2];
        body.prevQuaternion[0] = body.quaternion[0];
        body.prevQuaternion[1] = body.quaternion[1];
        body.prevQuaternion[2] = body.quaternion[2];
        body.prevQuaternion[3] = body.quaternion[3];

        state.impl.getBodyPosition(_pos, state.world, body.handle);
        state.impl.getBodyQuaternion(_quat, state.world, body.handle);
        body.position[0] = _pos[0];
        body.position[1] = _pos[1];
        body.position[2] = _pos[2];
        body.quaternion[0] = _quat[0];
        body.quaternion[1] = _quat[1];
        body.quaternion[2] = _quat[2];
        body.quaternion[3] = _quat[3];
    }
}
