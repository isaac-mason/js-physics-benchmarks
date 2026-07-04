import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Candy Cups — a structured grid of small truncated-cone convex hulls placed
// base-down and left to settle so they nest into each other. Faithful port of
// box3d's "Candy Cups" benchmark: a stress test for convex-hull collision and
// deep, persistent resting contacts.
//
// Original layout: a 16x16 footprint stacked 16 layers high (4096 cups),
// placed at { -10 + 2.5*j, 1.0*i, -10 + 2.5*k }, dropped, and left to rest.
// ---------------------------------------------------------------------------

/**
 * An `sides`-gon truncated cone (frustum): a narrow base ring at `yBase` and a
 * wider mouth ring at `yMouth`, so cups nest like stacked party cups. Local
 * origin sits at the base. Mirrors box3d's CreateConvex(r1, h1, r2, h2).
 */
function makeCup(sides: number, rBase: number, yBase: number, rMouth: number, yMouth: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        pts.push(rBase * c, yBase, rBase * s);
        pts.push(rMouth * c, yMouth, rMouth * s);
    }
    return pts;
}

// Cup geometry — exactly box3d's CreateConvex(0.6, 0.0, 0.95, 1.0)
const CUP_SIDES = 8;
const CUP_BASE_RADIUS = 0.6;
const CUP_BASE_Y = 0.0;
const CUP_MOUTH_RADIUS = 0.95;
const CUP_MOUTH_Y = 1.0;

// Grid — 2.5 spacing, 1.0 vertical pitch (box3d values). Footprint width and
// stack height are driven by the sliders below.
const GRID_SPACING = 2.5;
const LAYER_HEIGHT = 1.0;

const DEFAULT_GRID_SIZE = 4;
const DEFAULT_LAYERS = 4;
const MAX_GRID_SIZE = 24;
const MAX_LAYERS = 24;

type ScenarioState = {
    bodyHandles: number[];
    cupShapeId: number;
    // footprint width / stack height the current bodies were placed for
    gridSize: number;
    layers: number;
};

type Controls = {
    gridSize: number;
    layers: number;
};

/** Canonical grid position for the cup at a given fill index (box3d fill order: layer, then j, then k). */
function gridPosition(index: number, gridSize: number): [number, number, number] {
    const perLayer = gridSize * gridSize;
    const layer = Math.floor(index / perLayer);
    const rem = index % perLayer;
    const j = Math.floor(rem / gridSize);
    const k = rem % gridSize;
    const halfSpan = ((gridSize - 1) * GRID_SPACING) / 2; // centre the grid on the origin
    return [-halfSpan + GRID_SPACING * j, LAYER_HEIGHT * layer, -halfSpan + GRID_SPACING * k];
}

function spawnCup(physics: PhysicsState, cupShapeId: number, index: number, gridSize: number): number {
    return api.createRigidBody(physics, {
        shape: cupShapeId,
        motionType: MotionType.DYNAMIC,
        position: gridPosition(index, gridSize),
        mass: 1,
        friction: 0.6,
        restitution: 0,
    });
}

export const createCandyCupsScenario = () => {
    return createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { gridSize: DEFAULT_GRID_SIZE, layers: DEFAULT_LAYERS };
            gui.title('Candy Cups');
            gui.add(params, 'gridSize', 1, MAX_GRID_SIZE, 1).name('grid size');
            gui.add(params, 'layers', 0, MAX_LAYERS, 1).name('layers');
            return params;
        },

        init: (physics: PhysicsState, _renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            const floorShapeId = api.createShape(physics, {
                type: ShapeType.BOX,
                halfExtents: [60, 0.5, 60],
                convexRadius: 0.05,
            });
            api.createRigidBody(physics, {
                shape: floorShapeId,
                motionType: MotionType.STATIC,
                position: [0, -0.5, 0],
            });

            const cupShapeId = api.createShape(physics, {
                type: ShapeType.CONVEX_HULL,
                points: makeCup(CUP_SIDES, CUP_BASE_RADIUS, CUP_BASE_Y, CUP_MOUTH_RADIUS, CUP_MOUTH_Y),
            });

            return { bodyHandles: [], cupShapeId, gridSize: DEFAULT_GRID_SIZE, layers: DEFAULT_LAYERS };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, _dt: number): void => {
            // Changing either slider resets the scene: tear down all cups and
            // re-place the whole grid from scratch so it settles fresh.
            if (controls.gridSize !== state.gridSize || controls.layers !== state.layers) {
                while (state.bodyHandles.length > 0) {
                    api.removeRigidBody(physics, state.bodyHandles.pop()!);
                }
                state.gridSize = controls.gridSize;
                state.layers = controls.layers;
            }

            // Place the full grid once; once settled the cups just rest and
            // nest — no respawn.
            const target = state.gridSize * state.gridSize * state.layers;
            while (state.bodyHandles.length < target) {
                state.bodyHandles.push(spawnCup(physics, state.cupShapeId, state.bodyHandles.length, state.gridSize));
            }
        },
    });
};
