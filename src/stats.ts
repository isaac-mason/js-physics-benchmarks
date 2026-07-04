type StatsPanel = {
    dom: HTMLElement;
    update(value: number, maxValue: number): void;
    reset(): void;
};

const HISTORY = 120;
const BUDGET_MS = 16.67; // 60fps frame budget, used as the graph ceiling
const TEXT_INTERVAL_MS = 250; // throttle the numeric readout so it stays readable

function computeAvg(values: number[]): number {
    if (values.length === 0) return 0;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
}

export function createStats() {
    const panels: StatsPanel[] = [];

    const container = document.createElement('div');
    container.className = 'stats-card';

    function addPanel(name: string, color: string, primary = false): StatsPanel {
        const PR = Math.min(window.devicePixelRatio || 1, 2);
        const W = 196;
        const H = primary ? 36 : 22;

        const root = document.createElement('div');
        root.className = primary ? 'stat-panel stat-panel--primary' : 'stat-panel';

        const head = document.createElement('div');
        head.className = 'stat-head';

        const nameEl = document.createElement('span');
        nameEl.className = 'stat-name';
        nameEl.textContent = name;
        nameEl.style.color = color;

        const nums = document.createElement('span');
        nums.className = 'stat-nums';
        const curEl = document.createElement('b');
        curEl.className = 'stat-cur';
        curEl.textContent = '0.00';
        const unitEl = document.createElement('span');
        unitEl.className = 'stat-unit';
        unitEl.textContent = 'ms';
        const avgEl = document.createElement('span');
        avgEl.className = 'stat-avg';
        avgEl.textContent = 'avg 0.00';
        nums.append(curEl, unitEl, avgEl);
        head.append(nameEl, nums);

        const canvas = document.createElement('canvas');
        canvas.className = 'stat-graph';
        canvas.width = W * PR;
        canvas.height = H * PR;
        canvas.style.width = `${W}px`;
        canvas.style.height = `${H}px`;
        const ctx = canvas.getContext('2d')!;
        ctx.scale(PR, PR);

        root.append(head, canvas);

        const history: number[] = [];
        let lastTextAt = 0;

        function draw(maxValue: number): void {
            ctx.clearRect(0, 0, W, H);

            // subtle baseline
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, H - 0.5);
            ctx.lineTo(W, H - 0.5);
            ctx.stroke();

            if (history.length < 2) return;

            const ceil = Math.max(maxValue, 1);
            const stepX = W / (HISTORY - 1);
            const yOf = (v: number): number => H - Math.min(v / ceil, 1) * (H - 1);
            const startI = HISTORY - history.length;

            // area fill under the line
            ctx.beginPath();
            ctx.moveTo(startI * stepX, H);
            for (let i = 0; i < history.length; i++) {
                ctx.lineTo((startI + i) * stepX, yOf(history[i]!));
            }
            ctx.lineTo((HISTORY - 1) * stepX, H);
            ctx.closePath();
            ctx.fillStyle = hexToRgba(color, 0.14);
            ctx.fill();

            // the line itself
            ctx.beginPath();
            for (let i = 0; i < history.length; i++) {
                const x = (startI + i) * stepX;
                const y = yOf(history[i]!);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.25;
            ctx.lineJoin = 'round';
            ctx.stroke();

            // leading dot
            const lastX = (HISTORY - 1) * stepX;
            const lastY = yOf(history[history.length - 1]!);
            ctx.beginPath();
            ctx.arc(lastX - 0.5, lastY, 1.6, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        }

        const panel: StatsPanel = {
            dom: root,
            reset: () => {
                history.length = 0;
                lastTextAt = 0;
                curEl.textContent = '0.00';
                avgEl.textContent = 'avg 0.00';
                ctx.clearRect(0, 0, W, H);
            },
            update: (value: number, maxValue: number) => {
                history.push(value);
                if (history.length > HISTORY) history.shift();

                // Graph refreshes every frame; the numbers only a few times a
                // second so they're actually legible.
                const now = performance.now();
                if (now - lastTextAt >= TEXT_INTERVAL_MS) {
                    lastTextAt = now;
                    curEl.textContent = value.toFixed(2);
                    avgEl.textContent = `avg ${computeAvg(history).toFixed(2)}`;
                }

                draw(maxValue);
            },
        };

        container.appendChild(root);
        panels.push(panel);
        return panel;
    }

    // step is the headline metric (the physics solve) — show it first and large.
    const stepPanel = addPanel('step', '#ff7a1a', true);
    const preUpdatePanel = addPanel('pre', '#ffb020');
    const postUpdatePanel = addPanel('post', '#ffd23f');
    const syncPanel = addPanel('sync', '#a080ff');
    const renderPanel = addPanel('render', '#00ff88');
    const totalPanel = addPanel('total', '#ffffff');

    let beginTime = performance.now();
    let preUpdateStart = performance.now();
    let stepStart = performance.now();
    let postUpdateStart = performance.now();
    let syncStart = performance.now();
    let renderStart = performance.now();

    return {
        dom: container,

        reset() {
            for (const panel of panels) panel.reset();
        },

        begin() {
            beginTime = performance.now();
        },

        beginPreUpdate() {
            preUpdateStart = performance.now();
        },

        endPreUpdate() {
            preUpdatePanel.update(performance.now() - preUpdateStart, BUDGET_MS);
        },

        beginStep() {
            stepStart = performance.now();
        },

        endStep() {
            stepPanel.update(performance.now() - stepStart, BUDGET_MS);
        },

        beginPostUpdate() {
            postUpdateStart = performance.now();
        },

        endPostUpdate() {
            postUpdatePanel.update(performance.now() - postUpdateStart, BUDGET_MS);
        },

        beginSync() {
            syncStart = performance.now();
        },

        endSync() {
            syncPanel.update(performance.now() - syncStart, BUDGET_MS);
        },

        beginRender() {
            renderStart = performance.now();
        },

        endRender() {
            renderPanel.update(performance.now() - renderStart, BUDGET_MS);
        },

        end() {
            totalPanel.update(performance.now() - beginTime, BUDGET_MS);
        },
    };
}

/** `#rrggbb` -> `rgba(r,g,b,a)` for translucent fills. */
function hexToRgba(hex: string, alpha: number): string {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
}
