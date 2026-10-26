import * as crashcatPublished from 'crashcat';
import { vec3 } from 'mathcat';
import type { HingeMotorDesc, PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';
import { Capability, JointType, MotionType, ShapeType } from '../api';
import type { PhysicsImpl } from './impl';

// one adapter over any build of crashcat with the published API: the npm package here, the dev source in crashcat-dev-impl.ts

type Crashcat = typeof crashcatPublished;

type CrashcatJointHandle =
    | { type: JointType.POINT; constraint: crashcatPublished.PointConstraint }
    | { type: JointType.HINGE; constraint: crashcatPublished.HingeConstraint }
    | { type: JointType.FIXED; constraint: crashcatPublished.FixedConstraint }
    | { type: JointType.DISTANCE; constraint: crashcatPublished.DistanceConstraint };

type ImplState = {
    world: crashcatPublished.World;
    objectLayerMoving: number;
    objectLayerNotMoving: number;
    onContactAdded?: (hA: crashcatPublished.RigidBody, hB: crashcatPublished.RigidBody) => void;
};

type RigidBody = crashcatPublished.RigidBody;

export type CrashcatImpl = PhysicsImpl<ImplState, RigidBody, CrashcatJointHandle, crashcatPublished.Shape> & {
    capabilities: ReadonlySet<Capability>;
};

export function createCrashcatImpl(crashcat: Crashcat): CrashcatImpl {
    const capabilities: ReadonlySet<Capability> = new Set([
        Capability.Raycast,
        Capability.ContactListener,
        Capability.HingeLimits,
        Capability.ConvexHull,
    ]);

    function motionTypeToImpl(motionType: MotionType): crashcatPublished.MotionType {
        switch (motionType) {
            case MotionType.STATIC:
                return crashcat.MotionType.STATIC;
            case MotionType.DYNAMIC:
                return crashcat.MotionType.DYNAMIC;
            case MotionType.KINEMATIC:
                return crashcat.MotionType.KINEMATIC;
        }
    }

    function init(): Promise<void> {
        crashcat.registerAll();
        return Promise.resolve();
    }

    function disposeWorld(_state: ImplState): void {
        // no-op
    }

    function createWorld(): ImplState {
        const worldSettings = crashcat.createWorldSettings();

        const broadphaseLayerMoving = crashcat.addBroadphaseLayer(worldSettings);
        const broadphaseLayerNotMoving = crashcat.addBroadphaseLayer(worldSettings);

        const objectLayerMoving = crashcat.addObjectLayer(worldSettings, broadphaseLayerMoving);
        const objectLayerNotMoving = crashcat.addObjectLayer(worldSettings, broadphaseLayerNotMoving);

        crashcat.enableCollision(worldSettings, objectLayerMoving, objectLayerMoving);
        crashcat.enableCollision(worldSettings, objectLayerMoving, objectLayerNotMoving);

        const world = crashcat.createWorld(worldSettings);

        return { world, objectLayerMoving, objectLayerNotMoving };
    }

    function setGravity(state: ImplState, x: number, y: number, z: number): void {
        state.world.settings.gravity = [x, y, z];
    }

    function stepSimulation(state: ImplState, deltaTime: number): void {
        let listener: crashcatPublished.Listener | undefined;
        if (state.onContactAdded) {
            const cb = state.onContactAdded;
            listener = {
                onContactAdded: (bodyA, bodyB) => {
                    cb(bodyA, bodyB);
                },
            };
        }
        crashcat.updateWorld(state.world, listener, deltaTime);
    }

    function onContactAdded(state: ImplState, onContact: (hA: RigidBody, hB: RigidBody) => void): void {
        state.onContactAdded = onContact;
    }

    function disposeContactListener(_state: ImplState): void {
        // no-op
    }

    function createShape(_state: ImplState, desc: PhysicsShape): crashcatPublished.Shape {
        switch (desc.type) {
            case ShapeType.BOX:
                return crashcat.box.create({
                    halfExtents: desc.halfExtents,
                    convexRadius: desc.convexRadius ?? 0.05,
                });
            case ShapeType.SPHERE:
                return crashcat.sphere.create({
                    radius: desc.radius,
                });
            case ShapeType.CONVEX_HULL:
                return crashcat.convexHull.create({
                    positions: desc.points,
                });
            case ShapeType.TRIANGLE_MESH:
                return crashcat.triangleMesh.create({
                    positions: Array.from(desc.positions),
                    indices: Array.from(desc.indices),
                });
        }
    }

    function destroyShape(_state: ImplState, _implHandle: crashcatPublished.Shape): void {
        // no-op
    }

    function createRigidBody(state: ImplState, options: RigidBodyOptions, implShape: crashcatPublished.Shape): RigidBody {
        return crashcat.rigidBody.create(state.world, {
            shape: implShape,
            motionType: motionTypeToImpl(options.motionType),
            objectLayer: state.objectLayerMoving,
            position: options.position,
            quaternion: options.quaternion ?? [0, 0, 0, 1],
            mass: options.mass,
            friction: options.friction ?? 0.5,
            restitution: options.restitution ?? 0,
        });
    }

    function removeRigidBody(state: ImplState, handle: RigidBody): void {
        crashcat.rigidBody.remove(state.world, handle);
    }

    function getBodyPosition(out: Vec3, _state: ImplState, handle: RigidBody): void {
        out[0] = handle.position[0];
        out[1] = handle.position[1];
        out[2] = handle.position[2];
    }

    function getBodyQuaternion(out: Quat, _state: ImplState, handle: RigidBody): void {
        out[0] = handle.quaternion[0];
        out[1] = handle.quaternion[1];
        out[2] = handle.quaternion[2];
        out[3] = handle.quaternion[3];
    }

    function setBodyPosition(state: ImplState, handle: RigidBody, position: Vec3): void {
        crashcat.rigidBody.setPosition(state.world, handle, position, true);
    }

    function setBodyQuaternion(state: ImplState, handle: RigidBody, quaternion: Quat): void {
        crashcat.rigidBody.setQuaternion(state.world, handle, quaternion, true);
    }

    function setBodyLinearVelocity(state: ImplState, handle: RigidBody, velocity: Vec3): void {
        crashcat.rigidBody.setLinearVelocity(state.world, handle, velocity);
    }

    function applyImpulse(state: ImplState, handle: RigidBody, impulse: Vec3): void {
        crashcat.rigidBody.addImpulse(state.world, handle, impulse);
    }

    function getBodyLinearVelocity(out: Vec3, _state: ImplState, handle: RigidBody): void {
        const vel = handle.motionProperties.linearVelocity;
        out[0] = vel[0];
        out[1] = vel[1];
        out[2] = vel[2];
    }

    function setBodyTranslationRotation(state: ImplState, handle: RigidBody, position: Vec3, quaternion: Quat): void {
        crashcat.rigidBody.setTransform(state.world, handle, position, quaternion, true);
    }

    const _raycastClosest_closestCollector = crashcat.createClosestCastRayCollector();
    const _raycastClosest_castRaySettings = crashcat.createDefaultCastRaySettings();

    function createPointJoint(state: ImplState, anchor: Vec3, bodyA: RigidBody, bodyB: RigidBody): CrashcatJointHandle {
        return {
            type: JointType.POINT,
            constraint: crashcat.pointConstraint.create(state.world, {
                bodyIdA: bodyA.id,
                bodyIdB: bodyB.id,
                pointA: anchor,
                pointB: anchor,
            }),
        };
    }

    function createHingeJoint(
        state: ImplState,
        anchor: Vec3,
        axis: Vec3,
        bodyA: RigidBody,
        bodyB: RigidBody,
    ): CrashcatJointHandle {
        const n: Vec3 = [0, 0, 0];
        vec3.perpendicular(n, axis);
        return {
            type: JointType.HINGE,
            constraint: crashcat.hingeConstraint.create(state.world, {
                bodyIdA: bodyA.id,
                bodyIdB: bodyB.id,
                pointA: anchor,
                pointB: anchor,
                hingeAxisA: axis,
                hingeAxisB: axis,
                normalAxisA: n,
                normalAxisB: n,
            }),
        };
    }

    function createFixedJoint(state: ImplState, bodyA: RigidBody, bodyB: RigidBody): CrashcatJointHandle {
        return {
            type: JointType.FIXED,
            constraint: crashcat.fixedConstraint.create(state.world, {
                bodyIdA: bodyA.id,
                bodyIdB: bodyB.id,
                // World-space points at body A's center — crashcat converts to local frames internally.
                point1: bodyA.position,
                point2: bodyA.position,
            }),
        };
    }

    function createDistanceJoint(
        state: ImplState,
        anchorA: Vec3,
        anchorB: Vec3,
        minDistance: number | undefined,
        maxDistance: number | undefined,
        bodyA: RigidBody,
        bodyB: RigidBody,
    ): CrashcatJointHandle {
        return {
            type: JointType.DISTANCE,
            constraint: crashcat.distanceConstraint.create(state.world, {
                bodyIdA: bodyA.id,
                bodyIdB: bodyB.id,
                pointA: anchorA,
                pointB: anchorB,
                minDistance: minDistance ?? -1,
                maxDistance: maxDistance ?? -1,
            }),
        };
    }

    function removeJoint(state: ImplState, handle: CrashcatJointHandle): void {
        switch (handle.type) {
            case JointType.POINT:
                crashcat.pointConstraint.remove(state.world, handle.constraint);
                break;
            case JointType.HINGE:
                crashcat.hingeConstraint.remove(state.world, handle.constraint);
                break;
            case JointType.FIXED:
                crashcat.fixedConstraint.remove(state.world, handle.constraint);
                break;
            case JointType.DISTANCE:
                crashcat.distanceConstraint.remove(state.world, handle.constraint);
                break;
        }
    }

    function setHingeMotor(_state: ImplState, handle: CrashcatJointHandle, desc: HingeMotorDesc): void {
        if (handle.type !== JointType.HINGE) return;
        const c = handle.constraint;
        if (desc.mode === 'off') {
            crashcat.hingeConstraint.setMotorState(c, crashcat.MotorState.OFF);
        } else {
            c.motorSettings.maxTorqueLimit = desc.maxTorque;
            c.motorSettings.minTorqueLimit = -desc.maxTorque;
            crashcat.hingeConstraint.setMotorState(c, crashcat.MotorState.VELOCITY);
            crashcat.hingeConstraint.setTargetAngularVelocity(c, desc.speed);
        }
    }

    function setHingeLimits(_state: ImplState, handle: CrashcatJointHandle, lower: number, upper: number): void {
        if (handle.type !== JointType.HINGE) return;
        crashcat.hingeConstraint.setLimits(handle.constraint, lower, upper);
    }

    function raycastClosest(out: RaycastResult, state: ImplState, origin: Vec3, direction: Vec3, maxDistance: number): void {
        _raycastClosest_closestCollector.reset();
        const filter = crashcat.filter.forWorld(state.world);
        crashcat.castRay(
            state.world,
            _raycastClosest_closestCollector,
            _raycastClosest_castRaySettings,
            origin,
            direction,
            maxDistance,
            filter,
        );
        if (_raycastClosest_closestCollector.hit.status !== crashcat.CastRayStatus.COLLIDING) {
            out.hit = false;
            out.fraction = 0;
            return;
        }
        out.hit = true;
        out.fraction = _raycastClosest_closestCollector.hit.fraction;
    }

    return {
        capabilities,
        init,
        createWorld,
        disposeWorld,
        setGravity,
        stepSimulation,
        createShape,
        destroyShape,
        createRigidBody,
        removeRigidBody,
        getBodyPosition,
        getBodyQuaternion,
        setBodyPosition,
        setBodyQuaternion,
        setBodyLinearVelocity,
        getBodyLinearVelocity,
        applyImpulse,
        setBodyTranslationRotation,
        onContactAdded,
        disposeContactListener,
        raycastClosest,
        createPointJoint,
        createHingeJoint,
        createFixedJoint,
        createDistanceJoint,
        removeJoint,
        setHingeMotor,
        setHingeLimits,
    };
}

export const {
    capabilities,
    init,
    createWorld,
    disposeWorld,
    setGravity,
    stepSimulation,
    createShape,
    destroyShape,
    createRigidBody,
    removeRigidBody,
    getBodyPosition,
    getBodyQuaternion,
    setBodyPosition,
    setBodyQuaternion,
    setBodyLinearVelocity,
    getBodyLinearVelocity,
    applyImpulse,
    setBodyTranslationRotation,
    onContactAdded,
    disposeContactListener,
    raycastClosest,
    createPointJoint,
    createHingeJoint,
    createFixedJoint,
    createDistanceJoint,
    removeJoint,
    setHingeMotor,
    setHingeLimits,
} = createCrashcatImpl(crashcatPublished);
