import initJolt from 'jolt-physics/wasm'

const Jolt = await initJolt()

const NUM_OBJECT_LAYERS = 2
const NUM_BP_LAYERS = 2
const LAYER_NON_MOVING = 0
const LAYER_MOVING = 1

const objectFilter = new Jolt.ObjectLayerPairFilterTable(NUM_OBJECT_LAYERS)
objectFilter.EnableCollision(LAYER_NON_MOVING, LAYER_MOVING)
objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING)

const bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(NUM_OBJECT_LAYERS, NUM_BP_LAYERS)
bpInterface.MapObjectToBroadPhaseLayer(LAYER_NON_MOVING, new Jolt.BroadPhaseLayer(0))
bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, new Jolt.BroadPhaseLayer(1))

const settings = new Jolt.JoltSettings()
settings.mObjectLayerPairFilter = objectFilter
settings.mBroadPhaseLayerInterface = bpInterface
settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(
    bpInterface,
    NUM_BP_LAYERS,
    objectFilter,
    NUM_OBJECT_LAYERS,
)

const joltInstance = new Jolt.JoltInterface(settings)
const physicsSystem = joltInstance.GetPhysicsSystem()
const bodyInterface = physicsSystem.GetBodyInterface()
physicsSystem.SetGravity(new Jolt.Vec3(0, -9.81, 0))

const shapeSettings = new Jolt.BoxShapeSettings(new Jolt.Vec3(0.5, 0.5, 0.5), 0.05)
const shape = shapeSettings.Create().Get()
const bcs = new Jolt.BodyCreationSettings(
    shape,
    new Jolt.RVec3(0, 5, 0),
    new Jolt.Quat(0, 0, 0, 1),
    Jolt.EMotionType_Dynamic,
    LAYER_MOVING,
)
const body = bodyInterface.CreateBody(bcs)
bodyInterface.AddBody(body.GetID(), Jolt.EActivation_Activate)

joltInstance.Step(1 / 60, 1)

console.log(joltInstance)
