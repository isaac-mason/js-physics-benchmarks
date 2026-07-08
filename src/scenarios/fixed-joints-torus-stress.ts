import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Fixed Joints Torus Stress — port of PEEL's FixedJointsTorusStressTest scene.
// 10 interlocked torus rings, each made of 32 convex-hull slices connected by
// fixed joints. Alternating rings are rotated 90° around Y to allow interlocking.
// The top ring (i=9) is static; the rest are dynamic.
// ---------------------------------------------------------------------------

const NB_TORUS = 10;
const NB_SLICES = 32;
const NB_SMALL = 16;
const BIG_R = 3.0;
const SMALL_R = 1.0;
const BASE_Y = 50.0;
const Y_STEP = 4.0;

// PEEL orientation: big circle sweeps YZ plane (hole along X).
// Vertex(theta, phi): x = r*cos(phi), y = (R+r*sin(phi))*cos(theta), z = (R+r*sin(phi))*sin(theta)
function torusVert(theta: number, phi: number): [number, number, number] {
    return [
        SMALL_R * Math.cos(phi),
        (BIG_R + SMALL_R * Math.sin(phi)) * Math.cos(theta),
        (BIG_R + SMALL_R * Math.sin(phi)) * Math.sin(theta),
    ];
}

// RotY(90°): (x,y,z) → (z,y,-x). Converts hole-along-X ring to hole-along-Z ring.
function rotY90([x, y, z]: [number, number, number]): [number, number, number] {
    return [z, y, -x];
}

type TorusData = {
    bodyIds: number[];
    shapeIds: number[];
    jointIds: number[];
};

function buildTorus(
    physics: PhysicsState,
    centerY: number,
    useRotY90: boolean,
    mass: number,
): TorusData {
    // Pre-compute all vertex rings
    const rings: [number, number, number][][] = [];
    for (let j = 0; j <= NB_SLICES; j++) {
        const theta = (j / NB_SLICES) * 2 * Math.PI;
        const ring: [number, number, number][] = [];
        for (let i = 0; i < NB_SMALL; i++) {
            const phi = (i / NB_SMALL) * 2 * Math.PI;
            const v = torusVert(theta, phi);
            ring.push(useRotY90 ? rotY90(v) : v);
        }
        rings.push(ring);
    }

    const bodyIds: number[] = [];
    const shapeIds: number[] = [];
    const jointIds: number[] = [];
    const centers: [number, number, number][] = [];

    for (let s = 0; s < NB_SLICES; s++) {
        const ringA = rings[s]!;
        const ringB = rings[s + 1]!;
        const pts = [...ringA, ...ringB];

        // Centroid of this slice
        let cx = 0, cy = 0, cz = 0;
        for (const [x, y, z] of pts) { cx += x; cy += y; cz += z; }
        cx /= pts.length; cy /= pts.length; cz /= pts.length;
        centers.push([cx, centerY + cy, cz]);

        // Convex hull points centered at slice centroid
        const localPts = pts.flatMap(([x, y, z]) => [x - cx, y - cy, z - cz]);

        const shapeId = api.createShape(physics, {
            type: ShapeType.CONVEX_HULL,
            points: localPts,
        });
        shapeIds.push(shapeId);

        bodyIds.push(api.createRigidBody(physics, {
            shape: shapeId,
            motionType: mass === 0 ? MotionType.STATIC : MotionType.DYNAMIC,
            position: [cx, centerY + cy, cz],
            mass,
        }));
    }

    // Fixed joints between adjacent slices
    for (let s = 0; s < NB_SLICES; s++) {
        const s1 = (s + 1) % NB_SLICES;
        jointIds.push(api.createFixedConstraint(physics, bodyIds[s]!, bodyIds[s1]!));
    }

    return { bodyIds, shapeIds, jointIds };
}

type ScenarioState = { toruses: TorusData[] };

function teardown(physics: PhysicsState, s: ScenarioState): void {
    for (const t of s.toruses) {
        for (const id of t.jointIds) api.removeConstraint(physics, id);
        for (const id of t.bodyIds) api.removeRigidBody(physics, id);
        for (const id of t.shapeIds) api.destroyShape(physics, id);
    }
}

export const createFixedJointsTorusStressScenario = () =>
    createScenario<ScenarioState>({
        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, BASE_Y + 20, 40);
            renderer.camera.lookAt(0, BASE_Y + (NB_TORUS * Y_STEP) / 2, 0);
            renderer.controls.target.set(0, BASE_Y + (NB_TORUS * Y_STEP) / 2, 0);
            renderer.controls.update();

            const toruses: TorusData[] = [];
            for (let i = 0; i < NB_TORUS; i++) {
                const centerY = BASE_Y + i * Y_STEP;
                const useRotY90 = (i % 2) === 1;
                // Last torus (i == NB_TORUS-1) is static
                const mass = i === NB_TORUS - 1 ? 0 : 1;
                toruses.push(buildTorus(physics, centerY, useRotY90, mass));
            }

            return { toruses };
        },

        preUpdate: () => {},

        dispose: (state: ScenarioState, physics: PhysicsState): void => {
            teardown(physics, state);
        },
    });
