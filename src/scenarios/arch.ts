import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Arch — faithful port of box3d's "Arch" stacking sample. A self-supporting
// masonry arch of wedge-shaped (voussoir) convex blocks, topped with a stack of
// load boxes. The blocks hold each other up purely through compression, so it's
// a hard test of solver stability under a high-friction, statically-indeterminate
// structure — weak solvers let it sag or collapse.
// ---------------------------------------------------------------------------

const SCALE = 0.25;
const HALF_DEPTH = 0.5;
const DENSITY = 200;

// Inner (ps1) and outer (ps2) arch curves, from box3d, before scaling.
const PS1: [number, number][] = [
    [16.0, 0.0], [14.93803712795643, 5.133601056842984], [13.79871746027416, 10.24928069555078],
    [12.56252963284711, 15.34107019122473], [11.20040987372525, 20.39856541571217], [9.66521217819836, 25.40369899225096],
    [7.87179930638133, 30.3179337000085], [5.635199558196225, 35.03820717801641], [2.405937953536585, 39.09554102558315],
];
const PS2: [number, number][] = [
    [24.0, 0.0], [22.33619528222415, 6.02299846205841], [20.54936888969905, 12.00964361211476],
    [18.60854610798073, 17.9470321677465], [16.46769273811807, 23.81367936585418], [14.05325025774858, 29.57079353071012],
    [11.23551045834022, 35.13775818285372], [7.752568160730571, 40.30450679009583], [3.016931552701656, 44.28891593799322],
];

/** |shoelace| area of a 2D quad, for the block cross-section. */
function quadArea(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): number {
    return (
        0.5 *
        Math.abs(
            a[0] * b[1] - b[0] * a[1] + (b[0] * c[1] - c[0] * b[1]) + (c[0] * d[1] - d[0] * c[1]) + (d[0] * a[1] - a[0] * d[1]),
        )
    );
}

/** A voussoir block: a quad (in xy) extruded along ±z into an 8-point convex hull. */
function blockPoints(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): number[] {
    const quad = [a, b, c, d];
    const pts: number[] = [];
    for (const [x, y] of quad) pts.push(x, y, -HALF_DEPTH);
    for (const [x, y] of quad) pts.push(x, y, HALF_DEPTH);
    return pts;
}

export const createArchScenario = () =>
    createScenario<null, void>({
        init: (physics: PhysicsState, renderer: Renderer): null => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 8, 22);
            renderer.camera.lookAt(0, 5, 0);
            renderer.controls.target.set(0, 5, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [40, 0.5, 40], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            const ps1 = PS1.map(([x, y]): [number, number] => [x * SCALE, y * SCALE]);
            const ps2 = PS2.map(([x, y]): [number, number] => [x * SCALE, y * SCALE]);

            const addBlock = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]): void => {
                const shape = api.createShape(physics, { type: ShapeType.CONVEX_HULL, points: blockPoints(a, b, c, d) });
                const mass = DENSITY * quadArea(a, b, c, d) * (2 * HALF_DEPTH);
                api.createRigidBody(physics, { shape, motionType: MotionType.DYNAMIC, position: [0, 0, 0], mass, friction: 0.6, restitution: 0 });
            };

            // Right half.
            for (let i = 0; i < 8; i++) addBlock(ps1[i]!, ps2[i]!, ps2[i + 1]!, ps1[i + 1]!);
            // Left half (mirror across x).
            const mx = ([x, y]: [number, number]): [number, number] => [-x, y];
            for (let i = 0; i < 8; i++) addBlock(mx(ps2[i]!), mx(ps1[i]!), mx(ps1[i + 1]!), mx(ps2[i + 1]!));
            // Keystone spanning both halves at the apex.
            addBlock(ps1[8]!, ps2[8]!, mx(ps2[8]!), mx(ps1[8]!));

            // Load: a stack of boxes resting on the crown.
            const boxShape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [2, 0.5, HALF_DEPTH] });
            const boxMass = DENSITY * (2 * 2) * (2 * 0.5) * (2 * HALF_DEPTH);
            const crownY = ps2[8]![1];
            for (let i = 0; i < 4; i++) {
                api.createRigidBody(physics, {
                    shape: boxShape,
                    motionType: MotionType.DYNAMIC,
                    position: [0, 0.5 + crownY + i, 0],
                    mass: boxMass,
                    friction: 0.6,
                    restitution: 0,
                });
            }

            return null;
        },

        preUpdate: (): void => {},
    });
