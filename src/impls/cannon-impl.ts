import * as CANNON from 'cannon-es';
import { quickhull3 } from 'mathcat';
import type { PhysicsShape, Quat, RaycastResult, RigidBodyOptions, Vec3 } from '../api';
import { MotionType, ShapeType } from '../api';

type ImplState = {
    world: CANNON.World;
    _contactHandler?: (event: { bodyA: CANNON.Body; bodyB: CANNON.Body }) => void;
};

function motionTypeToImpl(motionType: MotionType): 1 | 2 | 4 {
    switch (motionType) {
        case MotionType.STATIC:
            return CANNON.Body.STATIC;
        case MotionType.DYNAMIC:
            return CANNON.Body.DYNAMIC;
        case MotionType.KINEMATIC:
            return CANNON.Body.KINEMATIC;
    }
}

function buildCannonShape(desc: PhysicsShape): CANNON.Shape {
    switch (desc.type) {
        case ShapeType.BOX:
            return new CANNON.Box(new CANNON.Vec3(desc.halfExtents[0], desc.halfExtents[1], desc.halfExtents[2]));
        case ShapeType.SPHERE:
            return new CANNON.Sphere(desc.radius);
        case ShapeType.CONVEX_HULL: {
            const indices = quickhull3(desc.points);
            const vertices: CANNON.Vec3[] = [];
            for (let i = 0; i < desc.points.length; i += 3) {
                vertices.push(new CANNON.Vec3(desc.points[i]!, desc.points[i + 1]!, desc.points[i + 2]!));
            }
            const faces: number[][] = [];
            for (let i = 0; i < indices.length; i += 3) {
                faces.push([indices[i]!, indices[i + 1]!, indices[i + 2]!]);
            }
            return new CANNON.ConvexPolyhedron({ vertices, faces });
        }
        case ShapeType.TRIANGLE_MESH: {
            const shape = new CANNON.Trimesh(Array.from(desc.positions), Array.from(desc.indices));
            shape.updateNormals();
            return shape;
        }
    }
}

export function init(): Promise<void> {
    return Promise.resolve();
}

export function disposeWorld(_state: ImplState): void {
    // no-op
}

export function createWorld(): ImplState {
    const world = new CANNON.World({
        gravity: new CANNON.Vec3(0, -9.81, 0),
    });
    world.broadphase = new CANNON.SAPBroadphase(world);

    return { world };
}

export function setGravity(state: ImplState, x: number, y: number, z: number): void {
    state.world.gravity.set(x, y, z);
}

export function stepSimulation(state: ImplState, dt: number): void {
    state.world.step(dt);
}

export function onContactAdded(state: ImplState, onContact: (hA: CANNON.Body, hB: CANNON.Body) => void): void {
    const handler = (event: { bodyA: CANNON.Body; bodyB: CANNON.Body }) => {
        onContact(event.bodyA, event.bodyB);
    };
    state._contactHandler = handler;
    state.world.addEventListener('beginContact', handler);
}

export function disposeContactListener(state: ImplState): void {
    if (state._contactHandler) {
        state.world.removeEventListener('beginContact', state._contactHandler);
        state._contactHandler = undefined;
    }
}

export function createShape(_state: ImplState, desc: PhysicsShape): CANNON.Shape {
    return buildCannonShape(desc);
}

export function destroyShape(_state: ImplState, _implHandle: CANNON.Shape): void {
    // no-op — cannon shapes are GC'd
}

export function createRigidBody(state: ImplState, options: RigidBodyOptions, implShape: CANNON.Shape): CANNON.Body {
    const mass = options.motionType === MotionType.DYNAMIC ? (options.mass ?? 1) : 0;
    const body = new CANNON.Body({
        mass,
        type: motionTypeToImpl(options.motionType),
        shape: implShape,
        position: new CANNON.Vec3(options.position[0], options.position[1], options.position[2]),
    });
    if (options.quaternion) {
        body.quaternion.set(options.quaternion[0], options.quaternion[1], options.quaternion[2], options.quaternion[3]);
    }
    if (options.friction !== undefined || options.restitution !== undefined) {
        body.material = new CANNON.Material({
            friction: options.friction ?? 0.3,
            restitution: options.restitution ?? 0,
        });
    }
    state.world.addBody(body);
    return body;
}

export function removeRigidBody(state: ImplState, handle: CANNON.Body): void {
    state.world.removeBody(handle);
}

export function getBodyPosition(out: Vec3, _state: ImplState, handle: CANNON.Body): void {
    out[0] = handle.position.x;
    out[1] = handle.position.y;
    out[2] = handle.position.z;
}

export function getBodyQuaternion(out: Quat, _state: ImplState, handle: CANNON.Body): void {
    out[0] = handle.quaternion.x;
    out[1] = handle.quaternion.y;
    out[2] = handle.quaternion.z;
    out[3] = handle.quaternion.w;
}

export function setBodyPosition(state: ImplState, handle: CANNON.Body, position: Vec3): void {
    handle.position.set(position[0], position[1], position[2]);
    handle.previousPosition.set(position[0], position[1], position[2]);
    handle.interpolatedPosition.set(position[0], position[1], position[2]);
    handle.aabbNeedsUpdate = true;
    handle.wakeUp();
    state.world.broadphase.dirty = true;
}

export function setBodyQuaternion(_state: ImplState, handle: CANNON.Body, quaternion: Quat): void {
    handle.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    handle.previousQuaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    handle.interpolatedQuaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    handle.aabbNeedsUpdate = true;
}

export function setBodyLinearVelocity(_state: ImplState, handle: CANNON.Body, velocity: Vec3): void {
    handle.velocity.set(velocity[0], velocity[1], velocity[2]);
}

export function getBodyLinearVelocity(out: Vec3, _state: ImplState, handle: CANNON.Body): void {
    out[0] = handle.velocity.x;
    out[1] = handle.velocity.y;
    out[2] = handle.velocity.z;
}

export function setBodyTranslationRotation(state: ImplState, handle: CANNON.Body, position: Vec3, quaternion: Quat): void {
    setBodyPosition(state, handle, position);
    setBodyQuaternion(state, handle, quaternion);
}

const _raycastClosest_rayFrom = new CANNON.Vec3();
const _raycastClosest_rayTo = new CANNON.Vec3();
const _raycastClosest_raycastResult = new CANNON.RaycastResult();
const _raycastClosest_raycastOptions = {};

export function raycastClosest(out: RaycastResult, state: ImplState, origin: Vec3, direction: Vec3, maxDistance: number): void {
    _raycastClosest_rayFrom.set(origin[0], origin[1], origin[2]);
    _raycastClosest_rayTo.set(
        origin[0] + direction[0] * maxDistance,
        origin[1] + direction[1] * maxDistance,
        origin[2] + direction[2] * maxDistance,
    );
    _raycastClosest_raycastResult.reset();
    state.world.raycastClosest(_raycastClosest_rayFrom, _raycastClosest_rayTo, _raycastClosest_raycastOptions, _raycastClosest_raycastResult);
    if (!_raycastClosest_raycastResult.hasHit) {
        out.hit = false;
        out.fraction = 0;
        return;
    }
    out.hit = true;
    out.fraction = _raycastClosest_raycastResult.distance / maxDistance;
}
