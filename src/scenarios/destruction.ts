import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState, Vec3 } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Destruction — port of box3d's "Destruction" benchmark. A dense cube of boxes
// is spawned and immediately blown apart by a radial impulse; after a while all
// bodies are destroyed and the cube is respawned + re-exploded. Stresses the
// create/destroy throughput (a dimension nothing else here measures) on top of
// the explosion impulse.
// ---------------------------------------------------------------------------

const EXTENT = 2.5;
const DEFAULT_GRID = 12;
const MAX_GRID = 20;
const IMPULSE_PER_AREA = 1000;

const DEFAULT_RESPAWN = 2.3;

type ScenarioState = {
    boxes: number[];
    boxShapeIds: number[];
    builtGrid: number;
    elapsed: number;
};

type Controls = { grid: number; respawn: number };

function spawnAndExplode(physics: PhysicsState, grid: number): { boxes: number[]; shapeIds: number[] } {
    const a = EXTENT / grid;
    const boxHalf = 0.8 * a;
    const boxArea = (2 * boxHalf) * (2 * boxHalf); // representative projected area
    const center: Vec3 = [0, 2 * EXTENT, 0];
    const radius = EXTENT;
    const falloff = 0.5 * EXTENT;

    const boxes: number[] = [];
    const shapeIds: number[] = [];
    let seed = 1;
    const rand = (): number => {
        const s = Math.sin(seed++ * 78.233) * 43758.5453;
        return s - Math.floor(s);
    };

    for (let i = 0; i < grid; i++) {
        for (let j = 0; j < grid; j++) {
            for (let k = 0; k < grid; k++) {
                if (rand() < 0.5) continue; // ~half the cells are empty (box3d randomises)
                const shape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [boxHalf, boxHalf, boxHalf] });
                const pos: Vec3 = [(2 * i - grid + 1) * a, (2 * j + 1) * a, (2 * k - grid + 1) * a];
                const id = api.createRigidBody(physics, { shape, motionType: MotionType.DYNAMIC, position: pos, mass: 1, friction: 0.5, restitution: 0 });
                shapeIds.push(shape);
                boxes.push(id);

                // Explode immediately (box3d explodes at spawn), outward from `center`.
                const dx = pos[0] - center[0];
                const dy = pos[1] - center[1];
                const dz = pos[2] - center[2];
                const dist = Math.hypot(dx, dy, dz);
                if (dist > radius + falloff) continue;
                let scale = 1;
                if (dist > radius && falloff > 0) scale = Math.max(0, Math.min(1, (radius + falloff - dist) / falloff));
                const inv = dist > 1e-4 ? 1 / dist : 0;
                const mag = IMPULSE_PER_AREA * boxArea * scale;
                api.applyImpulse(physics, id, inv > 0 ? [dx * inv * mag, dy * inv * mag, dz * inv * mag] : [mag, 0, 0]);
            }
        }
    }
    return { boxes, shapeIds };
}

function destroy(physics: PhysicsState, state: ScenarioState): void {
    for (const id of state.boxes) api.removeRigidBody(physics, id);
    state.boxes = [];
    state.boxShapeIds = [];
}

export const createDestructionScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { grid: DEFAULT_GRID, respawn: DEFAULT_RESPAWN };
            gui.title('Destruction');
            gui.add(params, 'grid', 4, MAX_GRID, 1).name('grid');
            gui.add(params, 'respawn', 0.5, 6, 0.1).name('respawn (s)');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 12, 18);
            renderer.camera.lookAt(0, 2, 0);
            renderer.controls.target.set(0, 2, 0);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [40, 0.5, 40], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            const { boxes, shapeIds } = spawnAndExplode(physics, DEFAULT_GRID);
            return { boxes, boxShapeIds: shapeIds, builtGrid: DEFAULT_GRID, elapsed: 0 };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            const gridChanged = controls.grid !== state.builtGrid;
            state.elapsed += dt;
            if (gridChanged || state.elapsed >= controls.respawn) {
                destroy(physics, state);
                const spawned = spawnAndExplode(physics, controls.grid);
                state.boxes = spawned.boxes;
                state.boxShapeIds = spawned.shapeIds;
                state.builtGrid = controls.grid;
                state.elapsed = 0;
            }
        },
    });
