import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState, Quat } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Friction Ramp — faithful port of PEEL's "FrictionRamp" (CATEGORY_BEHAVIOR).
// Eight static ramps tilted 42°, each with a different friction coefficient
// (0 → 1). A cube dropped on each slides a different distance — a correctness
// test for the friction model. Auto-restarts so the slide replays.
// ---------------------------------------------------------------------------

const N = 8;
const BOX_EXTENT = 10;
const RAMP_Y = BOX_EXTENT;
const RAMP_ANGLE = (42 * Math.PI) / 180;
const CUBE_HALF = 1;
const CUBE_DROP: [number, number, number] = [0, 18, -6]; // relative offset before x
const DEFAULT_RESTART = 5;

function rampX(i: number): number {
    return (i - N / 2) * BOX_EXTENT * 1.1;
}

/** Rotation about the world X axis. */
function quatX(angle: number): Quat {
    return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
}

type ScenarioState = {
    cubes: { id: number; x: number }[];
    quat: Quat;
    elapsed: number;
};

type Controls = { restart: number };

export const createFrictionRampScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { restart: DEFAULT_RESTART };
            gui.title('Friction Ramp');
            gui.add(params, 'restart', 0, 12, 0.5).name('restart (s)');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 48, 96);
            renderer.camera.lookAt(-4, 6, 0);
            renderer.controls.target.set(-4, 6, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [120, 0.5, 120], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            // Ramp: half-extents (BoxExtent/2, 0.5, BoxExtent), tilted 42° about X.
            const rampShape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [BOX_EXTENT * 0.5, 0.5, BOX_EXTENT] });
            const cubeShape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [CUBE_HALF, CUBE_HALF, CUBE_HALF] });
            const quat = quatX(RAMP_ANGLE);

            const cubes: { id: number; x: number }[] = [];
            for (let i = 0; i < N; i++) {
                // PEEL uses static friction 0 and dynamic friction i/(N-1); our
                // API has a single coefficient, so we use the dynamic value.
                const friction = i / (N - 1); // 0 → 1
                const x = rampX(i);
                api.createRigidBody(physics, {
                    shape: rampShape,
                    motionType: MotionType.STATIC,
                    position: [x, RAMP_Y, 0],
                    quaternion: quat,
                    friction,
                    restitution: 0,
                });
                const id = api.createRigidBody(physics, {
                    shape: cubeShape,
                    motionType: MotionType.DYNAMIC,
                    position: [x + CUBE_DROP[0], CUBE_DROP[1], CUBE_DROP[2]],
                    quaternion: quat,
                    mass: 1,
                    friction,
                    restitution: 0,
                });
                cubes.push({ id, x });
            }

            return { cubes, quat, elapsed: 0 };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            if (controls.restart <= 0) return;
            state.elapsed += dt;
            if (state.elapsed < controls.restart) return;
            state.elapsed = 0;
            for (const c of state.cubes) {
                api.setBodyTranslationRotation(physics, c.id, [c.x + CUBE_DROP[0], CUBE_DROP[1], CUBE_DROP[2]], state.quat);
                api.setBodyLinearVelocity(physics, c.id, [0, 0, 0]);
            }
        },
    });
