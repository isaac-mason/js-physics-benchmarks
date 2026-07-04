import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState, Quat, Vec3 } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Initial Penetration — faithful port of PEEL's "InitialPenetration"
// (CATEGORY_BEHAVIOR). Bodies are created in an overlapping state; a robust
// engine depenetrates them gently, a weak one lets them explode apart. Tests
// the depenetration / max-depenetration-velocity behaviour.
// ---------------------------------------------------------------------------

const BOX_EXTENT = 3; // half-extent -> 6-unit boxes
const NB_STACKED = 4;
const BOX_POS_Y = BOX_EXTENT;
const DEFAULT_RESTART = 5;

type Body = { id: number; pos: Vec3; quat: Quat };

type ScenarioState = {
    bodies: Body[];
    elapsed: number;
};

type Controls = { restart: number };

export const createInitialPenetrationScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { restart: DEFAULT_RESTART };
            gui.title('Initial Penetration');
            gui.add(params, 'restart', 0, 12, 0.5).name('restart (s)');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(9, 21, 40);
            renderer.camera.lookAt(2, 6, 0);
            renderer.controls.target.set(2, 6, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [80, 0.5, 80], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            const boxShape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [BOX_EXTENT, BOX_EXTENT, BOX_EXTENT] });
            const sphereShape = api.createShape(physics, { type: ShapeType.SPHERE, radius: 4 });

            const bodies: Body[] = [];
            const add = (shape: number, pos: Vec3, mass = 1): void => {
                const id = api.createRigidBody(physics, { shape, motionType: MotionType.DYNAMIC, position: pos, mass, friction: 0.5, restitution: 0 });
                bodies.push({ id, pos: [pos[0], pos[1], pos[2]], quat: [0, 0, 0, 1] });
            };

            // A vertical column of boxes spaced closer than their size -> they overlap.
            for (let i = 0; i < NB_STACKED; i++) {
                add(boxShape, [0, BOX_POS_Y + i * BOX_EXTENT * 1.5, 0]);
            }
            // Two boxes half-buried in the ground (one heavy).
            add(boxShape, [10, BOX_POS_Y * 0.5, 0]);
            add(boxShape, [20, BOX_POS_Y * 0.5, 0], 100);
            // A big sphere sunk into the ground.
            add(sphereShape, [-15, 0, 0]);

            return { bodies, elapsed: 0 };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            if (controls.restart <= 0) return;
            state.elapsed += dt;
            if (state.elapsed < controls.restart) return;
            state.elapsed = 0;
            for (const b of state.bodies) {
                api.setBodyTranslationRotation(physics, b.id, b.pos, b.quat);
                api.setBodyLinearVelocity(physics, b.id, [0, 0, 0]);
            }
        },
    });
