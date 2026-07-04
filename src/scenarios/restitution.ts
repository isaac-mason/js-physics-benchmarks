import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Restitution — faithful port of PEEL's "Restitution" (CATEGORY_BEHAVIOR).
// Eight static platforms with restitution 0 → 1; a sphere dropped on each
// bounces to a different height. A correctness test: engines should agree on
// bounce height, and frequently don't. Auto-restarts so the bounce replays.
// ---------------------------------------------------------------------------

const N = 8;
const BOX_EXTENT = 3;
const PLATFORM_Y = 3;
const RADIUS = 1;
const DROP_Y = 20;
const DEFAULT_RESTART = 4;

function platformX(i: number): number {
    return (i - N / 2) * BOX_EXTENT * 1.1;
}

type ScenarioState = {
    spheres: { id: number; x: number }[];
    elapsed: number;
};

type Controls = { restart: number };

export const createRestitutionScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { restart: DEFAULT_RESTART };
            gui.title('Restitution');
            gui.add(params, 'restart', 0, 10, 0.5).name('restart (s)');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 14, 34);
            renderer.camera.lookAt(0, 4, 0);
            renderer.controls.target.set(0, 4, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [60, 0.5, 60], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            // Platform: half-extents (BoxExtent/2, 0.5, BoxExtent) — a wide thin slab.
            const platformShape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [BOX_EXTENT * 0.5, 0.5, BOX_EXTENT] });
            const sphereShape = api.createShape(physics, { type: ShapeType.SPHERE, radius: RADIUS });

            const spheres: { id: number; x: number }[] = [];
            for (let i = 0; i < N; i++) {
                const restitution = i / (N - 1); // 0 → 1
                const x = platformX(i);
                api.createRigidBody(physics, {
                    shape: platformShape,
                    motionType: MotionType.STATIC,
                    position: [x, PLATFORM_Y, 0],
                    restitution,
                    friction: 0.5,
                });
                const id = api.createRigidBody(physics, {
                    shape: sphereShape,
                    motionType: MotionType.DYNAMIC,
                    position: [x, DROP_Y, 0],
                    mass: 1,
                    restitution,
                    friction: 0.5,
                });
                spheres.push({ id, x });
            }

            return { spheres, elapsed: 0 };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            if (controls.restart <= 0) return;
            state.elapsed += dt;
            if (state.elapsed < controls.restart) return;
            state.elapsed = 0;
            for (const s of state.spheres) {
                api.setBodyTranslationRotation(physics, s.id, [s.x, DROP_Y, 0], [0, 0, 0, 1]);
                api.setBodyLinearVelocity(physics, s.id, [0, 0, 0]);
            }
        },
    });
