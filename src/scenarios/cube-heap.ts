import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

function randomInRange(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

const SPAWN_HEIGHT = 10;
const SPAWN_AREA = 2.5;

type ScenarioState = {
    bodyHandles: number[];
    cubeShapeId: number;
    index: number;
};

type Controls = {
    n: number;
};

function spawnCube(physics: PhysicsState, cubeShapeId: number): number {
    return api.createRigidBody(physics, {
        shape: cubeShapeId,
        motionType: MotionType.DYNAMIC,
        position: [
            randomInRange(-SPAWN_AREA, SPAWN_AREA),
            randomInRange(0, SPAWN_HEIGHT),
            randomInRange(-SPAWN_AREA, SPAWN_AREA),
        ],
        mass: 1,
        friction: 0.5,
        restitution: 0,
    });
}

export const createCubeHeapScenario = () => {
    return createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { n: 200 };
            gui.title('Cube Heap');
            gui.add(params, 'n', 0, 1000, 1).name('cubes');
            return params;
        },

        init: (physics: PhysicsState, _renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            const floorShape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [50, 0.5, 50], convexRadius: 0.05 });
            api.createRigidBody(physics, {
                shape: floorShape,
                motionType: MotionType.STATIC,
                position: [0, -0.5, 0],
            });

            const cubeShapeId = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [0.25, 0.25, 0.25] });
            const bodyHandles: number[] = [];

            return { bodyHandles, cubeShapeId, index: 0 };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, _dt: number): void => {
            // Add or remove cubes to match target n
            const target = controls.n;
            while (state.bodyHandles.length < target) {
                state.bodyHandles.push(spawnCube(physics, state.cubeShapeId));
            }
            while (state.bodyHandles.length > target) {
                const id = state.bodyHandles.pop()!;
                api.removeRigidBody(physics, id);
            }

            if (state.bodyHandles.length === 0) return;

            // Respawn one cube per step to keep them raining in
            const handle = state.bodyHandles[state.index % state.bodyHandles.length]!;
            const newX = randomInRange(-SPAWN_AREA, SPAWN_AREA);
            const newZ = randomInRange(-SPAWN_AREA, SPAWN_AREA);
            api.setBodyTranslationRotation(physics, handle, [newX, SPAWN_HEIGHT, newZ], [0, 0, 0, 1]);
            state.index = (state.index + 1) % state.bodyHandles.length;
        },
    });
};
