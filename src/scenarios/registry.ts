import { Capability } from '../api';
import { createArchScenario } from './arch';
import { createBoxContainerScenario } from './box-container';
import { createCandyCupsScenario } from './candy-cups';
import { createCardHouseScenario } from './card-house';
import { createCatenaryBridgeScenario } from './catenary-bridge';
import { createContactListenersScenario } from './contact-listeners';
import { createConvexHullsScenario } from './convex-hulls';
import { createCubeHeapScenario } from './cube-heap';
import { createDestructionScenario } from './destruction';
import { createDistanceJointScenario } from './distance-joint';
import { createDominoesScenario } from './dominoes';
import { createExplosionScenario } from './explosion';
import { createFixedJointsTorusStressScenario } from './fixed-joints-torus-stress';
import { createFixedTorusScenario } from './fixed-torus';
import { createFrictionRampScenario } from './friction-ramp';
import { createHighMassRatioScenario } from './high-mass-ratio';
import { createHingeBridgeScenario } from './hinge-bridge';
import { createHingeJointChainScenario } from './hinge-joint-chain';
import { createInitialPenetrationScenario } from './initial-penetration';
import { createJengaScenario } from './jenga';
import { createLimitedHingeJointScenario } from './limited-hinge-joint';
import { createManyBoxStacksScenario } from './many-box-stacks';
import { createPyramidScenario } from './pyramid';
import { createRayCurtainScenario } from './ray-curtain';
import { createRaycastsScenario } from './raycasts';
import { createRestitutionScenario } from './restitution';
import { createSeaOfStaticBoxesScenario } from './sea-of-static-boxes';
import { createSleepingPileScenario } from './sleeping-pile';
import { createSphericalJointNetScenario } from './spherical-joint-net';
import { createSphericalJointNet2Scenario } from './spherical-joint-net2';
import { createStableSphericalChainScenario } from './stable-spherical-chain';
import { createStableStackingScenario } from './stable-stacking';
import { createStackedSpheresScenario } from './stacked-spheres';
import { createTenThousandScenario } from './ten-thousand';
import { createTumblerScenario } from './tumbler';
import { createWindScenario } from './wind';

// biome-ignore format: pretty
export const SCENARIOS = [
    { id: 'cube-heap',          label: 'Cube Heap',          category: 'Benchmark', create: createCubeHeapScenario },
    { id: 'convex-hulls',       label: 'Convex Hull Heap',   category: 'Benchmark', create: createConvexHullsScenario },
    { id: 'box-container',      label: 'Box Container',      category: 'Benchmark', create: createBoxContainerScenario },
    { id: 'many-box-stacks',    label: 'Many Box Stacks',    category: 'Benchmark', create: createManyBoxStacksScenario },
    { id: 'sleeping-pile',      label: 'Sleeping Pile',      category: 'Benchmark', create: createSleepingPileScenario },
    { id: 'explosion',          label: 'Explosion',          category: 'Benchmark', create: createExplosionScenario },
    { id: 'destruction',        label: 'Destruction',        category: 'Benchmark', create: createDestructionScenario },
    { id: 'ten-thousand',       label: 'Ten Thousand',       category: 'Benchmark', create: createTenThousandScenario },
    { id: 'tumbler',            label: 'Tumbler',            category: 'Benchmark', create: createTumblerScenario },
    { id: 'wind',               label: 'Wind',               category: 'Benchmark', create: createWindScenario },

    { id: 'pyramid',            label: 'Pyramid',            category: 'Stacking', create: createPyramidScenario },
    { id: 'stable-stacking',    label: 'Box Stack',          category: 'Stacking', create: createStableStackingScenario },
    { id: 'jenga',              label: 'Jenga Stack',        category: 'Stacking', create: createJengaScenario },
    { id: 'stacked-spheres',    label: 'Stacked Spheres',    category: 'Stacking', create: createStackedSpheresScenario },
    { id: 'candy-cups',         label: 'Candy Cups',         category: 'Stacking', create: createCandyCupsScenario },
    { id: 'arch',               label: 'Arch',               category: 'Stacking', create: createArchScenario },
    { id: 'card-house',         label: 'Card House',         category: 'Stacking', create: createCardHouseScenario },

    { id: 'restitution',        label: 'Restitution',        category: 'Behavior', create: createRestitutionScenario },
    { id: 'friction-ramp',      label: 'Friction Ramp',      category: 'Behavior', create: createFrictionRampScenario },
    { id: 'high-mass-ratio',    label: 'High Mass Ratio',    category: 'Behavior', create: createHighMassRatioScenario },
    { id: 'initial-penetration', label: 'Initial Penetration', category: 'Behavior', create: createInitialPenetrationScenario },
    { id: 'dominoes',           label: 'Dominoes',           category: 'Behavior', create: createDominoesScenario },

    { id: 'raycasts',           label: 'Raycasts',           category: 'Query',  create: createRaycastsScenario,        requires: [Capability.Raycast] },
    { id: 'ray-curtain',        label: 'Ray Curtain',        category: 'Query',  create: createRayCurtainScenario,      requires: [Capability.Raycast] },
    { id: 'sea-of-static-boxes', label: 'Sea of Static Boxes', category: 'Query', create: createSeaOfStaticBoxesScenario, requires: [Capability.Raycast] },

    { id: 'contact-listeners',  label: 'Contact Listeners',  category: 'Events', create: createContactListenersScenario, requires: [Capability.ContactListener] },

    { id: 'hinge-bridge',       label: 'Hinge Bridge',       category: 'Joints', create: createHingeBridgeScenario },

    { id: 'fixed-torus',        label: 'Fixed Torus',        category: 'Joints', create: createFixedTorusScenario },
    { id: 'hinge-joint-chain',  label: 'Hinge Joint Chain',  category: 'Joints', create: createHingeJointChainScenario },
    { id: 'catenary-bridge',    label: 'Catenary Bridge',    category: 'Joints', create: createCatenaryBridgeScenario },
    { id: 'spherical-joint-net', label: 'Spherical Net',     category: 'Joints', create: createSphericalJointNetScenario },
    { id: 'spherical-joint-net2', label: 'Spherical Net 2',  category: 'Joints', create: createSphericalJointNet2Scenario },
    { id: 'stable-spherical-chain', label: 'Spherical Chain',        category: 'Joints', create: createStableSphericalChainScenario },
    { id: 'fixed-joints-torus-stress', label: 'Fixed Torus Stress', category: 'Joints', create: createFixedJointsTorusStressScenario },
    { id: 'distance-joint',       label: 'Distance Joint',     category: 'Joints', create: createDistanceJointScenario },
    { id: 'limited-hinge-joint',  label: 'Limited Hinge',      category: 'Joints', create: createLimitedHingeJointScenario, requires: [Capability.HingeLimits] },
]
