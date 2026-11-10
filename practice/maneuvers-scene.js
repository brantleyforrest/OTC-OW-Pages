// 3D Three.js Visualization for Orbital Maneuvers:
// - Hohmann Transfers (Coplanar circular to circular, orbit raising and lowering)
// - Simple Inclination Changes (Burn at line of nodes)
// - Polar Orbit RAAN Changes (Burn at the poles)
// - Combined Plane Changes (Hohmann transfer with the plane change in the burn at the higher orbit)
// Load as a classic script.
(function (global) {
    'use strict';

    const Kit = global.ToolKit;
    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;
    const TWO_PI = 2 * Math.PI;

    const COLORS = {
        earth: '#1e3a8a',
        orbit1: '#38bdf8',    // Cyan / light blue for initial orbit
        orbit2: '#34d399',    // Emerald green for final orbit
        transfer: '#f59e0b',  // Amber / gold for transfer ellipse
        burn: '#f87171',      // Coral red for impulse delta-V vectors
        node: '#fbbf24',      // Golden yellow for node line / polar axis
        spacecraft: '#ffffff',
        equator: 'rgba(255, 255, 255, 0.18)',
        grid: '#1e293b'
    };

    function create(THREE, dom, constants) {
        const { view, canvas, labels, hint, reset, showStatus, onProgress } = dom;
        const R_E = constants.R_EARTH;

        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        } catch (err) {
            if (showStatus) showStatus('WebGL is not available in this browser.');
            return null;
        }
        renderer.setClearColor(0x060b14);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
        camera.up.set(0, 0, 1);

        // Lighting
        scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
        sunLight.position.set(12, 6, 8);
        scene.add(sunLight);

        // Earth & Stars from shared assets
        const earth = window.EarthScene ? window.EarthScene.addEarth(THREE, renderer, scene) : null;
        const stars = window.EarthScene ? window.EarthScene.addStars(THREE, scene) : null;

        // Label Layer
        const labelLayer = new Kit.LabelLayer(labels, { wide: true });

        // Root group for all maneuver objects
        const maneuverGroup = new THREE.Group();
        scene.add(maneuverGroup);

        // Camera interaction state
        const homeView = { az: 35, el: 28, dist: 5.5, targetX: 0, targetY: 0, targetZ: 0 };
        const cam = { ...homeView };
        let isDragging = false;
        let lastX = 0, lastY = 0;

        // Animation state
        const anim = {
            active: true,
            speed: 1.0,
            progress: 0.0, // 0 to 1 along full maneuver cycle
            stage: 'given',
            problem: null
        };

        /* ------------------------------------------------------------------ */
        /* Mesh Helpers                                                       */
        /* ------------------------------------------------------------------ */
        function createThickLine(points, colorHex, opacity = 1.0, dashed = false) {
            const geom = new THREE.BufferGeometry().setFromPoints(points);
            let mat;
            if (dashed) {
                mat = new THREE.LineDashedMaterial({
                    color: colorHex,
                    dashSize: 0.15,
                    gapSize: 0.08,
                    linewidth: 2,
                    transparent: opacity < 1,
                    opacity
                });
            } else {
                mat = new THREE.LineBasicMaterial({
                    color: colorHex,
                    linewidth: 2,
                    transparent: opacity < 1,
                    opacity
                });
            }
            const line = new THREE.Line(geom, mat);
            if (dashed) line.computeLineDistances();
            return line;
        }

        function createVectorArrow(origin, vector, colorHex, headLen = 0.2, headWidth = 0.1) {
            const len = vector.length();
            if (len < 1e-4) return new THREE.Group();
            const dir = vector.clone().normalize();
            const arrow = new THREE.ArrowHelper(dir, origin, len, colorHex, Math.min(headLen, len * 0.4), Math.min(headWidth, len * 0.25));
            return arrow;
        }

        function createPulsingMarker(radius = 0.07, colorHex = 0xf87171) {
            const group = new THREE.Group();
            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(radius, 16, 12),
                new THREE.MeshBasicMaterial({ color: colorHex })
            );
            const ringGeom = new THREE.RingGeometry(radius * 1.4, radius * 2.1, 32);
            const ringMat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.65, side: THREE.DoubleSide });
            const ring = new THREE.Mesh(ringGeom, ringMat);
            group.add(sphere);
            group.add(ring);
            group.userData = { ring, ringMat, baseRadius: radius };
            return group;
        }

        function createSpacecraftModel() {
            const sc = new THREE.Group();
            // Satellite body
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.08, 0.1),
                new THREE.MeshLambertMaterial({ color: 0xe2e8f0 })
            );
            // Solar panels
            const panelGeom = new THREE.BoxGeometry(0.24, 0.06, 0.01);
            const panelMat = new THREE.MeshLambertMaterial({ color: 0x2563eb });
            const panelLeft = new THREE.Mesh(panelGeom, panelMat);
            panelLeft.position.set(-0.16, 0, 0);
            const panelRight = new THREE.Mesh(panelGeom, panelMat);
            panelRight.position.set(0.16, 0, 0);

            // Glow point
            const beacon = new THREE.PointLight(0x60a5fa, 0.8, 1.2);
            sc.add(body, panelLeft, panelRight, beacon);
            return sc;
        }

        const spacecraft = createSpacecraftModel();
        scene.add(spacecraft);

        /* ------------------------------------------------------------------ */
        /* Dynamic Scene Elements for Each Maneuver Type                      */
        /* ------------------------------------------------------------------ */
        let activeElements = [];
        let labelRefs = [];

        function clearActive() {
            activeElements.forEach((obj) => {
                maneuverGroup.remove(obj);
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
                    else obj.material.dispose();
                }
            });
            activeElements = [];
            labelLayer.labels.forEach((lbl) => {
                lbl.el.style.display = 'none';
                lbl.el.remove();
            });
            labelLayer.labels = [];
            labelRefs = [];
        }

        // Orbit position calculator given inclination i, RAAN, and argument of latitude u
        function getOrbitPoint(r_norm, inc_deg, raan_deg, u_deg) {
            const i = inc_deg * D2R;
            const raan = raan_deg * D2R;
            const u = u_deg * D2R;
            const x = r_norm * (Math.cos(raan) * Math.cos(u) - Math.sin(raan) * Math.sin(u) * Math.cos(i));
            const y = r_norm * (Math.sin(raan) * Math.cos(u) + Math.cos(raan) * Math.sin(u) * Math.cos(i));
            const z = r_norm * (Math.sin(u) * Math.sin(i));
            return new THREE.Vector3(x, y, z);
        }

        // Unit tangent velocity vector
        function getOrbitTangent(inc_deg, raan_deg, u_deg) {
            const i = inc_deg * D2R;
            const raan = raan_deg * D2R;
            const u = u_deg * D2R;
            const vx = -Math.cos(raan) * Math.sin(u) - Math.sin(raan) * Math.cos(u) * Math.cos(i);
            const vy = -Math.sin(raan) * Math.sin(u) + Math.cos(raan) * Math.cos(u) * Math.cos(i);
            const vz = Math.cos(u) * Math.sin(i);
            return new THREE.Vector3(vx, vy, vz).normalize();
        }

        /* ------------------------------------------------------------------ */
        /* Build Hohmann Transfer Visual                                      */
        /* ------------------------------------------------------------------ */
        function buildHohmannVisual(data) {
            clearActive();

            const R1_n = data.R1 / R_E;
            const R2_n = data.R2 / R_E;
            const atx_n = data.a_tx / R_E;
            const isRaise = data.isRaise;

            // Tilt orbits slightly (e.g. 15°) for better spatial perspective
            const inc = 18;
            const raan = 25;

            // 1. Initial Orbit Ring
            const pts1 = [];
            for (let deg = 0; deg <= 360; deg += 3) {
                pts1.push(getOrbitPoint(R1_n, inc, raan, deg));
            }
            const line1 = createThickLine(pts1, COLORS.orbit1);
            maneuverGroup.add(line1);
            activeElements.push(line1);

            // 2. Final Orbit Ring
            const pts2 = [];
            for (let deg = 0; deg <= 360; deg += 3) {
                pts2.push(getOrbitPoint(R2_n, inc, raan, deg));
            }
            const line2 = createThickLine(pts2, COLORS.orbit2);
            maneuverGroup.add(line2);
            activeElements.push(line2);

            // 3. Transfer Ellipse
            // Transfer ellipse has periapsis at R1 and apoapsis at R2 (or vice versa)
            // Major axis lies along u = 0 to u = 180
            const ptsTx = [];
            const e = Math.abs(R2_n - R1_n) / (R1_n + R2_n);
            const p = atx_n * (1 - e * e);

            for (let nu_deg = 0; nu_deg <= 180; nu_deg += 2) {
                const nu = nu_deg * D2R;
                const r_tx = p / (1 + e * Math.cos(nu));
                // If orbit raise: periapsis (nu=0) is at u=0 (R1), apoapsis (nu=180) is at u=180 (R2)
                // If orbit lowering: apoapsis (nu=180) is at u=0 (R1), periapsis (nu=0) is at u=180 (R2)
                const u_effective = isRaise ? nu_deg : (180 - nu_deg);
                ptsTx.push(getOrbitPoint(r_tx, inc, raan, u_effective));
            }
            const lineTx = createThickLine(ptsTx, COLORS.transfer, 1.0, true);
            maneuverGroup.add(lineTx);
            activeElements.push(lineTx);

            // 4. Burn 1 Marker & Delta-V Vector Arrow
            const burn1Pos = getOrbitPoint(R1_n, inc, raan, 0);
            const burn1Marker = createPulsingMarker(0.065, 0xf87171);
            burn1Marker.position.copy(burn1Pos);
            maneuverGroup.add(burn1Marker);
            activeElements.push(burn1Marker);

            const tan1 = getOrbitTangent(inc, raan, 0);
            const dv1Dir = isRaise ? tan1.clone() : tan1.clone().negate();
            const dv1Len = Math.min(1.2, Math.max(0.4, data.dv1 * 0.45));
            const arrow1 = createVectorArrow(burn1Pos, dv1Dir.multiplyScalar(dv1Len), 0xf87171, 0.22, 0.12);
            maneuverGroup.add(arrow1);
            activeElements.push(arrow1);

            // 5. Burn 2 Marker & Delta-V Vector Arrow
            const burn2Pos = getOrbitPoint(R2_n, inc, raan, 180);
            const burn2Marker = createPulsingMarker(0.065, 0xf87171);
            burn2Marker.position.copy(burn2Pos);
            maneuverGroup.add(burn2Marker);
            activeElements.push(burn2Marker);

            const tan2 = getOrbitTangent(inc, raan, 180);
            const dv2Dir = isRaise ? tan2.clone() : tan2.clone().negate();
            const dv2Len = Math.min(1.2, Math.max(0.4, data.dv2 * 0.45));
            const arrow2 = createVectorArrow(burn2Pos, dv2Dir.multiplyScalar(dv2Len), 0xf87171, 0.22, 0.12);
            maneuverGroup.add(arrow2);
            activeElements.push(arrow2);

            // 6. Labels
            const lblR1 = labelLayer.add(`<span class="measure" style="color:${COLORS.orbit1}">R₁ = ${Math.round(data.R1)} km</span>`, { rank: 1 });
            const lblR2 = labelLayer.add(`<span class="measure" style="color:${COLORS.orbit2}">R₂ = ${Math.round(data.R2)} km</span>`, { rank: 1 });
            const lblB1 = labelLayer.add(`<span class="measure" style="color:${COLORS.burn}">ΔV₁ = ${data.dv1.toFixed(3)} km/s</span>`, { rank: 0 });
            const lblB2 = labelLayer.add(`<span class="measure" style="color:${COLORS.burn}">ΔV₂ = ${data.dv2.toFixed(3)} km/s</span>`, { rank: 0 });

            labelRefs.push(
                { pos: burn1Pos.clone().multiplyScalar(1.08), label: lblB1, answer: true },
                { pos: burn2Pos.clone().multiplyScalar(1.08), label: lblB2, answer: true },
                { pos: getOrbitPoint(R1_n, inc, raan, 70), label: lblR1 },
                { pos: getOrbitPoint(R2_n, inc, raan, 250), label: lblR2 }
            );

            // Spacecraft trajectory function
            anim.trajectory = function (prog) {
                // prog: 0.0 -> 0.35 on Orbit 1
                //       0.35 -> 0.70 on Transfer Ellipse
                //       0.70 -> 1.00 on Orbit 2
                let pos, forward;
                if (prog < 0.35) {
                    const u = (prog / 0.35) * 360 - 360;
                    pos = getOrbitPoint(R1_n, inc, raan, u);
                    forward = getOrbitTangent(inc, raan, u);
                } else if (prog < 0.7) {
                    const t = (prog - 0.35) / 0.35; // 0 to 1
                    const nu_deg = isRaise ? (t * 180) : (180 - t * 180);
                    const nu = nu_deg * D2R;
                    const r_tx = p / (1 + e * Math.cos(nu));
                    const u_deg = isRaise ? nu_deg : (180 - nu_deg);
                    pos = getOrbitPoint(r_tx, inc, raan, u_deg);
                    forward = getOrbitTangent(inc, raan, u_deg);
                } else {
                    const t = (prog - 0.7) / 0.3;
                    const u = 180 + t * 360;
                    pos = getOrbitPoint(R2_n, inc, raan, u);
                    forward = getOrbitTangent(inc, raan, u);
                }
                return { pos, forward };
            };

            anim.burnView = null;

            // Far enough back that the larger orbit stays in view
            homeView.dist = Math.max(5.0, Math.max(R1_n, R2_n) * 3.4);
            cam.dist = homeView.dist;
        }

        /* ------------------------------------------------------------------ */
        /* Build Simple Inclination Change Visual                             */
        /* ------------------------------------------------------------------ */
        function buildInclinationVisual(data) {
            clearActive();

            const r_n = data.r / R_E;
            const i1 = data.i1;
            const i2 = data.i2;
            const raan = data.raan;
            const u_sc = data.u_sc;

            // 1. Equator reference ring
            const ptsEq = [];
            for (let deg = 0; deg <= 360; deg += 4) {
                ptsEq.push(getOrbitPoint(r_n * 1.02, 0, 0, deg));
            }
            const lineEq = createThickLine(ptsEq, '#475569', 0.45, true);
            maneuverGroup.add(lineEq);
            activeElements.push(lineEq);

            // 2. Initial Orbit Ring (i1)
            const pts1 = [];
            for (let deg = 0; deg <= 360; deg += 3) {
                pts1.push(getOrbitPoint(r_n, i1, raan, deg));
            }
            const line1 = createThickLine(pts1, COLORS.orbit1);
            maneuverGroup.add(line1);
            activeElements.push(line1);

            // 3. Final Orbit Ring (i2)
            const pts2 = [];
            for (let deg = 0; deg <= 360; deg += 3) {
                pts2.push(getOrbitPoint(r_n, i2, raan, deg));
            }
            const line2 = createThickLine(pts2, COLORS.orbit2);
            maneuverGroup.add(line2);
            activeElements.push(line2);

            // 4. Line of Nodes (glowing line connecting Ascending and Descending nodes)
            const nodeAsc = getOrbitPoint(r_n * 1.15, 0, raan, 0);
            const nodeDesc = getOrbitPoint(r_n * 1.15, 0, raan, 180);
            const lineNode = createThickLine([nodeDesc, nodeAsc], COLORS.node, 0.9, true);
            maneuverGroup.add(lineNode);
            activeElements.push(lineNode);

            // 5. Burn Marker at the next node, as in the walkthrough
            const burnU = data.u_burn;
            const burnPos = getOrbitPoint(r_n, i1, raan, burnU);
            const mBurn = createPulsingMarker(0.065, 0xf87171);
            mBurn.position.copy(burnPos);
            maneuverGroup.add(mBurn);
            activeElements.push(mBurn);

            // Velocity vectors and Delta-V triangle at the burn node
            const v1_vec = getOrbitTangent(i1, raan, burnU).multiplyScalar(1.2);
            const v2_vec = getOrbitTangent(i2, raan, burnU).multiplyScalar(1.2);
            const dv_vec = v2_vec.clone().sub(v1_vec);

            const arrowV1 = createVectorArrow(burnPos, v1_vec, 0x38bdf8, 0.18, 0.09);
            const arrowV2 = createVectorArrow(burnPos, v2_vec, 0x34d399, 0.18, 0.09);
            // Delta-V connects tip of V1 to tip of V2
            const v1_tip = burnPos.clone().add(v1_vec);
            const arrowDV = createVectorArrow(v1_tip, dv_vec, 0xf87171, 0.22, 0.11);

            maneuverGroup.add(arrowV1, arrowV2, arrowDV);
            activeElements.push(arrowV1, arrowV2, arrowDV);

            // 6. Current Spacecraft Marker
            const currentPos = getOrbitPoint(r_n, i1, raan, u_sc);
            const currentMarker = new THREE.Mesh(
                new THREE.SphereGeometry(0.055, 16, 16),
                new THREE.MeshBasicMaterial({ color: 0xffffff })
            );
            currentMarker.position.copy(currentPos);
            maneuverGroup.add(currentMarker);
            activeElements.push(currentMarker);

            // 7. Labels
            const lblI1 = labelLayer.add(`<span class="measure" style="color:${COLORS.orbit1}">i₁ = ${data.i1.toFixed(1)}°</span>`, { rank: 1 });
            const lblI2 = labelLayer.add(`<span class="measure" style="color:${COLORS.orbit2}">i₂ = ${data.i2.toFixed(1)}°</span>`, { rank: 1 });
            const lblDV = labelLayer.add(`<span class="measure" style="color:${COLORS.burn}">ΔV = ${data.dv.toFixed(3)} km/s</span>`, { rank: 0 });
            const lblNode = labelLayer.add(`<span class="measure" style="color:${COLORS.node}">Node Line (Burn)</span>`, { rank: 1 });
            const lblCurr = labelLayer.add(`<span class="measure" style="color:#ffffff">Spacecraft (u = ${Math.round(u_sc)}°)</span>`, { rank: 0 });

            labelRefs.push(
                { pos: getOrbitPoint(r_n, i1, raan, 90), label: lblI1 },
                { pos: getOrbitPoint(r_n, i2, raan, 120), label: lblI2 },
                { pos: v1_tip.clone().add(dv_vec.clone().multiplyScalar(0.5)), label: lblDV, answer: true },
                { pos: burnPos.clone().multiplyScalar(1.12), label: lblNode },
                { pos: currentPos.clone().multiplyScalar(1.08), label: lblCurr }
            );

            // Trajectory: coasts to the burn node on the initial plane, then flies the final plane.
            // With no coast needed, the whole cycle is spent on the final plane.
            const coast = data.delta_u_to_node;
            const burnAt = coast > 0 ? 0.5 : 0;
            anim.trajectory = function (prog) {
                let pos, forward;
                if (prog < burnAt) {
                    const u = u_sc + (prog / burnAt) * coast;
                    pos = getOrbitPoint(r_n, i1, raan, u);
                    forward = getOrbitTangent(i1, raan, u);
                } else {
                    const u = burnU + ((prog - burnAt) / (1 - burnAt)) * 360;
                    pos = getOrbitPoint(r_n, i2, raan, u);
                    forward = getOrbitTangent(i2, raan, u);
                }
                return { pos, forward };
            };

            // Face the burn node, a little to one side so that the vector triangle shows
            anim.burnView = { az: Math.atan2(burnPos.y, burnPos.x) * R2D + 20, el: 35 };

            homeView.dist = Math.max(4.8, r_n * 2.8);
            cam.dist = homeView.dist;
        }

        /* ------------------------------------------------------------------ */
        /* Build Polar Orbit RAAN Change Visual                               */
        /* ------------------------------------------------------------------ */
        function buildPolarRaanVisual(data) {
            clearActive();

            const r_n = data.r / R_E;
            const raan1 = data.raan1;
            const raan2 = data.raan2;
            const u_sc = data.u_sc;

            // 1. Highlight Earth's Polar Axis (Z axis)
            const poleNorth = new THREE.Vector3(0, 0, r_n * 1.3);
            const poleSouth = new THREE.Vector3(0, 0, -r_n * 1.3);
            const poleLine = createThickLine([poleSouth, poleNorth], COLORS.node, 0.85, true);
            maneuverGroup.add(poleLine);
            activeElements.push(poleLine);

            // 2. Initial Polar Orbit Ring (RAAN 1)
            const pts1 = [];
            for (let deg = 0; deg <= 360; deg += 3) {
                pts1.push(getOrbitPoint(r_n, 90, raan1, deg));
            }
            const line1 = createThickLine(pts1, COLORS.orbit1);
            maneuverGroup.add(line1);
            activeElements.push(line1);

            // 3. Final Polar Orbit Ring (RAAN 2)
            const pts2 = [];
            for (let deg = 0; deg <= 360; deg += 3) {
                pts2.push(getOrbitPoint(r_n, 90, raan2, deg));
            }
            const line2 = createThickLine(pts2, COLORS.orbit2);
            maneuverGroup.add(line2);
            activeElements.push(line2);

            // 4. Burn Marker at the next pole crossing, as in the walkthrough
            const burnU = data.u_burn;
            const burnPos = getOrbitPoint(r_n, 90, raan1, burnU);
            const poleSign = burnPos.z >= 0 ? 1 : -1;
            const mBurn = createPulsingMarker(0.065, 0xf87171);
            mBurn.position.copy(burnPos);
            maneuverGroup.add(mBurn);
            activeElements.push(mBurn);

            // Velocity vectors and Delta-V triangle at the burn pole
            const v1_vec = getOrbitTangent(90, raan1, burnU).multiplyScalar(1.2);
            const v2_vec = getOrbitTangent(90, raan2, burnU).multiplyScalar(1.2);
            const dv_vec = v2_vec.clone().sub(v1_vec);

            const arrowV1 = createVectorArrow(burnPos, v1_vec, 0x38bdf8, 0.18, 0.09);
            const arrowV2 = createVectorArrow(burnPos, v2_vec, 0x34d399, 0.18, 0.09);
            const v1_tip = burnPos.clone().add(v1_vec);
            const arrowDV = createVectorArrow(v1_tip, dv_vec, 0xf87171, 0.22, 0.11);

            maneuverGroup.add(arrowV1, arrowV2, arrowDV);
            activeElements.push(arrowV1, arrowV2, arrowDV);

            // 5. Current Spacecraft Marker
            const currentPos = getOrbitPoint(r_n, 90, raan1, u_sc);
            const currentMarker = new THREE.Mesh(
                new THREE.SphereGeometry(0.055, 16, 16),
                new THREE.MeshBasicMaterial({ color: 0xffffff })
            );
            currentMarker.position.copy(currentPos);
            maneuverGroup.add(currentMarker);
            activeElements.push(currentMarker);

            // 6. Labels
            const lblR1 = labelLayer.add(`<span class="measure" style="color:${COLORS.orbit1}">Ω₁ = ${data.raan1.toFixed(1)}°</span>`, { rank: 1 });
            const lblR2 = labelLayer.add(`<span class="measure" style="color:${COLORS.orbit2}">Ω₂ = ${data.raan2.toFixed(1)}°</span>`, { rank: 1 });
            const lblDV = labelLayer.add(`<span class="measure" style="color:${COLORS.burn}">ΔV = ${data.dv.toFixed(3)} km/s</span>`, { rank: 0 });
            const lblPole = labelLayer.add(`<span class="measure" style="color:${COLORS.node}">${data.next_pole} (Burn Point)</span>`, { rank: 0 });
            const lblCurr = labelLayer.add(`<span class="measure" style="color:#ffffff">Spacecraft (u = ${Math.round(u_sc)}°)</span>`, { rank: 0 });

            labelRefs.push(
                { pos: getOrbitPoint(r_n, 90, raan1, 0), label: lblR1 },
                { pos: getOrbitPoint(r_n, 90, raan2, 0), label: lblR2 },
                { pos: v1_tip.clone().add(dv_vec.clone().multiplyScalar(0.5)), label: lblDV, answer: true },
                { pos: burnPos.clone().add(new THREE.Vector3(0, 0, 0.3 * poleSign)), label: lblPole },
                { pos: currentPos.clone().multiplyScalar(1.08), label: lblCurr }
            );

            // Trajectory: coasts to the burn pole on the initial plane, then flies the final plane
            const coast = data.delta_u_to_pole;
            const burnAt = coast > 0 ? 0.5 : 0;
            anim.trajectory = function (prog) {
                let pos, forward;
                if (prog < burnAt) {
                    const u = u_sc + (prog / burnAt) * coast;
                    pos = getOrbitPoint(r_n, 90, raan1, u);
                    forward = getOrbitTangent(90, raan1, u);
                } else {
                    const u = burnU + ((prog - burnAt) / (1 - burnAt)) * 360;
                    pos = getOrbitPoint(r_n, 90, raan2, u);
                    forward = getOrbitTangent(90, raan2, u);
                }
                return { pos, forward };
            };

            // Look down on the burn pole from its own side of Earth
            anim.burnView = { az: raan1 + 20, el: 50 * poleSign };

            homeView.dist = Math.max(4.8, r_n * 2.8);
            cam.dist = homeView.dist;
        }

        /* ------------------------------------------------------------------ */
        /* Build Combined Plane Change Visual                                 */
        /* ------------------------------------------------------------------ */
        function buildCombinedVisual(data) {
            clearActive();

            const { i1, i2, isRaise } = data;
            const R1_n = data.R1 / R_E;
            const R2_n = data.R2 / R_E;
            const R_max = Math.max(R1_n, R2_n);
            const atx_n = data.a_tx / R_E;
            const raan = 25;

            // The transfer ellipse lies in the plane of the lower orbit. The burn at the higher orbit changes the plane.
            const incTransfer = isRaise ? i1 : i2;
            const e = Math.abs(R2_n - R1_n) / (R1_n + R2_n);
            const p = atx_n * (1 - e * e);
            const transferRadius = (u) => p / (1 + (isRaise ? e : -e) * Math.cos(u * D2R));

            const addLine = (points, color, opacity, dashed) => {
                const line = createThickLine(points, color, opacity, dashed);
                maneuverGroup.add(line);
                activeElements.push(line);
            };
            const ringPoints = (radius, inc) => {
                const pts = [];
                for (let deg = 0; deg <= 360; deg += 3) pts.push(getOrbitPoint(radius, inc, raan, deg));
                return pts;
            };

            // 1. Orbits, transfer ellipse, and the line of nodes through both burns
            addLine(ringPoints(R1_n, i1), COLORS.orbit1, 1.0, false);
            addLine(ringPoints(R2_n, i2), COLORS.orbit2, 1.0, false);
            const ptsTx = [];
            for (let u = 0; u <= 180; u += 2) ptsTx.push(getOrbitPoint(transferRadius(u), incTransfer, raan, u));
            addLine(ptsTx, COLORS.transfer, 1.0, true);
            addLine([getOrbitPoint(R_max * 1.15, 0, raan, 180), getOrbitPoint(R_max * 1.15, 0, raan, 0)], COLORS.node, 0.6, true);

            // 2. Burn markers
            const burn1Pos = getOrbitPoint(R1_n, i1, raan, 0);
            const burn2Pos = getOrbitPoint(R2_n, i2, raan, 180);
            [burn1Pos, burn2Pos].forEach((pos) => {
                const marker = createPulsingMarker(0.065, 0xf87171);
                marker.position.copy(pos);
                maneuverGroup.add(marker);
                activeElements.push(marker);
            });

            // 3. The plain burn at the lower orbit: prograde when raising, retrograde when lowering
            const plainPos = isRaise ? burn1Pos : burn2Pos;
            const plainDir = getOrbitTangent(incTransfer, raan, isRaise ? 0 : 180);
            if (!isRaise) plainDir.negate();
            const plainLen = Math.min(1.2, Math.max(0.4, (isRaise ? data.dv1 : data.dv2) * 0.45));
            const plainArrow = createVectorArrow(plainPos, plainDir.multiplyScalar(plainLen), 0xf87171, 0.22, 0.12);
            maneuverGroup.add(plainArrow);
            activeElements.push(plainArrow);

            // 4. The velocity triangle at the higher orbit, with arrow lengths in proportion to the speeds
            const highU = isRaise ? 180 : 0;
            const highPos = isRaise ? burn2Pos : burn1Pos;
            const scale = Math.max(1.2, R_max * 0.35) / Math.max(data.v_initial, data.v_final);
            const vInitial = getOrbitTangent(i1, raan, highU).multiplyScalar(data.v_initial * scale);
            const vFinal = getOrbitTangent(i2, raan, highU).multiplyScalar(data.v_final * scale);
            const dvCombined = vFinal.clone().sub(vInitial);
            const vInitialTip = highPos.clone().add(vInitial);
            const triangle = [
                createVectorArrow(highPos, vInitial, 0x38bdf8, 0.18, 0.09),
                createVectorArrow(highPos, vFinal, 0x34d399, 0.18, 0.09),
                createVectorArrow(vInitialTip, dvCombined, 0xf87171, 0.22, 0.11)
            ];
            triangle.forEach((arrow) => {
                maneuverGroup.add(arrow);
                activeElements.push(arrow);
            });

            // 5. Labels
            const lblR1 = labelLayer.add(`<span class="measure" style="color:${COLORS.orbit1}">R₁ = ${Math.round(data.R1)} km, i₁ = ${i1.toFixed(1)}°</span>`, { rank: 1 });
            const lblR2 = labelLayer.add(`<span class="measure" style="color:${COLORS.orbit2}">R₂ = ${Math.round(data.R2)} km, i₂ = ${i2.toFixed(1)}°</span>`, { rank: 1 });
            const lblHigh = labelLayer.add(`<span class="measure" style="color:${COLORS.node}">Combined Burn</span>`, { rank: 1 });
            const lblB1 = labelLayer.add(`<span class="measure" style="color:${COLORS.burn}">ΔV₁ = ${data.dv1.toFixed(3)} km/s</span>`, { rank: 0 });
            const lblB2 = labelLayer.add(`<span class="measure" style="color:${COLORS.burn}">ΔV₂ = ${data.dv2.toFixed(3)} km/s</span>`, { rank: 0 });

            labelRefs.push(
                { pos: getOrbitPoint(R1_n, i1, raan, 70), label: lblR1 },
                { pos: getOrbitPoint(R2_n, i2, raan, 250), label: lblR2 },
                { pos: highPos.clone().multiplyScalar(1.08), label: lblHigh },
                { pos: burn1Pos.clone().multiplyScalar(1.08), label: lblB1, answer: true },
                { pos: burn2Pos.clone().multiplyScalar(1.08), label: lblB2, answer: true }
            );

            // Spacecraft: initial orbit, then the transfer ellipse, then the final orbit
            anim.trajectory = function (prog) {
                let u, pos, forward;
                if (prog < 0.35) {
                    u = (prog / 0.35) * 360 - 360;
                    pos = getOrbitPoint(R1_n, i1, raan, u);
                    forward = getOrbitTangent(i1, raan, u);
                } else if (prog < 0.7) {
                    u = ((prog - 0.35) / 0.35) * 180;
                    pos = getOrbitPoint(transferRadius(u), incTransfer, raan, u);
                    forward = getOrbitTangent(incTransfer, raan, u);
                } else {
                    u = 180 + ((prog - 0.7) / 0.3) * 360;
                    pos = getOrbitPoint(R2_n, i2, raan, u);
                    forward = getOrbitTangent(i2, raan, u);
                }
                return { pos, forward };
            };

            anim.burnView = null;
            // Far enough back that the higher orbit and its velocity triangle stay in view
            homeView.dist = Math.max(5.0, R_max * 3.4);
            cam.dist = homeView.dist;
        }

        /* ------------------------------------------------------------------ */
        /* Problem Dispatcher                                                 */
        /* ------------------------------------------------------------------ */
        function setProblem(problem) {
            anim.problem = problem;
            anim.progress = 0;
            anim.answersShown = false;
            if (!problem || !problem.data) return;

            if (problem.data.type === 'hohmann') {
                buildHohmannVisual(problem.data);
            } else if (problem.data.type === 'inclination') {
                buildInclinationVisual(problem.data);
            } else if (problem.data.type === 'polar_raan') {
                buildPolarRaanVisual(problem.data);
            } else if (problem.data.type === 'combined') {
                buildCombinedVisual(problem.data);
            }
        }

        function setStage(stageKey) {
            anim.stage = stageKey;
            // Smoothly move camera based on stage
            if (stageKey === 'burn1') {
                cam.az = 15; cam.el = 20;
            } else if (stageKey === 'burn2') {
                cam.az = 195; cam.el = 20;
            } else if (stageKey === 'location' || stageKey === 'angle') {
                const facing = anim.burnView || { az: 45, el: 45 };
                cam.az = facing.az; cam.el = facing.el;
            }
        }

        /* ------------------------------------------------------------------ */
        /* Camera Orbit Controls                                              */
        /* ------------------------------------------------------------------ */
        function updateCamera() {
            const azRad = cam.az * D2R;
            const elRad = Math.max(-85 * D2R, Math.min(85 * D2R, cam.el * D2R));
            const x = cam.dist * Math.cos(elRad) * Math.cos(azRad) + cam.targetX;
            const y = cam.dist * Math.cos(elRad) * Math.sin(azRad) + cam.targetY;
            const z = cam.dist * Math.sin(elRad) + cam.targetZ;
            camera.position.set(x, y, z);
            camera.lookAt(cam.targetX, cam.targetY, cam.targetZ);
        }

        canvas.addEventListener('pointerdown', (e) => {
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            canvas.setPointerCapture(e.pointerId);
            if (hint) hint.style.opacity = '0';
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;
            cam.az = (cam.az - dx * 0.45 + 360) % 360;
            cam.el = Math.max(-85, Math.min(85, cam.el + dy * 0.45));
            updateCamera();
        });

        const stopDrag = (e) => {
            if (isDragging) {
                isDragging = false;
                try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
            }
        };
        canvas.addEventListener('pointerup', stopDrag);
        canvas.addEventListener('pointercancel', stopDrag);

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.08 : 0.92;
            cam.dist = Math.max(2.2, Math.min(35.0, cam.dist * factor));
            updateCamera();
        }, { passive: false });

        if (reset) {
            reset.addEventListener('click', () => {
                cam.az = homeView.az;
                cam.el = homeView.el;
                cam.dist = homeView.dist;
                cam.targetX = homeView.targetX;
                cam.targetY = homeView.targetY;
                cam.targetZ = homeView.targetZ;
                updateCamera();
            });
        }

        /* ------------------------------------------------------------------ */
        /* Render Loop & Animation                                            */
        /* ------------------------------------------------------------------ */
        let lastTime = performance.now();

        function render(now) {
            requestAnimationFrame(render);
            const dt = Math.min(0.1, (now - lastTime) / 1000);
            lastTime = now;

            // Turn Earth slightly
            if (earth && earth.pivot) {
                earth.pivot.rotation.z += dt * 0.04;
            }

            // Animate spacecraft. Its position is updated while paused too, so that the slider and rewind work.
            if (anim.trajectory) {
                if (anim.active && !anim.held) {
                    anim.progress = (anim.progress + dt * 0.08 * anim.speed) % 1.0;
                }
                const { pos, forward } = anim.trajectory(anim.progress);
                if (pos) spacecraft.position.copy(pos);
                if (forward) {
                    const lookTarget = pos.clone().add(forward);
                    spacecraft.lookAt(lookTarget);
                }
                if (onProgress) onProgress(anim.progress);
            }

            // Pulse burn markers
            activeElements.forEach((obj) => {
                if (obj.userData && obj.userData.ring) {
                    const scale = 1.0 + 0.3 * Math.sin(now * 0.006);
                    obj.userData.ring.scale.set(scale, scale, 1);
                    obj.userData.ringMat.opacity = 0.4 + 0.3 * Math.cos(now * 0.006);
                }
            });

            updateCamera();
            renderer.render(scene, camera);

            // Update Labels
            if (labelLayer) {
                labelLayer.begin();
                const w = view.clientWidth;
                const h = view.clientHeight;
                labelRefs.forEach(({ pos, label, answer }) => {
                    if (answer && !anim.answersShown) return;
                    const screenPos = pos.clone().project(camera);
                    // Check if in front of camera
                    if (screenPos.z < 1.0) {
                        const px = (screenPos.x * 0.5 + 0.5) * w;
                        const py = (-(screenPos.y * 0.5) + 0.5) * h;
                        labelLayer.show(label, px, py);
                    }
                });
                labelLayer.place(w, h);
            }
        }
        requestAnimationFrame(render);

        // Handle Resizing
        function resize(width, height) {
            const w = width || view.clientWidth;
            const h = height || view.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
            updateCamera();
        }
        Kit.observeSize(view, (w, h) => resize(w, h));

        return {
            setProblem,
            setStage,
            resize,
            setPlayState(playing) { anim.active = playing; },
            setSpeed(spd) { anim.speed = spd; },
            setHeld(held) { anim.held = held; },
            setAnswersShown(shown) { anim.answersShown = shown; },
            setProgress(prog) { anim.progress = Math.max(0, Math.min(1, prog)); }
        };
    }

    global.ManeuversScene = { create };
})(window);
