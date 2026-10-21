// tumble: crashcat's design in C++, compiled to wasm, through its js package. `tumble` and `tumble-binary` are the
// sibling checkout's built js/dist (vite.config.ts), so a run benches whatever was last built there

import tumbleWasmUrl from 'tumble-binary?url';
import { vec3 } from 'mathcat';
import {
    type BodyId,
    Box,
    type CastRaySettings,
    CastRayStatus,
    ConvexHull,
    castRay,
    createClosestCastRayCollector,
    createDefaultCastRaySettings,
    DistanceConstraint,
    FixedConstraint,
    HingeConstraint,
    init as initTumble,
    type Listener,
    MotorState,
    PointConstraint,
    RigidBody,
    Shape,
    Sphere,
    TriangleMesh,
    MotionType as TumbleMotionType,
    World,
    WorldSettings,
} from 'tumble';
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

type TumbleJoint = { type: JointType; id: number };

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
    const settings = WorldSettings.create();
    const moving = WorldSettings.addObjectLayer(settings, WorldSettings.addBroadphaseLayer(settings));
    const notMoving = WorldSettings.addObjectLayer(settings, WorldSettings.addBroadphaseLayer(settings));
    WorldSettings.enableCollision(settings, moving, moving);
    WorldSettings.enableCollision(settings, moving, notMoving);
    const world = World.create(settings);
    return { world, moving, notMoving, bodies: new Map(), listener: undefined };
}

export function disposeWorld(state: ImplState): void {
    World.destroy(state.world);
}

export function setGravity(state: ImplState, x: number, y: number, z: number): void {
    World.setGravity(state.world, [x, y, z]);
}

export function stepSimulation(state: ImplState, dt: number): void {
    World.step(state.world, state.listener, dt);
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
            return Box.create({ halfExtents: desc.halfExtents, convexRadius: desc.convexRadius ?? CONVEX_RADIUS });
        case ShapeType.SPHERE:
            return Sphere.create({ radius: desc.radius });
        case ShapeType.CONVEX_HULL:
            return ConvexHull.create({ positions: desc.points, convexRadius: CONVEX_RADIUS });
        case ShapeType.TRIANGLE_MESH:
            return TriangleMesh.create({ positions: desc.positions, indices: desc.indices });
    }
}

export function destroyShape(_state: ImplState, shape: Shape): void {
    Shape.destroy(shape);
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
    const id = RigidBody.create(state.world, {
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
    RigidBody.remove(state.world, body.id);
    state.bodies.delete(body.id);
}

export function getBodyPosition(out: Vec3, state: ImplState, body: TumbleBody): void {
    RigidBody.getPosition(out, state.world, body.id);
}

export function getBodyQuaternion(out: Quat, state: ImplState, body: TumbleBody): void {
    RigidBody.getQuaternion(out, state.world, body.id);
}

export function setBodyPosition(state: ImplState, body: TumbleBody, position: Vec3): void {
    RigidBody.setPosition(state.world, body.id, position, true);
}

export function setBodyQuaternion(state: ImplState, body: TumbleBody, quaternion: Quat): void {
    RigidBody.setQuaternion(state.world, body.id, quaternion, true);
}

export function setBodyLinearVelocity(state: ImplState, body: TumbleBody, velocity: Vec3): void {
    RigidBody.setLinearVelocity(state.world, body.id, velocity);
}

export function getBodyLinearVelocity(out: Vec3, state: ImplState, body: TumbleBody): void {
    RigidBody.getLinearVelocity(out, state.world, body.id);
}

export function applyImpulse(state: ImplState, body: TumbleBody, impulse: Vec3): void {
    RigidBody.addImpulse(state.world, body.id, impulse);
}

export function setBodyTranslationRotation(state: ImplState, body: TumbleBody, position: Vec3, quaternion: Quat): void {
    RigidBody.setTransform(state.world, body.id, position, quaternion, true);
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
        id: PointConstraint.create(state.world, bodyA.id, bodyB.id, { pointA: anchor, pointB: anchor }),
    };
}

export function createHingeJoint(state: ImplState, anchor: Vec3, axis: Vec3, bodyA: TumbleBody, bodyB: TumbleBody): TumbleJoint {
    const normal: Vec3 = [0, 0, 0];
    vec3.perpendicular(normal, axis);
    const id = HingeConstraint.create(state.world, bodyA.id, bodyB.id, {
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
    RigidBody.getPosition(at, state.world, bodyA.id);
    return { type: JointType.FIXED, id: FixedConstraint.create(state.world, bodyA.id, bodyB.id, { pointA: at, pointB: at }) };
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
    const id = DistanceConstraint.create(state.world, bodyA.id, bodyB.id, {
        pointA: anchorA,
        pointB: anchorB,
        minDistance: minDistance ?? -1,
        maxDistance: maxDistance ?? -1,
    });
    return { type: JointType.DISTANCE, id };
}

export function removeJoint(state: ImplState, joint: TumbleJoint): void {
    switch (joint.type) {
        case JointType.POINT:
            PointConstraint.remove(state.world, joint.id);
            break;
        case JointType.HINGE:
            HingeConstraint.remove(state.world, joint.id);
            break;
        case JointType.FIXED:
            FixedConstraint.remove(state.world, joint.id);
            break;
        case JointType.DISTANCE:
            DistanceConstraint.remove(state.world, joint.id);
            break;
    }
}

export function setHingeMotor(state: ImplState, joint: TumbleJoint, desc: HingeMotorDesc): void {
    if (joint.type !== JointType.HINGE) return;
    if (desc.mode === 'off') {
        HingeConstraint.setMotorState(state.world, joint.id, MotorState.OFF);
        return;
    }
    HingeConstraint.setMotorSettings(state.world, joint.id, { minTorqueLimit: -desc.maxTorque, maxTorqueLimit: desc.maxTorque });
    HingeConstraint.setMotorState(state.world, joint.id, MotorState.VELOCITY);
    HingeConstraint.setTargetAngularVelocity(state.world, joint.id, desc.speed);
}

export function setHingeLimits(state: ImplState, joint: TumbleJoint, lower: number, upper: number): void {
    if (joint.type !== JointType.HINGE) return;
    HingeConstraint.setLimits(state.world, joint.id, lower, upper);
}
