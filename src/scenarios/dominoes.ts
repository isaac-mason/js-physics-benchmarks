import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState, Quat, Vec3 } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Dominoes — port of PEEL's "Dominos" (CATEGORY_BEHAVIOR). 128 dominoes stood
// in a ring; the first is knocked over and the cascade runs around the circle.
// Watch for whether the fallen dominoes keep drifting, and how friction changes
// the toppling speed. PEEL starts it with an angular velocity, which our API
// doesn't expose, so we knock the first one with applyImpulse instead.
// ---------------------------------------------------------------------------

const NB = 128;
const CIRCLE_RADIUS = 10;
const HALF: [number, number, number] = [0.1, 0.5, 1.0]; // thin / radial / tall (see orientation below)
const KNOCK_IMPULSE = 4;
const DEFAULT_RESTART = 9;

/** Row-major 3x3 -> quaternion [x,y,z,w]. */
function mat3ToQuat(m00: number, m01: number, m02: number, m10: number, m11: number, m12: number, m20: number, m21: number, m22: number): Quat {
    const trace = m00 + m11 + m22;
    if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1);
        return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
    }
    if (m00 > m11 && m00 > m22) {
        const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
        return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
    }
    if (m11 > m22) {
        const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
        return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
    }
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

type Domino = { id: number; pos: Vec3; quat: Quat };

type ScenarioState = {
    dominoes: Domino[];
    knockDir: Vec3; // forward direction of the first domino
    knockPending: boolean;
    elapsed: number;
    builtFriction: number;
};

type Controls = { friction: number; restart: number };

function buildDominoes(physics: PhysicsState, friction: number): { dominoes: Domino[]; knockDir: Vec3 } {
    const shape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: HALF });
    const dominoes: Domino[] = [];
    let knockDir: Vec3 = [1, 0, 0];

    for (let i = 0; i < NB; i++) {
        const a = (i / NB) * Math.PI * 2;
        const aNext = ((i + 1) / NB) * Math.PI * 2;
        const px = Math.cos(a) * CIRCLE_RADIUS;
        const pz = Math.sin(a) * CIRCLE_RADIUS;
        // Forward = tangent (toward the next domino); thin axis points this way.
        let dx = Math.cos(aNext) * CIRCLE_RADIUS - px;
        let dz = Math.sin(aNext) * CIRCLE_RADIUS - pz;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;

        // Local axes: X (thin) -> forward, Z (tall) -> world up, Y -> up x forward.
        // Columns of the rotation are the world images of the local axes.
        const quat = mat3ToQuat(dx, dz, 0, 0, 0, 1, dz, -dx, 0);
        const pos: Vec3 = [px, HALF[2], pz];

        const id = api.createRigidBody(physics, {
            shape,
            motionType: MotionType.DYNAMIC,
            position: pos,
            quaternion: quat,
            mass: 1,
            friction,
            restitution: 0,
        });
        dominoes.push({ id, pos, quat });
        if (i === 0) knockDir = [dx, 0, dz];
    }

    return { dominoes, knockDir };
}

export const createDominoesScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { friction: 0.2, restart: DEFAULT_RESTART };
            gui.title('Dominoes');
            gui.add(params, 'friction', 0, 1, 0.05).name('friction');
            gui.add(params, 'restart', 0, 20, 0.5).name('restart (s)');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(14, 14, 14);
            renderer.camera.lookAt(0, 0, 0);
            renderer.controls.target.set(0, 0, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [50, 0.5, 50], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            const { dominoes, knockDir } = buildDominoes(physics, 0.2);
            return { dominoes, knockDir, knockPending: true, elapsed: 0, builtFriction: 0.2 };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            // Changing friction rebuilds the ring (friction is baked in per body).
            if (controls.friction !== state.builtFriction) {
                for (const d of state.dominoes) api.removeRigidBody(physics, d.id);
                const rebuilt = buildDominoes(physics, controls.friction);
                state.dominoes = rebuilt.dominoes;
                state.knockDir = rebuilt.knockDir;
                state.builtFriction = controls.friction;
                state.knockPending = true;
                state.elapsed = 0;
            }

            // Knock the first domino once the ring exists.
            if (state.knockPending) {
                state.knockPending = false;
                const d = state.dominoes[0]!;
                api.applyImpulse(physics, d.id, [state.knockDir[0] * KNOCK_IMPULSE, 0, state.knockDir[2] * KNOCK_IMPULSE]);
            }

            if (controls.restart <= 0) return;
            state.elapsed += dt;
            if (state.elapsed < controls.restart) return;
            state.elapsed = 0;
            for (const d of state.dominoes) {
                api.setBodyTranslationRotation(physics, d.id, d.pos, d.quat);
                api.setBodyLinearVelocity(physics, d.id, [0, 0, 0]);
            }
            state.knockPending = true;
        },
    });
