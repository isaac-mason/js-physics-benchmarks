import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// Distance Joint — port of PEEL's DistanceJoint scene.
// Static sphere at origin + dynamic sphere 2 units away, max-distance=2.
// ---------------------------------------------------------------------------

const SPHERE_RADIUS = 1.0;
const MAX_DISTANCE = 2.0;

type ScenarioState = {
    bodyIds: number[];
    jointId: number;
    shapeId: number;
};

function build(physics: PhysicsState): ScenarioState {
    const shapeId = api.createShape(physics, { type: ShapeType.SPHERE, radius: SPHERE_RADIUS });

    const staticId = api.createRigidBody(physics, {
        shape: shapeId,
        motionType: MotionType.STATIC,
        position: [0, 20, 0],
    });
    const dynamicId = api.createRigidBody(physics, {
        shape: shapeId,
        motionType: MotionType.DYNAMIC,
        position: [2, 20, 0],
        mass: 1,
    });

    const jointId = api.createDistanceConstraint(
        physics, staticId, dynamicId,
        [0, 20, 0], [2, 20, 0],
        undefined, MAX_DISTANCE,
    );

    return { bodyIds: [staticId, dynamicId], jointId, shapeId };
}

function teardown(physics: PhysicsState, s: ScenarioState): void {
    api.removeConstraint(physics, s.jointId);
    for (const id of s.bodyIds) api.removeRigidBody(physics, id);
    api.destroyShape(physics, s.shapeId);
}

export const createDistanceJointScenario = () =>
    createScenario<ScenarioState>({
        init: (physics: PhysicsState, renderer: Renderer): ScenarioState => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(0, 20, 20);
            renderer.camera.lookAt(0, 18, 0);
            renderer.controls.target.set(0, 18, 0);
            renderer.controls.update();

            return build(physics);
        },

        preUpdate: () => {},

        dispose: (state: ScenarioState, physics: PhysicsState): void => {
            teardown(physics, state);
        },
    });
