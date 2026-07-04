import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState, Quat } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Jenga Stack — a tall crosshatched tower of thin planks. Faithful port of
// box3d's "Jenga Stack" (hull variant): a stability / robustness stress test
// where a tall stack of long thin boxes must stay standing.
//
// Each layer holds two planks; alternate layers are rotated 90 deg about Y so
// the tower crosshatches. box3d uses 40 layers of 2.5 x 0.25 x 0.25 planks.
// ---------------------------------------------------------------------------

// Plank geometry — box3d's b3MakeBoxHull(2.5, 0.25, 0.25)
const PLANK_HALF_EXTENTS: [number, number, number] = [2.5, 0.25, 0.25];
const LAYER_STEP = 0.5; // vertical pitch between layers
const OFFSET = 1.75; // lateral offset of the two planks in a layer

const DEFAULT_LAYERS = 40;
const MAX_LAYERS = 60;

const HALF_PI = Math.PI / 2;

type ScenarioState = {
    bodyHandles: number[];
    plankShapeId: number;
    layers: number; // layer count the current bodies were placed for
};

type Controls = {
    layers: number;
};

/** Quaternion for a rotation of `angle` about the world Y axis. */
function quatAroundY(angle: number): Quat {
    return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}

function createPlank(physics: PhysicsState, plankShapeId: number, position: [number, number, number], quat: Quat): number {
    return api.createRigidBody(physics, {
        shape: plankShapeId,
        motionType: MotionType.DYNAMIC,
        position,
        quaternion: quat,
        mass: 1,
        friction: 0.6,
        restitution: 0,
    });
}

/** Place the two planks that make up layer `i` (box3d's crosshatch layout). */
function placeLayer(physics: PhysicsState, plankShapeId: number, i: number, out: number[]): void {
    const even = (i & 1) === 0;
    const alpha = even ? HALF_PI : 0;
    const x = even ? OFFSET : 0;
    const z = even ? 0 : OFFSET;
    const y = LAYER_STEP * i + 0.25;
    const quat = quatAroundY(alpha);

    out.push(createPlank(physics, plankShapeId, [x, y, z], quat));
    out.push(createPlank(physics, plankShapeId, [-x, y, -z], quat));
}

export const createJengaScenario = () => {
    return createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { layers: DEFAULT_LAYERS };
            gui.title('Jenga Stack');
            gui.add(params, 'layers', 1, MAX_LAYERS, 1).name('layers');
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

            const plankShapeId = api.createShape(physics, {
                type: ShapeType.BOX,
                halfExtents: PLANK_HALF_EXTENTS,
            });

            return { bodyHandles: [], plankShapeId, layers: DEFAULT_LAYERS };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, _dt: number): void => {
            // Changing the layer count resets the scene: tear down the tower and
            // rebuild it so it settles fresh.
            if (controls.layers !== state.layers) {
                while (state.bodyHandles.length > 0) {
                    api.removeRigidBody(physics, state.bodyHandles.pop()!);
                }
                state.layers = controls.layers;
            }

            // Build the tower once; afterwards the planks just rest — no respawn.
            const builtLayers = state.bodyHandles.length / 2;
            for (let i = builtLayers; i < state.layers; i++) {
                placeLayer(physics, state.plankShapeId, i, state.bodyHandles);
            }
        },
    });
};
