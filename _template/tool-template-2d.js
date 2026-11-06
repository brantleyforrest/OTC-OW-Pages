// Starter for a tool drawn on a 2D canvas. The moving point is a placeholder.
// Replace the sections marked REPLACE. Keep the structure around them.
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const Kit = window.ToolKit;

    /* REPLACE: the content and settings for this tool */
    const SPEEDS = [
        { rate: 15, label: 'Slow' },
        { rate: 45, label: 'Normal' },
        { rate: 135, label: 'Fast' }
    ];
    const OPTIONS = {
        a: { radiusShare: 0.33, caption: 'Describe what Option A shows.' },
        b: { radiusShare: 0.2, caption: 'Describe what Option B shows.' }
    };

    /* State */
    const state = {
        t: 0,
        playing: !Kit.prefersReducedMotion(),
        speed: 1,
        option: 'a',
        showPath: true,
        showLabels: true
    };

    /* View */
    const view = $('view');
    const canvas = $('scene');
    const ctx = canvas.getContext('2d');
    const hud = $('hud');
    const layer = new Kit.LabelLayer($('labels'));
    const centerLabel = layer.add('<b>Center</b>', { rank: 1 });
    const pointLabel = layer.add('<b>Moving point</b><span class="hint">placeholder</span>', { rank: 0 });
    let W = 1, H = 1;
    let dirty = true;

    // REPLACE: draw the scene. Scale drawings from the view's shorter side, and keep
    // important items clear of the status box.
    function draw() {
        ctx.fillStyle = '#03060c';
        ctx.fillRect(0, 0, W, H);

        const cx = W / 2, cy = H / 2;
        const radius = Math.min(W, H) * OPTIONS[state.option].radiusShare;
        const angle = state.t * Math.PI / 180;
        const x = cx + radius * Math.cos(angle);
        const y = cy - radius * Math.sin(angle);

        if (state.showPath) {
            ctx.strokeStyle = '#3a5a8c';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
            ctx.stroke();
        }

        ctx.fillStyle = '#c59b3c';
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, 2 * Math.PI);
        ctx.fill();

        layer.begin();
        if (state.showLabels) {
            layer.show(pointLabel, x, y);
            layer.show(centerLabel, cx, cy);
        }
        layer.place(W, H, [Kit.overlayBox(hud, view)]);
    }

    // REPLACE: update the values shown in the side panels.
    function updatePanels() {
        $('elapsed').textContent = `${(state.t / SPEEDS[1].rate).toFixed(1)} s`;
        $('angle').textContent = `${Math.floor(state.t % 360)}°`;
    }

    function setPlaying(value) {
        state.playing = value;
        $('play').textContent = value ? 'Pause' : 'Play';
    }

    /* Controls */
    $('play').addEventListener('click', () => setPlaying(!state.playing));
    $('restart').addEventListener('click', () => {
        state.t = 0;
        dirty = true;
    });
    $('speed').addEventListener('input', (e) => {
        state.speed = Number(e.target.value);
        $('speed-value').textContent = SPEEDS[state.speed].label;
    });
    const selectOption = Kit.bindSegmented($('option'), (value) => {
        state.option = value;
        $('option-caption').textContent = OPTIONS[value].caption;
        dirty = true;
    });
    $('show-path').addEventListener('change', (e) => {
        state.showPath = e.target.checked;
        dirty = true;
    });
    $('show-labels').addEventListener('change', (e) => {
        state.showLabels = e.target.checked;
        dirty = true;
    });

    /* Start */
    $('speed-value').textContent = SPEEDS[state.speed].label;
    selectOption(state.option);
    setPlaying(state.playing);

    Kit.observeSize(view, (width, height) => {
        W = width;
        H = height;
        Kit.fitCanvas2D(canvas, ctx, W, H);
        layer.remeasure();
        draw(); // Resizing clears the canvas, so draw at once to avoid a blank frame.
    });

    Kit.startLoop((seconds) => {
        if (state.playing) {
            state.t += seconds * SPEEDS[state.speed].rate;
            dirty = true;
        }
        if (!dirty) return;
        dirty = false;
        draw();
        updatePanels();
    });
})();
