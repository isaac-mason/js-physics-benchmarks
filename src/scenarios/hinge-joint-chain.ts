import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Hinge Joint Chain — port of PEEL's HingeJointChain scene.
// NbRows chains of NbBoxes boxes suspended from a static anchor, each link
// connected by a Z-axis hinge. Tests long-chain hinge stability.
// ---------------------------------------------------------------------------

const NB_BOXES = 20;
const NB_ROWS = 20;
const HEX = 1.0;  // half-extent X
const HEY = 1.0;  // half-extent Y
const HEZ = 2.0;  // half-extent Z
const ALTITUDE = 40;
const HINGE_AXIS: [number, number, number] = [0, 0, 1];

type ChainData = {
    boxIds: number[];
    jointIds: number[];
    boxShapeId: number;
};

type ScenarioState = { chains: ChainData };

function buildChains(physics: PhysicsState): ChainData {
    const boxShapeId = api.createShape(physics, {
        type: ShapeType.BOX,
        halfExtents: [HEX, HEY, HEZ],
    });

    const boxIds: number[] = [];
    const jointIds: number[] = [];

    for (let row = 0; row < NB_ROWS; row++) {
        const z = row * HEZ * 4;
        const rowBoxIds: number[] = [];

        // First box is static (mass=0)
        rowBoxIds.push(api.createRigidBody(physics, {
            shape: boxShapeId,
            motionType: MotionType.STATIC,
            position: [0, ALTITUDE, z],
        }));

        // Remaining boxes are dynamic
        for (let j = 1; j < NB_BOXES; j++) {
            rowBoxIds.push(api.createRigidBody(physics, {
                shape: boxShapeId,
                motionType: MotionType.DYNAMIC,
                position: [j * HEX * 2, ALTITUDE, z],
                mass: 1,
            }));
        }

        // Hinges between adjacent boxes; anchor at right edge of box j
        for (let j = 0; j < NB_BOXES - 1; j++) {
            const ax = j * HEX * 2 + HEX;
            jointIds.push(api.createHingeConstraint(
                physics,
                rowBoxIds[j]!,
                rowBoxIds[j + 1]!,
                [ax, ALTITUDE, z],
                HINGE_AXIS,
            ));
        }

        boxIds.push(...rowBoxIds);
    }

    return { boxIds, jointIds, boxShapeId };
}

function teardownChains(physics: PhysicsState, c: ChainData): void {
    for (const id of c.jointIds) api.removeConstraint(physics, id);
    for (const id of c.boxIds) api.removeRigidBody(physics, id);
    api.destroyShape(physics, c.boxShapeId);
}

export const createHingeJointChainScenario = () =>
    createScenario<ScenarioState>({
        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            const midZ = (NB_ROWS - 1) * HEZ * 2;
            renderer.camera.position.set(20, 45, midZ + 60);
            renderer.camera.lookAt(20, ALTITUDE * 0.5, midZ);
            renderer.controls.target.set(20, ALTITUDE * 0.5, midZ);
            renderer.controls.update();

            const chains = buildChains(physics);
            return { chains };
        },

        preUpdate: () => {},

        dispose: (state: ScenarioState, physics: PhysicsState): void => {
            teardownChains(physics, state.chains);
        },
    });
