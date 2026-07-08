import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState, Vec3 } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Hinge Bridge — a row of planks suspended by hinge joints (Z-axis) from two
// static anchor pillars. A heavy sphere drops from above the centre and loads
// the bridge. Exercises joint chain propagation, hinge axis consistency, and
// stability under impact. Inspired by PEEL's BridgeUsingHinges scene.
// ---------------------------------------------------------------------------

const PLANK_HX = 0.8;     // half-length along bridge (X)
const PLANK_HY = 0.08;    // half-height (thin plank)
const PLANK_HZ = 0.6;     // half-depth (perpendicular to bridge)
const GAP = 0.05;
const STEP = PLANK_HX * 2 + GAP;
const BRIDGE_Y = 7;
const HINGE_AXIS: Vec3 = [0, 0, 1];

const DEFAULT_PLANKS = 12;
const DEFAULT_SPHERE_MASS = 25;
const DEFAULT_RESTART = 10;

type BridgeData = {
    n: number;
    plankIds: number[];
    leftAnchorId: number;
    rightAnchorId: number;
    sphereId: number;
    jointIds: number[];
    plankShapeId: number;
    pillarShapeId: number;
    sphereShapeId: number;
};

type ScenarioState = {
    bridge: BridgeData;
    elapsed: number;
};

type Controls = { planks: number; sphereMass: number; restart: number };

function buildBridge(physics: PhysicsState, n: number, sphereMass: number): BridgeData {
    const halfSpan = (n * STEP) / 2;

    const pillarShapeId = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [0.3, 0.5, 0.6] });
    const plankShapeId = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [PLANK_HX, PLANK_HY, PLANK_HZ], convexRadius: 0.02 });
    const sphereShapeId = api.createShape(physics, { type: ShapeType.SPHERE, radius: 0.7 });

    const leftAnchorId = api.createRigidBody(physics, {
        shape: pillarShapeId, motionType: MotionType.STATIC,
        position: [-halfSpan - 1, BRIDGE_Y, 0],
    });
    const rightAnchorId = api.createRigidBody(physics, {
        shape: pillarShapeId, motionType: MotionType.STATIC,
        position: [halfSpan + 1, BRIDGE_Y, 0],
    });

    const plankIds: number[] = [];
    for (let i = 0; i < n; i++) {
        const x = -halfSpan + PLANK_HX + i * STEP;
        plankIds.push(api.createRigidBody(physics, {
            shape: plankShapeId,
            motionType: MotionType.DYNAMIC,
            position: [x, BRIDGE_Y, 0],
            mass: 2,
            friction: 0.6,
            restitution: 0,
        }));
    }

    const sphereId = api.createRigidBody(physics, {
        shape: sphereShapeId,
        motionType: MotionType.DYNAMIC,
        position: [0, BRIDGE_Y + 9, 0],
        mass: sphereMass,
        restitution: 0.1,
    });

    const jointIds: number[] = [];

    // Left pillar → first plank
    jointIds.push(api.createHingeConstraint(physics, leftAnchorId, plankIds[0]!, [-halfSpan, BRIDGE_Y, 0], HINGE_AXIS));

    // Plank-to-plank hinges
    for (let i = 0; i < n - 1; i++) {
        const ax = -halfSpan + (i + 1) * STEP - GAP * 0.5;
        jointIds.push(api.createHingeConstraint(physics, plankIds[i]!, plankIds[i + 1]!, [ax, BRIDGE_Y, 0], HINGE_AXIS));
    }

    // Last plank → right pillar
    jointIds.push(api.createHingeConstraint(physics, plankIds[n - 1]!, rightAnchorId, [halfSpan, BRIDGE_Y, 0], HINGE_AXIS));

    return { n, plankIds, leftAnchorId, rightAnchorId, sphereId, jointIds, plankShapeId, pillarShapeId, sphereShapeId };
}

function teardownBridge(physics: PhysicsState, b: BridgeData): void {
    for (const jId of b.jointIds) api.removeConstraint(physics, jId);
    api.removeRigidBody(physics, b.sphereId);
    for (const pId of b.plankIds) api.removeRigidBody(physics, pId);
    api.removeRigidBody(physics, b.leftAnchorId);
    api.removeRigidBody(physics, b.rightAnchorId);
    api.destroyShape(physics, b.plankShapeId);
    api.destroyShape(physics, b.pillarShapeId);
    api.destroyShape(physics, b.sphereShapeId);
}

export const createHingeBridgeScenario = () =>
    createScenario<ScenarioState, Controls>({
        controls: (gui) => {
            const params: Controls = { planks: DEFAULT_PLANKS, sphereMass: DEFAULT_SPHERE_MASS, restart: DEFAULT_RESTART };
            gui.title('Hinge Bridge');
            gui.add(params, 'planks', 4, 20, 1).name('planks');
            gui.add(params, 'sphereMass', 1, 200, 1).name('sphere mass');
            gui.add(params, 'restart', 0, 30, 1).name('restart (s)');
            return params;
        },

        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 10, 24);
            renderer.camera.lookAt(0, BRIDGE_Y - 1, 0);
            renderer.controls.target.set(0, BRIDGE_Y - 1, 0);
            renderer.controls.update();

            const groundShape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [40, 0.5, 10] });
            api.createRigidBody(physics, { shape: groundShape, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            // Pillars holding the bridge ends up
            const pillarColShape = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [0.3, BRIDGE_Y * 0.5, 0.3] });
            const halfSpanDefault = (DEFAULT_PLANKS * STEP) / 2;
            api.createRigidBody(physics, { shape: pillarColShape, motionType: MotionType.STATIC, position: [-halfSpanDefault - 1, BRIDGE_Y * 0.5, 0] });
            api.createRigidBody(physics, { shape: pillarColShape, motionType: MotionType.STATIC, position: [halfSpanDefault + 1, BRIDGE_Y * 0.5, 0] });

            const bridge = buildBridge(physics, DEFAULT_PLANKS, DEFAULT_SPHERE_MASS);
            return { bridge, elapsed: 0 };
        },

        preUpdate: (state: ScenarioState, physics: PhysicsState, _renderer: Renderer, controls: Controls, dt: number): void => {
            if (controls.planks !== state.bridge.n) {
                teardownBridge(physics, state.bridge);
                state.bridge = buildBridge(physics, controls.planks, controls.sphereMass);
                state.elapsed = 0;
                return;
            }

            if (controls.restart <= 0) return;
            state.elapsed += dt;
            if (state.elapsed < controls.restart) return;
            state.elapsed = 0;
            teardownBridge(physics, state.bridge);
            state.bridge = buildBridge(physics, controls.planks, controls.sphereMass);
        },
    });
