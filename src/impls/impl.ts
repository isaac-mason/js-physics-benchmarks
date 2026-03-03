import type { PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';

type PhysicsState = any;

export type PhysicsImpl = {
    init(): Promise<void>;
    createWorld(): PhysicsState;
    disposeWorld(world: PhysicsState): void;
    setGravity(world: PhysicsState, x: number, y: number, z: number): void;
    stepSimulation(world: PhysicsState, dt: number): void;
    createShape(world: PhysicsState, desc: PhysicsShape): any;
    destroyShape(world: PhysicsState, implHandle: any): void;
    createRigidBody(world: PhysicsState, options: RigidBodyOptions, implShape: any): any;
    removeRigidBody(world: PhysicsState, handle: any): void;
    getBodyPosition(out: Vec3, world: PhysicsState, handle: any): void;
    getBodyQuaternion(out: Quat, world: PhysicsState, handle: any): void;
    setBodyPosition(world: PhysicsState, handle: any, position: Vec3): void;
    setBodyQuaternion(world: PhysicsState, handle: any, quaternion: Quat): void;
    setBodyLinearVelocity(world: PhysicsState, handle: any, velocity: Vec3): void;
    getBodyLinearVelocity(out: Vec3, world: PhysicsState, handle: any): void;
    setBodyTranslationRotation(world: PhysicsState, handle: any, position: Vec3, quaternion: Quat): void;
    onContactAdded(world: PhysicsState, onContact: (handleA: any, handleB: any) => void): void;
    disposeContactListener(world: PhysicsState): void;
    raycastClosest(out: RaycastResult, world: PhysicsState, origin: Vec3, direction: Vec3, maxDistance: number): void;
}
