import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState, Quat } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Catenary Bridge — port of PEEL's CatenaryBridge scene.
// NbRows catenary bridge chains, each made of NbBoxes planks tilted to follow
// a catenary (hyperbolic cosine) curve. End planks are static; the rest hang
// freely. A sphere is dropped on each bridge.
// ---------------------------------------------------------------------------

const NB_BOXES = 20;
const NB_ROWS = 10;
const HEX = 1.0;   // plank half-extent along bridge (X)
const HEY = 0.1;   // plank half-height
const HEZ = 2.0;   // plank half-depth
const ALTITUDE = 40;
const CATENARY_COEFF = 20.0;
const SPHERE_RADIUS = 1.0;

function quatRotZ(alpha: number): Quat {
    return [0, 0, Math.sin(alpha / 2), Math.cos(alpha / 2)];
}

// Precompute catenary slope values
function buildDy(): number[] {
    const dy: number[] = [];
    for (let i = 0; i < NB_BOXES + 1; i++) {
        const f0 = i - NB_BOXES / 2;
        const f1 = i + 1 - NB_BOXES / 2;
        dy.push(CATENARY_COEFF * (Math.cosh(f1 / CATENARY_COEFF) - Math.cosh(f0 / CATENARY_COEFF)));
    }
    return dy;
}

type BridgeData = {
    bodyIds: number[];
    jointIds: number[];
    plankShapeId: number;
    sphereShapeId: number;
};

type ScenarioState = { bridge: BridgeData };

function buildBridges(physics: PhysicsState): BridgeData {
    const plankShapeId = api.createShape(physics, {
        type: ShapeType.BOX,
        halfExtents: [HEX, HEY, HEZ],
    });
    const sphereShapeId = api.createShape(physics, {
        type: ShapeType.SPHERE,
        radius: SPHERE_RADIUS,
    });

    const bodyIds: number[] = [];
    const jointIds: number[] = [];
    const dy = buildDy();

    for (let row = 0; row < NB_ROWS; row++) {
        const rowCoeff = row / (NB_ROWS - 1);
        const curveCoeff = 0.5 + rowCoeff * 2.5;
        const z = row * HEZ * 4;

        // Drop sphere at start of row
        bodyIds.push(api.createRigidBody(physics, {
            shape: sphereShapeId,
            motionType: MotionType.DYNAMIC,
            position: [0, ALTITUDE + SPHERE_RADIUS * 3, z],
            mass: 10,
        }));

        // Build planks with catenary chaining
        const plankIds: number[] = [];
        const rightEdges: [number, number, number][] = [];

        let px = 0, py = ALTITUDE, pz = z; // running position (Pos in PEEL)
        let rightX = 0, rightY = 0;        // RightPos XY from previous plank

        for (let i = 0; i < NB_BOXES; i++) {
            const alpha = Math.atan(dy[i]!);
            const angle = alpha * curveCoeff;
            const rx = Math.cos(angle);
            const ry = Math.sin(angle);

            // LeftPos = Pos - R * HEX
            const leftX = px - rx * HEX;
            const leftY = py - ry * HEX;

            if (i > 0) {
                // Shift Pos so LeftPos aligns with previous RightPos
                px += rightX - leftX;
                py += rightY - leftY;
            }

            const mass = (i === 0 || i === NB_BOXES - 1) ? 0 : 1;
            plankIds.push(api.createRigidBody(physics, {
                shape: plankShapeId,
                motionType: mass === 0 ? MotionType.STATIC : MotionType.DYNAMIC,
                position: [px, py, pz],
                quaternion: quatRotZ(angle),
                mass,
            }));

            // Track right edge of this plank as the hinge anchor
            rightX = px + rx * HEX;
            rightY = py + ry * HEX;
            rightEdges.push([rightX, rightY, pz]);

            // Advance Pos
            px += rx * 2 * HEX;
            py += ry * 2 * HEX;
        }

        bodyIds.push(...plankIds);

        // Hinges between adjacent planks at right-edge world positions
        for (let i = 0; i < NB_BOXES - 1; i++) {
            jointIds.push(api.createHingeConstraint(
                physics,
                plankIds[i]!,
                plankIds[i + 1]!,
                rightEdges[i]!,
                [0, 0, 1],
            ));
        }
    }

    return { bodyIds, jointIds, plankShapeId, sphereShapeId };
}

function teardownBridges(physics: PhysicsState, b: BridgeData): void {
    for (const id of b.jointIds) api.removeConstraint(physics, id);
    for (const id of b.bodyIds) api.removeRigidBody(physics, id);
    api.destroyShape(physics, b.plankShapeId);
    api.destroyShape(physics, b.sphereShapeId);
}

export const createCatenaryBridgeScenario = () =>
    createScenario<ScenarioState>({
        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            const midZ = (NB_ROWS - 1) * HEZ * 2;
            renderer.camera.position.set(10, 45, midZ + 100);
            renderer.camera.lookAt(10, ALTITUDE * 0.4, midZ);
            renderer.controls.target.set(10, ALTITUDE * 0.4, midZ);
            renderer.controls.update();

            const bridge = buildBridges(physics);
            return { bridge };
        },

        preUpdate: () => {},

        dispose: (state: ScenarioState, physics: PhysicsState): void => {
            teardownBridges(physics, state.bridge);
        },
    });
