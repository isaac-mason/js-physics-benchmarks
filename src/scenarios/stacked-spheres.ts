import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState, Vec3 } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Stacked Spheres — faithful port of PEEL's "StackedSpheres" (CATEGORY_BEHAVIOR).
// Ten spheres dropped in a perfect vertical column. Spheres resist stacking
// (a single contact point, prone to rolling), so this stresses solver stability
// — some engines hold the tower, others let it topple or jitter apart.
// ---------------------------------------------------------------------------

const RADIUS = 1;
const COUNT = 10;
const DEFAULT_RESTART = 6;

function spherePos(i: number): Vec3 {
    // PEEL: y = 2R + (2R + 1) * i  — a 1-unit gap between spheres so they drop in.
    return [0, RADIUS * 2 + (RADIUS * 2 + 1) * i, 0];
}

type ScenarioState = {
    handles: number[];
    elapsed: number;
};

type Controls = { restart: number };

export const createStackedSpheresScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { restart: DEFAULT_RESTART };
            gui.title('Stacked Spheres');
            gui.add(params, 'restart', 0, 12, 0.5).name('restart (s)');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(16, 16, 16);
            renderer.camera.lookAt(0, 12, 0);
            renderer.controls.target.set(0, 12, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [50, 0.5, 50], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            const sphereShape = api.createShape(physics, { type: ShapeType.SPHERE, radius: RADIUS });
            const handles: number[] = [];
            for (let i = 0; i < COUNT; i++) {
                handles.push(
                    api.createRigidBody(physics, {
                        shape: sphereShape,
                        motionType: MotionType.DYNAMIC,
                        position: spherePos(i),
                        mass: 1,
                        friction: 0.5,
                        restitution: 0,
                    }),
                );
            }

            return { handles, elapsed: 0 };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            if (controls.restart <= 0) return;
            state.elapsed += dt;
            if (state.elapsed < controls.restart) return;
            state.elapsed = 0;
            for (let i = 0; i < state.handles.length; i++) {
                api.setBodyTranslationRotation(physics, state.handles[i]!, spherePos(i), [0, 0, 0, 1]);
                api.setBodyLinearVelocity(physics, state.handles[i]!, [0, 0, 0]);
            }
        },
    });
