import type { HingeMotorDesc, PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';

export type PhysicsImpl<
    TWorld = unknown,
    TBody extends object = object,
    TJoint extends object = object,
    TShape extends object = object,
> = {
    init(): Promise<void>;
    createWorld(): TWorld;
    disposeWorld(world: TWorld): void;
    setGravity(world: TWorld, x: number, y: number, z: number): void;
    stepSimulation(world: TWorld, dt: number): void;
    createShape(world: TWorld, desc: PhysicsShape): TShape;
    destroyShape(world: TWorld, implHandle: TShape): void;
    createRigidBody(world: TWorld, options: RigidBodyOptions, implShape: TShape): TBody;
    removeRigidBody(world: TWorld, handle: TBody): void;
    getBodyPosition(out: Vec3, world: TWorld, handle: TBody): void;
    getBodyQuaternion(out: Quat, world: TWorld, handle: TBody): void;
    setBodyPosition(world: TWorld, handle: TBody, position: Vec3): void;
    setBodyQuaternion(world: TWorld, handle: TBody, quaternion: Quat): void;
    setBodyLinearVelocity(world: TWorld, handle: TBody, velocity: Vec3): void;
    getBodyLinearVelocity(out: Vec3, world: TWorld, handle: TBody): void;
    applyImpulse(world: TWorld, handle: TBody, impulse: Vec3): void;
    setBodyTranslationRotation(world: TWorld, handle: TBody, position: Vec3, quaternion: Quat): void;
    onContactAdded(world: TWorld, onContact: (handleA: TBody, handleB: TBody) => void): void;
    disposeContactListener(world: TWorld): void;
    raycastClosest(out: RaycastResult, world: TWorld, origin: Vec3, direction: Vec3, maxDistance: number): void;
    createPointJoint(world: TWorld, anchor: Vec3, bodyA: TBody, bodyB: TBody): TJoint;
    createHingeJoint(world: TWorld, anchor: Vec3, axis: Vec3, bodyA: TBody, bodyB: TBody): TJoint;
    createFixedJoint(world: TWorld, bodyA: TBody, bodyB: TBody): TJoint;
    createDistanceJoint(world: TWorld, anchorA: Vec3, anchorB: Vec3, minDistance: number | undefined, maxDistance: number | undefined, bodyA: TBody, bodyB: TBody): TJoint;
    removeJoint(world: TWorld, handle: TJoint): void;
    setHingeMotor(world: TWorld, handle: TJoint, desc: HingeMotorDesc): void;
    setHingeLimits(world: TWorld, handle: TJoint, lower: number, upper: number): void;
}
