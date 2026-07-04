import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Sleeping Pile — a sleeping-performance test. A grid of boxes is dropped once
// and left to settle; a good engine puts the resting bodies to sleep and its
// per-step cost collapses (watch the STEP stat fall after the initial settle).
//
// Every so often a "disturber" sphere drops onto the pile, waking only the
// local island around the impact — which exposes how each engine sleeps:
//   * does it sleep at all? (STEP stays high if not)
//   * does it wake only the impacted island, or the whole world?
//   * how cheap are sleeping bodies?
//
// Unlike the cube-heap / candy-cups heaps, nothing is respawned per frame — the
// whole point is to let the world go quiet.
// ---------------------------------------------------------------------------

const BOX_HALF = 0.25;
const GRID_W = 12; // footprint width in boxes
const PER_LAYER = GRID_W * GRID_W;
const SPACING = 0.6; // > box size so they settle with small gaps, not a big explosion
const LAYER_H = 0.6;
const DROP_H = 0.4; // spawn a touch above the rest height so they drop and settle
const HALF_SPAN = ((GRID_W - 1) * SPACING) / 2;

const DISTURBER_COUNT = 3;
const DISTURBER_RADIUS = 0.4;
const DISTURBER_HEIGHT = 14;

const MAX_BOXES = 2500;

// Small deterministic jitter so the grid doesn't settle in perfect lockstep.
function jitter(index: number): number {
    return (((index * 12.9898) % 1) - 0.5) * 0.06;
}

function boxRestPosition(index: number): [number, number, number] {
    const layer = Math.floor(index / PER_LAYER);
    const rem = index % PER_LAYER;
    const row = Math.floor(rem / GRID_W);
    const col = rem % GRID_W;
    return [
        -HALF_SPAN + col * SPACING + jitter(index),
        BOX_HALF + layer * LAYER_H + DROP_H,
        -HALF_SPAN + row * SPACING + jitter(index * 7),
    ];
}

function disturberSpawn(seed: number): [number, number, number] {
    // Pseudo-random x/z within the footprint, dropped from high up.
    const a = ((seed * 0.6180339887) % 1) * Math.PI * 2;
    const r = Math.sqrt((seed % 13) / 13) * HALF_SPAN;
    return [Math.cos(a) * r, DISTURBER_HEIGHT, Math.sin(a) * r];
}

type ScenarioState = {
    boxHandles: number[];
    disturbers: number[];
    boxShapeId: number;
    builtBoxes: number; // box count the current pile was built for
    elapsed: number;
    nextDisturber: number;
    dropSeed: number;
};

type Controls = {
    boxes: number;
    dropInterval: number; // seconds between disturber drops (0 = none)
};

export const createSleepingPileScenario = () => {
    return createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { boxes: 600, dropInterval: 1.5 };
            gui.title('Sleeping Pile');
            gui.add(params, 'boxes', 0, MAX_BOXES, 1).name('boxes');
            gui.add(params, 'dropInterval', 0, 5, 0.1).name('drop every (s)');
            return params;
        },

        init: (physics: PhysicsState, _renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            const floorShapeId = api.createShape(physics, {
                type: ShapeType.BOX,
                halfExtents: [50, 0.5, 50],
                convexRadius: 0.05,
            });
            api.createRigidBody(physics, {
                shape: floorShapeId,
                motionType: MotionType.STATIC,
                position: [0, -0.5, 0],
            });

            const boxShapeId = api.createShape(physics, {
                type: ShapeType.BOX,
                halfExtents: [BOX_HALF, BOX_HALF, BOX_HALF],
            });

            // Disturber spheres, parked high; they get recycled onto the pile.
            const disturberShapeId = api.createShape(physics, { type: ShapeType.SPHERE, radius: DISTURBER_RADIUS });
            const disturbers: number[] = [];
            for (let i = 0; i < DISTURBER_COUNT; i++) {
                disturbers.push(
                    api.createRigidBody(physics, {
                        shape: disturberShapeId,
                        motionType: MotionType.DYNAMIC,
                        position: disturberSpawn(i + 1),
                        mass: 4,
                        friction: 0.5,
                        restitution: 0.1,
                    }),
                );
            }

            return {
                boxHandles: [],
                disturbers,
                boxShapeId,
                builtBoxes: -1,
                elapsed: 0,
                nextDisturber: 0,
                dropSeed: DISTURBER_COUNT + 1,
            };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            // Changing the box count rebuilds the pile so it settles fresh.
            if (controls.boxes !== state.builtBoxes) {
                while (state.boxHandles.length > 0) {
                    api.removeRigidBody(physics, state.boxHandles.pop()!);
                }
                for (let i = 0; i < controls.boxes; i++) {
                    state.boxHandles.push(
                        api.createRigidBody(physics, {
                            shape: state.boxShapeId,
                            motionType: MotionType.DYNAMIC,
                            position: boxRestPosition(i),
                            mass: 1,
                            friction: 0.6,
                            restitution: 0,
                        }),
                    );
                }
                state.builtBoxes = controls.boxes;
            }

            // Periodically drop a disturber onto the pile to wake a local island.
            if (controls.dropInterval > 0 && state.disturbers.length > 0) {
                state.elapsed += dt;
                if (state.elapsed >= controls.dropInterval) {
                    state.elapsed = 0;
                    const handle = state.disturbers[state.nextDisturber % state.disturbers.length]!;
                    api.setBodyTranslationRotation(physics, handle, disturberSpawn(state.dropSeed), [0, 0, 0, 1]);
                    api.setBodyLinearVelocity(physics, handle, [0, 0, 0]);
                    state.nextDisturber++;
                    state.dropSeed++;
                }
            }
        },
    });
};
