import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState, Quat, Vec3 } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Tumbler — a rotating kinematic drum that endlessly tumbles a pile of boxes.
// A classic Box2D/box3d-style sample (box3d ships it stubbed out), rebuilt here
// with our API: four kinematic walls form a square tube that we rotate about the
// view axis each frame, carrying the dynamic boxes around. Our first moving-
// kinematic-drives-dynamics scene — continuous and very watchable.
// ---------------------------------------------------------------------------

const S = 5; // drum half-size
const WALL_T = 0.3; // wall thickness
const WALL_D = 4; // wall depth (along the tube / view axis)

const DEFAULT_BOXES = 40;
const MAX_BOXES = 400;
const BOX_HALF = 0.35;

/** Rotation about the world Z axis. */
function quatZ(angle: number): Quat {
    return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
}

// Four walls of the square tube, as (localPos, localHalfExtents).
const WALLS: { pos: Vec3; half: Vec3 }[] = [
    { pos: [0, S, 0], half: [S + WALL_T, WALL_T, WALL_D] }, // top
    { pos: [0, -S, 0], half: [S + WALL_T, WALL_T, WALL_D] }, // bottom
    { pos: [-S, 0, 0], half: [WALL_T, S + WALL_T, WALL_D] }, // left
    { pos: [S, 0, 0], half: [WALL_T, S + WALL_T, WALL_D] }, // right
];

type ScenarioState = {
    wallIds: number[];
    boxIds: number[];
    boxShapeId: number;
    angle: number;
    builtBoxes: number;
};

type Controls = { boxes: number; speed: number };

function buildBoxes(physics: PhysicsState, boxShapeId: number, n: number): number[] {
    const boxes: number[] = [];
    const perRow = 8;
    for (let i = 0; i < n; i++) {
        const col = i % perRow;
        const row = Math.floor(i / perRow);
        boxes.push(
            api.createRigidBody(physics, {
                shape: boxShapeId,
                motionType: MotionType.DYNAMIC,
                position: [(col - perRow / 2) * (BOX_HALF * 2.2), 2 + row * (BOX_HALF * 2.2), 0],
                mass: 1,
                friction: 0.4,
                restitution: 0,
            }),
        );
    }
    return boxes;
}

export const createTumblerScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { boxes: DEFAULT_BOXES, speed: 0.35 };
            gui.title('Tumbler');
            gui.add(params, 'boxes', 0, MAX_BOXES, 1).name('boxes');
            gui.add(params, 'speed', -1.5, 1.5, 0.05).name('spin (rad/s)');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 0, 20);
            renderer.camera.lookAt(0, 0, 0);
            renderer.controls.target.set(0, 0, 0);
            renderer.controls.update();

            // Kinematic tube walls (positioned/rotated each frame in preUpdate).
            const wallIds: number[] = [];
            for (const w of WALLS) {
                const shape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: w.half });
                wallIds.push(api.createRigidBody(physics, { shape, motionType: MotionType.KINEMATIC, position: w.pos }));
            }

            const boxShapeId = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [BOX_HALF, BOX_HALF, BOX_HALF] });
            const boxIds = buildBoxes(physics, boxShapeId, DEFAULT_BOXES);

            return { wallIds, boxIds, boxShapeId, angle: 0, builtBoxes: DEFAULT_BOXES };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            if (controls.boxes !== state.builtBoxes) {
                for (const id of state.boxIds) api.removeRigidBody(physics, id);
                state.boxIds = buildBoxes(physics, state.boxShapeId, controls.boxes);
                state.builtBoxes = controls.boxes;
            }

            state.angle += controls.speed * dt;
            const c = Math.cos(state.angle);
            const s = Math.sin(state.angle);
            const q = quatZ(state.angle);
            for (let i = 0; i < state.wallIds.length; i++) {
                const p = WALLS[i]!.pos;
                // Rotate the wall's local position about Z into world space.
                api.setBodyTranslationRotation(physics, state.wallIds[i]!, [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]], q);
            }
        },
    });
