import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Convex Stack — faithful port of PEEL's "ConvexStack" (CATEGORY_PERFORMANCE).
// A 16x16 grid of truncated-cone convex hulls (an 8-gon ring of radius 2 at the
// base, radius 3 at the top), stacked in layers and left to settle. A convex-
// hull stacking / broadphase throughput test.
// ---------------------------------------------------------------------------

const GRID = 16;
const SPACING = 8;
const LAYER_H = 2;
const HALF_SPAN = ((GRID - 1) * SPACING) / 2;
const DEFAULT_LAYERS = 3;
const MAX_LAYERS = 6;

// GenerateConvex(8, 8, scale0=2, scale1=3, z=2): base ring r=2 at y=0, top ring r=3 at y=2.
function makeFrustum(): number[] {
    const pts: number[] = [];
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push(Math.cos(a) * 2, 0, Math.sin(a) * 2);
    }
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push(Math.cos(a) * 3, 2, Math.sin(a) * 3);
    }
    return pts;
}

type ScenarioState = {
    handles: number[];
    shapeId: number;
    builtLayers: number;
};

type Controls = { layers: number };

function build(physics: PhysicsState, shapeId: number, layers: number): number[] {
    const handles: number[] = [];
    for (let j = 0; j < layers; j++) {
        for (let y = 0; y < GRID; y++) {
            for (let x = 0; x < GRID; x++) {
                handles.push(
                    api.createRigidBody(physics, {
                        shape: shapeId,
                        motionType: MotionType.DYNAMIC,
                        position: [x * SPACING - HALF_SPAN, LAYER_H * j + 0.1, y * SPACING - HALF_SPAN],
                        mass: 1,
                        friction: 0.5,
                        restitution: 0,
                    }),
                );
            }
        }
    }
    return handles;
}

export const createConvexStackScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { layers: DEFAULT_LAYERS };
            gui.title('Convex Stack');
            gui.add(params, 'layers', 1, MAX_LAYERS, 1).name('layers');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 45, 135);
            renderer.camera.lookAt(0, 4, 0);
            renderer.controls.target.set(0, 4, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [100, 0.5, 100], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            const shapeId = api.createShape(physics, { type: ShapeType.CONVEX_HULL, points: makeFrustum() });
            const handles = build(physics, shapeId, DEFAULT_LAYERS);

            return { handles, shapeId, builtLayers: DEFAULT_LAYERS };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, _dt: number): void => {
            if (controls.layers === state.builtLayers) return;
            for (const id of state.handles) api.removeRigidBody(physics, id);
            state.handles = build(physics, state.shapeId, controls.layers);
            state.builtLayers = controls.layers;
        },
    });
