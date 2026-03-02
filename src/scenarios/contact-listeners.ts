import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState, Vec3, Quat } from '../api';

const DEFAULT_GRID_SIZE = 30;
const PLATFORM_SPACING = 3;
const PLATFORM_HALF_EXTENTS: [number, number, number] = [0.75, 0.1, 0.75];
const CUBE_HALF_EXTENTS: [number, number, number] = [0.35, 0.35, 0.35];
const SPAWN_Y = 6;
const WAVE_Y_PER_CELL = 0.05;

const _quatIdentity: Quat = [0, 0, 0, 1];
const _zero: Vec3 = [0, 0, 0];

function platformPosition(col: number, row: number, gridSize: number): Vec3 {
    const halfGrid = ((gridSize - 1) * PLATFORM_SPACING) / 2;
    return [col * PLATFORM_SPACING - halfGrid, 0, row * PLATFORM_SPACING - halfGrid];
}

function cubeSpawnPosition(platformPos: Vec3, cellIndex: number, totalCells: number): Vec3 {
    const waveOffset = (cellIndex % totalCells) * WAVE_Y_PER_CELL;
    return [platformPos[0], platformPos[1] + SPAWN_Y + waveOffset, platformPos[2]];
}

type GridState = {
    spawnPositions: Map<number, Vec3>;
    pendingRespawns: Set<number>;
    staticToDynamic: Map<number, number>;
    allBodyIds: number[];
    gridSize: number;
};

function buildGrid(physics: PhysicsState, gridSize: number): GridState {
    const totalCells = gridSize * gridSize;
    const platformShape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: PLATFORM_HALF_EXTENTS });
    const cubeShape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: CUBE_HALF_EXTENTS });

    const spawnPositions = new Map<number, Vec3>();
    const staticToDynamic = new Map<number, number>();
    const pendingRespawns = new Set<number>();
    const allBodyIds: number[] = [];

    for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
            const cellIndex = row * gridSize + col;
            const platPos = platformPosition(col, row, gridSize);
            const spawnPos = cubeSpawnPosition(platPos, cellIndex, totalCells);

            const platformId = api.createRigidBody(physics, {
                shape: platformShape,
                motionType: MotionType.STATIC,
                position: platPos,
            });

            const cubeId = api.createRigidBody(physics, {
                shape: cubeShape,
                motionType: MotionType.DYNAMIC,
                position: [spawnPos[0], spawnPos[1], spawnPos[2]],
                mass: 1,
                friction: 0.5,
                restitution: 0.1,
            });

            spawnPositions.set(cubeId, [spawnPos[0], spawnPos[1], spawnPos[2]]);
            staticToDynamic.set(platformId, cubeId);
            allBodyIds.push(platformId, cubeId);
        }
    }

    api.onContactAdded(physics, (bodyIdA, bodyIdB) => {
        const dynFromA = staticToDynamic.get(bodyIdB) === bodyIdA ? bodyIdA : undefined;
        const dynFromB = staticToDynamic.get(bodyIdA) === bodyIdB ? bodyIdB : undefined;
        const dynamicId = dynFromA ?? dynFromB;
        if (dynamicId !== undefined) {
            pendingRespawns.add(dynamicId);
        }
    });

    return { spawnPositions, pendingRespawns, staticToDynamic, allBodyIds, gridSize };
}

function teardownGrid(physics: PhysicsState, grid: GridState): void {
    for (const id of grid.allBodyIds) {
        api.removeRigidBody(physics, id);
    }
    physics.contactCallback = null;
}

type ScenarioState = {
    grid: GridState;
};

export const createContactListenersScenario = () => {
    return createScenario<ScenarioState, { gridSize: number }>({
        controls: (gui) => {
            const params = { gridSize: DEFAULT_GRID_SIZE };
            gui.title('Contact Listeners');
            gui.add(params, 'gridSize', 1, 50, 1).name('grid size');
            return params;
        },

        init: (physics: PhysicsState) => {
            api.setGravity(physics, 0, -9.81, 0);
            return { grid: buildGrid(physics, DEFAULT_GRID_SIZE) };
        },

        preUpdate: (state, physics: PhysicsState, _renderer, controls, _dt: number): void => {
            if (controls.gridSize !== state.grid.gridSize) {
                teardownGrid(physics, state.grid);
                state.grid = buildGrid(physics, controls.gridSize);
                return;
            }

            for (const cubeId of state.grid.pendingRespawns) {
                const spawn = state.grid.spawnPositions.get(cubeId);
                if (!spawn) continue;
                api.setBodyTranslationRotation(physics, cubeId, spawn, _quatIdentity);
                api.setBodyLinearVelocity(physics, cubeId, _zero);
            }
            state.grid.pendingRespawns.clear();
        },
    });
};
