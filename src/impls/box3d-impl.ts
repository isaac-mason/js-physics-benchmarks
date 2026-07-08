import Box3D from 'box3d.js/inline';
import type { Box3DModule, ContactTouchEvent, EventsBuffer, b3BodyId, b3WorldId } from 'box3d.js';
import type { HingeMotorDesc, PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';
import { Capability, MotionType, ShapeType } from '../api';
import { quat } from 'mathcat';
import { quatFromZToAxis, rotateByConjugate, worldToLocal } from './impl-helpers';

export const capabilities: ReadonlySet<Capability> = new Set([Capability.Raycast, Capability.ContactListener, Capability.HingeLimits, Capability.ConvexHull]);

type B3Quat = { v: { x: number; y: number; z: number }; s: number };

const B3Q_IDENTITY: B3Quat = { v: { x: 0, y: 0, z: 0 }, s: 1 };

function toB3Quat(q: Quat): B3Quat {
    return { v: { x: q[0], y: q[1], z: q[2] }, s: q[3] };
}

type ImplState = {
    b3: Box3DModule;
    world: b3WorldId;
    contactCallback: ((hA: b3BodyId, hB: b3BodyId) => void) | null;
    // b3BodyId is a value struct, not a handle — b3Shape_GetBody returns a fresh
    // object each call, so we intern the original handle by its field-tuple key
    // and hand THAT back to the callback so upstream reference-equality lookups work.
    bodyByKey: Map<string, b3BodyId>;
    events: EventsBuffer;
    contactEvent: ContactTouchEvent;
};

function bodyKey(id: b3BodyId): string {
    return `${id.index1}:${id.world0}:${id.generation}`;
}

function shapeVolume(shape: PhysicsShape): number {
    switch (shape.type) {
        case ShapeType.BOX: {
            const [hx, hy, hz] = shape.halfExtents;
            return 8 * hx * hy * hz;
        }
        case ShapeType.SPHERE:
            return (4 / 3) * Math.PI * shape.radius ** 3;
        case ShapeType.CONVEX_HULL:
        case ShapeType.TRIANGLE_MESH:
            // Volume not readily available for arbitrary meshes; leave density at default.
            return 1;
    }
}

let b3: Box3DModule;

export async function init(): Promise<void> {
    b3 = await Box3D();
}

export function createWorld(): ImplState {
    const worldDef = b3.b3DefaultWorldDef();
    const world = b3.b3CreateWorld(worldDef);
    return {
        b3,
        world,
        contactCallback: null,
        bodyByKey: new Map(),
        events: b3.createEventsBuffer(),
        contactEvent: b3.createContactTouchEvent(),
    };
}

export function disposeWorld(state: ImplState): void {
    b3.destroyEventsBuffer(state.events);
    b3.b3DestroyWorld(state.world);
}

export function setGravity(state: ImplState, x: number, y: number, z: number): void {
    b3.b3World_SetGravity(state.world, { x, y, z });
}

export function stepSimulation(state: ImplState, dt: number): void {
    b3.b3World_Step(state.world, dt, 4);

    if (state.contactCallback) {
        b3.getEvents(state.events, state.world);
        const n = b3.getNumContactBeginEvents(state.events);
        for (let i = 0; i < n; i++) {
            b3.getContactBeginEventAt(state.contactEvent, state.events, i);
            const bodyA = state.bodyByKey.get(bodyKey(b3.b3Shape_GetBody(state.contactEvent.shapeIdA)));
            const bodyB = state.bodyByKey.get(bodyKey(b3.b3Shape_GetBody(state.contactEvent.shapeIdB)));
            if (bodyA && bodyB) state.contactCallback(bodyA, bodyB);
        }
    }
}

export function createShape(state: ImplState, desc: PhysicsShape): any {
    // Shapes are created attached to a body in box3d, so we stash the desc and
    // create the actual shape in createRigidBody. Return the desc as the handle.
    void state;
    return desc;
}

export function destroyShape(_state: ImplState, _implHandle: any): void {
    // shapes are owned by bodies in box3d; destroyed with the body
}

export function createRigidBody(state: ImplState, options: RigidBodyOptions, implShape: PhysicsShape): b3BodyId {
    const def = b3.b3DefaultBodyDef();

    switch (options.motionType) {
        case MotionType.STATIC:
            def.type = b3.b3BodyType.b3_staticBody;
            break;
        case MotionType.DYNAMIC:
            def.type = b3.b3BodyType.b3_dynamicBody;
            break;
        case MotionType.KINEMATIC:
            def.type = b3.b3BodyType.b3_kinematicBody;
            break;
    }

    def.position = { x: options.position[0], y: options.position[1], z: options.position[2] };

    if (options.quaternion) {
        const [qx, qy, qz, qw] = options.quaternion;
        def.rotation = { v: { x: qx, y: qy, z: qz }, s: qw };
    }

    const body = b3.b3CreateBody(state.world, def);
    state.bodyByKey.set(bodyKey(body), body);
    const shapeDef = b3.b3DefaultShapeDef();
    shapeDef.baseMaterial.friction = options.friction ?? 0.5;
    shapeDef.baseMaterial.restitution = options.restitution ?? 0;
    shapeDef.enableContactEvents = true;
    if (options.motionType === MotionType.DYNAMIC && options.mass !== undefined) {
        // shapeDef.density scales mass linearly — target = current * (mass / currentMass).
        // Since default density is 1, we set density so that computed mass hits target.
        shapeDef.density = options.mass / shapeVolume(implShape);
    }

    switch (implShape.type) {
        case ShapeType.BOX: {
            const [hx, hy, hz] = implShape.halfExtents;
            b3.b3CreateBoxShape(body, shapeDef, hx, hy, hz);
            break;
        }
        case ShapeType.SPHERE: {
            b3.b3CreateSphereShape(body, shapeDef, { center: { x: 0, y: 0, z: 0 }, radius: implShape.radius });
            break;
        }
        case ShapeType.CONVEX_HULL: {
            const pts = implShape.points;
            const hull = b3.b3CreateHull(pts);
            if (hull) b3.b3CreateHullShape(body, shapeDef, hull);
            break;
        }
        case ShapeType.TRIANGLE_MESH: {
            const mesh = b3.b3CreateMesh(implShape.positions, implShape.indices);
            if (mesh) b3.b3CreateMeshShape(body, shapeDef, mesh, { x: 1, y: 1, z: 1 });
            break;
        }
    }

    return body;
}

export function removeRigidBody(state: ImplState, handle: b3BodyId): void {
    state.bodyByKey.delete(bodyKey(handle));
    b3.b3DestroyBody(handle);
}

export function getBodyPosition(out: Vec3, _state: ImplState, handle: b3BodyId): void {
    const p = b3.b3Body_GetPosition(handle);
    out[0] = p.x;
    out[1] = p.y;
    out[2] = p.z;
}

export function getBodyQuaternion(out: Quat, _state: ImplState, handle: b3BodyId): void {
    const q = b3.b3Body_GetRotation(handle);
    out[0] = q.v.x;
    out[1] = q.v.y;
    out[2] = q.v.z;
    out[3] = q.s;
}

export function setBodyPosition(state: ImplState, handle: b3BodyId, position: Vec3): void {
    const rot = b3.b3Body_GetRotation(handle);
    b3.b3Body_SetTransform(handle, { x: position[0], y: position[1], z: position[2] }, rot);
    b3.b3Body_SetAwake(handle, true);
    void state;
}

export function setBodyQuaternion(state: ImplState, handle: b3BodyId, quaternion: Quat): void {
    const pos = b3.b3Body_GetPosition(handle);
    const [qx, qy, qz, qw] = quaternion;
    b3.b3Body_SetTransform(handle, pos, { v: { x: qx, y: qy, z: qz }, s: qw });
    b3.b3Body_SetAwake(handle, true);
    void state;
}

export function setBodyLinearVelocity(state: ImplState, handle: b3BodyId, velocity: Vec3): void {
    b3.b3Body_SetLinearVelocity(handle, { x: velocity[0], y: velocity[1], z: velocity[2] });
    b3.b3Body_SetAwake(handle, true);
    void state;
}

export function applyImpulse(_state: ImplState, handle: b3BodyId, impulse: Vec3): void {
    b3.b3Body_ApplyLinearImpulseToCenter(handle, { x: impulse[0], y: impulse[1], z: impulse[2] }, true);
}

export function getBodyLinearVelocity(out: Vec3, _state: ImplState, handle: b3BodyId): void {
    const v = b3.b3Body_GetLinearVelocity(handle);
    out[0] = v.x;
    out[1] = v.y;
    out[2] = v.z;
}

export function setBodyTranslationRotation(state: ImplState, handle: b3BodyId, position: Vec3, quaternion: Quat): void {
    const [qx, qy, qz, qw] = quaternion;
    b3.b3Body_SetTransform(
        handle,
        { x: position[0], y: position[1], z: position[2] },
        { v: { x: qx, y: qy, z: qz }, s: qw },
    );
    b3.b3Body_SetAwake(handle, true);
    void state;
}

export function onContactAdded(state: ImplState, onContact: (hA: b3BodyId, hB: b3BodyId) => void): void {
    state.contactCallback = onContact;
}

export function disposeContactListener(state: ImplState): void {
    state.contactCallback = null;
}

// lazily initialised after Box3D loads so b3.b3DefaultQueryFilter() is available
let _filter: ReturnType<Box3DModule['b3DefaultQueryFilter']> | null = null;
function getFilter(b3: Box3DModule) {
    if (!_filter) _filter = b3.b3DefaultQueryFilter();
    return _filter;
}

function box3dTransforms(state: ImplState, bodyA: b3BodyId, bodyB: b3BodyId) {
    const b3 = state.b3;
    const pA = b3.b3Body_GetPosition(bodyA), rA = b3.b3Body_GetRotation(bodyA);
    const pB = b3.b3Body_GetPosition(bodyB), rB = b3.b3Body_GetRotation(bodyB);
    return {
        posA: [pA.x, pA.y, pA.z] as Vec3, quatA: [rA.v.x, rA.v.y, rA.v.z, rA.s] as Quat,
        posB: [pB.x, pB.y, pB.z] as Vec3, quatB: [rB.v.x, rB.v.y, rB.v.z, rB.s] as Quat,
    };
}

export function createPointJoint(state: ImplState, anchor: Vec3, bodyA: b3BodyId, bodyB: b3BodyId): any {
    const b3 = state.b3;
    const { posA, quatA, posB, quatB } = box3dTransforms(state, bodyA, bodyB);
    const lA: Vec3 = [0, 0, 0]; worldToLocal(lA, anchor, posA, quatA);
    const lB: Vec3 = [0, 0, 0]; worldToLocal(lB, anchor, posB, quatB);
    const def = b3.b3DefaultSphericalJointDef();
    def.base.bodyIdA = bodyA; def.base.bodyIdB = bodyB; def.base.collideConnected = false;
    def.base.localFrameA = { p: { x: lA[0], y: lA[1], z: lA[2] }, q: B3Q_IDENTITY };
    def.base.localFrameB = { p: { x: lB[0], y: lB[1], z: lB[2] }, q: B3Q_IDENTITY };
    return b3.b3CreateSphericalJoint(state.world, def);
}

export function createHingeJoint(state: ImplState, anchor: Vec3, axis: Vec3, bodyA: b3BodyId, bodyB: b3BodyId): any {
    const b3 = state.b3;
    const { posA, quatA, posB, quatB } = box3dTransforms(state, bodyA, bodyB);
    const lA: Vec3 = [0, 0, 0]; worldToLocal(lA, anchor, posA, quatA);
    const lB: Vec3 = [0, 0, 0]; worldToLocal(lB, anchor, posB, quatB);
    const axA: Vec3 = [0, 0, 0]; rotateByConjugate(axA, axis, quatA);
    const axB: Vec3 = [0, 0, 0]; rotateByConjugate(axB, axis, quatB);
    const fqA: Quat = [0, 0, 0, 1]; quatFromZToAxis(fqA, axA[0], axA[1], axA[2]);
    const fqB: Quat = [0, 0, 0, 1]; quatFromZToAxis(fqB, axB[0], axB[1], axB[2]);
    const def = b3.b3DefaultRevoluteJointDef();
    def.base.bodyIdA = bodyA; def.base.bodyIdB = bodyB; def.base.collideConnected = false;
    def.base.localFrameA = { p: { x: lA[0], y: lA[1], z: lA[2] }, q: toB3Quat(fqA) };
    def.base.localFrameB = { p: { x: lB[0], y: lB[1], z: lB[2] }, q: toB3Quat(fqB) };
    return b3.b3CreateRevoluteJoint(state.world, def);
}

export function createFixedJoint(state: ImplState, bodyA: b3BodyId, bodyB: b3BodyId): any {
    const b3 = state.b3;
    const { posA, quatA, posB, quatB } = box3dTransforms(state, bodyA, bodyB);
    // frame2 = conjB * quatA so that quatB * frame2 = quatA (frames coincide in world)
    const lB: Vec3 = [0, 0, 0]; worldToLocal(lB, posA, posB, quatB);
    const conjB: Quat = [-quatB[0], -quatB[1], -quatB[2], quatB[3]];
    const relQ: Quat = [0, 0, 0, 1]; quat.multiply(relQ, conjB, quatA);
    const def = b3.b3DefaultWeldJointDef();
    def.base.bodyIdA = bodyA; def.base.bodyIdB = bodyB; def.base.collideConnected = false;
    def.base.localFrameA = { p: { x: 0, y: 0, z: 0 }, q: B3Q_IDENTITY };
    def.base.localFrameB = { p: { x: lB[0], y: lB[1], z: lB[2] }, q: toB3Quat(relQ) };
    def.linearHertz = 0; def.angularHertz = 0; // hertz=0 → rigid
    return b3.b3CreateWeldJoint(state.world, def);
}

export function createDistanceJoint(state: ImplState, anchorA: Vec3, anchorB: Vec3, minDistance: number | undefined, maxDistance: number | undefined, bodyA: b3BodyId, bodyB: b3BodyId): any {
    const b3 = state.b3;
    const { posA, quatA, posB, quatB } = box3dTransforms(state, bodyA, bodyB);
    const lA: Vec3 = [0, 0, 0]; worldToLocal(lA, anchorA, posA, quatA);
    const lB: Vec3 = [0, 0, 0]; worldToLocal(lB, anchorB, posB, quatB);
    const dx = anchorA[0] - anchorB[0], dy = anchorA[1] - anchorB[1], dz = anchorA[2] - anchorB[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const def = b3.b3DefaultDistanceJointDef();
    def.base.bodyIdA = bodyA; def.base.bodyIdB = bodyB; def.base.collideConnected = false;
    def.base.localFrameA = { p: { x: lA[0], y: lA[1], z: lA[2] }, q: B3Q_IDENTITY };
    def.base.localFrameB = { p: { x: lB[0], y: lB[1], z: lB[2] }, q: B3Q_IDENTITY };
    def.minLength = minDistance ?? 0; def.maxLength = maxDistance ?? d; def.enableLimit = true;
    return b3.b3CreateDistanceJoint(state.world, def);
}

export function removeJoint(state: ImplState, handle: any): void {
    state.b3.b3DestroyJoint(handle, true);
}

export function setHingeMotor(state: ImplState, handle: any, desc: HingeMotorDesc): void {
    const b3 = state.b3;
    if (desc.mode === 'off') {
        b3.b3RevoluteJoint_EnableMotor(handle, false);
    } else {
        b3.b3RevoluteJoint_EnableMotor(handle, true);
        b3.b3RevoluteJoint_SetMotorSpeed(handle, desc.speed);
        b3.b3RevoluteJoint_SetMaxMotorTorque(handle, desc.maxTorque);
    }
}

export function setHingeLimits(state: ImplState, handle: any, lower: number, upper: number): void {
    const b3 = state.b3;
    b3.b3RevoluteJoint_EnableLimit(handle, true);
    b3.b3RevoluteJoint_SetLimits(handle, lower, upper);
}

export function raycastClosest(out: RaycastResult, state: ImplState, origin: Vec3, direction: Vec3, maxDistance: number): void {
    const scaledDir = {
        x: direction[0] * maxDistance,
        y: direction[1] * maxDistance,
        z: direction[2] * maxDistance,
    };
    const result = b3.b3World_CastRayClosest(
        state.world,
        { x: origin[0], y: origin[1], z: origin[2] },
        scaledDir,
        getFilter(b3),
    );
    out.hit = result.hit;
    out.fraction = result.fraction;
}
