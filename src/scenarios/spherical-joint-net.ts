import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Spherical Joint Net — port of PEEL's SphericalJointNet scene.
// 40×40 grid of unit spheres connected by ball-socket (point) joints.
// All spheres are dynamic; a large static sphere sits in the centre.
// ---------------------------------------------------------------------------

const NB_X = 40;
const NB_Y = 40;
const SCALE = 40.0;
const ALTITUDE = 30.0;
const SPHERE_RADIUS = 1.0;
const STATIC_SPHERE_RADIUS = 16.0;

// Horizontal spacing between grid columns

type NetData = {
    bodyIds: number[];
    jointIds: number[];
    sphereShapeId: number;
    staticSphereShapeId: number;
    staticSphereId: number;
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
    const staticSphereShapeId = api.createShape(physics, {
        type: ShapeType.SPHERE,
        radius: STATIC_SPHERE_RADIUS,
    });

    // Large static sphere in the centre
    const staticSphereId = api.createRigidBody(physics, {
        shape: staticSphereShapeId,
        motionType: MotionType.STATIC,
        position: [0, 10, 0],
    });

    // Flat array: handles[y * NB_X + x]
    const handles: number[] = [];
    for (let y = 0; y < NB_Y; y++) {
        for (let x = 0; x < NB_X; x++) {
            handles.push(api.createRigidBody(physics, {
                shape: sphereShapeId,
                motionType: MotionType.DYNAMIC,
                position: gridPos(x, y),
                mass: 1,
            }));
        }
    }

    const jointIds: number[] = [];

    // Horizontal joints (along X): anchor at right body's world position
    for (let y = 0; y < NB_Y; y++) {
        for (let x = 0; x < NB_X - 1; x++) {
            const a = handles[y * NB_X + x]!;
            const b = handles[y * NB_X + x + 1]!;
            // World anchor = bodyB.position (local pivot0 = CenterX*2 → same world point)
            const anchor = gridPos(x + 1, y);
            jointIds.push(api.createPointConstraint(physics, a, b, anchor));
        }
    }

    // Vertical joints (along Z): anchor at lower body's world position
    for (let x = 0; x < NB_X; x++) {
        for (let y = 0; y < NB_Y - 1; y++) {
            const a = handles[y * NB_X + x]!;
            const b = handles[(y + 1) * NB_X + x]!;
            const anchor = gridPos(x, y + 1);
            jointIds.push(api.createPointConstraint(physics, a, b, anchor));
        }
    }

    return {
        bodyIds: handles,
        jointIds,
        sphereShapeId,
        staticSphereShapeId,
        staticSphereId,
    };
}

function teardownNet(physics: PhysicsState, n: NetData): void {
    for (const id of n.jointIds) api.removeConstraint(physics, id);
    for (const id of n.bodyIds) api.removeRigidBody(physics, id);
    api.removeRigidBody(physics, n.staticSphereId);
    api.destroyShape(physics, n.sphereShapeId);
    api.destroyShape(physics, n.staticSphereShapeId);
}

export const createSphericalJointNetScenario = () =>
    createScenario<ScenarioState>({
        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(50, 50, 50);
            renderer.camera.lookAt(0, 15, 0);
            renderer.controls.target.set(0, 15, 0);
            renderer.controls.update();

            const net = buildNet(physics);
            return { net };
        },

        preUpdate: () => {},

        dispose: (state: ScenarioState, physics: PhysicsState): void => {
            teardownNet(physics, state.net);
        },
    });
