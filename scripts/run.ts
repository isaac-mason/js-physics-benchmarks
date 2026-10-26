// headless benchmark: node scripts/run.ts [--engines a,b] [--scenarios a,b] [--steps n] [--warmup n] [--seed n] [--runs n]
// bundles src/headless.ts with the repo's vite config (as the browser build would be), then runs every engine in a
// process of its own, --runs times, interleaved, so one engine's garbage, jit or a busy machine lands on no other's
// numbers; each scenario reports the engine's best run and the spread of its medians across runs. add --expose-gc to
// collect before each timed run

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, type Plugin } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'node_modules/.headless');

const DEFAULT_ENGINES = ['tumble', 'crashcat', 'jolt', 'rapier'];

function parseArgs(argv: string[]) {
    const options = { engines: DEFAULT_ENGINES, scenarios: [] as string[], steps: 300, warmup: 100, seed: 1, runs: 3, child: '' };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[i + 1];
        if (value === undefined) throw new Error(`${flag} needs a value`);
        if (flag === '--engines') options.engines = value.split(',');
        else if (flag === '--scenarios') options.scenarios = value.split(',');
        else if (flag === '--steps') options.steps = Number(value);
        else if (flag === '--warmup') options.warmup = Number(value);
        else if (flag === '--seed') options.seed = Number(value);
        else if (flag === '--runs') options.runs = Number(value);
        // internal: the process of one engine's run, given the bundle
        else if (flag === '--child') options.child = value;
        else throw new Error(`unknown flag ${flag}`);
        i++;
    }
    return options;
}

// a `?url` import becomes the file's own file: url, which node's loaders (jolt's emscripten glue) read from disk
function assetUrlsAsFiles(): Plugin {
    const prefix = '\0file-url:';
    return {
        name: 'asset-urls-as-files',
        enforce: 'pre',
        async resolveId(source, importer) {
            if (!source.endsWith('?url') || importer === undefined) return null;
            const resolved = await this.resolve(source.slice(0, -'?url'.length), importer, { skipSelf: true });
            if (resolved === null) return null;
            // the query keeps the wasm plugin, which claims every id ending in .wasm, off it
            return `${prefix}${resolved.id}?file-url`;
        },
        load(id) {
            if (!id.startsWith(prefix)) return null;
            const file = id.slice(prefix.length, -'?file-url'.length);
            return `export default ${JSON.stringify(pathToFileURL(file).href)};`;
        },
    };
}

async function bundle(): Promise<string> {
    await build({
        root,
        configFile: path.join(root, 'vite.config.ts'),
        logLevel: 'warn',
        plugins: [assetUrlsAsFiles()],
        ssr: { noExternal: true, target: 'node' },
        build: {
            ssr: 'src/headless.ts',
            outDir,
            emptyOutDir: true,
            minify: false,
            sourcemap: true,
            rollupOptions: { output: { entryFileNames: 'headless.mjs' } },
        },
    });
    return path.join(outDir, 'headless.mjs');
}

function quantile(sorted: Float64Array, q: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

function mean(values: Float64Array): number {
    let sum = 0;
    for (const value of values) sum += value;
    return sum / values.length;
}

const ms = (value: number) => value.toFixed(value < 10 ? 3 : 2).padStart(7);

// tumble's time over each other engine's: under 1 is tumble faster
function printSummary(title: string, table: Map<string, Map<string, number>>, engines: string[]): void {
    const others = engines.includes('tumble') ? engines.filter((e) => e !== 'tumble') : [];
    console.log(`\n${title}${others.length > 0 ? ', then tumble / engine' : ''}`);
    console.log(
        `${''.padEnd(26)}${engines.map((e) => e.padStart(13)).join('')}  ${others.map((e) => `/${e}`.padStart(13)).join('')}`,
    );
    for (const [scenario, row] of table) {
        const cells = engines.map((e) => (row.has(e) ? ms(row.get(e)!) : '-').padStart(13));
        const ours = row.get('tumble');
        const ratios = others.map((e) => {
            const theirs = row.get(e);
            return (ours !== undefined && theirs !== undefined && theirs > 0 ? (ours / theirs).toFixed(2) : '-').padStart(13);
        });
        console.log(`${scenario.padEnd(26)}${cells.join('')}  ${ratios.join('')}`);
    }
}

type Row = {
    scenario: string;
    engine: string;
    /** why it did not run, or the error it threw */
    skipped?: string;
    error?: string;
    median?: number;
    p95?: number;
    min?: number;
    mean?: number;
    update?: number;
    sync?: number;
    dynamicBodies?: number;
    escaped?: number;
    meanY?: number;
    meanSpeed?: number;
    maxSpeed?: number;
};

type Options = ReturnType<typeof parseArgs>;

/** one engine's run of every scenario, in this process: a json line per scenario */
async function child(options: Options): Promise<void> {
    const headless = await import(pathToFileURL(options.child).href);
    const scenarios: string[] = options.scenarios.length > 0 ? options.scenarios : headless.SCENARIO_IDS;
    const engine = options.engines[0]!;
    await headless.initEngine(engine);
    for (const scenario of scenarios) {
        const row: Row = { scenario, engine };
        const skip = headless.unsupported(engine, scenario);
        if (skip !== null) row.skipped = skip;
        else {
            try {
                const result = await headless.runScenario(engine, scenario, {
                    warmup: options.warmup,
                    steps: options.steps,
                    dt: 1 / 60,
                    seed: options.seed,
                });
                const step = result.step.slice().sort();
                row.median = quantile(step, 0.5);
                row.p95 = quantile(step, 0.95);
                row.min = step[0]!;
                row.mean = mean(step);
                row.update = quantile(result.update.slice().sort(), 0.5);
                row.sync = quantile(result.sync.slice().sort(), 0.5);
                row.dynamicBodies = result.dynamicBodies;
                row.escaped = result.escaped;
                row.meanY = result.meanY;
                row.meanSpeed = result.meanSpeed;
                row.maxSpeed = result.maxSpeed;
            } catch (error) {
                row.error = (error as Error).message;
            }
        }
        console.log(`RESULT ${JSON.stringify(row)}`);
    }
}

/** an engine's run in a process of its own */
function spawnRun(options: Options, bundlePath: string, engine: string): Row[] {
    const args = [...process.execArgv, fileURLToPath(import.meta.url), '--child', bundlePath, '--engines', engine];
    if (options.scenarios.length > 0) args.push('--scenarios', options.scenarios.join(','));
    args.push('--steps', String(options.steps), '--warmup', String(options.warmup), '--seed', String(options.seed));
    const run = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const rows: Row[] = [];
    for (const line of run.stdout.split('\n'))
        if (line.startsWith('RESULT ')) rows.push(JSON.parse(line.slice('RESULT '.length)));
    if (run.status !== 0)
        console.log(`  ${engine}: its process exited ${run.status}: ${run.stderr.trim().split('\n').slice(-3).join(' / ')}`);
    return rows;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (options.child !== '') return child(options);

    const started = performance.now();
    const bundlePath = await bundle();
    const headless = await import(pathToFileURL(bundlePath).href);
    const scenarios: string[] = options.scenarios.length > 0 ? options.scenarios : headless.SCENARIO_IDS;
    console.log(
        `bundled in ${((performance.now() - started) / 1000).toFixed(1)}s; each engine in a process of its own, ${options.runs} runs interleaved, the best shown. per run a discarded ${options.warmup} step warm-up, then ${options.steps} steps timed from a fresh world at 1/60 s, seed ${options.seed}${process.execArgv.includes('--expose-gc') ? ', gc before each timed run' : ''}`,
    );

    // runs[scenario][engine]: every run's row
    const runs = new Map<string, Map<string, Row[]>>();
    for (let run = 0; run < options.runs; run++) {
        for (const engine of options.engines) {
            for (const row of spawnRun(options, bundlePath, engine)) {
                let byEngine = runs.get(row.scenario);
                if (byEngine === undefined) {
                    byEngine = new Map();
                    runs.set(row.scenario, byEngine);
                }
                let rows = byEngine.get(row.engine);
                if (rows === undefined) {
                    rows = [];
                    byEngine.set(row.engine, rows);
                }
                rows.push(row);
            }
        }
        console.log(`run ${run + 1} of ${options.runs} done in ${((performance.now() - started) / 1000).toFixed(1)}s`);
    }

    console.log(
        `\n${'engine'.padEnd(14)}${'step med'.padStart(9)}${'p95'.padStart(8)}${'min'.padStart(8)}${'mean'.padStart(8)}${'spread'.padStart(8)} |${'upd med'.padStart(8)} |${'sync med'.padStart(9)} | dynamic escaped  mean y  mean |v|  max |v|`,
    );
    const medians = new Map<string, Map<string, number>>();
    const means = new Map<string, Map<string, number>>();
    for (const scenario of scenarios) {
        console.log(`\n${scenario}`);
        const row = new Map<string, number>();
        const meanRow = new Map<string, number>();
        medians.set(scenario, row);
        means.set(scenario, meanRow);
        for (const engine of options.engines) {
            const rows = runs.get(scenario)?.get(engine) ?? [];
            const first = rows[0];
            if (first === undefined) {
                console.log(`  ${engine.padEnd(12)}  no result`);
                continue;
            }
            if (first.skipped !== undefined) {
                console.log(`  ${engine.padEnd(12)}  skipped: ${first.skipped}`);
                continue;
            }
            const timed = rows.filter((r) => r.median !== undefined);
            if (timed.length === 0) {
                console.log(`  ${engine.padEnd(12)}  error: ${first.error}`);
                continue;
            }
            // the best run, by its median; the spread is its worst run's median over its best's
            const best = timed.reduce((a, b) => (b.median! < a.median! ? b : a));
            const worst = timed.reduce((a, b) => (b.median! > a.median! ? b : a));
            row.set(engine, best.median!);
            meanRow.set(engine, Math.min(...timed.map((r) => r.mean!)));
            console.log(
                `  ${engine.padEnd(12)}${ms(best.median!).padStart(9)}${ms(best.p95!).padStart(8)}${ms(best.min!).padStart(8)}${ms(best.mean!).padStart(8)}${`${(worst.median! / best.median!).toFixed(2)}x`.padStart(8)} |${ms(best.update!).padStart(8)} |${ms(best.sync!).padStart(9)} |` +
                    `${String(best.dynamicBodies).padStart(8)}${String(best.escaped).padStart(8)}${best.meanY!.toFixed(2).padStart(8)}${best.meanSpeed!.toFixed(3).padStart(9)}${best.maxSpeed!.toFixed(2).padStart(9)}`,
            );
        }
    }

    printSummary('step median (ms), best of runs', medians, options.engines);
    printSummary('step mean (ms), best of runs', means, options.engines);
    console.log(`\ndone in ${((performance.now() - started) / 1000).toFixed(1)}s`);
}

await main();
