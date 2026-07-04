import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Wind — an original scene (box3d's "Wind" is a jointed flag, which needs joints
// we don't expose). A bin of light debris is swept around by a gusting wind. The
// wind is applied as a per-frame force via applyImpulse (impulse = force * dt),
// its direction slowly rotating and its strength pulsing, with per-body noise so
// the field tumbles turbulently rather than sliding in lockstep.
// ---------------------------------------------------------------------------

const BIN_HALF = 12;
const WALL_H = 2;
const DEFAULT_BODIES = 250;
const MAX_BODIES = 1500;
const BOX_HALF = 0.3;
const WIND_ROTATE = 0.25; // rad/s the wind direction turns

type ScenarioState = {
    boxes: number[];
    boxShapeId: number;
    builtBodies: number;
    time: number;
};

type Controls = { strength: number; bodies: number };

function randomInRange(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

function buildDebris(physics: PhysicsState, boxShapeId: number, n: number): number[] {
    const boxes: number[] = [];
    for (let i = 0; i < n; i++) {
        boxes.push(
            api.createRigidBody(physics, {
                shape: boxShapeId,
                motionType: MotionType.DYNAMIC,
                position: [randomInRange(-BIN_HALF + 1, BIN_HALF - 1), BOX_HALF + 0.02, randomInRange(-BIN_HALF + 1, BIN_HALF - 1)],
                mass: 1,
                friction: 0.3,
                restitution: 0.1,
            }),
        );
    }
    return boxes;
}

export const createWindScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { strength: 22, bodies: DEFAULT_BODIES };
            gui.title('Wind');
            gui.add(params, 'strength', 0, 60, 1).name('strength');
            gui.add(params, 'bodies', 0, MAX_BODIES, 1).name('debris');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 26, 30);
            renderer.camera.lookAt(0, 0, 0);
            renderer.controls.target.set(0, 0, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [BIN_HALF, 0.5, BIN_HALF], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            // Bin walls so the debris stays in view.
            const wallX = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [0.3, WALL_H, BIN_HALF] });
            const wallZ = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [BIN_HALF, WALL_H, 0.3] });
            api.createRigidBody(physics, { shape: wallX, motionType: MotionType.STATIC, position: [-BIN_HALF, WALL_H, 0] });
            api.createRigidBody(physics, { shape: wallX, motionType: MotionType.STATIC, position: [BIN_HALF, WALL_H, 0] });
            api.createRigidBody(physics, { shape: wallZ, motionType: MotionType.STATIC, position: [0, WALL_H, -BIN_HALF] });
            api.createRigidBody(physics, { shape: wallZ, motionType: MotionType.STATIC, position: [0, WALL_H, BIN_HALF] });

            const boxShapeId = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [BOX_HALF, BOX_HALF, BOX_HALF] });
            const boxes = buildDebris(physics, boxShapeId, DEFAULT_BODIES);

            return { boxes, boxShapeId, builtBodies: DEFAULT_BODIES, time: 0 };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            if (controls.bodies !== state.builtBodies) {
                for (const id of state.boxes) api.removeRigidBody(physics, id);
                state.boxes = buildDebris(physics, state.boxShapeId, controls.bodies);
                state.builtBodies = controls.bodies;
            }

            state.time += dt;
            const t = state.time;
            // Wind direction slowly rotates; strength pulses in gusts.
            const dir = t * WIND_ROTATE;
            const gust = 0.55 + 0.45 * Math.sin(t * 1.3);
            const mag = controls.strength * gust;
            const wx = Math.cos(dir) * mag;
            const wz = Math.sin(dir) * mag;

            for (let i = 0; i < state.boxes.length; i++) {
                // Per-body turbulence so the field doesn't move in lockstep.
                const nx = Math.sin(t * 3 + i * 0.7) * controls.strength * 0.25;
                const nz = Math.cos(t * 2.7 + i * 1.3) * controls.strength * 0.25;
                api.applyImpulse(physics, state.boxes[i]!, [(wx + nx) * dt, 0, (wz + nz) * dt]);
            }
        },
    });
