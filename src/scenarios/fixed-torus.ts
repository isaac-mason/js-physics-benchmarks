import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState, Quat } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Fixed Torus — a ring of rectangular blocks joined by fixed joints, forming a
// rigid hoop. The ring is dropped from above and impacts the ground, testing
// whether fixed joints maintain shape under impact and contact. With a tight
// constraint solver the ring should bounce and roll intact; with a weak one the
// joints drift and the ring distorts.
// ---------------------------------------------------------------------------

const RING_RADIUS = 5;
// BOX_HX is computed per-build from the chord length so boxes never overlap,
// regardless of count. See buildTorus below.
const BOX_HY = 0.18;   // half-height (ring thickness)
const BOX_HZ = 0.45;   // half-depth
const DROP_HEIGHT = 8;
const DEFAULT_COUNT = 16;
const DEFAULT_RESTART = 10;

type TorusData = {
    n: number;
    boxIds: number[];
    jointIds: number[];
    boxShapeId: number;
};

type ScenarioState = {
    torus: TorusData;
    elapsed: number;
};

type Controls = { count: number; restart: number };

/** Quaternion [x,y,z,w] for a horizontal ring box at angle θ.
 *  Rotates local X (long axis) to face the ring tangent in the XZ plane. */
function ringBoxQuat(theta: number): Quat {
    // Tangent direction: (-sinθ, 0, cosθ). To map [1,0,0]→tangent we rotate
    // around Y by -(θ + π/2).
    const half = (theta + Math.PI / 2) / 2;
    return [0, -Math.sin(half), 0, Math.cos(half)];
}

function buildTorus(physics: PhysicsState, n: number): TorusData {
    // Half-chord between adjacent box centers; cap at 0.85 for aesthetic sizing
    const boxHx = Math.min(0.85, RING_RADIUS * Math.sin(Math.PI / n) * 0.9);
    const boxShapeId = api.createShape(physics, {
        type: ShapeType.BOX,
        halfExtents: [boxHx, BOX_HY, BOX_HZ],
        convexRadius: 0.02,
    });

    const boxIds: number[] = [];
    for (let i = 0; i < n; i++) {
        const theta = (i / n) * Math.PI * 2;
        const x = Math.cos(theta) * RING_RADIUS;
        const z = Math.sin(theta) * RING_RADIUS;
        boxIds.push(api.createRigidBody(physics, {
            shape: boxShapeId,
            motionType: MotionType.DYNAMIC,
            position: [x, DROP_HEIGHT, z],
            quaternion: ringBoxQuat(theta),
            mass: 1,
            friction: 0.4,
            restitution: 0.1,
        }));
    }

    // Fixed joints between adjacent boxes (and last→first to close the ring)
    const jointIds: number[] = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        jointIds.push(api.createFixedConstraint(physics, boxIds[i]!, boxIds[j]!));
    }

    return { n, boxIds, jointIds, boxShapeId };
}

function teardownTorus(physics: PhysicsState, t: TorusData): void {
    for (const jId of t.jointIds) api.removeConstraint(physics, jId);
    for (const bId of t.boxIds) api.removeRigidBody(physics, bId);
    api.destroyShape(physics, t.boxShapeId);
}

export const createFixedTorusScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { count: DEFAULT_COUNT, restart: DEFAULT_RESTART };
            gui.title('Fixed Torus');
            gui.add(params, 'count', 6, 32, 1).name('ring count');
            gui.add(params, 'restart', 0, 30, 1).name('restart (s)');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 12, 18);
            renderer.camera.lookAt(0, 4, 0);
            renderer.controls.target.set(0, 4, 0);
            renderer.controls.update();

            const groundShape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [20, 0.5, 20] });
            api.createRigidBody(physics, { shape: groundShape, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            const torus = buildTorus(physics, DEFAULT_COUNT);
            return { torus, elapsed: 0 };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            if (controls.count !== state.torus.n) {
                teardownTorus(physics, state.torus);
                state.torus = buildTorus(physics, controls.count);
                state.elapsed = 0;
                return;
            }

            if (controls.restart <= 0) return;
            state.elapsed += dt;
            if (state.elapsed < controls.restart) return;
            state.elapsed = 0;
            teardownTorus(physics, state.torus);
            state.torus = buildTorus(physics, controls.count);
        },
    });
