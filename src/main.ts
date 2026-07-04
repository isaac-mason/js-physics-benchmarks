import GUI from 'lil-gui';
import bundleSizes from '../bundle-sizes/results.json';
import type { PhysicsState } from './api';
import { createPhysicsState, snapshot } from './api';
import * as ammo from './impls/ammo-impl';
import * as bounce from './impls/bounce-impl';
import * as box3d from './impls/box3d-impl';
import * as cannon from './impls/cannon-impl';
import * as crashcat from './impls/crashcat-impl';
import type { PhysicsImpl } from './impls/impl';
import * as jolt from './impls/jolt-impl';
import * as meep from './impls/meep-impl';
import * as rapier from './impls/rapier-impl';
import { createRenderer } from './renderer';
import { createArchScenario } from './scenarios/arch';
import { createBoxContainerScenario } from './scenarios/box-container';
import { createCandyCupsScenario } from './scenarios/candy-cups';
import { createCardHouseScenario } from './scenarios/card-house';
import { createContactListenersScenario } from './scenarios/contact-listeners';
import { createDestructionScenario } from './scenarios/destruction';
import { createExplosionScenario } from './scenarios/explosion';
import { createFrictionRampScenario } from './scenarios/friction-ramp';
import { createHighMassRatioScenario } from './scenarios/high-mass-ratio';
import { createRestitutionScenario } from './scenarios/restitution';
import { createConvexHullsScenario } from './scenarios/convex-hulls';
import { createConvexStackScenario } from './scenarios/convex-stack';
import { createCubeHeapScenario } from './scenarios/cube-heap';
import { createDominoesScenario } from './scenarios/dominoes';
import { createInitialPenetrationScenario } from './scenarios/initial-penetration';
import { createJengaScenario } from './scenarios/jenga';
import { createManyBoxStacksScenario } from './scenarios/many-box-stacks';
import { createPyramidScenario } from './scenarios/pyramid';
import { createRaycastsScenario } from './scenarios/raycasts';
import { createRayCurtainScenario } from './scenarios/ray-curtain';
import { createSeaOfStaticBoxesScenario } from './scenarios/sea-of-static-boxes';
import { createSleepingPileScenario } from './scenarios/sleeping-pile';
import { createStackedSpheresScenario } from './scenarios/stacked-spheres';
import { createTenThousandScenario } from './scenarios/ten-thousand';
import { createTumblerScenario } from './scenarios/tumbler';
import { createWindScenario } from './scenarios/wind';
import { createStableStackingScenario } from './scenarios/stable-stacking';
import type { Scenario } from './scenarios/types';
import { createStats } from './stats';

const PHYSICS_DT = 1 / 60;
const MAX_SUBSTEPS = 8;

let impl: PhysicsImpl;
let physics: PhysicsState;
const currentRenderer = createRenderer();
const stats = createStats();
document.getElementById('stats-container')!.appendChild(stats.dom);

// biome-ignore format: pretty
const ENGINES = [
    { id: 'crashcat', label: 'crashcat',  tag: 'js',   repoUrl: 'https://github.com/isaac-mason/crashcat' },
    { id: 'bounce',   label: 'bounce',    tag: 'js',   repoUrl: 'https://codeberg.org/perplexdotgg/bounce' },
    { id: 'meep',     label: 'meep',      tag: 'js',   repoUrl: 'https://meep.company-named.com/' },
    { id: 'cannon',   label: 'cannon-es', tag: 'js',   repoUrl: 'https://github.com/pmndrs/cannon-es' },
    { id: 'box3d',    label: 'box3d.js',  tag: 'wasm', repoUrl: 'https://github.com/isaac-mason/box3d.js' },
    { id: 'rapier',   label: 'rapier',    tag: 'wasm', repoUrl: 'https://github.com/dimforge/rapier.js' },
    { id: 'jolt',     label: 'jolt',      tag: 'wasm', repoUrl: 'https://github.com/jrouwe/JoltPhysics.js' },
    { id: 'ammo',     label: 'ammo.js',   tag: 'wasm', repoUrl: 'https://github.com/kripken/ammo.js' },
]

// biome-ignore format: pretty
const SCENARIOS = [
    { id: 'cube-heap',          label: 'Cube Heap',          category: 'Benchmark', create: createCubeHeapScenario },
    { id: 'convex-hulls',       label: 'Convex Hull Heap',   category: 'Benchmark', create: createConvexHullsScenario },
    { id: 'candy-cups',         label: 'Candy Cups',         category: 'Benchmark', create: createCandyCupsScenario },
    { id: 'box-container',      label: 'Box Container',      category: 'Benchmark', create: createBoxContainerScenario },
    { id: 'many-box-stacks',    label: 'Many Box Stacks',    category: 'Benchmark', create: createManyBoxStacksScenario },
    { id: 'sleeping-pile',      label: 'Sleeping Pile',      category: 'Benchmark', create: createSleepingPileScenario },
    { id: 'explosion',          label: 'Explosion',          category: 'Benchmark', create: createExplosionScenario },
    { id: 'destruction',        label: 'Destruction',        category: 'Benchmark', create: createDestructionScenario },
    { id: 'ten-thousand',       label: 'Ten Thousand',       category: 'Benchmark', create: createTenThousandScenario },
    { id: 'tumbler',            label: 'Tumbler',            category: 'Benchmark', create: createTumblerScenario },
    { id: 'wind',               label: 'Wind',               category: 'Benchmark', create: createWindScenario },

    { id: 'pyramid',            label: 'Pyramid',            category: 'Stacking', create: createPyramidScenario },
    { id: 'stable-stacking',    label: 'Stacking Stability', category: 'Stacking', create: createStableStackingScenario },
    { id: 'jenga',              label: 'Jenga Stack',        category: 'Stacking', create: createJengaScenario },
    { id: 'stacked-spheres',    label: 'Stacked Spheres',    category: 'Stacking', create: createStackedSpheresScenario },
    { id: 'convex-stack',       label: 'Convex Stack',       category: 'Stacking', create: createConvexStackScenario },
    { id: 'arch',               label: 'Arch',               category: 'Stacking', create: createArchScenario },
    { id: 'card-house',         label: 'Card House',         category: 'Stacking', create: createCardHouseScenario },

    { id: 'restitution',        label: 'Restitution',        category: 'Behavior', create: createRestitutionScenario },
    { id: 'friction-ramp',      label: 'Friction Ramp',      category: 'Behavior', create: createFrictionRampScenario },
    { id: 'high-mass-ratio',    label: 'High Mass Ratio',    category: 'Behavior', create: createHighMassRatioScenario },
    { id: 'initial-penetration', label: 'Initial Penetration', category: 'Behavior', create: createInitialPenetrationScenario },
    { id: 'dominoes',           label: 'Dominoes',           category: 'Behavior', create: createDominoesScenario },

    { id: 'raycasts',           label: 'Raycasts',           category: 'Query', create: createRaycastsScenario },
    { id: 'ray-curtain',        label: 'Ray Curtain',        category: 'Query', create: createRayCurtainScenario },
    { id: 'sea-of-static-boxes', label: 'Sea of Static Boxes', category: 'Query', create: createSeaOfStaticBoxesScenario },

    { id: 'contact-listeners',  label: 'Contact Listeners',  category: 'Events', create: createContactListenersScenario },
]

function fmtKb(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} kB`;
}

let accumulator = 0;
let lastTime = performance.now();

let activeScenario: Scenario<any, any> | null = null;
let activeScenarioState: any = null;
let activeScenarioControls: any;
let activeScenarioGui: GUI | undefined;
let activeScenarioControlsMounted = false;
let activeScenarioName = 'cube-heap';
let activeEngineName = 'crashcat';

function encodeParams(engine: string, scenario: string, controls: unknown): void {
    let qs = `engine=${encodeURIComponent(engine)}&scenario=${encodeURIComponent(scenario)}`;
    if (controls !== undefined && controls !== null) {
        qs += `&controls=${JSON.stringify(controls)}`;
    }
    history.replaceState(null, '', `?${qs}`);
}

function decodeParams(): { engine: string; scenario: string; controls: Record<string, unknown> | null } {
    const defaultEngine = ENGINES[0]!.id;
    const defaultScenario = SCENARIOS[0]!.id;
    const params = new URLSearchParams(window.location.search);

    const rawEngine = params.get('engine') ?? defaultEngine;
    const rawScenario = params.get('scenario') ?? defaultScenario;
    const rawControls = params.get('controls');

    const engine = ENGINES.find((e) => e.id === rawEngine) ? rawEngine : defaultEngine;
    const scenario = SCENARIOS.find((s) => s.id === rawScenario) ? rawScenario : defaultScenario;

    let controls: Record<string, unknown> | null = null;
    if (rawControls) {
        try {
            const parsed = JSON.parse(rawControls);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                controls = parsed as Record<string, unknown>;
            }
        } catch {
            // ignore malformed JSON
        }
    }

    return { engine, scenario, controls };
}

function applyRestoredControls(controls: Record<string, unknown>): void {
    if (!activeScenarioControls || !activeScenarioGui) return;
    for (const key of Object.keys(controls)) {
        if (key in activeScenarioControls) {
            activeScenarioControls[key] = controls[key];
        }
    }
    for (const c of activeScenarioGui.controllersRecursive()) c.updateDisplay();
}

// --- per-engine bundle sizes, shared by the popover table ---
type EngineSizes = {
    version: string;
    jsMin: number | null;
    jsMinGz: number | null;
    wasmRaw: number | null;
    wasmGzip: number | null;
    totalMin: number | null;
    totalMinGz: number | null;
};

function engineSizes(id: string): EngineSizes {
    const sizes = bundleSizes.results[id as keyof typeof bundleSizes.results];
    const version = bundleSizes.meta.versions[id as keyof typeof bundleSizes.meta.versions];
    const jsOk = sizes && 'js' in sizes;
    const wasmOk = sizes && 'wasm' in sizes && (sizes as any).wasm;
    const jsMin = jsOk ? (sizes as any).js.minified : null;
    const jsMinGz = jsOk ? (sizes as any).js.minifiedGzip : null;
    const wasmRaw = wasmOk ? (sizes as any).wasm.total : null;
    const wasmGzip = wasmOk ? (sizes as any).wasm.totalGzip : null;
    const totalMin = jsMin != null ? jsMin + (wasmRaw ?? 0) : null;
    const totalMinGz = jsMinGz != null ? jsMinGz + (wasmGzip ?? 0) : null;
    return { version, jsMin, jsMinGz, wasmRaw, wasmGzip, totalMin, totalMinGz };
}

const fmtOrDash = (b: number | null): string => (b != null ? fmtKb(b) : '—');

const scenarioLabel = (id: string): string => SCENARIOS.find((s) => s.id === id)?.label ?? id;
const engineLabelOf = (id: string): string => ENGINES.find((e) => e.id === id)?.label ?? id;

// --- scenario menu: collapsible category sections ---
const scenarioPanel = document.getElementById('scenario-panel')!;
const scenarioCurrent = document.getElementById('scenario-current')!;
{
    const categories: string[] = [];
    for (const s of SCENARIOS) if (!categories.includes(s.category)) categories.push(s.category);

    for (const category of categories) {
        const section = document.createElement('div');
        section.className = 'scenario-cat';
        section.dataset.category = category;

        const header = document.createElement('div');
        header.className = 'menu-cat-header';
        header.textContent = category;
        section.appendChild(header);

        const items = document.createElement('div');
        items.className = 'scenario-cat-items';
        for (const s of SCENARIOS.filter((x) => x.category === category)) {
            const btn = document.createElement('button');
            btn.className = 'scenario-item';
            btn.type = 'button';
            btn.dataset.scenario = s.id;
            btn.textContent = s.label;
            items.appendChild(btn);
        }
        section.appendChild(items);
        scenarioPanel.appendChild(section);
    }
}

// --- engine menu: wrapped tiles, one per library (whole tile selects) ---
const enginePanel = document.getElementById('engine-panel')!;
const engineCurrent = document.getElementById('engine-current')!;
{
    const engineTile = (engine: (typeof ENGINES)[number]): string => {
        const { id, label, tag, repoUrl } = engine;
        const s = engineSizes(id);
        // The name is NOT a link — the whole tile selects the engine. The repo
        // opens only from the small ↗ icon, so a normal click can't misfire.
        const wasmCols =
            s.wasmGzip != null
                ? `
            <div class="card-col-divider"></div>
            <div class="card-col">
                <div class="card-col-label">WASM</div>
                <div class="card-col-stat"><span class="card-stat-label">raw</span><span class="card-stat-value">${fmtOrDash(s.wasmRaw)}</span></div>
                <div class="card-col-stat"><span class="card-stat-label">gz</span><span class="card-stat-value">${fmtOrDash(s.wasmGzip)}</span></div>
            </div>`
                : '';
        return `<button class="engine-tile" type="button" data-engine="${id}">
            <div class="card-header">
                <span class="card-name">${label}</span>
                <span class="engine-tag tag-${tag}">${tag}</span>
                <a class="tile-repo" href="${repoUrl}" target="_blank" rel="noopener noreferrer" title="Open repository" aria-label="Open ${label} repository">↗</a>
            </div>
            <div class="card-version">v${s.version}</div>
            <div class="card-cols">
                <div class="card-col">
                    <div class="card-col-label">JS</div>
                    <div class="card-col-stat"><span class="card-stat-label">min</span><span class="card-stat-value">${fmtOrDash(s.jsMin)}</span></div>
                    <div class="card-col-stat"><span class="card-stat-label">min+gz</span><span class="card-stat-value">${fmtOrDash(s.jsMinGz)}</span></div>
                </div>
                ${wasmCols}
            </div>
            <div class="card-totals">
                <div class="card-total-stat"><span class="card-stat-label">total min</span><span class="card-stat-value">${fmtOrDash(s.totalMin)}</span></div>
                <div class="card-total-stat"><span class="card-stat-label">total min+gz</span><span class="card-stat-value card-stat-value--highlight">${fmtOrDash(s.totalMinGz)}</span></div>
            </div>
        </button>`;
    };

    const groups: [string, string][] = [
        ['Pure JS', 'js'],
        ['WebAssembly', 'wasm'],
    ];
    let html = '';
    for (const [title, tag] of groups) {
        const group = ENGINES.filter((e) => e.tag === tag);
        if (group.length === 0) continue;
        html += `<div class="menu-cat"><div class="menu-cat-header">${title}</div><div class="engine-grid">${group.map(engineTile).join('')}</div></div>`;
    }
    enginePanel.innerHTML = html;
}

// --- reflect the current selection into the menu triggers + panels ---
function setActiveScenarioUI(name: string): void {
    scenarioCurrent.textContent = scenarioLabel(name);
    for (const item of scenarioPanel.querySelectorAll<HTMLButtonElement>('.scenario-item')) {
        item.classList.toggle('active', item.dataset.scenario === name);
    }
}

function setActiveEngineUI(name: string): void {
    engineCurrent.textContent = engineLabelOf(name);
    for (const tile of enginePanel.querySelectorAll<HTMLButtonElement>('[data-engine]')) {
        tile.classList.toggle('active', tile.dataset.engine === name);
    }
}

function getScenario(name: string): Scenario<any, any> {
    const entry = SCENARIOS.find((s) => s.id === name);
    if (!entry) throw new Error(`Unknown scenario: ${name}`);
    return entry.create();
}

function mountControls(scenario: Scenario<any, any>): { controls: any; gui: GUI | undefined } {
    if (!scenario.controls) return { controls: undefined, gui: undefined };
    const gui = new GUI({ autoPlace: false, width: 213 });
    document.getElementById('scenario-gui')!.appendChild(gui.domElement);
    const controls = scenario.controls(gui);
    gui.onChange(() => encodeParams(activeEngineName, activeScenarioName, controls));
    return { controls, gui };
}

function teardownControls(): void {
    activeScenarioGui?.destroy();
    activeScenarioGui = undefined;
    activeScenarioControls = undefined;
    activeScenarioControlsMounted = false;
}

async function startEngine(name: string): Promise<void> {
    activeEngineName = name;
    
    if (impl && physics) {
        if (activeScenario?.dispose && activeScenarioState) {
            activeScenario.dispose(activeScenarioState, physics, currentRenderer);
        }
        impl.disposeContactListener(physics.world);
        impl.disposeWorld(physics.world);
    }

    if (name === 'box3d') {
        impl = box3d;
    } else if (name === 'crashcat') {
        impl = crashcat;
    } else if (name === 'rapier') {
        impl = rapier;
    } else if (name === 'jolt') {
        impl = jolt;
    } else if (name === 'cannon') {
        impl = cannon;
    } else if (name === 'bounce') {
        impl = bounce;
    } else if (name === 'meep') {
        impl = meep;
    } else if (name === 'ammo') {
        impl = ammo;
    } else {
        throw new Error(`Unknown engine: ${name}`);
    }

    physics = createPhysicsState(impl, impl.createWorld());
    currentRenderer.clear();
    currentRenderer.resetCamera();
    stats.reset();

    activeScenario = getScenario(activeScenarioName);

    if (!activeScenarioControlsMounted) {
        const mounted = mountControls(activeScenario);
        activeScenarioControls = mounted.controls;
        activeScenarioGui = mounted.gui;
        activeScenarioControlsMounted = true;
    }

    activeScenarioState = activeScenario.init(physics, currentRenderer);
    encodeParams(activeEngineName, activeScenarioName, activeScenarioControls);
}

function startScenario(name: string): void {
    activeScenarioName = name;
    if (!impl || !physics) return;

    // Full teardown — physics + controls/gui
    if (activeScenario?.dispose && activeScenarioState) {
        activeScenario.dispose(activeScenarioState, physics, currentRenderer);
    }
    teardownControls();
    impl.disposeContactListener(physics.world);
    impl.disposeWorld(physics.world);
    physics = createPhysicsState(impl, impl.createWorld());
    currentRenderer.clear();
    currentRenderer.resetCamera();
    stats.reset();

    activeScenario = getScenario(name);

    const mounted = mountControls(activeScenario);
    activeScenarioControls = mounted.controls;
    activeScenarioGui = mounted.gui;
    activeScenarioControlsMounted = true;

    activeScenarioState = activeScenario.init(physics, currentRenderer);
    encodeParams(activeEngineName, activeScenarioName, activeScenarioControls);
}

function animate(): void {
    requestAnimationFrame(animate);

    stats.begin();

    const currentTime = performance.now();
    let frameTime = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    if (frameTime > 0.25) frameTime = 0.25;

    accumulator += frameTime;

    let stepped = 0;
    while (accumulator >= PHYSICS_DT && stepped < MAX_SUBSTEPS) {
        if (activeScenario && activeScenarioState && physics) {
            stats.beginPreUpdate();
            activeScenario.preUpdate(activeScenarioState, physics, currentRenderer, activeScenarioControls, PHYSICS_DT);
            stats.endPreUpdate();
        }
        if (physics) {
            stats.beginStep();
            physics.impl.stepSimulation(physics.world, PHYSICS_DT);
            snapshot(physics);
            stats.endStep();
        }
        stats.beginPostUpdate();
        if (activeScenario?.postUpdate && activeScenarioState && physics) {
            activeScenario.postUpdate(activeScenarioState, physics, currentRenderer, activeScenarioControls, PHYSICS_DT);
        }
        stats.endPostUpdate();
        accumulator -= PHYSICS_DT;
        stepped++;
    }

    stats.beginSync();
    if (physics) {
        currentRenderer.update(physics, accumulator / PHYSICS_DT);
    }
    stats.endSync();

    stats.beginRender();
    currentRenderer.controls.update();
    currentRenderer.renderer.render(currentRenderer.scene, currentRenderer.camera);
    stats.endRender();

    stats.end();
}

// --- dropdown menus: open / close ---
const topbar = document.getElementById('topbar')!;
const scenarioTrigger = document.getElementById('scenario-trigger')!;
const engineTrigger = document.getElementById('engine-trigger')!;

function setMenuOpen(trigger: HTMLElement, panel: HTMLElement, open: boolean): void {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
}
function closeMenus(): void {
    setMenuOpen(scenarioTrigger, scenarioPanel, false);
    setMenuOpen(engineTrigger, enginePanel, false);
}
scenarioTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = scenarioPanel.hidden;
    closeMenus();
    setMenuOpen(scenarioTrigger, scenarioPanel, willOpen);
});
engineTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = enginePanel.hidden;
    closeMenus();
    setMenuOpen(engineTrigger, enginePanel, willOpen);
});
document.addEventListener('click', (e) => {
    if (!topbar.contains(e.target as Node)) closeMenus();
});

// pick a scenario from the menu
for (const item of scenarioPanel.querySelectorAll<HTMLButtonElement>('.scenario-item')) {
    item.addEventListener('click', () => {
        const name = item.dataset.scenario!;
        setActiveScenarioUI(name);
        closeMenus();
        startScenario(name);
    });
}

// pick an engine from the menu (the small repo ↗ still opens normally)
for (const tile of enginePanel.querySelectorAll<HTMLButtonElement>('[data-engine]')) {
    tile.addEventListener('click', async (e) => {
        if ((e.target as HTMLElement).closest('a')) return;
        const name = tile.dataset.engine!;
        setActiveEngineUI(name);
        closeMenus();
        await startEngine(name);
    });
}

async function init(): Promise<void> {
    const { engine, scenario, controls: restoredControls } = decodeParams();
    activeEngineName = engine;
    activeScenarioName = scenario;

    setActiveScenarioUI(scenario);
    setActiveEngineUI(engine);

    await Promise.all([box3d.init(), crashcat.init(), rapier.init(), jolt.init(), cannon.init(), bounce.init(), meep.init(), ammo.init()]);
    await startEngine(engine);

    if (restoredControls) {
        applyRestoredControls(restoredControls);
        encodeParams(activeEngineName, activeScenarioName, activeScenarioControls);
    }

    animate();
}

init();
