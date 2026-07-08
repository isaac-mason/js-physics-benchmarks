import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Limited Hinge Joint — port of PEEL's LimitedHingeJoint scene.
// 3 pairs of cubes, each pair connected by a hinge with ±45° limits.
// i=0: Z-axis hinge, i=1: Y-axis hinge, i=2: X-axis hinge.
// ---------------------------------------------------------------------------

const BOX_SIZE = 1.0;
const LIMIT = Math.PI / 4; // 45°

// Per-pair: hinge axis, static pos, dynamic pos
const PAIRS: { axis: [number, number, number]; sx: number; dx: number }[] = [
    { axis: [0, 0, 1], sx: 0,  dx: 2  },
    { axis: [0, 1, 0], sx: 8,  dx: 10 },
    { axis: [1, 0, 0], sx: 16, dx: 18 },
];

type ScenarioState = {
    bodyIds: number[];
    jointIds: number[];
    shapeId: number;
};

function build(physics: PhysicsState): ScenarioState {
    const shapeId = api.createShape(physics, {
        type: ShapeType.BOX,
        halfExtents: [BOX_SIZE, BOX_SIZE, BOX_SIZE],
    });

    const bodyIds: number[] = [];
    const jointIds: number[] = [];

    for (const { axis, sx, dx } of PAIRS) {
        const staticId = api.createRigidBody(physics, {
            shape: shapeId,
            motionType: MotionType.STATIC,
            position: [sx, 20, 0],
        });
        const dynamicId = api.createRigidBody(physics, {
            shape: shapeId,
            motionType: MotionType.DYNAMIC,
            position: [dx, 18, 0],
            mass: 1,
        });
        bodyIds.push(staticId, dynamicId);

        // Anchor at midpoint: StaticPos + Disp*0.5 = (sx+1, 19, 0)
        const jointId = api.createHingeConstraint(
            physics, staticId, dynamicId,
            [sx + 1, 19, 0],
            axis,
        );
        api.setHingeLimits(physics, jointId, -LIMIT, LIMIT);
        jointIds.push(jointId);
    }

    return { bodyIds, jointIds, shapeId };
}

function teardown(physics: PhysicsState, s: ScenarioState): void {
    for (const id of s.jointIds) api.removeConstraint(physics, id);
    for (const id of s.bodyIds) api.removeRigidBody(physics, id);
    api.destroyShape(physics, s.shapeId);
}

export const createLimitedHingeJointScenario = () =>
    createScenario<ScenarioState>({
        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(9, 22, 20);
            renderer.camera.lookAt(9, 18, 0);
            renderer.controls.target.set(9, 18, 0);
            renderer.controls.update();

            return build(physics);
        },

        preUpdate: () => {},

        dispose: (state: ScenarioState, physics: PhysicsState): void => {
            teardown(physics, state);
        },
    });
