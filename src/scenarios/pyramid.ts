import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';

const DEFAULT_HEIGHT = 6;
const BOX_SIZE = 1.0;
const BOX_HALF = BOX_SIZE * 0.5;
const WRECKING_BALL_SPAWN_HEIGHT_ABOVE = 14;

type PyramidState = {
    allBodyIds: number[];
    height: number;
};

function buildPyramid(physics: PhysicsState, height: number): PyramidState {
    const floorShapeId = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [50, 0.5, 50] });
    const boxShapeId = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [BOX_HALF, BOX_HALF, BOX_HALF] });
    const ballShapeId = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [1, 1, 1] });

    const allBodyIds: number[] = [];

    allBodyIds.push(
        api.createRigidBody(physics, {
            shape: floorShapeId,
            motionType: MotionType.STATIC,
            position: [0, -0.5, 0],
            restitution: 0.3,
        }),
    );

    for (let y = 0; y < height; y++) {
        const baseOffset = height - 1 - y;
        for (let x = -baseOffset; x <= baseOffset; x++) {
            for (let z = -baseOffset; z <= baseOffset; z++) {
                allBodyIds.push(
                    api.createRigidBody(physics, {
                        shape: boxShapeId,
                        motionType: MotionType.DYNAMIC,
                        position: [x * BOX_SIZE, y * BOX_SIZE + BOX_HALF, z * BOX_SIZE],
                        mass: 1,
                        friction: 0.5,
                        restitution: 0,
                    }),
                );
            }
        }
    }

    const spawnY = height * BOX_SIZE + WRECKING_BALL_SPAWN_HEIGHT_ABOVE;
    allBodyIds.push(
        api.createRigidBody(physics, {
            shape: ballShapeId,
            motionType: MotionType.DYNAMIC,
            position: [0, spawnY, 0],
            mass: 10,
            restitution: 0.3,
            friction: 0.5,
        }),
    );

    return { allBodyIds, height };
}

function teardownPyramid(physics: PhysicsState, state: PyramidState): void {
    for (const id of state.allBodyIds) {
        api.removeRigidBody(physics, id);
    }
}

export const createPyramidScenario = () => {
    return createScenario<PyramidState, { height: number }>({
        controls: (gui) => {
            const params = { height: DEFAULT_HEIGHT };
            gui.title('Pyramid');
            gui.add(params, 'height', 1, 20, 1).name('height');
            return params;
        },

        init: (physics: PhysicsState) => {
            api.setGravity(physics, 0, -9.81, 0);
            return buildPyramid(physics, DEFAULT_HEIGHT);
        },

        preUpdate: (state, physics, _renderer, controls, _dt) => {
            if (controls.height !== state.height) {
                teardownPyramid(physics, state);
                const next = buildPyramid(physics, controls.height);
                state.allBodyIds = next.allBodyIds;
                state.height = next.height;
            }
        },
    });
};
