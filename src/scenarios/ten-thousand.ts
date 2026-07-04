import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Ten Thousand — faithful port of PEEL's "TenThousandsBoxes / TenThousandsSpheres"
// (CATEGORY_PERFORMANCE). A 16x16 footprint stacked in up to 40 layers of
// randomly-sized boxes or spheres, dropped into one giant pile. The raw
// dynamic-body / broadphase throughput ceiling.
// ---------------------------------------------------------------------------

const NB_X = 16;
const NB_Y = 16;
const SCALE = 4;
const AMPLITUDE = 1.5;
const DEFAULT_LAYERS = 20; // 256 bodies/layer -> 5120 (crank to 40 for the full 10k)
const MAX_LAYERS = 40;
const SHAPE_VARIANTS = 200; // pool of random sizes, cycled (keeps body count, not shape count, the stress)

// Deterministic pseudo-random in [0, 1] (stands in for PEEL's seeded BasicRandom).
function rand01(seed: number): number {
    const s = Math.sin(seed * 12.9898) * 43758.5453;
    return s - Math.floor(s);
}

type ScenarioState = {
    handles: number[];
    variants: number[];
    builtLayers: number;
    builtShape: string;
};

type Controls = { shape: string; layers: number };

function makeVariants(physics: PhysicsState, shape: string): number[] {
    const variants: number[] = [];
    for (let i = 0; i < SHAPE_VARIANTS; i++) {
        if (shape === 'spheres') {
            variants.push(api.createShape(physics, { type: ShapeType.SPHERE, radius: 1 + rand01(i * 3 + 1) }));
        } else {
            const hx = Math.abs(rand01(i * 3 + 1) * 2 - 1) + 0.2;
            const hy = Math.abs(rand01(i * 3 + 2) * 2 - 1) + 0.2;
            const hz = Math.abs(rand01(i * 3 + 3) * 2 - 1) + 0.2;
            variants.push(api.createShape(physics, { type: ShapeType.BOX, halfExtents: [hx, hy, hz] }));
        }
    }
    return variants;
}

function build(physics: PhysicsState, variants: number[], layers: number): number[] {
    const handles: number[] = [];
    let seed = 1;
    let variant = 0;
    for (let j = 0; j < layers; j++) {
        for (let y = 0; y < NB_Y; y++) {
            for (let x = 0; x < NB_X; x++) {
                const xf = (x - NB_X * 0.5) * SCALE;
                const zf = (y - NB_Y * 0.5) * SCALE;
                const yf = rand01(seed++) * 2 + AMPLITUDE + AMPLITUDE * 2 * j;
                handles.push(
                    api.createRigidBody(physics, {
                        shape: variants[variant++ % variants.length]!,
                        motionType: MotionType.DYNAMIC,
                        position: [xf, yf, zf],
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

export const createTenThousandScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { shape: 'boxes', layers: DEFAULT_LAYERS };
            gui.title('Ten Thousand');
            gui.add(params, 'shape', ['boxes', 'spheres']).name('shape');
            gui.add(params, 'layers', 1, MAX_LAYERS, 1).name('layers');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 55, 95);
            renderer.camera.lookAt(0, 10, 0);
            renderer.controls.target.set(0, 10, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [80, 0.5, 80], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            const variants = makeVariants(physics, 'boxes');
            const handles = build(physics, variants, DEFAULT_LAYERS);
            return { handles, variants, builtLayers: DEFAULT_LAYERS, builtShape: 'boxes' };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, _dt: number): void => {
            if (controls.shape === state.builtShape && controls.layers === state.builtLayers) return;
            for (const id of state.handles) api.removeRigidBody(physics, id);
            if (controls.shape !== state.builtShape) state.variants = makeVariants(physics, controls.shape);
            state.handles = build(physics, state.variants, controls.layers);
            state.builtLayers = controls.layers;
            state.builtShape = controls.shape;
        },
    });
