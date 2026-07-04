import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState, Vec3 } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Explosion — port of box3d's "Explosion" benchmark. A field of cylinder pucks
// sits in a walled arena and is periodically blown outward by a radial impulse.
// Uses the new applyImpulse primitive with box3d's b3World_Explode falloff:
//   impulse = impulsePerArea * area * scale * explosionScale, aimed outward,
//   with `scale` ramping linearly to 0 between `radius` and `radius + falloff`.
// (box3d also imparts angular velocity via the lever arm; our applyImpulse is
// central, so the pucks blast out without the extra tumble.)
// ---------------------------------------------------------------------------

const CYL_SIDES = 15; // 15 (not 16) to avoid manifold degeneracies, per box3d
const CYL_RADIUS = 0.5;
const CYL_HALF_H = 0.1;
const PUCK_AREA = 0.4; // representative projected area of a puck

const EXPLODE_CENTER: Vec3 = [0, -4, 0];
const EXPLODE_RADIUS = 16;
const EXPLODE_FALLOFF = 8;
const EXPLOSION_SCALE = 2;

const DEFAULT_N = 10; // (2N+1)^2 pucks
const MAX_N = 16;

function makeCylinder(sides: number, radius: number, halfH: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        pts.push(c * radius, -halfH, s * radius, c * radius, halfH, s * radius);
    }
    return pts;
}

type ScenarioState = {
    pucks: number[];
    puckShapeId: number;
    builtN: number;
    elapsed: number;
    firstDone: boolean;
};

type Controls = { n: number; magnitude: number; interval: number };

function buildPucks(physics: PhysicsState, puckShapeId: number, n: number): number[] {
    const pucks: number[] = [];
    for (let i = -n; i <= n; i++) {
        for (let k = -n; k <= n; k++) {
            pucks.push(
                api.createRigidBody(physics, {
                    shape: puckShapeId,
                    motionType: MotionType.DYNAMIC,
                    position: [i, CYL_HALF_H + 0.05, k],
                    mass: 1,
                    friction: 0.5,
                    restitution: 0,
                }),
            );
        }
    }
    return pucks;
}

const _pos: Vec3 = [0, 0, 0];

function explode(physics: PhysicsState, bodies: number[], impulsePerArea: number): void {
    for (const id of bodies) {
        api.getBodyPosition(_pos, physics, id);
        const dx = _pos[0] - EXPLODE_CENTER[0];
        const dy = _pos[1] - EXPLODE_CENTER[1];
        const dz = _pos[2] - EXPLODE_CENTER[2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist > EXPLODE_RADIUS + EXPLODE_FALLOFF) continue;
        let scale = 1;
        if (dist > EXPLODE_RADIUS && EXPLODE_FALLOFF > 0) {
            scale = Math.max(0, Math.min(1, (EXPLODE_RADIUS + EXPLODE_FALLOFF - dist) / EXPLODE_FALLOFF));
        }
        const inv = dist > 1e-4 ? 1 / dist : 0;
        const mag = impulsePerArea * PUCK_AREA * scale * EXPLOSION_SCALE;
        api.applyImpulse(physics, id, inv > 0 ? [dx * inv * mag, dy * inv * mag, dz * inv * mag] : [mag, 0, 0]);
    }
}

export const createExplosionScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { n: DEFAULT_N, magnitude: 1000, interval: 3 };
            gui.title('Explosion');
            gui.add(params, 'n', 1, MAX_N, 1).name('field radius');
            gui.add(params, 'magnitude', 0, 3000, 50).name('magnitude');
            gui.add(params, 'interval', 1, 8, 0.5).name('explode every (s)');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 24, 34);
            renderer.camera.lookAt(0, 0, 0);
            renderer.controls.target.set(0, 0, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [40, 0.5, 40], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            // Four arena walls (box3d uses hy = 1, span 20).
            const wallX = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [20, 1, 0.1] });
            const wallZ = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [0.1, 1, 20] });
            api.createRigidBody(physics, { shape: wallX, motionType: MotionType.STATIC, position: [0, 1, -20] });
            api.createRigidBody(physics, { shape: wallX, motionType: MotionType.STATIC, position: [0, 1, 20] });
            api.createRigidBody(physics, { shape: wallZ, motionType: MotionType.STATIC, position: [-20, 1, 0] });
            api.createRigidBody(physics, { shape: wallZ, motionType: MotionType.STATIC, position: [20, 1, 0] });

            const puckShapeId = api.createShape(physics, { type: ShapeType.CONVEX_HULL, points: makeCylinder(CYL_SIDES, CYL_RADIUS, CYL_HALF_H) });
            const pucks = buildPucks(physics, puckShapeId, DEFAULT_N);

            return { pucks, puckShapeId, builtN: DEFAULT_N, elapsed: 0, firstDone: false };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            if (controls.n !== state.builtN) {
                for (const id of state.pucks) api.removeRigidBody(physics, id);
                state.pucks = buildPucks(physics, state.puckShapeId, controls.n);
                state.builtN = controls.n;
                state.elapsed = 0;
                state.firstDone = false;
            }

            state.elapsed += dt;
            // Let them settle for a beat, then explode on the interval.
            if (!state.firstDone && state.elapsed >= 1) {
                state.firstDone = true;
                state.elapsed = 0;
                explode(physics, state.pucks, controls.magnitude);
            } else if (state.firstDone && state.elapsed >= controls.interval) {
                state.elapsed = 0;
                explode(physics, state.pucks, controls.magnitude);
            }
        },
    });
