import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Stable Spherical Chain — port of PEEL's StableSphericalChain scene.
// 256 spheres in a horizontal chain, first static. Point joints between
// adjacent spheres, plus skip-one distance constraints to prevent stretching.
// A heavy box (mass=100) hangs from the end.
// ---------------------------------------------------------------------------

const NB_SPHERES = 256;
const SPHERE_RADIUS = 1.0;
const ALTITUDE = 50.0;
const STEP = SPHERE_RADIUS * 2; // 2.0

type ScenarioState = {
    sphereIds: number[];
    boxId: number;
    jointIds: number[];
    distIds: number[];
    sphereShapeId: number;
    boxShapeId: number;
};

function build(physics: PhysicsState): ScenarioState {
    const sphereShapeId = api.createShape(physics, {
        type: ShapeType.SPHERE,
        radius: SPHERE_RADIUS,
    });
    const boxShapeId = api.createShape(physics, {
        type: ShapeType.BOX,
        halfExtents: [10, 10, 10],
    });

    // Create spheres at (i*2, ALTITUDE, 0); sphere 0 is static
    const sphereIds: number[] = [];
    for (let i = 0; i < NB_SPHERES; i++) {
        sphereIds.push(api.createRigidBody(physics, {
            shape: sphereShapeId,
            motionType: i === 0 ? MotionType.STATIC : MotionType.DYNAMIC,
            position: [i * STEP, ALTITUDE, 0],
            mass: 1,
        }));
    }

    const jointIds: number[] = [];
    const distIds: number[] = [];

    // Point joints between adjacent spheres; anchor at sphere[i] world pos
    for (let i = 0; i < NB_SPHERES - 1; i++) {
        jointIds.push(api.createPointConstraint(
            physics, sphereIds[i]!, sphereIds[i + 1]!,
            [i * STEP, ALTITUDE, 0],
        ));
    }

    // Skip-one distance constraints (sphere[i] → sphere[i+2], max=4)
    for (let i = 0; i < NB_SPHERES - 2; i++) {
        distIds.push(api.createDistanceConstraint(
            physics, sphereIds[i]!, sphereIds[i + 2]!,
            [i * STEP, ALTITUDE, 0],
            [(i + 2) * STEP, ALTITUDE, 0],
            undefined, STEP * 2,
        ));
    }

    // Heavy box at end: center = (sphere[255].x + 1 + 10, ALTITUDE, 0) = (521, ALTITUDE, 0)
    // LocalPivot0=(1,0,0) on last sphere → world=(511, ALTITUDE, 0)
    // LocalPivot1=(-10,0,0) on box → world=(511, ALTITUDE, 0)
    const lastX = (NB_SPHERES - 1) * STEP; // 510
    const boxX = lastX + 1 + 10;           // 521
    const boxId = api.createRigidBody(physics, {
        shape: boxShapeId,
        motionType: MotionType.DYNAMIC,
        position: [boxX, ALTITUDE, 0],
        mass: 100,
    });
    jointIds.push(api.createPointConstraint(
        physics, sphereIds[NB_SPHERES - 1]!, boxId,
        [lastX + 1, ALTITUDE, 0],
    ));

    return { sphereIds, boxId, jointIds, distIds, sphereShapeId, boxShapeId };
}

function teardown(physics: PhysicsState, s: ScenarioState): void {
    for (const id of s.distIds) api.removeConstraint(physics, id);
    for (const id of s.jointIds) api.removeConstraint(physics, id);
    for (const id of s.sphereIds) api.removeRigidBody(physics, id);
    api.removeRigidBody(physics, s.boxId);
    api.destroyShape(physics, s.sphereShapeId);
    api.destroyShape(physics, s.boxShapeId);
}

export const createStableSphericalChainScenario = () =>
    createScenario<ScenarioState>({
        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            // Camera looking at the mid-chain from above
            const midX = ((NB_SPHERES - 1) * STEP) / 2; // ~255
            renderer.camera.position.set(midX, ALTITUDE + 80, 120);
            renderer.camera.lookAt(midX, ALTITUDE, 0);
            renderer.controls.target.set(midX, ALTITUDE, 0);
            renderer.controls.update();

            return build(physics);
        },

        preUpdate: () => {},

        dispose: (state: ScenarioState, physics: PhysicsState): void => {
            teardown(physics, state);
        },
    });
