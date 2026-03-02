import joltWasmUrl from 'jolt-physics/jolt-physics.wasm.wasm?url';
import Jolt from 'jolt-physics/wasm';
import type { PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';
import { MotionType, ShapeType } from '../api';

type JoltType = Awaited<ReturnType<typeof Jolt>>;

const LAYER_NON_MOVING = 0;
const LAYER_MOVING = 1;
const NUM_OBJECT_LAYERS = 2;
const NUM_BP_LAYERS = 2;

export type ImplState = {
    jolt: Jolt.JoltInterface;
    physicsSystem: Jolt.PhysicsSystem;
    bodyInterface: Jolt.BodyInterface;
    localBodies: Map<number, Jolt.Body>;
    contactListener?: Jolt.ContactListenerJS;
    onContactAdded?: (hA: Jolt.Body, hB: Jolt.Body) => void;
};

let jolt: JoltType | null = null;
let initialized = false;

let _vec3: Jolt.Vec3;
let _rvec3: Jolt.RVec3;
let _quat: Jolt.Quat;

function motionTypeToJolt(Jolt: JoltType, motionType: MotionType): number {
    switch (motionType) {
        case MotionType.STATIC:
            return Jolt.EMotionType_Static;
        case MotionType.DYNAMIC:
            return Jolt.EMotionType_Dynamic;
        case MotionType.KINEMATIC:
            return Jolt.EMotionType_Kinematic;
    }
}

function objectLayerForMotionType(motionType: MotionType): number {
    return motionType === MotionType.STATIC ? LAYER_NON_MOVING : LAYER_MOVING;
}

let _raycastCollector: Jolt.CastRayClosestHitCollisionCollector | null = null;
let _rayCastSettings: Jolt.RayCastSettings | null = null;
let _broadPhaseLayerFilter: Jolt.BroadPhaseLayerFilter | null = null;
let _objectLayerFilter: Jolt.ObjectLayerFilter | null = null;
let _bodyFilter: Jolt.BodyFilter | null = null;
let _shapeFilter: Jolt.ShapeFilter | null = null;
let _ray: Jolt.RRayCast | null = null;
let _rayOrigin: Jolt.RVec3 | null = null;
let _rayDirection: Jolt.Vec3 | null = null;

export async function init(): Promise<void> {
    if (initialized) return;
    jolt = await Jolt({ locateFile: () => joltWasmUrl });
    _vec3 = new jolt.Vec3(0, 0, 0);
    _rvec3 = new jolt.RVec3(0, 0, 0);
    _quat = new jolt.Quat(0, 0, 0, 1);
    _raycastCollector = new jolt.CastRayClosestHitCollisionCollector();
    _rayCastSettings = new jolt.RayCastSettings();
    _broadPhaseLayerFilter = new jolt.BroadPhaseLayerFilter();
    _objectLayerFilter = new jolt.ObjectLayerFilter();
    _bodyFilter = new jolt.BodyFilter();
    _shapeFilter = new jolt.ShapeFilter();
    _rayOrigin = new jolt.RVec3(0, 0, 0);
    _rayDirection = new jolt.Vec3(0, 0, 0);
    _ray = new jolt.RRayCast();
    _ray.mOrigin = _rayOrigin;
    _ray.mDirection = _rayDirection;
    initialized = true;
}

export function disposeWorld(state: ImplState): void {
    jolt!.destroy(state.jolt);
}

export function createWorld(): ImplState {
    const J = jolt!;

    const objectFilter = new J.ObjectLayerPairFilterTable(NUM_OBJECT_LAYERS);
    objectFilter.EnableCollision(LAYER_NON_MOVING, LAYER_MOVING);
    objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);

    const bpNonMoving = new J.BroadPhaseLayer(0);
    const bpMoving = new J.BroadPhaseLayer(1);
    const bpInterface = new J.BroadPhaseLayerInterfaceTable(NUM_OBJECT_LAYERS, NUM_BP_LAYERS);
    bpInterface.MapObjectToBroadPhaseLayer(LAYER_NON_MOVING, bpNonMoving);
    bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, bpMoving);

    const settings = new J.JoltSettings();
    settings.mObjectLayerPairFilter = objectFilter;
    settings.mBroadPhaseLayerInterface = bpInterface;
    settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(
        settings.mBroadPhaseLayerInterface,
        NUM_BP_LAYERS,
        settings.mObjectLayerPairFilter,
        NUM_OBJECT_LAYERS,
    );

    const joltInstance = new J.JoltInterface(settings);
    J.destroy(settings);

    const physicsSystem = joltInstance.GetPhysicsSystem();
    const bodyInterface = physicsSystem.GetBodyInterface();

    return {
        jolt: joltInstance,
        physicsSystem,
        bodyInterface,
        localBodies: new Map(),
    };
}

export function setGravity(state: ImplState, x: number, y: number, z: number): void {
    _vec3.Set(x, y, z);
    state.physicsSystem.SetGravity(_vec3);
}

export function stepSimulation(state: ImplState, dt: number): void {
    // Use 2 collision steps when running below 55 Hz (matches the official example)
    const collisionSteps = dt > 1 / 55 ? 2 : 1;
    state.jolt.Step(dt, collisionSteps);
}

export function createShape(_state: ImplState, desc: PhysicsShape): Jolt.Shape {
    const J = jolt!;
    switch (desc.type) {
        case ShapeType.BOX: {
            _vec3.Set(desc.halfExtents[0], desc.halfExtents[1], desc.halfExtents[2]);
            const settings = new J.BoxShapeSettings(_vec3, 0.05);
            const result = settings.Create();
            const shape = result.Get();
            shape.AddRef(); // take ownership before releasing the result and settings
            result.Clear(); // release the ShapeResult's reference
            J.destroy(settings); // release the settings' reference
            return shape;
        }
        case ShapeType.SPHERE: {
            const settings = new J.SphereShapeSettings(desc.radius);
            const result = settings.Create();
            const shape = result.Get();
            shape.AddRef();
            result.Clear();
            J.destroy(settings);
            return shape;
        }
        case ShapeType.CONVEX_HULL: {
            const settings = new J.ConvexHullShapeSettings();
            const pts = settings.mPoints;
            for (let i = 0; i < desc.points.length; i += 3) {
                _vec3.Set(desc.points[i]!, desc.points[i + 1]!, desc.points[i + 2]!);
                pts.push_back(_vec3);
            }
            const result = settings.Create();
            if (!result.IsValid()) {
                J.destroy(settings);
                throw new Error('jolt: ConvexHullShapeSettings.Create() failed — degenerate point set');
            }
            const shape = result.Get();
            shape.AddRef();
            result.Clear();
            J.destroy(settings);
            return shape;
        }
        case ShapeType.TRIANGLE_MESH: {
            const verts = new J.VertexList();
            const tris = new J.IndexedTriangleList();
            const f3 = new J.Float3(0, 0, 0);
            for (let i = 0; i < desc.positions.length; i += 3) {
                f3.x = desc.positions[i]!;
                f3.y = desc.positions[i + 1]!;
                f3.z = desc.positions[i + 2]!;
                verts.push_back(f3);
            }
            J.destroy(f3);
            for (let i = 0; i < desc.indices.length; i += 3) {
                const tri = new J.IndexedTriangle(desc.indices[i]!, desc.indices[i + 1]!, desc.indices[i + 2]!, 0);
                tris.push_back(tri);
                J.destroy(tri);
            }
            const matList = new J.PhysicsMaterialList();
            const settings = new J.MeshShapeSettings(verts, tris, matList);
            J.destroy(verts);
            J.destroy(tris);
            J.destroy(matList);
            const result = settings.Create();
            J.destroy(settings);
            if (!result.IsValid()) throw new Error('jolt: MeshShapeSettings.Create() failed');
            const shape = result.Get();
            shape.AddRef();
            result.Clear();
            return shape;
        }
    }
}

export function destroyShape(_state: ImplState, implHandle: Jolt.Shape): void {
    implHandle.Release();
}

export function createRigidBody(state: ImplState, options: RigidBodyOptions, implShape: Jolt.Shape): Jolt.Body {
    const J = jolt!;

    const layer = objectLayerForMotionType(options.motionType);

    _rvec3.Set(options.position[0], options.position[1], options.position[2]);
    const q = options.quaternion ?? ([0, 0, 0, 1] as Quat);
    _quat.Set(q[0], q[1], q[2], q[3]);

    // BodyCreationSettings takes a reference to the shape — we keep our own AddRef()'d
    // reference from createShape() so the shape stays alive independently of bodies.
    const creationSettings = new J.BodyCreationSettings(implShape, _rvec3, _quat, motionTypeToJolt(J, options.motionType), layer);

    creationSettings.mFriction = options.friction ?? 0.5;
    creationSettings.mRestitution = options.restitution ?? 0;

    if (options.mass !== undefined && options.motionType === MotionType.DYNAMIC) {
        creationSettings.mOverrideMassProperties = J.EOverrideMassProperties_MassAndInertiaProvided;
        const massProps = creationSettings.mMassPropertiesOverride;
        massProps.mMass = options.mass;
    }

    const body = state.bodyInterface.CreateBody(creationSettings);
    J.destroy(creationSettings);

    state.bodyInterface.AddBody(body.GetID(), J.EActivation_Activate);

    state.localBodies.set(body.GetID().GetIndexAndSequenceNumber(), body);

    return body;
}

export function removeRigidBody(state: ImplState, handle: Jolt.Body): void {
    const id = handle.GetID();
    state.bodyInterface.RemoveBody(id);
    state.bodyInterface.DestroyBody(id);
    state.localBodies.delete(id.GetIndexAndSequenceNumber());
}

export function getBodyPosition(out: Vec3, _state: ImplState, handle: Jolt.Body): void {
    const pos = handle.GetPosition();
    out[0] = pos.GetX();
    out[1] = pos.GetY();
    out[2] = pos.GetZ();
}

export function getBodyQuaternion(out: Quat, _state: ImplState, handle: Jolt.Body): void {
    const rot = handle.GetRotation();
    out[0] = rot.GetX();
    out[1] = rot.GetY();
    out[2] = rot.GetZ();
    out[3] = rot.GetW();
}

export function setBodyPosition(state: ImplState, handle: Jolt.Body, position: Vec3): void {
    _rvec3.Set(position[0], position[1], position[2]);
    state.bodyInterface.SetPosition(handle.GetID(), _rvec3, jolt!.EActivation_Activate);
}

export function setBodyQuaternion(state: ImplState, handle: Jolt.Body, quaternion: Quat): void {
    _quat.Set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    state.bodyInterface.SetRotation(handle.GetID(), _quat, jolt!.EActivation_Activate);
}

export function setBodyLinearVelocity(state: ImplState, handle: Jolt.Body, velocity: Vec3): void {
    _vec3.Set(velocity[0], velocity[1], velocity[2]);
    state.bodyInterface.SetLinearVelocity(handle.GetID(), _vec3);
}

export function getBodyLinearVelocity(out: Vec3, _state: ImplState, handle: Jolt.Body): void {
    const vel = handle.GetLinearVelocity();
    out[0] = vel.GetX();
    out[1] = vel.GetY();
    out[2] = vel.GetZ();
}

export function setBodyTranslationRotation(state: ImplState, handle: Jolt.Body, position: Vec3, quaternion: Quat): void {
    _rvec3.Set(position[0], position[1], position[2]);
    _quat.Set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    state.bodyInterface.SetPositionAndRotation(handle.GetID(), _rvec3, _quat, jolt!.EActivation_Activate);
}

export function onContactAdded(state: ImplState, onContact: (hA: Jolt.Body, hB: Jolt.Body) => void): void {
    const J = jolt!;
    state.onContactAdded = onContact;

    const listener = new J.ContactListenerJS();

    listener.OnContactValidate = (
        _body1Ptr: number,
        _body2Ptr: number,
        _baseOffsetPtr: number,
        _collisionResultPtr: number,
    ): number => {
        return J.ValidateResult_AcceptAllContactsForThisBodyPair;
    };

    listener.OnContactAdded = (body1Ptr: number, body2Ptr: number, _manifoldPtr: number, _settingsPtr: number): void => {
        if (!state.onContactAdded) return;
        const body1 = J.wrapPointer(body1Ptr, J.Body);
        const body2 = J.wrapPointer(body2Ptr, J.Body);
        const hA = state.localBodies.get(body1.GetID().GetIndexAndSequenceNumber());
        const hB = state.localBodies.get(body2.GetID().GetIndexAndSequenceNumber());
        if (hA && hB) state.onContactAdded(hA, hB);
    };

    listener.OnContactPersisted = (_body1Ptr: number, _body2Ptr: number, _manifoldPtr: number, _settingsPtr: number): void => {
        // not used
    };

    listener.OnContactRemoved = (_subShapePairPtr: number): void => {
        // not used
    };

    state.contactListener = listener;
    state.physicsSystem.SetContactListener(listener);
}

export function disposeContactListener(state: ImplState): void {
    if (state.contactListener) {
        jolt!.destroy(state.contactListener);
        state.contactListener = undefined;
    }
}

export function raycastClosest(out: RaycastResult, state: ImplState, origin: Vec3, direction: Vec3, maxDistance: number): void {
    _rayOrigin!.Set(origin[0], origin[1], origin[2]);
    _rayDirection!.Set(direction[0] * maxDistance, direction[1] * maxDistance, direction[2] * maxDistance);
    _ray!.mOrigin = _rayOrigin!;
    _ray!.mDirection = _rayDirection!;
    _raycastCollector!.Reset();
    state.physicsSystem
        .GetNarrowPhaseQuery()
        .CastRay(
            _ray!,
            _rayCastSettings!,
            _raycastCollector!,
            _broadPhaseLayerFilter!,
            _objectLayerFilter!,
            _bodyFilter!,
            _shapeFilter!,
        );
    if (!_raycastCollector!.HadHit()) {
        out.hit = false;
        out.fraction = 0;
        return;
    }
    out.hit = true;
    out.fraction = _raycastCollector!.mHit.mFraction;
}
