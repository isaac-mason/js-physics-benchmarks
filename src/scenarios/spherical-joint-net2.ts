import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Spherical Joint Net 2 — port of PEEL's SphericalJointNet2 scene.
// Same 40×40 joint net as SphericalJointNet but at altitude 0 with the four
// corners pinned static, and random heavy bodies dropped on top.
// ---------------------------------------------------------------------------

const NB_X = 40;
const NB_Y = 40;
const SCALE = 40.0;
const ALTITUDE = 0.0;
const SPHERE_RADIUS = 1.0;

// Random bodies dropped on the net
const NB_LAYERS = 2;
const DROP_NB_X = 4;
const DROP_NB_Y = 4;
const DROP_RADIUS = 3.0;
const DROP_HE = 3.0;       // box half-extent
const DROP_BOX_DEPTH = 20.0;
const DROP_BOX_SIDE = 20.0;

// Simple seeded PRNG (LCG) matching deterministic scene layout
class Rng {
    private s: number;
    constructor(seed: number) { this.s = seed >>> 0; }
    next(): number {
        this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
        return this.s;
    }
    float(): number { return (this.next() / 0xffffffff) * 2 - 1; }
    uint3(): number { return this.next() % 3; }
}


type NetData = {
    bodyIds: number[];
    jointIds: number[];
    dropIds: number[];
    sphereShapeId: number;
    dropSphereShapeId: number;
    dropBoxShapeId: number;
};

type ScenarioState = { net: NetData };

function gridPos(x: number, y: number): [number, number, number] {
    const cx = 2 * (x / (NB_X - 1) - 0.5) * SCALE;
    const cz = 2 * (y / (NB_Y - 1) - 0.5) * SCALE;
    return [cx, ALTITUDE, cz];
}

function buildNet(physics: PhysicsState): NetData {
    const sphereShapeId = api.createShape(physics, {
        type: ShapeType.SPHERE,
        radius: SPHERE_RADIUS,
    });
    const dropSphereShapeId = api.createShape(physics, {
        type: ShapeType.SPHERE,
        radius: DROP_RADIUS,
    });
    const dropBoxShapeId = api.createShape(physics, {
        type: ShapeType.BOX,
        halfExtents: [DROP_HE, DROP_HE, DROP_HE],
    });

    // Grid — corner nodes pinned static
    const handles: number[] = [];
    for (let y = 0; y < NB_Y; y++) {
        for (let x = 0; x < NB_X; x++) {
            const corner =
                (x === 0 && y === 0) ||
                (x === 0 && y === NB_Y - 1) ||
                (x === NB_X - 1 && y === 0) ||
                (x === NB_X - 1 && y === NB_Y - 1);
            const mass = corner ? 0 : 1;
            handles.push(api.createRigidBody(physics, {
                shape: sphereShapeId,
                motionType: corner ? MotionType.STATIC : MotionType.DYNAMIC,
                position: gridPos(x, y),
                mass,
            }));
        }
    }

    const jointIds: number[] = [];

    // Horizontal joints
    for (let y = 0; y < NB_Y; y++) {
        for (let x = 0; x < NB_X - 1; x++) {
            const a = handles[y * NB_X + x]!;
            const b = handles[y * NB_X + x + 1]!;
            jointIds.push(api.createPointConstraint(physics, a, b, gridPos(x + 1, y)));
        }
    }

    // Vertical joints
    for (let x = 0; x < NB_X; x++) {
        for (let y = 0; y < NB_Y - 1; y++) {
            const a = handles[y * NB_X + x]!;
            const b = handles[(y + 1) * NB_X + x]!;
            jointIds.push(api.createPointConstraint(physics, a, b, gridPos(x, y + 1)));
        }
    }

    // Random bodies dropped on the net
    const dropIds: number[] = [];
    const rng = new Rng(42);
    let yy = 10.0;
    const areaScale = DROP_BOX_DEPTH - DROP_RADIUS - DROP_BOX_SIDE * 2; // = -23

    for (let k = 0; k < NB_LAYERS; k++) {
        for (let y = 0; y < DROP_NB_Y; y++) {
            const cy = 2 * (y / (DROP_NB_Y - 1) - 0.5);
            for (let x = 0; x < DROP_NB_X; x++) {
                const cx = 2 * (x / (DROP_NB_X - 1) - 0.5);
                const rx = rng.float();
                const ry = rng.float();
                const shapeIndex = rng.uint3();
                const shape = shapeIndex === 0 ? dropSphereShapeId : dropBoxShapeId;
                dropIds.push(api.createRigidBody(physics, {
                    shape,
                    motionType: MotionType.DYNAMIC,
                    position: [rx + cx * areaScale, yy, ry + cy * areaScale],
                    mass: 1,
                }));
            }
        }
        yy += DROP_HE * 5;
    }

    return { bodyIds: handles, jointIds, dropIds, sphereShapeId, dropSphereShapeId, dropBoxShapeId };
}

function teardownNet(physics: PhysicsState, n: NetData): void {
    for (const id of n.jointIds) api.removeConstraint(physics, id);
    for (const id of n.bodyIds) api.removeRigidBody(physics, id);
    for (const id of n.dropIds) api.removeRigidBody(physics, id);
    api.destroyShape(physics, n.sphereShapeId);
    api.destroyShape(physics, n.dropSphereShapeId);
    api.destroyShape(physics, n.dropBoxShapeId);
}

export const createSphericalJointNet2Scenario = () =>
    createScenario<ScenarioState>({
        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(60, 36, 60);
            renderer.camera.lookAt(0, 0, 0);
            renderer.controls.target.set(0, 0, 0);
            renderer.controls.update();

            const net = buildNet(physics);
            return { net };
        },

        preUpdate: () => {},

        dispose: (state: ScenarioState, physics: PhysicsState): void => {
            teardownNet(physics, state.net);
        },
    });
