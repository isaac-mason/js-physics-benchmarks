import Box3D from 'box3d.js/inline';
import type { Box3DModule, ContactTouchEvent, EventsBuffer, b3BodyId, b3WorldId } from 'box3d.js';
import type { HingeMotorDesc, PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';
import { Capability, MotionType, ShapeType } from '../api';
import { quat } from 'mathcat';
import { quatFromZToAxis, rotateByConjugate, worldToLocal } from './impl-helpers';

export const capabilities: ReadonlySet<Capability> = new Set([Capability.Raycast, Capability.ContactListener, Capability.HingeLimits, Capability.ConvexHull]);

const Q_IDENTITY: Quat = [0, 0, 0, 1];

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
    b3.b3World_SetGravity(state.world, [x, y, z]);
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

    def.position = [options.position[0], options.position[1], options.position[2]];

    if (options.quaternion) {
        const [qx, qy, qz, qw] = options.quaternion;
        def.rotation = [qx, qy, qz, qw];
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
            b3.b3CreateSphereShape(body, shapeDef, { center: [0, 0, 0], radius: implShape.radius });
            break;
        }
        case ShapeType.CONVEX_HULL: {
            const pts = implShape.points;
            const hull = b3.b3CreateHull(pts);
            if (hull) {
                b3.b3CreateHullShape(body, shapeDef, hull);
                // hull data is copied into the shape on creation — free the handle now
                b3.b3DestroyHull(hull);
            }
            break;
        }
        case ShapeType.TRIANGLE_MESH: {
            const mesh = b3.b3CreateMesh(implShape.positions, implShape.indices);
            // mesh data is NOT copied — the world holds a raw pointer, so keep it alive
            if (mesh) b3.b3CreateMeshShape(body, shapeDef, mesh, [1, 1, 1]);
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
    b3.b3Body_GetPosition(out, handle);
}

export function getBodyQuaternion(out: Quat, _state: ImplState, handle: b3BodyId): void {
    b3.b3Body_GetRotation(out, handle);
}

export function setBodyPosition(state: ImplState, handle: b3BodyId, position: Vec3): void {
    const rot: Quat = [0, 0, 0, 1];
    b3.b3Body_GetRotation(rot, handle);
    b3.b3Body_SetTransform(handle, position, rot);
    b3.b3Body_SetAwake(handle, true);
    void state;
}

export function setBodyQuaternion(state: ImplState, handle: b3BodyId, quaternion: Quat): void {
    const pos: Vec3 = [0, 0, 0];
    b3.b3Body_GetPosition(pos, handle);
    b3.b3Body_SetTransform(handle, pos, quaternion);
    b3.b3Body_SetAwake(handle, true);
    void state;
}

export function setBodyLinearVelocity(state: ImplState, handle: b3BodyId, velocity: Vec3): void {
    b3.b3Body_SetLinearVelocity(handle, velocity);
    b3.b3Body_SetAwake(handle, true);
    void state;
}

export function applyImpulse(_state: ImplState, handle: b3BodyId, impulse: Vec3): void {
    b3.b3Body_ApplyLinearImpulseToCenter(handle, impulse, true);
}

export function getBodyLinearVelocity(out: Vec3, _state: ImplState, handle: b3BodyId): void {
    b3.b3Body_GetLinearVelocity(out, handle);
}

export function setBodyTranslationRotation(state: ImplState, handle: b3BodyId, position: Vec3, quaternion: Quat): void {
    b3.b3Body_SetTransform(handle, position, quaternion);
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
    const posA: Vec3 = [0, 0, 0], quatA: Quat = [0, 0, 0, 1];
    const posB: Vec3 = [0, 0, 0], quatB: Quat = [0, 0, 0, 1];
    b3.b3Body_GetPosition(posA, bodyA); b3.b3Body_GetRotation(quatA, bodyA);
    b3.b3Body_GetPosition(posB, bodyB); b3.b3Body_GetRotation(quatB, bodyB);
    return { posA, quatA, posB, quatB };
}

export function createPointJoint(state: ImplState, anchor: Vec3, bodyA: b3BodyId, bodyB: b3BodyId): any {
    const b3 = state.b3;
    const { posA, quatA, posB, quatB } = box3dTransforms(state, bodyA, bodyB);
    const lA: Vec3 = [0, 0, 0]; worldToLocal(lA, anchor, posA, quatA);
    const lB: Vec3 = [0, 0, 0]; worldToLocal(lB, anchor, posB, quatB);
    const def = b3.b3DefaultSphericalJointDef();
    def.base.bodyIdA = bodyA; def.base.bodyIdB = bodyB; def.base.collideConnected = false;
    def.base.localFrameA = { position: lA, quaternion: Q_IDENTITY };
    def.base.localFrameB = { position: lB, quaternion: Q_IDENTITY };
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
    def.base.localFrameA = { position: lA, quaternion: fqA };
    def.base.localFrameB = { position: lB, quaternion: fqB };
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
    def.base.localFrameA = { position: [0, 0, 0], quaternion: Q_IDENTITY };
    def.base.localFrameB = { position: lB, quaternion: relQ };
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
    def.base.localFrameA = { position: lA, quaternion: Q_IDENTITY };
    def.base.localFrameB = { position: lB, quaternion: Q_IDENTITY };
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
    const scaledDir: Vec3 = [
        direction[0] * maxDistance,
        direction[1] * maxDistance,
        direction[2] * maxDistance,
    ];
    const result = b3.b3World_CastRayClosest(state.world, origin, scaledDir, getFilter(b3));
    out.hit = result.hit;
    out.fraction = result.fraction;
}
