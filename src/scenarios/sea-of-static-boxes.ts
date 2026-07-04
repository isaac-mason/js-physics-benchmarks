import * as THREE from 'three';
import { createScenario } from './types';
import { MotionType, ShapeType, createRaycastResult } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Sea of Static Boxes — port of PEEL's "SeaOfStaticBoxes" (CATEGORY_STATIC_SCENE)
// as a static-scene + query test: a large field of randomly-sized static boxes,
// with a grid of rays cast straight down onto it every frame. Exercises the
// static broadphase (build + query) at scale rather than the dynamics solver.
// ---------------------------------------------------------------------------

const AMPLITUDE = 40;
const DEFAULT_GRID = 64;
const MAX_GRID = 128;
const DEFAULT_RAYS = 48;
const MAX_RAYS = 90;
const RAY_TOP_Y = 25;
const RAY_MAX_DIST = 32;
const RAY_DIR: [number, number, number] = [0, -1, 0];

// Deterministic pseudo-random in [0, 1].
function rand01(seed: number): number {
    const s = Math.sin(seed * 91.7) * 43758.5453;
    return s - Math.floor(s);
}

const _hitMaterial = new THREE.MeshBasicMaterial({ color: 0x33ff33, depthTest: false, depthWrite: false });
const _dotGeometry = new THREE.SphereGeometry(0.25, 6, 5);
const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _identQuat = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

type ScenarioState = {
    boxHandles: number[];
    boxShapeIds: number[];
    builtGrid: number;
    hitDots: THREE.InstancedMesh;
    rayResult: api.RaycastResult;
    phase: number;
};

type Controls = { grid: number; rays: number };

function buildField(physics: PhysicsState, grid: number): { handles: number[]; shapeIds: number[] } {
    const handles: number[] = [];
    const shapeIds: number[] = [];
    let seed = 1;
    for (let y = 0; y < grid; y++) {
        const coeffY = 2 * (y / (grid - 1) - 0.5);
        for (let x = 0; x < grid; x++) {
            const coeffX = 2 * (x / (grid - 1) - 0.5);
            // Random half-extents in [1, 2] and a small positional jitter (PEEL-style).
            const hx = 1 + rand01(seed++);
            const hy = 1 + rand01(seed++);
            const hz = 1 + rand01(seed++);
            const shape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [hx, hy, hz] });
            shapeIds.push(shape);
            handles.push(
                api.createRigidBody(physics, {
                    shape,
                    motionType: MotionType.STATIC,
                    position: [coeffX * AMPLITUDE + rand01(seed++) * 2 - 1, 0, coeffY * AMPLITUDE + rand01(seed++) * 2 - 1],
                }),
            );
        }
    }
    return { handles, shapeIds };
}

export const createSeaOfStaticBoxesScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { grid: DEFAULT_GRID, rays: DEFAULT_RAYS };
            gui.title('Sea of Static Boxes');
            gui.add(params, 'grid', 4, MAX_GRID, 1).name('boxes / side');
            gui.add(params, 'rays', 1, MAX_RAYS, 1).name('rays / side');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 70, 90);
            renderer.camera.lookAt(0, 0, 0);
            renderer.controls.target.set(0, 0, 0);
            renderer.controls.update();

            const { handles, shapeIds } = buildField(physics, DEFAULT_GRID);

            const hitDots = new THREE.InstancedMesh(_dotGeometry, _hitMaterial, MAX_RAYS * MAX_RAYS);
            hitDots.renderOrder = 10;
            hitDots.count = 0;
            renderer.scene.add(hitDots);

            return { boxHandles: handles, boxShapeIds: shapeIds, builtGrid: DEFAULT_GRID, hitDots, rayResult: createRaycastResult(), phase: 0 };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            if (controls.grid !== state.builtGrid) {
                for (const id of state.boxHandles) api.removeRigidBody(physics, id);
                const rebuilt = buildField(physics, controls.grid);
                state.boxHandles = rebuilt.handles;
                state.boxShapeIds = rebuilt.shapeIds;
                state.builtGrid = controls.grid;
            }
            state.phase += dt * 0.3;
        },

        postUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, _dt: number): void => {
            // Cast a grid of downward rays over the field; the whole grid drifts in
            // a slow circle so the query set keeps changing.
            const n = controls.rays;
            const span = AMPLITUDE * 2;
            const ox = Math.cos(state.phase) * 4;
            const oz = Math.sin(state.phase) * 4;
            let count = 0;
            for (let j = 0; j < n; j++) {
                const z = (n === 1 ? 0 : (j / (n - 1) - 0.5) * span) + oz;
                for (let i = 0; i < n; i++) {
                    const x = (n === 1 ? 0 : (i / (n - 1) - 0.5) * span) + ox;
                    api.raycastClosest(state.rayResult, physics, [x, RAY_TOP_Y, z], RAY_DIR, RAY_MAX_DIST);
                    if (state.rayResult.hit) {
                        _pos.set(x, RAY_TOP_Y - state.rayResult.fraction * RAY_MAX_DIST, z);
                        _matrix.compose(_pos, _identQuat, _one);
                    } else {
                        _matrix.copy(_hidden);
                    }
                    state.hitDots.setMatrixAt(count++, _matrix);
                }
            }
            state.hitDots.count = count;
            state.hitDots.instanceMatrix.needsUpdate = true;
        },

        dispose: (state: ScenarioState, _physics: PhysicsState, renderer: Renderer): void => {
            renderer.scene.remove(state.hitDots);
        },
    });
