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
    // spot is free. Set label.center = true to put a label's middle exactly on its point. Set label.fixed = true to keep a label beside its point, outside this search.
    // With { wide: true }, a label with no free spot beside its point also tries
    // spots farther out, for views with many labels that must all stay on screen.
    class LabelLayer {
        constructor(root, { wide = false } = {}) {
            this.root = root;
            this.wide = wide;
            this.labels = [];
            this.shown = [];
            this.settling = false; // True while a label is still gliding to a new spot
            this.glideFrame = 0;
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
                if (!label.visible) {
                    label.el.style.display = 'none';
                    label.wasShown = false;
                }
            }
            this.settling = false;
            const taken = overlays.filter(Boolean).slice();
            const clash = (r) => taken.some((o) => r.x < o.x + o.w + 3 && o.x < r.x + r.w + 3 && r.y < o.y + o.h + 2 && o.y < r.y + r.h + 2);
            this.shown.sort((a, b) => a.label.rank - b.label.rank);
            for (const { label, x, y } of this.shown) {
                const w = label.width, h = label.height;
                // A centered label is placed with its middle exactly on the point, with no search.
                if (label.center) {
                    const r = {
                        x: Math.min(Math.max(4, x - w / 2), viewWidth - w - 4),
                        y: Math.min(Math.max(4, y - h / 2), viewHeight - h - 4),
                        w, h
                    };
                    taken.push(r);
                    label.spot = 0;
                    label.wasShown = true;
                    label.ox = label.oy = 0;
                    label.dx = label.x = r.x;
                    label.dy = label.y = r.y;
                    label.el.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`;
                    if (label.onPlace) label.onPlace(label);
                    continue;
                }
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
                const nearSpots = spots.length - (this.wide ? 24 : 0);
                let chosen = -1;
                if (label.fixed) {
                    // A fixed label stays beside its point, where it was. It does not move to
                    // avoid other labels, and other labels do not move to avoid it.
                    chosen = label.spot < spots.length ? label.spot : 0;
                } else {
                    // A label keeps its previous spot while that spot is free, so that it does not
                    // jump as the view turns. A spot from the wider search is tried only after the
                    // spots beside the point, so that a label returns to its point when it can.
                    const order = label.spot < nearSpots
                        ? [label.spot, ...spots.keys()]
                        : [...Array(nearSpots).keys(), label.spot, ...spots.keys()];
                    for (const i of order) {
                        const r = at(i);
                        // Screen edges can push a label back onto its own point, so reject that spot too.
                        const onPoint = x > r.x - 8 && x < r.x + w + 8 && y > r.y - 2 && y < r.y + h + 2;
                        if (!onPoint && !clash(r)) { chosen = i; break; }
                    }
                    if (chosen < 0) {
                        if (label.optional) {
                            label.el.style.display = 'none';
                            label.wasShown = false;
                            continue;
                        }
                        chosen = 0;
                    }
                }
                const r = at(chosen);
                if (!label.fixed) taken.push(r);

                // When a label changes spot, it glides from where it was instead of jumping. The
                // gap closes a little each frame, and the label stays exactly on its target while
                // the view moves.
                let ox = 0, oy = 0;
                if (label.wasShown) {
                    if (chosen !== label.spot) {
                        ox = label.dx - r.x;
                        oy = label.dy - r.y;
                    } else {
                        ox = (label.ox || 0) * 0.8;
                        oy = (label.oy || 0) * 0.8;
                    }
                    if (Math.abs(ox) < 0.3 && Math.abs(oy) < 0.3) ox = oy = 0;
                }
                if (ox || oy) this.settling = true;
                label.ox = ox;
                label.oy = oy;
                label.spot = chosen;
                label.wasShown = true;
                label.dx = r.x + ox;
                label.dy = r.y + oy;
                label.x = label.dx;
                label.y = label.dy;
                label.el.style.transform = `translate(${label.dx.toFixed(1)}px, ${label.dy.toFixed(1)}px)`;
                if (label.onPlace) label.onPlace(label); // For example, to clip it to match its new position
            }
            // A tool that draws only when something changes still sees each glide finish.
            if (this.settling && !this.glideFrame) {
                this.glideFrame = requestAnimationFrame(() => {
                    this.glideFrame = 0;
                    this.place(viewWidth, viewHeight, overlays);
                });
            }
        }
    }

    global.ToolKit = { observeSize, fitCanvas2D, startLoop, prefersReducedMotion, bindSegmented, overlayBox, LabelLayer };
})(window);
