// tumble: crashcat's design in C++, compiled to wasm, through its js package (tumble.js)

import tumbleWasmUrl from 'tumble.js/tumble.wasm?url';
import { vec3 } from 'mathcat';
import {
    addBroadphaseLayer,
    addObjectLayer,
    type BodyId,
    box,
    type CastRaySettings,
    CastRayStatus,
    type ConstraintId,
    castRay,
    constraints,
    convexHull,
    createClosestCastRayCollector,
    createDefaultCastRaySettings,
    createWorld as createTumbleWorld,
    createWorldSettings,
    destroyWorld,
    distanceConstraint,
    enableCollision,
    fixedConstraint,
    hingeConstraint,
    init as initTumble,
    type Listener,
    MotorState,
    pointConstraint,
    releaseShape,
    rigidBody,
    type Shape,
    setGravity as setTumbleGravity,
    sphere,
    MotionType as TumbleMotionType,
    triangleMesh,
    updateWorld,
    type World,
} from 'tumble.js';
import type { HingeMotorDesc, PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';
import { Capability, JointType, MotionType, ShapeType } from '../api';

export const capabilities: ReadonlySet<Capability> = new Set([
    Capability.Raycast,
    Capability.ContactListener,
    Capability.HingeLimits,
    Capability.ConvexHull,
]);

// crashcat's default convex radius, as the other crashcat builds here have it
const CONVEX_RADIUS = 0.05;

type TumbleBody = { id: BodyId };

type TumbleJoint = { type: JointType; id: ConstraintId };

type ImplState = {
    world: World;
    moving: number;
    notMoving: number;
    /** by id, for the contact listener */
    bodies: Map<BodyId, TumbleBody>;
    listener: Listener | undefined;
};

const closest = createClosestCastRayCollector();
// made once the wasm is up, as its defaults are the wasm's
let raySettings: CastRaySettings;

export async function init(): Promise<void> {
    await initTumble({ wasm: tumbleWasmUrl });
    raySettings = createDefaultCastRaySettings();
}

export function createWorld(): ImplState {
    const settings = createWorldSettings();
    const moving = addObjectLayer(settings, addBroadphaseLayer(settings));
    const notMoving = addObjectLayer(settings, addBroadphaseLayer(settings));
    enableCollision(settings, moving, moving);
    enableCollision(settings, moving, notMoving);
    const world = createTumbleWorld(settings);
    return { world, moving, notMoving, bodies: new Map(), listener: undefined };
}

export function disposeWorld(state: ImplState): void {
    destroyWorld(state.world);
}

export function setGravity(state: ImplState, x: number, y: number, z: number): void {
    setTumbleGravity(state.world, [x, y, z]);
}

export function stepSimulation(state: ImplState, dt: number): void {
    updateWorld(state.world, state.listener, dt);
}

export function onContactAdded(state: ImplState, onContact: (bodyA: TumbleBody, bodyB: TumbleBody) => void): void {
    state.listener = {
        onContactAdded: (contact) => {
            const bodyA = state.bodies.get(contact.bodyA);
            const bodyB = state.bodies.get(contact.bodyB);
            if (bodyA && bodyB) onContact(bodyA, bodyB);
        },
    };
}

export function disposeContactListener(state: ImplState): void {
    state.listener = undefined;
}

export function createShape(_state: ImplState, desc: PhysicsShape): Shape {
    switch (desc.type) {
        case ShapeType.BOX:
            return box.create({ halfExtents: desc.halfExtents, convexRadius: desc.convexRadius ?? CONVEX_RADIUS });
        case ShapeType.SPHERE:
            return sphere.create({ radius: desc.radius });
        case ShapeType.CONVEX_HULL:
            return convexHull.create({ positions: desc.points, convexRadius: CONVEX_RADIUS });
        case ShapeType.TRIANGLE_MESH:
            return triangleMesh.create({ positions: desc.positions, indices: desc.indices });
    }
}

export function destroyShape(_state: ImplState, shape: Shape): void {
    releaseShape(shape);
}

function motionTypeOf(motionType: MotionType): TumbleMotionType {
    switch (motionType) {
        case MotionType.STATIC:
            return TumbleMotionType.STATIC;
        case MotionType.DYNAMIC:
            return TumbleMotionType.DYNAMIC;
        case MotionType.KINEMATIC:
            return TumbleMotionType.KINEMATIC;
    }
}

export function createRigidBody(state: ImplState, options: RigidBodyOptions, shape: Shape): TumbleBody {
    const id = rigidBody.create(state.world, {
        shape,
        objectLayer: options.motionType === MotionType.STATIC ? state.notMoving : state.moving,
        motionType: motionTypeOf(options.motionType),
        position: options.position,
        quaternion: options.quaternion ?? [0, 0, 0, 1],
        mass: options.mass,
        friction: options.friction ?? 0.5,
        restitution: options.restitution ?? 0,
    });
    const body = { id };
    state.bodies.set(id, body);
    return body;
}

export function removeRigidBody(state: ImplState, body: TumbleBody): void {
    rigidBody.remove(state.world, body.id);
    state.bodies.delete(body.id);
}

export function getBodyPosition(out: Vec3, state: ImplState, body: TumbleBody): void {
    rigidBody.getPosition(out, state.world, body.id);
}

export function getBodyQuaternion(out: Quat, state: ImplState, body: TumbleBody): void {
    rigidBody.getQuaternion(out, state.world, body.id);
}

export function setBodyPosition(state: ImplState, body: TumbleBody, position: Vec3): void {
    rigidBody.setPosition(state.world, body.id, position, true);
}

export function setBodyQuaternion(state: ImplState, body: TumbleBody, quaternion: Quat): void {
    rigidBody.setQuaternion(state.world, body.id, quaternion, true);
}

export function setBodyLinearVelocity(state: ImplState, body: TumbleBody, velocity: Vec3): void {
    rigidBody.setLinearVelocity(state.world, body.id, velocity);
}

export function getBodyLinearVelocity(out: Vec3, state: ImplState, body: TumbleBody): void {
    rigidBody.getLinearVelocity(out, state.world, body.id);
}

export function applyImpulse(state: ImplState, body: TumbleBody, impulse: Vec3): void {
    rigidBody.addImpulse(state.world, body.id, impulse);
}

export function setBodyTranslationRotation(state: ImplState, body: TumbleBody, position: Vec3, quaternion: Quat): void {
    rigidBody.setTransform(state.world, body.id, position, quaternion, true);
}

export function raycastClosest(out: RaycastResult, state: ImplState, origin: Vec3, direction: Vec3, maxDistance: number): void {
    closest.reset();
    castRay(state.world, closest, raySettings, origin, direction, maxDistance);
    out.hit = closest.hit.status === CastRayStatus.COLLIDING;
    out.fraction = out.hit ? closest.hit.fraction : 0;
}

export function createPointJoint(state: ImplState, anchor: Vec3, bodyA: TumbleBody, bodyB: TumbleBody): TumbleJoint {
    return {
        type: JointType.POINT,
        id: pointConstraint.create(state.world, bodyA.id, bodyB.id, { pointA: anchor, pointB: anchor }),
    };
}

export function createHingeJoint(state: ImplState, anchor: Vec3, axis: Vec3, bodyA: TumbleBody, bodyB: TumbleBody): TumbleJoint {
    const normal: Vec3 = [0, 0, 0];
    vec3.perpendicular(normal, axis);
    const id = hingeConstraint.create(state.world, bodyA.id, bodyB.id, {
        pointA: anchor,
        pointB: anchor,
        hingeAxisA: axis,
        hingeAxisB: axis,
        normalAxisA: normal,
        normalAxisB: normal,
    });
    return { type: JointType.HINGE, id };
}

const at: Vec3 = [0, 0, 0];

export function createFixedJoint(state: ImplState, bodyA: TumbleBody, bodyB: TumbleBody): TumbleJoint {
    // at body a, as the crashcat impl joins them
    rigidBody.getPosition(at, state.world, bodyA.id);
    return { type: JointType.FIXED, id: fixedConstraint.create(state.world, bodyA.id, bodyB.id, { pointA: at, pointB: at }) };
}

export function createDistanceJoint(
    state: ImplState,
    anchorA: Vec3,
    anchorB: Vec3,
    minDistance: number | undefined,
    maxDistance: number | undefined,
    bodyA: TumbleBody,
    bodyB: TumbleBody,
): TumbleJoint {
    const id = distanceConstraint.create(state.world, bodyA.id, bodyB.id, {
        pointA: anchorA,
        pointB: anchorB,
        minDistance: minDistance ?? -1,
        maxDistance: maxDistance ?? -1,
    });
    return { type: JointType.DISTANCE, id };
}

export function removeJoint(state: ImplState, joint: TumbleJoint): void {
    constraints.remove(state.world, joint.id);
}

export function setHingeMotor(state: ImplState, joint: TumbleJoint, desc: HingeMotorDesc): void {
    if (joint.type !== JointType.HINGE) return;
    if (desc.mode === 'off') {
        hingeConstraint.setMotorState(state.world, joint.id, MotorState.OFF);
        return;
    }
    hingeConstraint.setMotorSettings(state.world, joint.id, { minTorqueLimit: -desc.maxTorque, maxTorqueLimit: desc.maxTorque });
    hingeConstraint.setMotorState(state.world, joint.id, MotorState.VELOCITY);
    hingeConstraint.setTargetAngularVelocity(state.world, joint.id, desc.speed);
}

export function setHingeLimits(state: ImplState, joint: TumbleJoint, lower: number, upper: number): void {
    if (joint.type !== JointType.HINGE) return;
    hingeConstraint.setLimits(state.world, joint.id, lower, upper);
}
