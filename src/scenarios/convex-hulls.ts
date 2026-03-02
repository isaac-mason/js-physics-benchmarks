import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Hull geometry generators
// ---------------------------------------------------------------------------

/** Pyramid with a square base centred at the origin */
function makePyramid(baseHalf: number, height: number): number[] {
    return [
        -baseHalf, 0,  baseHalf,
         baseHalf, 0,  baseHalf,
         baseHalf, 0, -baseHalf,
        -baseHalf, 0, -baseHalf,
                0, height, 0,
    ];
}

/** Regular prism with `sides` sides, given radius and half-height */
function makePrism(sides: number, radius: number, halfH: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const x = Math.cos(a) * radius;
        const z = Math.sin(a) * radius;
        pts.push(x, -halfH, z);
        pts.push(x,  halfH, z);
    }
    return pts;
}

/** Seeded pseudo-random points on/inside a unit sphere — deterministic per seed */
function makeRandomHull(n: number, seed: number, scale: number): number[] {
    // Simple LCG so hulls are deterministic across engines/runs
    let s = seed;
    function rng(): number {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 0xffffffff;
    }
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
        // Uniform point in sphere via rejection sampling substitute: normalise
        const u = rng() * 2 - 1;
        const v = rng() * 2 - 1;
        const w = rng() * 2 - 1;
        const len = Math.sqrt(u * u + v * v + w * w) || 1;
        pts.push((u / len) * scale, (v / len) * scale, (w / len) * scale);
    }
    return pts;
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

const SPAWN_HEIGHT = 12;
const SPAWN_AREA = 3;

type ScenarioState = {
    bodyHandles: number[];
    shapeIds: number[];
    index: number;
};

type Controls = {
    n: number;
};

function spawnHull(physics: PhysicsState, shapeIds: number[], rngIndex: number): number {
    const shapeId = shapeIds[rngIndex % shapeIds.length]!;
    // Spread spawns across the area using a deterministic-ish index offset
    const angle = rngIndex * 2.399963; // golden-angle-ish spread
    const r = Math.sqrt((rngIndex % 17) / 17) * SPAWN_AREA;
    return api.createRigidBody(physics, {
        shape: shapeId,
        motionType: MotionType.DYNAMIC,
        position: [
            Math.cos(angle) * r,
            SPAWN_HEIGHT,
            Math.sin(angle) * r,
        ],
        mass: 1,
        friction: 0.5,
        restitution: 0.1,
    });
}

export const createConvexHullsScenario = () => {
    return createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { n: 100 };
            gui.title('Convex Hull Heap');
            gui.add(params, 'n', 0, 500, 1).name('bodies');
            return params;
        },

        init: (physics: PhysicsState, _renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            // Static floor
            const floorShapeId = api.createShape(physics, {
                type: ShapeType.BOX,
                halfExtents: [50, 0.5, 50],
            });
            api.createRigidBody(physics, {
                shape: floorShapeId,
                motionType: MotionType.STATIC,
                position: [0, -0.5, 0],
            });

            // Register hull variants — engines compute the actual convex hull from the point cloud
            const shapeIds = [
                api.createShape(physics, { type: ShapeType.CONVEX_HULL, points: makePyramid(0.4, 0.8) }),
                api.createShape(physics, { type: ShapeType.CONVEX_HULL, points: makePrism(8, 0.4, 0.35) }),  // octagonal prism
                api.createShape(physics, { type: ShapeType.CONVEX_HULL, points: makePrism(5, 0.45, 0.3) }), // pentagonal prism
                api.createShape(physics, { type: ShapeType.CONVEX_HULL, points: makeRandomHull(16, 1, 0.4) }),
                api.createShape(physics, { type: ShapeType.CONVEX_HULL, points: makeRandomHull(16, 2, 0.4) }),
                api.createShape(physics, { type: ShapeType.CONVEX_HULL, points: makeRandomHull(16, 3, 0.4) }),
            ];

            return { bodyHandles: [], shapeIds, index: 0 };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, _dt: number): void => {
            const target = controls.n;

            while (state.bodyHandles.length < target) {
                state.bodyHandles.push(spawnHull(physics, state.shapeIds, state.bodyHandles.length));
            }
            while (state.bodyHandles.length > target) {
                api.removeRigidBody(physics, state.bodyHandles.pop()!);
            }

            if (state.bodyHandles.length === 0) return;

            // Respawn one body per step cycling through the pool
            const handle = state.bodyHandles[state.index % state.bodyHandles.length]!;
            const angle = state.index * 2.399963;
            const r = Math.sqrt((state.index % 17) / 17) * SPAWN_AREA;
            api.setBodyTranslationRotation(physics, handle, [Math.cos(angle) * r, SPAWN_HEIGHT, Math.sin(angle) * r], [0, 0, 0, 1]);
            state.index = (state.index + 1) % state.bodyHandles.length;
        },
    });
};
