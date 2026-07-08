import RAPIER from '@dimforge/rapier3d';
import type { HingeMotorDesc, PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';
import { Capability, MotionType, ShapeType } from '../api';
import { quat } from 'mathcat';
import { worldToLocal } from './impl-helpers';

export const capabilities: ReadonlySet<Capability> = new Set([Capability.Raycast, Capability.ContactListener, Capability.HingeLimits, Capability.ConvexHull]);

type ImplState = {
    world: RAPIER.World;
    eventQueue?: RAPIER.EventQueue;
    onContactAdded?: (hA: RAPIER.RigidBody, hB: RAPIER.RigidBody) => void;
    _ray: RAPIER.Ray;
};

type RigidBody = RAPIER.RigidBody;

function descFromShape(desc: PhysicsShape): RAPIER.ColliderDesc {
    switch (desc.type) {
        case ShapeType.BOX:
            return RAPIER.ColliderDesc.cuboid(desc.halfExtents[0], desc.halfExtents[1], desc.halfExtents[2]);
        case ShapeType.SPHERE:
            return RAPIER.ColliderDesc.ball(desc.radius);
        case ShapeType.CONVEX_HULL: {
            const pts = new Float32Array(desc.points);
            const cd = RAPIER.ColliderDesc.convexHull(pts);
            if (!cd) throw new Error('rapier: convexHull failed — degenerate point set');
            return cd;
        }
        case ShapeType.TRIANGLE_MESH: {
            const idxU32 = desc.indices instanceof Uint32Array ? desc.indices : new Uint32Array(desc.indices);
            const cd = RAPIER.ColliderDesc.trimesh(desc.positions, idxU32);
            if (!cd) throw new Error('rapier: trimesh failed');
            return cd;
        }
    }
}

function motionTypeToRigidBodyDesc(motionType: MotionType): RAPIER.RigidBodyDesc {
    switch (motionType) {
        case MotionType.STATIC:
            return RAPIER.RigidBodyDesc.fixed();
        case MotionType.DYNAMIC:
            return RAPIER.RigidBodyDesc.dynamic();
        case MotionType.KINEMATIC:
            return RAPIER.RigidBodyDesc.kinematicPositionBased();
    }
}

export async function init(): Promise<void> {
    // @dimforge/rapier3d uses native ESM WASM imports — no async init needed
}

export function disposeWorld(state: ImplState): void {
    state.world.free();
}

export function createWorld(): ImplState {
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    return {
        world: new RAPIER.World(gravity),
        _ray: new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
    };
}

export function setGravity(state: ImplState, x: number, y: number, z: number): void {
    state.world.gravity = { x, y, z };
}

export function stepSimulation(state: ImplState, _dt: number): void {
    state.world.step(state.eventQueue);
    if (state.eventQueue && state.onContactAdded) {
        const cb = state.onContactAdded;
        state.eventQueue.drainCollisionEvents((handle1: number, handle2: number, started: boolean) => {
            if (!started) return;
            const col1 = state.world.getCollider(handle1);
            const col2 = state.world.getCollider(handle2);
            const body1 = col1?.parent();
            const body2 = col2?.parent();
            if (body1 && body2) cb(body1, body2);
        });
    }
}

export function onContactAdded(state: ImplState, onContact: (hA: RAPIER.RigidBody, hB: RAPIER.RigidBody) => void): void {
    state.eventQueue = new RAPIER.EventQueue(true);
    state.onContactAdded = onContact;
}

export function disposeContactListener(state: ImplState): void {
    state.eventQueue?.free();
}

export type RapierShapeHandle = { physicsDesc: PhysicsShape };

export function createShape(_state: ImplState, desc: PhysicsShape): RapierShapeHandle {
    return { physicsDesc: desc };
}

export function destroyShape(_state: ImplState, _implHandle: RapierShapeHandle): void {
    // no-op
}

export function createRigidBody(state: ImplState, options: RigidBodyOptions, implShape: RapierShapeHandle): RigidBody {
    const bodyDesc = motionTypeToRigidBodyDesc(options.motionType).setTranslation(
        options.position[0],
        options.position[1],
        options.position[2],
    );
    if (options.quaternion) {
        bodyDesc.setRotation({
            x: options.quaternion[0],
            y: options.quaternion[1],
            z: options.quaternion[2],
            w: options.quaternion[3],
        });
    }
    if (options.mass !== undefined) {
        bodyDesc.mass = options.mass;
        bodyDesc.massOnly = true;
    }
    const rigidBody = state.world.createRigidBody(bodyDesc);

    // clone the desc so per-body material settings don't mutate the shared descriptor
    const colliderDesc = descFromShape(
        // we reconstruct from the original PhysicsShape each time — Rapier has no true native
        // shape sharing; each createCollider allocates WASM memory anyway.
        implShape.physicsDesc,
    );
    if (options.friction !== undefined) {
        colliderDesc.setFriction(options.friction);
    }
    if (options.restitution !== undefined) {
        colliderDesc.setRestitution(options.restitution);
    }
    colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    state.world.createCollider(colliderDesc, rigidBody);
    return rigidBody;
}

export function removeRigidBody(state: ImplState, handle: RigidBody): void {
    state.world.removeRigidBody(handle);
}

export function getBodyPosition(out: Vec3, _state: ImplState, handle: RigidBody): void {
    const pos = handle.translation();
    out[0] = pos.x;
    out[1] = pos.y;
    out[2] = pos.z;
}

export function getBodyQuaternion(out: Quat, _state: ImplState, handle: RigidBody): void {
    const rot = handle.rotation();
    out[0] = rot.x;
    out[1] = rot.y;
    out[2] = rot.z;
    out[3] = rot.w;
}

export function setBodyPosition(_state: ImplState, handle: RigidBody, position: Vec3): void {
    handle.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
}

export function setBodyQuaternion(_state: ImplState, handle: RigidBody, quaternion: Quat): void {
    handle.setRotation({ x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] }, true);
}

export function setBodyLinearVelocity(_state: ImplState, handle: RigidBody, velocity: Vec3): void {
    handle.setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
}

export function applyImpulse(_state: ImplState, handle: RigidBody, impulse: Vec3): void {
    handle.applyImpulse({ x: impulse[0], y: impulse[1], z: impulse[2] }, true);
}

export function getBodyLinearVelocity(out: Vec3, _state: ImplState, handle: RigidBody): void {
    const vel = handle.linvel();
    out[0] = vel.x;
    out[1] = vel.y;
    out[2] = vel.z;
}

export function setBodyTranslationRotation(_state: ImplState, handle: RigidBody, position: Vec3, quaternion: Quat): void {
    handle.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
    handle.setRotation({ x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] }, true);
}

function rapierTransforms(bodyA: RigidBody, bodyB: RigidBody) {
    const pA = bodyA.translation(), rA = bodyA.rotation();
    const pB = bodyB.translation(), rB = bodyB.rotation();
    return {
        posA: [pA.x, pA.y, pA.z] as Vec3, qA: [rA.x, rA.y, rA.z, rA.w] as Quat,
        posB: [pB.x, pB.y, pB.z] as Vec3, qB: [rB.x, rB.y, rB.z, rB.w] as Quat,
    };
}

export function createPointJoint(state: ImplState, anchor: Vec3, bodyA: RigidBody, bodyB: RigidBody): RAPIER.ImpulseJoint {
    const { posA, qA, posB, qB } = rapierTransforms(bodyA, bodyB);
    const lA: Vec3 = [0, 0, 0]; worldToLocal(lA, anchor, posA, qA);
    const lB: Vec3 = [0, 0, 0]; worldToLocal(lB, anchor, posB, qB);
    return state.world.createImpulseJoint(
        RAPIER.JointData.spherical({ x: lA[0], y: lA[1], z: lA[2] }, { x: lB[0], y: lB[1], z: lB[2] }),
        bodyA, bodyB, true,
    );
}

export function createHingeJoint(state: ImplState, anchor: Vec3, axis: Vec3, bodyA: RigidBody, bodyB: RigidBody): RAPIER.ImpulseJoint {
    const { posA, qA, posB, qB } = rapierTransforms(bodyA, bodyB);
    const lA: Vec3 = [0, 0, 0]; worldToLocal(lA, anchor, posA, qA);
    const lB: Vec3 = [0, 0, 0]; worldToLocal(lB, anchor, posB, qB);
    return state.world.createImpulseJoint(
        RAPIER.JointData.revolute(
            { x: lA[0], y: lA[1], z: lA[2] },
            { x: lB[0], y: lB[1], z: lB[2] },
            { x: axis[0], y: axis[1], z: axis[2] },
        ),
        bodyA, bodyB, true,
    );
}

export function createFixedJoint(state: ImplState, bodyA: RigidBody, bodyB: RigidBody): RAPIER.ImpulseJoint {
    const { posA, qA, posB, qB } = rapierTransforms(bodyA, bodyB);
    // frame2 = conjB * qA so that qB * frame2 = qA (frames coincide in world)
    const lB: Vec3 = [0, 0, 0]; worldToLocal(lB, posA, posB, qB);
    const conjB: Quat = [-qB[0], -qB[1], -qB[2], qB[3]];
    const frame2: Quat = [0, 0, 0, 1]; quat.multiply(frame2, conjB, qA);
    return state.world.createImpulseJoint(
        RAPIER.JointData.fixed(
            { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 },
            { x: lB[0], y: lB[1], z: lB[2] }, { x: frame2[0], y: frame2[1], z: frame2[2], w: frame2[3] },
        ),
        bodyA, bodyB, true,
    );
}

export function createDistanceJoint(state: ImplState, anchorA: Vec3, anchorB: Vec3, _minDist: number | undefined, maxDistance: number | undefined, bodyA: RigidBody, bodyB: RigidBody): RAPIER.ImpulseJoint {
    const { posA, qA, posB, qB } = rapierTransforms(bodyA, bodyB);
    const lA: Vec3 = [0, 0, 0]; worldToLocal(lA, anchorA, posA, qA);
    const lB: Vec3 = [0, 0, 0]; worldToLocal(lB, anchorB, posB, qB);
    const dx = anchorA[0] - anchorB[0], dy = anchorA[1] - anchorB[1], dz = anchorA[2] - anchorB[2];
    const maxDist = maxDistance ?? Math.sqrt(dx * dx + dy * dy + dz * dz);
    return state.world.createImpulseJoint(
        RAPIER.JointData.rope(maxDist, { x: lA[0], y: lA[1], z: lA[2] }, { x: lB[0], y: lB[1], z: lB[2] }),
        bodyA, bodyB, true,
    );
}

export function removeJoint(state: ImplState, handle: RAPIER.ImpulseJoint): void {
    state.world.removeImpulseJoint(handle, true);
}

export function setHingeMotor(_state: ImplState, handle: RAPIER.ImpulseJoint, desc: HingeMotorDesc): void {
    const j = handle as RAPIER.RevoluteImpulseJoint;
    if (desc.mode === 'off') {
        j.configureMotorVelocity(0, 0);
    } else {
        j.configureMotorVelocity(desc.speed, desc.maxTorque);
    }
}

export function setHingeLimits(_state: ImplState, handle: RAPIER.ImpulseJoint, lower: number, upper: number): void {
    const j = handle as RAPIER.RevoluteImpulseJoint;
    j.setLimits(lower, upper);
    (j as any).limitsEnabled = true;
}

export function raycastClosest(out: RaycastResult, state: ImplState, origin: Vec3, direction: Vec3, maxDistance: number): void {
    const ray = state._ray;
    ray.origin.x = origin[0];
    ray.origin.y = origin[1];
    ray.origin.z = origin[2];
    ray.dir.x = direction[0];
    ray.dir.y = direction[1];
    ray.dir.z = direction[2];
    const hit = state.world.castRay(ray, maxDistance, true);
    if (hit === null) {
        out.hit = false;
        out.fraction = 0;
        return;
    }
    out.hit = true;
    out.fraction = hit.timeOfImpact / maxDistance;
}
