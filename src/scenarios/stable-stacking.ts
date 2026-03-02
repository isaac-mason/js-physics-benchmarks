import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';

const DEFAULT_HEIGHT = 5;
const CUBE_HALF = 0.5;
const CUBE_SIZE = CUBE_HALF * 2;
const GAP = 0.1;

type StackState = {
    allBodyIds: number[];
    height: number;
};

function buildStack(physics: PhysicsState, height: number): StackState {
    const floorShapeId = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [10, 0.5, 10] });
    const cubeShapeId = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [CUBE_HALF, CUBE_HALF, CUBE_HALF] });

    const allBodyIds: number[] = [];

    allBodyIds.push(
        api.createRigidBody(physics, {
            shape: floorShapeId,
            motionType: MotionType.STATIC,
            position: [0, -0.5, 0],
        }),
    );

    for (let i = 0; i < height; i++) {
        const y = i * (CUBE_SIZE + GAP) + CUBE_HALF;
        allBodyIds.push(
            api.createRigidBody(physics, {
                shape: cubeShapeId,
                motionType: MotionType.DYNAMIC,
                position: [0, y, 0],
                mass: 100,
            }),
        );
    }

    return { allBodyIds, height };
}

function teardownStack(physics: PhysicsState, state: StackState): void {
    for (const id of state.allBodyIds) {
        api.removeRigidBody(physics, id);
    }
}

export const createStableStackingScenario = () => {
    return createScenario<StackState, { height: number }>({
        controls: (gui) => {
            const params = { height: DEFAULT_HEIGHT };
            gui.title('Stacking Stability');
            gui.add(params, 'height', 1, 50, 1).name('height');
            return params;
        },

        init: (physics: PhysicsState) => {
            api.setGravity(physics, 0, -9.81, 0);
            return buildStack(physics, DEFAULT_HEIGHT);
        },

        preUpdate: (state, physics, _renderer, controls, _dt) => {
            if (controls.height !== state.height) {
                teardownStack(physics, state);
                const next = buildStack(physics, controls.height);
                state.allBodyIds = next.allBodyIds;
                state.height = next.height;
            }
        },
    });
};
