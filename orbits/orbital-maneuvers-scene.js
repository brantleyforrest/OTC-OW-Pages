// 3D Scene for Orbital Maneuvers Visualizer
// Covers Hohmann Transfers, Simple Plane Changes (Inclination & Polar RAAN), and Combined Plane Changes.
(function (global) {
    'use strict';

    const Kit = global.ToolKit;
    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;
    const FOV_DEG = 40;
    const TAN_HALF_FOV = Math.tan((FOV_DEG / 2) * D2R);
    const ORBIT_SEGMENTS = 256;
    const ORBIT_SIDES = 6;
    const ARC_SEGMENTS = 96;
    const ARC_SIDES = 8;

    const COLORS = {
        eci: 0x60a5fa,
        orbit1: 0xe0b64f,
        orbit2: 0x34d399,
        transfer: 0xff8a3d,
        dv: 0xf87171,
        node: 0xfbbf24,
        theta: 0x38bdf8,
        tof: 0xc4a1ff,
        radius: 0xf0f4fa
    };

    const ORDER = { planes: 2, ghost: 6 };

    function create(THREE, dom, constants) {
        const R_E = constants.R_EARTH;
        const { view, canvas, hint, labels } = dom;

        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        } catch (err) {
            if (dom.showStatus) dom.showStatus('This browser could not initialize WebGL. Live values and equations still work.');
            return null;
        }

        renderer.setClearColor(0x03060c);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 900);
        camera.up.set(0, 0, 1); // Z is North

        scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
        sunLight.position.set(12, 6, 8);
        scene.add(sunLight);

        const earth = window.EarthScene.addEarth(THREE, renderer, scene);
        if (earth && earth.atmosphere) earth.atmosphere.renderOrder = 1;
        const stars = window.EarthScene.addStars(THREE, scene);

        let labelLayer = null;
        if (Kit && Kit.LabelLayer && labels) {
            labelLayer = new Kit.LabelLayer(labels, { wide: true });
        }

        const X_AXIS = new THREE.Vector3(1, 0, 0);
        const Y_AXIS = new THREE.Vector3(0, 1, 0);
        const Z_AXIS = new THREE.Vector3(0, 0, 1);
        const ORIGIN = new THREE.Vector3(0, 0, 0);

        const tmp = new THREE.Vector3();
        const tmp2 = new THREE.Vector3();
        const tmpA = new THREE.Vector3();
        const tmpB = new THREE.Vector3();
        const projected = new THREE.Vector3();
        const toPoint = new THREE.Vector3();

        const sizers = [];
        let sz = 0.1;

        // Camera state
        const cam = {
            az: 28,
            el: 38,
            dist: 12,
            target: new THREE.Vector3(0, 0, 0)
        };
        let homeView = { az: 28, el: 38, dist: 12 };
        let lastFrameReach = 0;

        function updateCamera() {
            const radAz = cam.az * D2R;
            const radEl = cam.el * D2R;
            const cx = cam.dist * Math.cos(radEl) * Math.cos(radAz);
            const cy = cam.dist * Math.cos(radEl) * Math.sin(radAz);
            const cz = cam.dist * Math.sin(radEl);
            camera.position.set(cx + cam.target.x, cy + cam.target.y, cz + cam.target.z);
            camera.lookAt(cam.target);
        }

        /* ------------------------------------------------------------------ */
        /* Ghosted Mesh & Geometry Builders                                   */
        /* ------------------------------------------------------------------ */
        function ghosted(geometry, color, ghost = 0.35) {
            const group = new THREE.Group();
            const solidMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
            const ghostMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: ghost, depthTest: false, depthWrite: false });
            const solid = new THREE.Mesh(geometry, solidMat);
            const dim = new THREE.Mesh(geometry, ghostMat);
            dim.renderOrder = ORDER.ghost;
            solid.frustumCulled = false;
            dim.frustumCulled = false;
            group.add(solid, dim);
            group.userData = { solidMat, ghostMat, ghost, parts: [solid, dim] };
            return group;
        }

        function setOpacity(group, k) {
            if (!group || !group.userData || !group.userData.solidMat) return;
            const { solidMat, ghostMat, ghost } = group.userData;
            solidMat.opacity = k;
            ghostMat.opacity = ghost * k;
        }

        function setGeometry(group, geometry) {
            if (!group || !group.userData) return;
            if (group.userData.parts[0].geometry) {
                group.userData.parts[0].geometry.dispose();
            }
            group.userData.parts.forEach((p) => { p.geometry = geometry; });
        }

        const SHAFT_GEO = new THREE.CylinderGeometry(1, 1, 1, 10);
        const HEAD_GEO = new THREE.ConeGeometry(0.5, 1.6, 14);
        const SPHERE_GEO = new THREE.SphereGeometry(1, 16, 12);

        function createArrow(color) {
            const group = new THREE.Group();
            const shaft = ghosted(SHAFT_GEO, color);
            const head = ghosted(HEAD_GEO, color);
            group.add(shaft, head);
            scene.add(group);
            return { group, shaft, head };
        }

        function placeArrow(arrow, from, to, sizeScale, weight = 1, opacity = 1) {
            tmp.subVectors(to, from);
            const len = tmp.length();
            if (len < 1e-4 || opacity < 0.01) {
                arrow.group.visible = false;
                return;
            }
            arrow.group.visible = true;
            const thick = weight * sizeScale;
            const headLen = Math.min(3.2 * thick, len * 0.45);
            const shaftLen = Math.max(1e-4, len - headLen);

            arrow.group.position.copy(from);
            arrow.group.quaternion.setFromUnitVectors(Y_AXIS, tmp.normalize());

            arrow.shaft.scale.set(0.18 * thick, shaftLen, 0.18 * thick);
            arrow.shaft.position.y = shaftLen / 2;

            arrow.head.scale.set(thick * 0.9, headLen, thick * 0.9);
            arrow.head.position.y = shaftLen + headLen / 2;

            setOpacity(arrow.shaft, opacity);
            setOpacity(arrow.head, opacity);
        }

        function createMarker(color, size = 0.35) {
            const marker = ghosted(SPHERE_GEO, color, 0.4);
            marker.userData.size = size;
            scene.add(marker);
            return marker;
        }

        function placeMarker(marker, position, opacity = 1, customScale = 1) {
            if (!marker) return;
            if (opacity < 0.01) {
                marker.visible = false;
                return;
            }
            marker.visible = true;
            marker.position.copy(position);
            const baseSize = marker.userData.size || 0.35;
            marker.scale.setScalar(baseSize * sz * customScale);
            setOpacity(marker, opacity);
        }

        class PathCurve extends THREE.Curve {
            constructor(fn, segments = ORBIT_SEGMENTS) {
                super();
                this.fn = fn;
                this.arcLengthDivisions = segments;
            }
            getPoint(t, target = new THREE.Vector3()) {
                return this.fn(t, target);
            }
        }

        function createTube(color, { arc = false, radius = arc ? 0.28 : 0.2, ghost = 0.3 } = {}) {
            const tube = ghosted(new THREE.BufferGeometry(), color, ghost);
            scene.add(tube);
            return {
                tube,
                radius,
                key: '',
                curve: null,
                segments: arc ? ARC_SEGMENTS : ORBIT_SEGMENTS,
                sides: arc ? ARC_SIDES : ORBIT_SIDES
            };
        }

        function drawTube(tObj, pointAt, key, opacity = 1, radiusMult = 1) {
            if (!tObj) return;
            if (opacity < 0.01) {
                tObj.tube.visible = false;
                return;
            }
            tObj.tube.visible = true;
            if (tObj.key !== key) {
                tObj.key = key;
                tObj.curve = new PathCurve(pointAt, tObj.segments);
                setGeometry(tObj.tube, new THREE.TubeGeometry(tObj.curve, tObj.segments, tObj.radius * sz * radiusMult, tObj.sides, false));
            }
            setOpacity(tObj.tube, opacity);
        }

        function createDisc(color, fillOpacity = 0.15, rimOpacity = 0.6) {
            const group = new THREE.Group();
            const fill = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
            const disk = new THREE.Mesh(new THREE.CircleGeometry(1, 96), fill);
            disk.renderOrder = ORDER.planes;

            const rim = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
            const points = [];
            for (let j = 0; j <= 120; j++) {
                const angle = (j / 120) * 2 * Math.PI;
                points.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0));
            }
            const rimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), rim);
            group.add(disk, rimLine);
            scene.add(group);
            return { group, fill, rim, fillOpacity, rimOpacity };
        }

        function placeDisc(disc, radius, opacity = 1) {
            if (!disc) return;
            if (opacity < 0.01) {
                disc.group.visible = false;
                return;
            }
            disc.group.visible = true;
            disc.group.scale.setScalar(radius);
            disc.fill.opacity = disc.fillOpacity * opacity;
            disc.rim.opacity = disc.rimOpacity * opacity;
        }

        function createDashedLine(color) {
            const mat = new THREE.LineDashedMaterial({
                color,
                dashSize: 0.25,
                gapSize: 0.15,
                transparent: true,
                opacity: 0.5
            });
            const line = new THREE.Line(new THREE.BufferGeometry(), mat);
            line.frustumCulled = false;
            scene.add(line);
            return { line, mat };
        }

        function setDashedPoints(dLine, points, opacity = 0.5) {
            if (!dLine) return;
            if (opacity < 0.01 || !points || points.length < 2) {
                dLine.line.visible = false;
                return;
            }
            dLine.line.visible = true;
            dLine.mat.opacity = opacity;
            dLine.line.geometry.dispose();
            dLine.line.geometry = new THREE.BufferGeometry().setFromPoints(points);
            dLine.line.computeLineDistances();
        }

        /* ------------------------------------------------------------------ */
        /* Orbits & Math Helpers                                              */
        /* ------------------------------------------------------------------ */
        function orbitPoint(r, inc, raan, u, out = new THREE.Vector3()) {
            const i = inc * D2R, o = raan * D2R, a = u * D2R;
            return out.set(
                r * (Math.cos(o) * Math.cos(a) - Math.sin(o) * Math.sin(a) * Math.cos(i)),
                r * (Math.sin(o) * Math.cos(a) + Math.cos(o) * Math.sin(a) * Math.cos(i)),
                r * Math.sin(a) * Math.sin(i)
            );
        }

        function orbitTangent(inc, raan, u, out = new THREE.Vector3()) {
            const i = inc * D2R, o = raan * D2R, a = u * D2R;
            return out.set(
                -Math.cos(o) * Math.sin(a) - Math.sin(o) * Math.cos(a) * Math.cos(i),
                -Math.sin(o) * Math.sin(a) + Math.cos(o) * Math.cos(a) * Math.cos(i),
                Math.cos(a) * Math.sin(i)
            ).normalize();
        }

        function turnArc(point, fromDir, toDir, radius) {
            const u = fromDir.clone().normalize();
            const w = toDir.clone().normalize();
            const cross = new THREE.Vector3().crossVectors(u, w);
            const n = cross.lengthSq() > 1e-8 ? new THREE.Vector3().crossVectors(cross, u).normalize() : Y_AXIS.clone();
            const angle = Math.max(0, Math.min(Math.PI, u.angleTo(w)));
            return (t, out = new THREE.Vector3()) =>
                out.copy(point)
                    .addScaledVector(u, radius * Math.cos(angle * t))
                    .addScaledVector(n, radius * Math.sin(angle * t));
        }

        // Kepler solver for transfer orbit
        function transferTrueAnomaly(tFrac, eSigned) {
            const e = Math.abs(eSigned);
            const raise = eSigned >= 0;
            const M = Math.PI * (raise ? tFrac : 1 + tFrac);
            let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
            for (let k = 0; k < 12; k++) {
                const diff = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
                E -= diff;
                if (Math.abs(diff) < 1e-9) break;
            }
            const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
            return nu * R2D - (raise ? 0 : 180);
        }

        function burnAt(P, before, after) {
            const collinear = before.angleTo(after) < 0.5 * D2R;
            const offset = collinear ? P.clone().normalize().multiplyScalar(0.09 * Math.max(before.length(), after.length())) : new THREE.Vector3();
            const afterFrom = P.clone().add(offset);
            const tipBefore = P.clone().add(before);
            const tipAfter = afterFrom.clone().add(after);
            return {
                P,
                collinear,
                offset,
                afterFrom,
                tipBefore,
                tipAfter,
                dvFrom: tipBefore.clone().sub(offset),
                dvEnd: P.clone().sub(offset).add(after),
                before,
                after
            };
        }

        /* ------------------------------------------------------------------ */
        /* Scene Graph Allocation                                             */
        /* ------------------------------------------------------------------ */
        // Axes
        const axisI = createArrow(COLORS.eci);
        const axisJ = createArrow(COLORS.eci);
        const axisK = createArrow(COLORS.eci);

        // Orbits and Tubes
        const orbit1Tube = createTube(COLORS.orbit1);
        const orbit2Tube = createTube(COLORS.orbit2);
        const transferActiveTube = createTube(COLORS.transfer);
        const transferFaintTube = createTube(COLORS.transfer, { radius: 0.12, ghost: 0.18 });
        const thetaArcTube = createTube(COLORS.theta, { arc: true });
        const duArcTube = createTube(COLORS.tof, { arc: true });
        const raanArcTube = createTube(COLORS.node, { arc: true });

        // Planes & Discs
        const equatorDisc = createDisc(0x3a82f7, 0.14, 0.5);

        // Dashed lines (apsides, nodes)
        const apsidesLine = createDashedLine(0x94a3b8);
        const nodeLine = createDashedLine(COLORS.node);

        // Velocity Arrows
        const vBefore1 = createArrow(COLORS.orbit1);
        const vAfter1 = createArrow(COLORS.transfer);
        const vDv1 = createArrow(COLORS.dv);

        const vBefore2 = createArrow(COLORS.transfer);
        const vAfter2 = createArrow(COLORS.orbit2);
        const vDv2 = createArrow(COLORS.dv);

        // Markers
        const burn1Marker = createMarker(COLORS.dv, 0.45);
        const burn2Marker = createMarker(COLORS.dv, 0.45);
        const burn3Marker = createMarker(COLORS.dv, 0.45);
        const node1Marker = createMarker(COLORS.node, 0.35);
        const node2Marker = createMarker(COLORS.node, 0.35);

        // Spacecraft
        const spacecraft = createMarker(0xffffff, 0.52);

        /* ------------------------------------------------------------------ */
        /* Labels Setup                                                       */
        /* ------------------------------------------------------------------ */
        const mathFn = global.PracticeMath ? global.PracticeMath.math : (s) => s;

        function addMeasureLabel(tex, color, rank = 1) {
            if (!labelLayer) return null;
            const item = labelLayer.add(`<span style="color:${color}">${mathFn(tex)}</span><span class="val"></span>`, { rank });
            item.el.classList.add('measure');
            item.valEl = item.el.querySelector('.val');
            return item;
        }

        function addAxisLabel(letter) {
            if (!labelLayer) return null;
            const item = labelLayer.add(mathFn(`\\mathbf{\\hat{${letter}}}`), { rank: 1 });
            item.el.classList.add('axis');
            item.center = true;
            return item;
        }

        function addWordLabel(rank = 2, optional = false) {
            if (!labelLayer) return null;
            const item = labelLayer.add('', { rank, optional });
            item.el.classList.add('word');
            return item;
        }

        const sceneLabels = {
            I: addAxisLabel('I'),
            J: addAxisLabel('J'),
            K: addAxisLabel('K'),
            R1: addMeasureLabel('R_1', '#e0b64f', 1),
            R2: addMeasureLabel('R_2', '#34d399', 1),
            r: addMeasureLabel('r', '#f0f4fa', 1),
            atx: addMeasureLabel('a_{tx}', '#ff8a3d', 0),
            v1: addMeasureLabel('V_1', '#e0b64f', 1),
            v2: addMeasureLabel('V_2', '#34d399', 1),
            vtx1: addMeasureLabel('V_{tx_1}', '#ff8a3d', 1),
            vtx2: addMeasureLabel('V_{tx_2}', '#ff8a3d', 1),
            dv1: addMeasureLabel('\\Delta V_1', '#f87171', 0),
            dv2: addMeasureLabel('\\Delta V_2', '#f87171', 0),
            dv: addMeasureLabel('\\Delta V', '#f87171', 0),
            theta: addMeasureLabel('\\Delta \\theta', '#38bdf8', 0),
            du: addMeasureLabel('\\Delta u', '#c4a1ff', 1),
            nodeWord: addWordLabel(2, true),
            poleWord: addWordLabel(2, true)
        };

        function setLabelText(lbl, text) {
            if (!lbl || !lbl.valEl) return;
            if (lbl.valEl.textContent !== text) {
                lbl.valEl.textContent = text;
                lbl.width = 0;
            }
        }

        function setWordText(lbl, text) {
            if (!lbl || !lbl.el) return;
            if (lbl.el.textContent !== text) {
                lbl.el.textContent = text;
                lbl.width = 0;
            }
        }

        // Earth blocking test
        function isBlocked(point) {
            toPoint.copy(point).sub(camera.position);
            const distance = toPoint.length();
            if (distance < 1e-4) return false;
            toPoint.divideScalar(distance);
            const along = -camera.position.dot(toPoint);
            const offCenter = camera.position.lengthSq() - along * along;
            if (offCenter >= 1.0) return false;
            const entry = along - Math.sqrt(Math.max(0, 1.0 - offCenter));
            return entry > 0 && entry < distance;
        }

        /* ------------------------------------------------------------------ */
        /* Active State & Visual Data                                         */
        /* ------------------------------------------------------------------ */
        let currentModel = null;
        let currentTime = 0;
        let shownConfig = { vectors: true, angles: true, labels: true };
        let visualData = null;

        function setModel(model) {
            currentModel = model;
            const type = model.type;
            const reach = Math.max(model.R1 || model.r || 10000, model.R2 || model.r || 10000) / R_E;

            // Update axes size
            const axisBase = Math.max(2.2, reach * 1.25);
            placeArrow(axisI, ORIGIN, new THREE.Vector3(axisBase * 1.08, 0, 0), sz, 1, 0.9);
            placeArrow(axisJ, ORIGIN, new THREE.Vector3(0, axisBase * 1.08, 0), sz, 1, 0.9);
            placeArrow(axisK, ORIGIN, new THREE.Vector3(0, 0, axisBase * 0.9), sz, 1, 0.9);

            // Compute visual layout based on type
            if (type === 'hohmann') {
                buildHohmannData(model, reach, axisBase);
            } else if (type === 'inclination') {
                buildInclinationData(model, reach, axisBase);
            } else if (type === 'polar_raan') {
                buildPolarRaanData(model, reach, axisBase);
            } else if (type === 'combined') {
                buildCombinedData(model, reach, axisBase);
            }

            // Adjust camera distance if scale changed significantly
            if (lastFrameReach > 0 && Math.abs(reach - lastFrameReach) / lastFrameReach > 0.15) {
                cam.dist = Math.max(3.0, reach * 2.2);
            }
            lastFrameReach = reach;
        }

        /* ------------------------------------------------------------------ */
        /* 1. Hohmann Transfer Data                                           */
        /* ------------------------------------------------------------------ */
        function buildHohmannData(model, reach, axisBase) {
            const R1_n = model.R1 / R_E;
            const R2_n = model.R2 / R_E;
            const atx_n = model.a_tx / R_E;
            const isRaise = model.isRaise;
            const noTransfer = Math.abs(R1_n - R2_n) < 1e-4;

            const P1 = new THREE.Vector3(R1_n, 0, 0);
            const P2 = new THREE.Vector3(-R2_n, 0, 0);

            // Velocity vectors scale
            const maxV = Math.max(model.v1, model.v_tx1, model.v2, model.v_tx2);
            const vScale = (0.42 * R1_n) / Math.max(1e-4, maxV);

            const v1Vec = new THREE.Vector3(0, model.v1 * vScale, 0);
            const vtx1Vec = new THREE.Vector3(0, model.v_tx1 * vScale, 0);
            const b1 = burnAt(P1, v1Vec, vtx1Vec);

            const vtx2Vec = new THREE.Vector3(0, -model.v_tx2 * vScale, 0);
            const v2Vec = new THREE.Vector3(0, -model.v2 * vScale, 0);
            const b2 = burnAt(P2, vtx2Vec, v2Vec);

            const eSigned = (R2_n - R1_n) / (R1_n + R2_n);
            const p = atx_n * (1 - eSigned * eSigned);

            const transferPt = (uDeg, out = new THREE.Vector3()) => {
                const r = p / (1 + eSigned * Math.cos(uDeg * D2R));
                return out.set(r * Math.cos(uDeg * D2R), r * Math.sin(uDeg * D2R), 0);
            };

            visualData = {
                type: 'hohmann',
                reach,
                noTransfer,
                b1,
                b2,
                P1,
                P2,
                R1_n,
                R2_n,
                atx_n,
                isRaise,
                eSigned,
                axisBase,
                ring1: (t, out) => out.set(R1_n * Math.cos(t * 2 * Math.PI), R1_n * Math.sin(t * 2 * Math.PI), 0),
                ring2: (t, out) => out.set(R2_n * Math.cos(t * 2 * Math.PI), R2_n * Math.sin(t * 2 * Math.PI), 0),
                activeTx: (t, out) => transferPt(t * 180, out),
                faintTx: (t, out) => transferPt(180 + t * 180, out)
            };

            homeView = { az: 28, el: 42, dist: Math.max(3.5, reach * 2.2) };
        }

        /* ------------------------------------------------------------------ */
        /* 2. Inclination Change Data                                         */
        /* ------------------------------------------------------------------ */
        function buildInclinationData(model, reach, axisBase) {
            const r_n = model.r / R_E;
            const i1 = model.i1;
            const i2 = model.i2;
            const raan = model.raan;
            const u_sc = model.u_sc;
            const uBurn = model.u_burn;
            const coast = model.delta_u_to_node;
            const planesMatch = Math.abs(i1 - i2) < 1e-3;

            const satPos = orbitPoint(r_n, i1, raan, u_sc);
            const burnPos = orbitPoint(r_n, i1, raan, uBurn);
            const otherNodePos = orbitPoint(r_n, i1, raan, uBurn + 180);

            const vLen = 0.42 * r_n;
            const vScale = vLen / Math.max(1e-4, model.v);

            const T1 = orbitTangent(i1, raan, uBurn).multiplyScalar(vLen);
            const T2 = orbitTangent(i2, raan, uBurn).multiplyScalar(vLen);
            const b = burnAt(burnPos, T1, T2);

            const along = new THREE.Vector3(Math.cos(raan * D2R), Math.sin(raan * D2R), 0);

            visualData = {
                type: 'inclination',
                reach,
                planesMatch,
                r_n,
                satPos,
                burnPos,
                otherNodePos,
                coast,
                u_sc,
                uBurn,
                b,
                axisBase,
                ring1: (t, out) => orbitPoint(r_n, i1, raan, t * 360, out),
                ring2: (t, out) => orbitPoint(r_n, i2, raan, t * 360, out),
                duArc: (t, out) => orbitPoint(r_n, i1, raan, u_sc + t * coast, out),
                thetaArc: turnArc(burnPos, T1, T2, 0.45 * vLen),
                nodeLinePts: [along.clone().multiplyScalar(-r_n * 1.3), along.clone().multiplyScalar(r_n * 1.3)]
            };

            homeView = { az: raan + 35, el: 26, dist: Math.max(3.2, reach * 2.2) };
        }

        /* ------------------------------------------------------------------ */
        /* 3. Polar RAAN Change Data                                          */
        /* ------------------------------------------------------------------ */
        function buildPolarRaanData(model, reach, axisBase) {
            const r_n = model.r / R_E;
            const raan1 = model.raan1;
            const raan2 = model.raan2;
            const u_sc = model.u_sc;
            const uBurn = model.u_burn;
            const coast = model.delta_u_to_pole;
            const planesMatch = Math.abs(raan1 - raan2) < 1e-3;

            const satPos = orbitPoint(r_n, 90, raan1, u_sc);
            const burnPos = orbitPoint(r_n, 90, raan1, uBurn);
            const otherPolePos = orbitPoint(r_n, 90, raan1, uBurn + 180);

            const vLen = 0.42 * r_n;
            const T1 = orbitTangent(90, raan1, uBurn).multiplyScalar(vLen);
            const T2 = orbitTangent(90, raan2, uBurn).multiplyScalar(vLen);
            const b = burnAt(burnPos, T1, T2);

            visualData = {
                type: 'polar_raan',
                reach,
                planesMatch,
                r_n,
                satPos,
                burnPos,
                otherPolePos,
                coast,
                u_sc,
                uBurn,
                b,
                axisBase,
                ring1: (t, out) => orbitPoint(r_n, 90, raan1, t * 360, out),
                ring2: (t, out) => orbitPoint(r_n, 90, raan2, t * 360, out),
                duArc: (t, out) => orbitPoint(r_n, 90, raan1, u_sc + t * coast, out),
                thetaArc: turnArc(burnPos, T1, T2, 0.45 * vLen),
                nodeLinePts: [new THREE.Vector3(0, 0, -r_n * 1.3), new THREE.Vector3(0, 0, r_n * 1.3)]
            };

            const midRaan = (raan1 + raan2) / 2;
            homeView = { az: midRaan + 45, el: 32, dist: Math.max(3.2, reach * 2.2) };
        }

        /* ------------------------------------------------------------------ */
        /* 4. Combined Plane Change Data                                      */
        /* ------------------------------------------------------------------ */
        function buildCombinedData(model, reach, axisBase) {
            const R1_n = model.R1 / R_E;
            const R2_n = model.R2 / R_E;
            const atx_n = model.a_tx / R_E;
            const isRaise = model.isRaise;
            const loc = model.planeChangeLocation || 'higher'; // 'higher' | 'lower' | 'separate'

            // Inclinations
            const i1 = model.i1;
            const i2 = model.i2;
            const deltaTheta = Math.abs(i2 - i1);

            // Plane of transfer orbit
            let iTransfer = i1;
            if (loc === 'higher') {
                iTransfer = isRaise ? i1 : i2;
            } else if (loc === 'lower') {
                iTransfer = isRaise ? i2 : i1;
            } else {
                // separate: transfer is in plane 1
                iTransfer = i1;
            }

            const P1 = orbitPoint(R1_n, i1, 0, 0);
            const P2 = orbitPoint(R2_n, i2, 0, 180);

            const maxV = Math.max(model.v1, model.v_tx1, model.v2, model.v_tx2);
            const vScale = (0.42 * R1_n) / Math.max(1e-4, maxV);

            // Velocity vectors at Burn 1 (u = 0)
            const v1Dir = orbitTangent(i1, 0, 0);
            const vtx1Dir = orbitTangent(iTransfer, 0, 0);
            const v1Vec = v1Dir.clone().multiplyScalar(model.v1 * vScale);
            const vtx1Vec = vtx1Dir.clone().multiplyScalar(model.v_tx1 * vScale);
            const b1 = burnAt(P1, v1Vec, vtx1Vec);

            // Velocity vectors at Burn 2 (u = 180)
            const vtx2Dir = orbitTangent(iTransfer, 0, 180);
            const v2Dir = orbitTangent(loc === 'separate' ? i1 : i2, 0, 180);
            const vtx2Vec = vtx2Dir.clone().multiplyScalar(model.v_tx2 * vScale);
            const v2Vec = v2Dir.clone().multiplyScalar(model.v2 * vScale);
            const b2 = burnAt(P2, vtx2Vec, v2Vec);

            // If separate burn, define Burn 3 at higher orbit
            let b3 = null;
            if (loc === 'separate') {
                const highP = isRaise ? P2 : P1;
                const highR = isRaise ? R2_n : R1_n;
                const highU = isRaise ? 180 : 0;
                const highV = isRaise ? model.v2 : model.v1;
                const T_old = orbitTangent(i1, 0, highU).multiplyScalar(highV * vScale);
                const T_new = orbitTangent(i2, 0, highU).multiplyScalar(highV * vScale);
                b3 = burnAt(highP, T_old, T_new);
            }

            const eSigned = (R2_n - R1_n) / (R1_n + R2_n);
            const p = atx_n * (1 - eSigned * eSigned);

            const transferPt = (uDeg, out = new THREE.Vector3()) => {
                const r = p / (1 + eSigned * Math.cos(uDeg * D2R));
                return orbitPoint(r, iTransfer, 0, uDeg, out);
            };

            // Law of cosines triangle at whichever burn carries the plane change
            const combinedBurnObj = (loc === 'lower' ? (isRaise ? b1 : b2) : (isRaise ? b2 : b1));
            const thetaArc = deltaTheta > 0.01 ? turnArc(combinedBurnObj.P, combinedBurnObj.before, combinedBurnObj.after, 0.45 * combinedBurnObj.before.length()) : null;

            visualData = {
                type: 'combined',
                reach,
                b1,
                b2,
                b3,
                P1,
                P2,
                R1_n,
                R2_n,
                atx_n,
                isRaise,
                i1,
                i2,
                iTransfer,
                loc,
                eSigned,
                axisBase,
                ring1: (t, out) => orbitPoint(R1_n, i1, 0, t * 360, out),
                ring2: (t, out) => orbitPoint(R2_n, i2, 0, t * 360, out),
                activeTx: (t, out) => transferPt(t * 180, out),
                faintTx: (t, out) => transferPt(180 + t * 180, out),
                thetaArc
            };

            homeView = { az: 32, el: 38, dist: Math.max(3.5, reach * 2.2) };
        }

        /* ------------------------------------------------------------------ */
        /* Spacecraft & Dynamic Timeline Placement                            */
        /* ------------------------------------------------------------------ */
        function setTime(t) {
            currentTime = Math.max(0, Math.min(1, t));
            if (!visualData) return;

            const d = visualData;
            const satPos = tmp;
            let currentPhase = 'coast1';

            if (d.type === 'hohmann' || d.type === 'combined') {
                const isSep = d.loc === 'separate';
                // Hohmann / Combined phases:
                // 0.00 - 0.20 : coast orbit 1
                // 0.20 - 0.25 : burn 1
                // 0.25 - 0.75 : fly transfer
                // 0.75 - 0.80 : burn 2
                // 0.80 - 1.00 : coast orbit 2
                // (for separate burn: 0.78-0.83 is burn 3)
                if (currentTime < 0.20) {
                    currentPhase = 'coast1';
                    const prog = currentTime / 0.20;
                    const u = -60 * (1 - prog);
                    if (d.type === 'hohmann') {
                        satPos.set(d.R1_n * Math.cos(u * D2R), d.R1_n * Math.sin(u * D2R), 0);
                    } else {
                        orbitPoint(d.R1_n, d.i1, 0, u, satPos);
                    }
                } else if (currentTime < 0.25) {
                    currentPhase = 'burn1';
                    satPos.copy(d.P1);
                } else if (currentTime < 0.75) {
                    currentPhase = 'transfer';
                    const tFrac = (currentTime - 0.25) / 0.50;
                    const u = transferTrueAnomaly(tFrac, d.eSigned);
                    d.activeTx(u / 180, satPos);
                } else if (currentTime < 0.80) {
                    currentPhase = 'burn2';
                    satPos.copy(d.P2);
                } else if (isSep && currentTime < 0.85) {
                    currentPhase = 'burn3';
                    satPos.copy(d.isRaise ? d.P2 : d.P1);
                } else {
                    currentPhase = 'coast2';
                    const startT = isSep ? 0.85 : 0.80;
                    const prog = (currentTime - startT) / (1.0 - startT);
                    const u = 180 + 72 * prog;
                    if (d.type === 'hohmann') {
                        satPos.set(d.R2_n * Math.cos(u * D2R), d.R2_n * Math.sin(u * D2R), 0);
                    } else {
                        orbitPoint(d.R2_n, d.i2, 0, u, satPos);
                    }
                }
            } else if (d.type === 'inclination' || d.type === 'polar_raan') {
                // Plane changes:
                // 0.00 - 0.45 : coast from u_sc to burn
                // 0.45 - 0.55 : burn (velocity rotates)
                // 0.55 - 1.00 : coast on orbit 2
                if (currentTime < 0.45) {
                    currentPhase = 'coast_to_burn';
                    const prog = currentTime / 0.45;
                    const u = d.u_sc + d.coast * prog;
                    d.ring1(u / 360, satPos);
                } else if (currentTime < 0.55) {
                    currentPhase = 'burn';
                    satPos.copy(d.burnPos);
                } else {
                    currentPhase = 'coast_on_target';
                    const prog = (currentTime - 0.55) / 0.45;
                    const u = d.uBurn + (360 - d.coast) * prog;
                    d.ring2(u / 360, satPos);
                }
            }

            placeMarker(spacecraft, satPos, 1.0, currentPhase.startsWith('burn') ? 1.35 : 1.0);
            return currentPhase;
        }

        function setShown(cfg) {
            shownConfig = { ...shownConfig, ...cfg };
        }

        function resetView() {
            cam.az = homeView.az;
            cam.el = homeView.el;
            cam.dist = homeView.dist;
            cam.target.set(0, 0, 0);
            updateCamera();
        }

        /* ------------------------------------------------------------------ */
        /* Pointer / Camera Interaction                                       */
        /* ------------------------------------------------------------------ */
        const pointers = new Map();
        let pinchStart = 0;
        let pinchDist = 0;

        canvas.addEventListener('pointerdown', (e) => {
            canvas.setPointerCapture(e.pointerId);
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size === 2) {
                const [p1, p2] = [...pointers.values()];
                pinchStart = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                pinchDist = cam.dist;
            }
            if (hint) hint.style.display = 'none';
        });

        canvas.addEventListener('pointermove', (e) => {
            const last = pointers.get(e.pointerId);
            if (!last) return;
            if (pointers.size === 1) {
                cam.az = (cam.az - (e.clientX - last.x) * 0.35 + 360) % 360;
                cam.el = Math.max(-84, Math.min(84, cam.el + (e.clientY - last.y) * 0.3));
            }
            last.x = e.clientX;
            last.y = e.clientY;
            if (pointers.size === 2 && pinchStart > 0) {
                const [p1, p2] = [...pointers.values()];
                const distNow = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                if (distNow > 10) {
                    cam.dist = Math.max(2.4, Math.min(45.0, (pinchDist * pinchStart) / distNow));
                }
            }
        });

        const removePointer = (e) => pointers.delete(e.pointerId);
        canvas.addEventListener('pointerup', removePointer);
        canvas.addEventListener('pointercancel', removePointer);

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            cam.dist = Math.max(2.4, Math.min(45.0, cam.dist * Math.exp(e.deltaY * 0.0012)));
        }, { passive: false });

        if (dom.reset) dom.reset.addEventListener('click', resetView);

        /* ------------------------------------------------------------------ */
        /* Render Loop                                                        */
        /* ------------------------------------------------------------------ */
        let lastTime = performance.now();

        function render(now) {
            requestAnimationFrame(render);
            const dt = Math.min(0.1, (now - lastTime) / 1000);
            lastTime = now;

            // Slowly rotate Earth
            if (earth && earth.pivot) {
                earth.pivot.rotation.z += dt * 0.03;
            }

            // Sizing based on camera distance
            sz = cam.dist / 85;
            const unitKey = Math.round(Math.log(sz) * 16);
            sizers.forEach((fn) => fn(sz, unitKey));

            updateCamera();
            if (stars && stars.follow) stars.follow(camera);

            // Update Geometry and Elements
            updateActiveGeometry();

            renderer.render(scene, camera);

            // Update Labels
            if (labelLayer) {
                updateLabels();
            }
        }
        requestAnimationFrame(render);

        function updateActiveGeometry() {
            if (!visualData) return;
            const d = visualData;
            const vecVis = shownConfig.vectors;
            const angVis = shownConfig.angles;

            if (d.type === 'hohmann') {
                // Orbit 1 and Orbit 2
                drawTube(orbit1Tube, d.ring1, `h_r1_${d.R1_n.toFixed(2)}`, 1.0);
                drawTube(orbit2Tube, d.ring2, `h_r2_${d.R2_n.toFixed(2)}`, d.noTransfer ? 0 : 1.0);

                // Transfer
                if (!d.noTransfer) {
                    drawTube(transferActiveTube, d.activeTx, `h_tx_${d.atx_n.toFixed(2)}`, 1.0);
                    drawTube(transferFaintTube, d.faintTx, `h_tx_faint_${d.atx_n.toFixed(2)}`, 0.28);
                    setDashedPoints(apsidesLine, [new THREE.Vector3(-d.R2_n * 1.15, 0, 0), new THREE.Vector3(d.R1_n * 1.15, 0, 0)], 0.35);

                    placeMarker(burn1Marker, d.P1, 1.0);
                    placeMarker(burn2Marker, d.P2, 1.0);

                    // Vectors
                    if (vecVis) {
                        const b1Level = (currentTime >= 0.20 && currentTime < 0.25) ? 1.0 : (currentTime < 0.20 ? 0.35 : 0.7);
                        const b2Level = (currentTime >= 0.75 && currentTime < 0.80) ? 1.0 : (currentTime < 0.75 ? 0.35 : 0.7);

                        placeArrow(vBefore1, d.b1.P, d.b1.tipBefore, sz, 1.1, b1Level);
                        placeArrow(vAfter1, d.b1.afterFrom, d.b1.tipAfter, sz, 1.1, b1Level);
                        placeArrow(vDv1, d.b1.dvFrom, d.b1.dvEnd, sz, 1.4, b1Level);

                        placeArrow(vBefore2, d.b2.P, d.b2.tipBefore, sz, 1.1, b2Level);
                        placeArrow(vAfter2, d.b2.afterFrom, d.b2.tipAfter, sz, 1.1, b2Level);
                        placeArrow(vDv2, d.b2.dvFrom, d.b2.dvEnd, sz, 1.4, b2Level);
                    } else {
                        hideArrows();
                    }
                } else {
                    transferActiveTube.tube.visible = false;
                    transferFaintTube.tube.visible = false;
                    apsidesLine.line.visible = false;
                    burn1Marker.visible = false;
                    burn2Marker.visible = false;
                    hideArrows();
                }

                thetaArcTube.tube.visible = false;
                duArcTube.tube.visible = false;
                nodeLine.line.visible = false;
                equatorDisc.group.visible = false;
                burn3Marker.visible = false;
                node1Marker.visible = false;
                node2Marker.visible = false;

            } else if (d.type === 'inclination' || d.type === 'polar_raan') {
                const isPolar = d.type === 'polar_raan';
                drawTube(orbit1Tube, d.ring1, `inc_r1_${d.r_n.toFixed(2)}`, 1.0);
                drawTube(orbit2Tube, d.ring2, `inc_r2_${d.r_n.toFixed(2)}`, d.planesMatch ? 0 : 0.95);

                transferActiveTube.tube.visible = false;
                transferFaintTube.tube.visible = false;
                apsidesLine.line.visible = false;
                burn2Marker.visible = false;
                burn3Marker.visible = false;

                // Equator disc
                placeDisc(equatorDisc, d.axisBase * 0.92, 0.5);

                // Line of nodes or polar crossing line
                setDashedPoints(nodeLine, d.nodeLinePts, 0.45);

                if (!d.planesMatch) {
                    placeMarker(burn1Marker, d.burnPos, 1.0, 1.1);
                    placeMarker(node1Marker, d.otherNodePos, 0.7);

                    // du arc
                    if (angVis && d.coast > 1.0) {
                        drawTube(duArcTube, d.duArc, `du_${d.coast.toFixed(1)}`, 0.85);
                    } else {
                        duArcTube.tube.visible = false;
                    }

                    // theta arc
                    if (angVis && d.thetaArc) {
                        drawTube(thetaArcTube, d.thetaArc, `theta_${d.type}`, 0.9);
                    } else {
                        thetaArcTube.tube.visible = false;
                    }

                    // Vectors
                    if (vecVis) {
                        const inBurn = currentTime >= 0.45 && currentTime < 0.55;
                        const bLevel = inBurn ? 1.0 : (currentTime < 0.45 ? 0.35 : 0.75);

                        placeArrow(vBefore1, d.b.P, d.b.tipBefore, sz, 1.1, bLevel);
                        placeArrow(vAfter1, d.b.P, d.b.tipAfter, sz, 1.1, bLevel);
                        placeArrow(vDv1, d.b.tipBefore, d.b.tipAfter, sz, 1.4, bLevel);
                    } else {
                        hideArrows();
                    }
                } else {
                    burn1Marker.visible = false;
                    node1Marker.visible = false;
                    duArcTube.tube.visible = false;
                    thetaArcTube.tube.visible = false;
                    hideArrows();
                }

            } else if (d.type === 'combined') {
                drawTube(orbit1Tube, d.ring1, `c_r1_${d.R1_n.toFixed(2)}`, 1.0);
                drawTube(orbit2Tube, d.ring2, `c_r2_${d.R2_n.toFixed(2)}`, 1.0);
                drawTube(transferActiveTube, d.activeTx, `c_tx_${d.atx_n.toFixed(2)}`, 1.0);
                drawTube(transferFaintTube, d.faintTx, `c_tx_faint_${d.atx_n.toFixed(2)}`, 0.28);

                placeDisc(equatorDisc, d.axisBase * 0.92, 0.35);

                placeMarker(burn1Marker, d.P1, 1.0);
                placeMarker(burn2Marker, d.P2, 1.0);
                if (d.b3) {
                    placeMarker(burn3Marker, d.b3.P, 0.9);
                } else {
                    burn3Marker.visible = false;
                }

                // Theta arc at combined burn
                if (angVis && d.thetaArc) {
                    drawTube(thetaArcTube, d.thetaArc, 'c_theta', 0.9);
                } else {
                    thetaArcTube.tube.visible = false;
                }

                duArcTube.tube.visible = false;
                nodeLine.line.visible = false;
                node1Marker.visible = false;
                node2Marker.visible = false;
                apsidesLine.line.visible = false;

                if (vecVis) {
                    const b1Level = (currentTime >= 0.20 && currentTime < 0.25) ? 1.0 : (currentTime < 0.20 ? 0.35 : 0.7);
                    const b2Level = (currentTime >= 0.75 && currentTime < 0.80) ? 1.0 : (currentTime < 0.75 ? 0.35 : 0.7);

                    placeArrow(vBefore1, d.b1.P, d.b1.tipBefore, sz, 1.1, b1Level);
                    placeArrow(vAfter1, d.b1.afterFrom, d.b1.tipAfter, sz, 1.1, b1Level);
                    placeArrow(vDv1, d.b1.dvFrom, d.b1.dvEnd, sz, 1.4, b1Level);

                    placeArrow(vBefore2, d.b2.P, d.b2.tipBefore, sz, 1.1, b2Level);
                    placeArrow(vAfter2, d.b2.afterFrom, d.b2.tipAfter, sz, 1.1, b2Level);
                    placeArrow(vDv2, d.b2.dvFrom, d.b2.dvEnd, sz, 1.4, b2Level);
                } else {
                    hideArrows();
                }
            }
        }

        function hideArrows() {
            vBefore1.group.visible = false;
            vAfter1.group.visible = false;
            vDv1.group.visible = false;
            vBefore2.group.visible = false;
            vAfter2.group.visible = false;
            vDv2.group.visible = false;
        }

        /* ------------------------------------------------------------------ */
        /* Label Layer Updates                                                */
        /* ------------------------------------------------------------------ */
        function updateLabels() {
            if (!labelLayer) return;
            labelLayer.begin();
            if (!shownConfig.labels) {
                labelLayer.place(view.clientWidth, view.clientHeight);
                return;
            }

            const w = view.clientWidth;
            const h = view.clientHeight;
            const d = visualData;

            function showLbl(lbl, pt, text) {
                if (!lbl || !pt) return;
                if (text !== undefined) setLabelText(lbl, text);
                if (isBlocked(pt)) return;
                projected.copy(pt).project(camera);
                if (projected.z < -1 || projected.z > 1) return;
                const px = (projected.x * 0.5 + 0.5) * w;
                const py = (-projected.y * 0.5 + 0.5) * h;
                labelLayer.show(lbl, px, py);
            }

            function showWord(lbl, pt, text) {
                if (!lbl || !pt) return;
                if (text !== undefined) setWordText(lbl, text);
                if (isBlocked(pt)) return;
                projected.copy(pt).project(camera);
                if (projected.z < -1 || projected.z > 1) return;
                const px = (projected.x * 0.5 + 0.5) * w;
                const py = (-projected.y * 0.5 + 0.5) * h;
                labelLayer.show(lbl, px, py);
            }

            // Axes
            const ab = d ? d.axisBase : 4;
            showLbl(sceneLabels.I, new THREE.Vector3(ab * 1.1, 0, 0));
            showLbl(sceneLabels.J, new THREE.Vector3(0, ab * 1.1, 0));
            showLbl(sceneLabels.K, new THREE.Vector3(0, 0, ab * 0.95));

            if (d && d.type === 'hohmann') {
                showLbl(sceneLabels.R1, new THREE.Vector3(0, d.R1_n, 0), `${Math.round(currentModel.R1).toLocaleString('en-US')} km`);
                if (!d.noTransfer) {
                    showLbl(sceneLabels.R2, new THREE.Vector3(0, -d.R2_n, 0), `${Math.round(currentModel.R2).toLocaleString('en-US')} km`);
                    showLbl(sceneLabels.atx, new THREE.Vector3(0, (d.R1_n - d.R2_n) / 4, 0), `${Math.round(currentModel.a_tx).toLocaleString('en-US')} km`);
                    if (shownConfig.vectors) {
                        showLbl(sceneLabels.dv1, d.b1.dvEnd, `${currentModel.dv1.toFixed(3)} km/s`);
                        showLbl(sceneLabels.dv2, d.b2.dvEnd, `${currentModel.dv2.toFixed(3)} km/s`);
                    }
                }
            } else if (d && (d.type === 'inclination' || d.type === 'polar_raan')) {
                showLbl(sceneLabels.r, new THREE.Vector3(0, d.r_n, 0), `${Math.round(currentModel.r).toLocaleString('en-US')} km`);
                if (!d.planesMatch) {
                    if (shownConfig.vectors) {
                        showLbl(sceneLabels.dv, d.b.tipAfter, `${currentModel.dv.toFixed(3)} km/s`);
                    }
                    if (shownConfig.angles) {
                        showLbl(sceneLabels.theta, d.burnPos.clone().add(new THREE.Vector3(0, 0, 0.3 * sz)), `${currentModel.delta_theta.toFixed(1)}°`);
                        if (d.coast > 1.0) {
                            showLbl(sceneLabels.du, d.satPos, `${Math.round(d.coast)}°`);
                        }
                    }
                    if (d.type === 'inclination') {
                        showWord(sceneLabels.nodeWord, d.burnPos, currentModel.next_node || 'Node');
                    } else {
                        showWord(sceneLabels.poleWord, d.burnPos, currentModel.next_pole || 'Pole');
                    }
                }
            } else if (d && d.type === 'combined') {
                showLbl(sceneLabels.R1, new THREE.Vector3(0, d.R1_n, 0), `${Math.round(currentModel.R1).toLocaleString('en-US')} km`);
                showLbl(sceneLabels.R2, new THREE.Vector3(0, -d.R2_n, 0), `${Math.round(currentModel.R2).toLocaleString('en-US')} km`);
                if (shownConfig.vectors) {
                    showLbl(sceneLabels.dv1, d.b1.dvEnd, `${currentModel.dv1.toFixed(3)} km/s`);
                    showLbl(sceneLabels.dv2, d.b2.dvEnd, `${currentModel.dv2.toFixed(3)} km/s`);
                }
                if (shownConfig.angles && d.thetaArc) {
                    showLbl(sceneLabels.theta, d.b2.P.clone().add(new THREE.Vector3(0, 0, 0.4 * sz)), `${currentModel.delta_theta.toFixed(1)}°`);
                }
            }

            labelLayer.place(w, h);
        }

        function resize(width, height) {
            const w = width || view.clientWidth;
            const h = height || view.clientHeight;
            if (w < 1 || h < 1) return;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
            updateCamera();
        }

        if (Kit && Kit.observeSize) {
            Kit.observeSize(view, (w, h) => resize(w, h));
        }

        return {
            setModel,
            setTime,
            setShown,
            resetView,
            resize
        };
    }

    global.ManeuverScene = { create };
})(window);
