import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Box Container — faithful port of PEEL's "BoxContainerAndSpheres"
// (CATEGORY_PERFORMANCE). A static four-walled bin filled with layers of
// spheres. Unlike our open heaps, the walls create dense, persistent contacts
// on every side — a different stress profile for the solver/broadphase.
// ---------------------------------------------------------------------------

const BOX_HEIGHT = 4;
const BOX_SIDE = 1;
const BOX_DEPTH = 10;
const RADIUS = 0.5;
const NB_X = 16;
const NB_Y = 16;
const DEFAULT_LAYERS = 4;
const MAX_LAYERS = 12;
const FILL_SPAN = BOX_DEPTH - RADIUS - BOX_SIDE * 2; // keep spheres inside the walls

// Deterministic jitter so the packing isn't a perfect lattice (mirrors PEEL's seeded random).
function rand(seed: number): number {
    const s = Math.sin(seed * 127.1) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1; // [-1, 1]
}

type ScenarioState = {
    sphereHandles: number[];
    sphereShapeId: number;
    builtLayers: number;
};

type Controls = { layers: number };

function buildWalls(physics: PhysicsState): void {
    // Two walls thin in X (at x = ±depth), two thin in Z (at z = ±depth).
    const wallX = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [BOX_SIDE, BOX_HEIGHT, BOX_DEPTH] });
    const wallZ = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [BOX_DEPTH, BOX_HEIGHT, BOX_SIDE] });
    const wall = (shape: number, x: number, z: number) =>
        api.createRigidBody(physics, { shape, motionType: MotionType.STATIC, position: [x, BOX_HEIGHT, z] });
    wall(wallX, -BOX_DEPTH, 0);
    wall(wallX, BOX_DEPTH, 0);
    wall(wallZ, 0, -BOX_DEPTH);
    wall(wallZ, 0, BOX_DEPTH);
}

function fill(physics: PhysicsState, sphereShapeId: number, layers: number): number[] {
    const handles: number[] = [];
    let seed = 1;
    let yy = RADIUS;
    for (let k = 0; k < layers; k++) {
        for (let y = 0; y < NB_Y; y++) {
            const coeffY = 2 * (y / (NB_Y - 1) - 0.5);
            for (let x = 0; x < NB_X; x++) {
                const coeffX = 2 * (x / (NB_X - 1) - 0.5);
                handles.push(
                    api.createRigidBody(physics, {
                        shape: sphereShapeId,
                        motionType: MotionType.DYNAMIC,
                        position: [0.1 * rand(seed++) + coeffX * FILL_SPAN, yy, 0.1 * rand(seed++) + coeffY * FILL_SPAN],
                        mass: 1,
                        friction: 0.5,
                        restitution: 0,
                    }),
                );
            }
        }
        yy += RADIUS * 2;
    }
    return handles;
}

export const createBoxContainerScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { layers: DEFAULT_LAYERS };
            gui.title('Box Container');
            gui.add(params, 'layers', 1, MAX_LAYERS, 1).name('sphere layers');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 18, 28);
            renderer.camera.lookAt(0, 3, 0);
            renderer.controls.target.set(0, 3, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [60, 0.5, 60], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            buildWalls(physics);

            const sphereShapeId = api.createShape(physics, { type: ShapeType.SPHERE, radius: RADIUS });
            const sphereHandles = fill(physics, sphereShapeId, DEFAULT_LAYERS);

            return { sphereHandles, sphereShapeId, builtLayers: DEFAULT_LAYERS };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, _dt: number): void => {
            if (controls.layers === state.builtLayers) return;
            // Changing the layer count refills the bin so it settles fresh.
            for (const id of state.sphereHandles) api.removeRigidBody(physics, id);
            state.sphereHandles = fill(physics, state.sphereShapeId, controls.layers);
            state.builtLayers = controls.layers;
        },
    });
