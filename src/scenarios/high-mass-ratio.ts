import { createScenario } from './types';
import { MotionType, ShapeType } from '../api';
import * as api from '../api';
import type { PhysicsState } from '../api';
import type { Renderer } from '../renderer';

// ---------------------------------------------------------------------------
// High Mass Ratio — faithful port of PEEL's "HighMassRatio" (CATEGORY_BEHAVIOR).
// Three pyramids (10 boxes at the base narrowing to 1 at the top). The single
// capstone box is very heavy (mass 100 / 200 / 300) while every other box has
// mass 1. A solver-robustness test: weak solvers let the light boxes squash or
// explode under the heavy top; strong ones hold the pyramid stable.
// ---------------------------------------------------------------------------

const BOX_EXTENT = 1; // half-extent -> 2x2x2 boxes
const NB_STACKS = 3;
const BASE_BOXES = 10;
const STACK_SPACING = BOX_EXTENT * 8;

type Controls = void;

export const createHighMassRatioScenario = () =>
    createScenario<null, Controls>({
        init: (physics: PhysicsState, renderer: Renderer): null => {
            api.setGravity(physics, 0, -9.81, 0);

            renderer.camera.position.set(26, 20, 42);
            renderer.camera.lookAt(0, 8, STACK_SPACING);
            renderer.controls.target.set(0, 8, STACK_SPACING);
            renderer.controls.update();

            const floor = api.createShape(physics, { type: ShapeType.BOX, halfExtents: [60, 0.5, 60], convexRadius: 0.05 });
            api.createRigidBody(physics, { shape: floor, motionType: MotionType.STATIC, position: [0, -0.5, 0] });

            const boxShape = api.createShape(physics, {
                type: ShapeType.BOX,
                halfExtents: [BOX_EXTENT, BOX_EXTENT, BOX_EXTENT],
            });

            for (let j = 0; j < NB_STACKS; j++) {
                let nbBoxes = BASE_BOXES;
                let boxPosY = BOX_EXTENT;
                while (nbBoxes > 0) {
                    for (let i = 0; i < nbBoxes; i++) {
                        const coeff = i - nbBoxes * 0.5;
                        // The lone top box of each stack is the heavy capstone.
                        const mass = nbBoxes === 1 ? (j + 1) * 100 : 1;
                        api.createRigidBody(physics, {
                            shape: boxShape,
                            motionType: MotionType.DYNAMIC,
                            position: [coeff * BOX_EXTENT * 2, boxPosY, j * STACK_SPACING],
                            mass,
                            friction: 0.5,
                            restitution: 0,
                        });
                    }
                    nbBoxes--;
                    boxPosY += BOX_EXTENT * 2;
                }
            }

            return null;
        },

        preUpdate: (): void => {},
    });
