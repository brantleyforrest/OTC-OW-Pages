// Shared helpers for tool pages. Load as a classic script, so that tools run from a local file.
// _template/README.md explains how to use them.
(function (global) {
    'use strict';

    // Reports a container's inner size now and after every change. Use the inner size because
    // a canvas fills the area inside the border, and any other size stretches and blurs it.
    // The callback runs before the browser paints, so a tool should redraw inside it.
    function observeSize(container, onResize) {
        const report = () => onResize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
        new ResizeObserver(report).observe(container);
        report();
    }

    // Sizes a 2D canvas for sharp drawing. Afterward, draw in CSS pixels.
    function fitCanvas2D(canvas, ctx, width, height) {
        const ratio = Math.min(global.devicePixelRatio || 1, 2);
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    // Calls step(seconds, now) once per display frame. The time step is capped, so that the
    // simulation does not jump after the browser tab has been in the background.
    function startLoop(step) {
        let last = performance.now();
        function frame(now) {
            requestAnimationFrame(frame);
            const seconds = Math.min(0.1, (now - last) / 1000);
            last = now;
            step(seconds, now);
        }
        requestAnimationFrame(frame);
    }

    function prefersReducedMotion() {
        return matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // Connects a .segmented group of buttons. Each button carries a data-value attribute.
    function bindSegmented(group, onChange) {
        const buttons = [...group.querySelectorAll('button')];
        const select = (value) => {
            for (const button of buttons) {
                button.setAttribute('aria-pressed', String(button.dataset.value === value));
            }
            onChange(value);
        };
        for (const button of buttons) {
            button.addEventListener('click', () => select(button.dataset.value));
        }
        return select;
    }

    // Returns an overlay's area in the view's coordinates, or null if it is not over the view.
    function overlayBox(overlay, view) {
        if (getComputedStyle(overlay).position !== 'absolute') return null;
        const a = overlay.getBoundingClientRect();
        const b = view.getBoundingClientRect();
        return { x: a.left - b.left - view.clientLeft, y: a.top - b.top - view.clientTop, w: a.width, h: a.height };
    }

    // Labels drawn as HTML over a canvas. Each frame:
    //     layer.begin();
    //     layer.show(label, x, y);        // for each visible label, in view coordinates
    //     layer.place(width, height, [overlayBoxes]);
    // Important labels are placed first. Each label takes a free spot beside its point, so
    // labels do not overlap each other or the overlays. An optional label is hidden when no
    // spot is free. With { wide: true }, a label with no free spot beside its point also tries
    // spots farther out, for views with many labels that must all stay on screen.
    class LabelLayer {
        constructor(root, { wide = false } = {}) {
            this.root = root;
            this.wide = wide;
            this.labels = [];
            this.shown = [];
            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(() => this.remeasure());
            }
        }

        // rank: lower numbers are placed first. optional: may be hidden when crowded.
        add(html, { rank = 1, optional = false } = {}) {
            const el = document.createElement('div');
            el.className = 'tool-label';
            el.innerHTML = html;
            el.style.display = 'none';
            this.root.appendChild(el);
            const label = { el, rank, optional, width: 0, height: 0, spot: 0 };
            this.labels.push(label);
            return label;
        }

        // Call after a resize or a change to a label's text.
        remeasure() {
            for (const label of this.labels) label.width = 0;
        }

        begin() {
            this.shown.length = 0;
            for (const label of this.labels) label.visible = false;
        }

        show(label, x, y, opacity = 1) {
            label.visible = true;
            label.el.style.display = 'block';
            label.el.style.opacity = opacity;
            if (!label.width) {
                label.width = label.el.offsetWidth;
                label.height = label.el.offsetHeight;
            }
            this.shown.push({ label, x, y });
        }

        place(viewWidth, viewHeight, overlays = []) {
            for (const label of this.labels) {
                if (!label.visible) label.el.style.display = 'none';
            }
            const taken = overlays.filter(Boolean).slice();
            const clash = (r) => taken.some((o) => r.x < o.x + o.w + 3 && o.x < r.x + r.w + 3 && r.y < o.y + o.h + 2 && o.y < r.y + r.h + 2);
            this.shown.sort((a, b) => a.label.rank - b.label.rank);
            for (const { label, x, y } of this.shown) {
                const w = label.width, h = label.height;
                const spots = [
                    [x + 10, y - h / 2], [x + 10, y - h - 6], [x + 10, y + 6],
                    [x - w - 10, y - h / 2], [x - w - 10, y - h - 6], [x - w - 10, y + 6]
                ];
                // A point beneath an overlay also gets a spot just below that overlay.
                for (const o of overlays) {
                    if (o && x > o.x - 10 && x < o.x + o.w + 10 && y > o.y - 10 && y < o.y + o.h + 10) {
                        spots.push([x + 10, o.y + o.h + 6], [o.x + o.w + 8, y - h / 2]);
                    }
                }
                if (this.wide) {
                    for (const d of [24, 42, 62]) {
                        spots.push(
                            [x + d, y - h / 2], [x - w - d, y - h / 2],
                            [x - w / 2, y - h - d], [x - w / 2, y + d],
                            [x + d, y - h - d], [x + d, y + d],
                            [x - w - d, y - h - d], [x - w - d, y + d]
                        );
                    }
                }
                const at = (i) => ({
                    x: Math.min(Math.max(4, spots[i][0]), viewWidth - w - 6),
                    y: Math.min(Math.max(4, spots[i][1]), viewHeight - h - 4),
                    w, h
                });
                // Use the usual spot when free, then the previous spot, so that labels do not jump.
                // A spot from the wider search is not kept, so that a label returns beside its point.
                const nearSpots = spots.length - (this.wide ? 24 : 0);
                const previous = label.spot < nearSpots ? label.spot : 0;
                let chosen = -1;
                for (const i of [0, previous, ...spots.keys()]) {
                    const r = at(i);
                    // Screen edges can push a label back onto its own point, so reject that spot too.
                    const onPoint = x > r.x - 8 && x < r.x + w + 8 && y > r.y - 2 && y < r.y + h + 2;
                    if (!onPoint && !clash(r)) { chosen = i; break; }
                }
                if (chosen < 0) {
                    if (label.optional) {
                        label.el.style.display = 'none';
                        continue;
                    }
                    chosen = 0;
                }
                label.spot = chosen;
                const r = at(chosen);
                taken.push(r);
                label.el.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`;
            }
        }
    }

    global.ToolKit = { observeSize, fitCanvas2D, startLoop, prefersReducedMotion, bindSegmented, overlayBox, LabelLayer };
})(window);
