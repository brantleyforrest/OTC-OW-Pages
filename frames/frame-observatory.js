// Reference Frame Observatory.
// One scene is simulated in ECI. Selecting a frame only changes the transform
// applied to the whole scene, so the motion itself never changes.
(async function () {
    'use strict';

    const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
    const FM = window.FrameMath;
    const { RE, D2R } = FM;
    const $ = (id) => document.getElementById(id);

    const statusEl = $('status');
    function showStatus(text) {
        statusEl.style.display = 'flex';
        statusEl.textContent = text;
    }

    let THREE;
    try {
        THREE = await import(THREE_URL);
    } catch (err) {
        showStatus('The 3D library could not be loaded. This tool needs an internet connection the first time it opens.');
        return;
    }

    /* ------------------------------------------------------------------ */
    /* Content                                                             */
    /* ------------------------------------------------------------------ */

    const COLORS = { ECI: 0x60a5fa, ECEF: 0xfb923c, RIC: 0xf87171 };
    const CSS_COLORS = { ECI: '#60a5fa', ECEF: '#fb923c', RIC: '#f87171' };
    const TARGET_COLOR = 0xffffff;
    const SECOND_COLOR = 0xe6c15a;
    const SITE_COLOR = 0x34d399;

    const FRAMES = {
        ECI: {
            name: 'Earth-Centered Inertial',
            axes: ['Î', 'Ĵ', 'K̂'],
            question: 'Where is the satellite in space, and where will it go next?',
            held: 'the axes and the distant stars.',
            moving: "Earth's surface and both spacecraft.",
            classLabel: 'Treated as inertial',
            classStyle: 'inertial',
            anatomy: [
                ['Origin', "Earth's center of mass."],
                ['Fundamental Plane', 'The equatorial plane.'],
                ['Principal Axis', 'Î', 'In the equatorial plane, toward the vernal equinox.'],
                ['Third Axis', 'K̂', "Along Earth's spin axis, through the North Pole."],
                ['Remaining Axis', 'Ĵ', 'In the equatorial plane, 90° east of the vernal equinox.'],
                ['Classification', 'Treated as inertial. Its axes do not rotate with Earth.'],
                ['Purpose', 'Calculating orbits and predicting where a satellite will be.']
            ]
        },
        ECEF: {
            name: 'Earth-Centered Earth-Fixed',
            axes: ['X̂', 'Ŷ', 'Ẑ'],
            question: "Where is this object relative to Earth's surface?",
            held: "the axes and Earth's surface.",
            moving: 'the stars, the Sun, and any spacecraft that is not geostationary.',
            classLabel: 'Non-inertial',
            classStyle: 'noninertial',
            anatomy: [
                ['Origin', "Earth's center of mass, as in ECI."],
                ['Fundamental Plane', 'The equatorial plane, as in ECI, but the axes rotate with Earth.'],
                ['Principal Axis', 'X̂', 'Toward 0° latitude, 0° longitude, where the Prime Meridian crosses the equator.'],
                ['Third Axis', 'Ẑ', "Along Earth's spin axis, through the North Pole."],
                ['Remaining Axis', 'Ŷ', 'Toward 0° latitude, 90° east longitude.'],
                ['Classification', 'Non-inertial, because it rotates with Earth.'],
                ['Purpose', 'Sensor locations, GPS navigation, antenna pointing, and ground tracks.']
            ]
        },
        RIC: {
            name: 'Radial, In-Track, Cross-Track',
            axes: ['R̂', 'Î', 'Ĉ'],
            question: 'Where is the other spacecraft relative to this one?',
            held: "the axes, the target, and Earth's center.",
            moving: "Earth's surface, the stars, the Sun, and the second spacecraft.",
            classLabel: 'Non-inertial',
            classStyle: 'noninertial',
            anatomy: [
                ['Origin', 'The center of mass of the target spacecraft.'],
                ['Fundamental Plane', "The target's orbital plane, containing its orbit and Earth's center."],
                ['Principal Axis', 'R̂', "Radial. From Earth's center through the target, pointing away from Earth."],
                ['Third Axis', 'Ĉ', "Cross-track. Perpendicular to the target's orbital plane."],
                ['Remaining Axis', 'Î', 'In-track. In the orbital plane, perpendicular to R̂, on the side the target moves toward.'],
                ['Classification', 'Non-inertial. It travels with the target and turns once per orbit.'],
                ['Purpose', 'Orienting and maneuvering two separate objects in space.']
            ]
        }
    };

    const AXIS_HINTS = {
        ECI: ['vernal equinox', '90° east of equinox', 'North Pole'],
        ECEF: ['0° lat, 0° long', '0° lat, 90° E long', 'North Pole'],
        RIC: ['away from Earth', 'direction of travel', 'out of the orbital plane']
    };

    const ORBITS = {
        GEO: {
            radius: FM.GEO_RADIUS,
            inclination: 0,
            separation: 300,
            tiltOffset: 0.4 * D2R,
            trailWindow: FM.SIDEREAL_DAY,
            speedStop: 4,
            globalDistance: 20.5,
            localDistance: 0.46,
            caption: 'About 35,786 km above the equator. One orbit takes one Earth rotation.'
        },
        LEO: {
            radius: RE + 700,
            inclination: 45,
            separation: 150,
            tiltOffset: 1.5 * D2R,
            trailWindow: null, // three orbits, set from the period
            speedStop: 1,
            globalDistance: 5.6,
            localDistance: 0.26,
            caption: '700 km above the surface. One orbit takes about 99 minutes.'
        }
    };

    const SPEEDS = [
        { rate: 60, label: '1 second = 1 minute' },
        { rate: 300, label: '1 second = 5 minutes' },
        { rate: 900, label: '1 second = 15 minutes' },
        { rate: 1800, label: '1 second = 30 minutes' },
        { rate: 3600, label: '1 second = 1 hour' },
        { rate: 7200, label: '1 second = 2 hours' }
    ];

    function noticeText(frame, orbit, inclination) {
        const tilted = inclination > 0;
        if (frame === 'ECI') {
            if (orbit === 'GEO') {
                return 'Earth turns inside fixed axes while the target traces one full circle per rotation. Its speed reads the true orbital speed, about 3.07 km/s. The stars stay still here, unlike in ECEF.';
            }
            return 'The orbit stays one fixed loop in space while Earth turns beneath it. This steadiness is why orbits are calculated in this frame.';
        }
        if (frame === 'ECEF') {
            if (orbit === 'GEO' && !tilted) {
                return 'The axes turn with Earth, so the continents stop moving. The target\'s path collapses to a single point and its speed reads zero. The orbit did not change. Only the viewpoint did.';
            }
            if (orbit === 'GEO') {
                return 'With a tilted orbit, the target swings north and south of the equator each day, tracing a repeating figure-eight. The ground site\'s coordinates still stay constant.';
            }
            return 'The continents stop moving. The target\'s path winds around the globe and shifts west each orbit, because Earth turns east beneath it. The path on the surface below is its ground track.';
        }
        const scale = orbit === 'GEO'
            ? 'Earth is too far below to appear here, so the inset shows it.'
            : 'Earth\'s surface moves beneath the view while its center stays directly below.';
        return 'The target always sits at the origin, reading zero. The second spacecraft, on a slightly different orbit, traces a closed loop around it with small RIC numbers. ' + scale;
    }

    const OBJECT_NOTES = {
        target: {
            ECI: 'The same spacecraft at the same moment, written three ways. All three descriptions are correct.',
            ECEF: 'The same spacecraft at the same moment, written three ways. All three descriptions are correct.',
            RIC: 'The target reads zero in RIC because the frame is centered on it.'
        },
        second: {
            ECI: 'From Earth\'s center, the second spacecraft\'s numbers are large and change quickly. Compare them with its small RIC numbers.',
            ECEF: 'From Earth\'s center, the second spacecraft\'s numbers are large and change quickly. Compare them with its small RIC numbers.',
            RIC: 'R: positive is above the target. I: positive is ahead of it. C: positive is out of its orbital plane.'
        },
        site: {
            ECI: 'The ground site moves in ECI at about 0.465 km/s because Earth carries it around. In ECEF, its coordinates stay constant.',
            ECEF: 'A point on the ground keeps the same ECEF coordinates at all times. This is the purpose of the frame.',
            RIC: 'Seen from the target, the ground site\'s numbers are large and change constantly. RIC is not suited to describing the ground.'
        }
    };

    /* ------------------------------------------------------------------ */
    /* State                                                               */
    /* ------------------------------------------------------------------ */

    const state = {
        t: 0,
        playing: !matchMedia('(prefers-reduced-motion: reduce)').matches,
        frame: 'ECI',
        orbit: 'GEO',
        inclination: 0,
        speedStop: ORBITS.GEO.speedStop,
        object: 'target',
        show: { trails: true, plane: true, others: true, labels: true, track: true }
    };

    let scenario = null;
    let dirty = true;

    function currentTrailWindow() {
        const cfg = ORBITS[state.orbit];
        return cfg.trailWindow || 3 * scenario.period;
    }

    function rebuildScenario() {
        const cfg = ORBITS[state.orbit];
        scenario = FM.makeScenario({
            radius: cfg.radius,
            inclination: state.inclination * D2R,
            raan: 0,
            startAngle: 60 * D2R,
            separation: cfg.separation,
            tiltOffset: cfg.tiltOffset,
            siteLongitude: 60 * D2R
        });
    }

    function objectPosition(name, t) {
        if (name === 'target') return FM.positionEci(scenario.target, t);
        if (name === 'second') return FM.positionEci(scenario.second, t);
        return FM.sitePositionEci(scenario, t);
    }

    /* ------------------------------------------------------------------ */
    /* Renderer and scene                                                  */
    /* ------------------------------------------------------------------ */

    const viewport = $('viewport');
    const canvas = $('scene');
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (err) {
        showStatus('This browser could not start the 3D view. WebGL must be enabled to use this tool.');
        return;
    }
    renderer.setClearColor(0x03060c);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.up.set(0, 0, 1);
    const insetCamera = new THREE.PerspectiveCamera(38, 1.5, 0.1, 100);
    insetCamera.up.set(0, 0, 1);

    // The root group holds everything in ECI coordinates, in Earth radii.
    // Its transform is the only thing that changes when the frame changes.
    const root = new THREE.Group();
    scene.add(root);

    /* Lighting */
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sunLight = new THREE.DirectionalLight(0xffffff, 2.6);
    scene.add(sunLight, sunLight.target);

    /* Earth, carried by a pivot that turns at Earth's rotation rate */
    const earthPivot = new THREE.Group();
    root.add(earthPivot);

    function buildEarthTexture(width) {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = width / 2;
        const g = c.getContext('2d');
        g.fillStyle = '#123258';
        g.fillRect(0, 0, c.width, c.height);

        const sx = c.width / 360, sy = c.height / 180;
        g.fillStyle = '#5f8a70';
        g.beginPath();
        for (const ring of window.EARTH_LAND) {
            for (const shift of [-360, 0, 360]) {
                g.moveTo((ring[0] + shift + 180) * sx, (90 - ring[1]) * sy);
                for (let i = 2; i < ring.length; i += 2) {
                    g.lineTo((ring[i] + shift + 180) * sx, (90 - ring[i + 1]) * sy);
                }
                g.closePath();
            }
        }
        g.fill();

        g.strokeStyle = 'rgba(255, 255, 255, 0.09)';
        g.lineWidth = Math.max(1, width / 2048);
        g.beginPath();
        for (let lon = -180; lon < 180; lon += 30) {
            g.moveTo((lon + 180) * sx, 0);
            g.lineTo((lon + 180) * sx, c.height);
        }
        for (let lat = -60; lat <= 60; lat += 30) {
            g.moveTo(0, (90 - lat) * sy);
            g.lineTo(c.width, (90 - lat) * sy);
        }
        g.stroke();

        // Equator and Prime Meridian, the two lines that define the ECEF axes
        g.lineWidth = Math.max(2, width / 1024);
        g.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        g.beginPath();
        g.moveTo(0, c.height / 2);
        g.lineTo(c.width, c.height / 2);
        g.stroke();
        g.strokeStyle = 'rgba(251, 146, 60, 0.85)';
        g.beginPath();
        g.moveTo(180 * sx, 0);
        g.lineTo(180 * sx, c.height);
        g.stroke();

        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        return tex;
    }

    const textureWidth = Math.min(renderer.capabilities.maxTextureSize, window.innerWidth < 800 ? 2048 : 4096);
    const earthGeometry = new THREE.SphereGeometry(1, 128, 96);
    earthGeometry.rotateX(Math.PI / 2); // Places the poles on the third axis.
    earthPivot.add(new THREE.Mesh(earthGeometry, new THREE.MeshLambertMaterial({ map: buildEarthTexture(textureWidth) })));

    /* Thin atmosphere at the limb */
    const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(1.04, 64, 48),
        new THREE.ShaderMaterial({
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vView;
                void main() {
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vNormal = normalize(normalMatrix * normal);
                    vView = normalize(-mv.xyz);
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `
                varying vec3 vNormal;
                varying vec3 vView;
                void main() {
                    float a = clamp(-dot(vNormal, vView) / 0.28, 0.0, 1.0);
                    gl_FragColor = vec4(0.42, 0.68, 1.0, pow(a, 2.4) * 0.55);
                }`
        })
    );
    root.add(atmosphere);

    /* Stars and the Sun marker. These rotate with the frame but do not shift with
       the origin, because they are too far away for that to be visible. */
    const starGroup = new THREE.Group();
    scene.add(starGroup);
    (function buildStars() {
        const count = 2400;
        const pos = new Float32Array(count * 3);
        const col = new Float32Array(count * 3);
        let seed = 12345;
        const rand = () => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };
        for (let i = 0; i < count; i++) {
            const z = 2 * rand() - 1;
            const a = 2 * Math.PI * rand();
            const s = Math.sqrt(1 - z * z);
            pos.set([s * Math.cos(a), s * Math.sin(a), z], i * 3);
            const b = 0.25 + 0.75 * Math.pow(rand(), 3);
            col.set([b, b, Math.min(1, b * 1.08)], i * 3);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const stars = new THREE.Points(geo, new THREE.PointsMaterial({
            size: 1.7,
            sizeAttenuation: false,
            vertexColors: true,
            depthWrite: false
        }));
        stars.frustumCulled = false;
        starGroup.add(stars);
    })();

    function glowTexture() {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.28, 'rgba(255,255,255,1)');
        grad.addColorStop(0.42, 'rgba(255,255,255,0.35)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }
    const glow = glowTexture();

    function makeMarker(color) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glow,
            color,
            transparent: true,
            depthWrite: false,
            sizeAttenuation: false
        }));
        sprite.renderOrder = 5;
        return sprite;
    }

    const targetMarker = makeMarker(TARGET_COLOR);
    const secondMarker = makeMarker(SECOND_COLOR);
    const siteMarker = makeMarker(SITE_COLOR);
    const sunMarker = makeMarker(0xffd76a);
    root.add(targetMarker, secondMarker);
    earthPivot.add(siteMarker);
    scene.add(sunMarker);

    /* Axes */
    function makeTriad(color) {
        const material = new THREE.MeshBasicMaterial({ color, transparent: true });
        const group = new THREE.Group();
        const tips = [];
        const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
        const yAxis = new THREE.Vector3(0, 1, 0);
        for (const dir of dirs) {
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.92, 12), material);
            shaft.position.copy(dir).multiplyScalar(0.46);
            shaft.quaternion.setFromUnitVectors(yAxis, dir);
            const head = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.09, 18), material);
            head.position.copy(dir).multiplyScalar(0.955);
            head.quaternion.setFromUnitVectors(yAxis, dir);
            const tip = new THREE.Object3D();
            tip.position.copy(dir).multiplyScalar(1.05);
            group.add(shaft, head, tip);
            tips.push(tip);
        }
        return { group, material, tips };
    }

    const triads = { ECI: makeTriad(COLORS.ECI), ECEF: makeTriad(COLORS.ECEF), RIC: makeTriad(COLORS.RIC) };
    root.add(triads.ECI.group);
    earthPivot.add(triads.ECEF.group);

    // The RIC group travels with the target. Local axes: x = R, y = I, z = C.
    const ricGroup = new THREE.Group();
    root.add(ricGroup);
    ricGroup.add(triads.RIC.group);

    const radialLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-1, 0, 0)]),
        new THREE.LineBasicMaterial({ color: COLORS.RIC, transparent: true, opacity: 0 })
    );
    radialLine.frustumCulled = false;
    ricGroup.add(radialLine);

    /* Fundamental planes */
    function makeDisk(color) {
        const group = new THREE.Group();
        const fill = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
        group.add(new THREE.Mesh(new THREE.CircleGeometry(1, 96), fill));
        const pts = [];
        for (let i = 0; i < 12; i++) {
            const a = i * Math.PI / 6;
            pts.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
        }
        for (const r of [0.25, 0.5, 0.75, 1]) {
            for (let i = 0; i < 96; i++) {
                const a = i / 96 * 2 * Math.PI, b = (i + 1) / 96 * 2 * Math.PI;
                pts.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), 0), new THREE.Vector3(r * Math.cos(b), r * Math.sin(b), 0));
            }
        }
        const line = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
        group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), line));
        return { group, fill, line };
    }

    function makeSquarePlane(color) {
        const group = new THREE.Group();
        const fill = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
        group.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fill));
        const pts = [];
        for (let i = -4; i <= 4; i++) {
            const v = i / 4;
            pts.push(new THREE.Vector3(v, -1, 0), new THREE.Vector3(v, 1, 0));
            pts.push(new THREE.Vector3(-1, v, 0), new THREE.Vector3(1, v, 0));
        }
        const line = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
        group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), line));
        return { group, fill, line };
    }

    const planes = { ECI: makeDisk(COLORS.ECI), ECEF: makeDisk(COLORS.ECEF), RIC: makeSquarePlane(COLORS.RIC) };
    root.add(planes.ECI.group);
    earthPivot.add(planes.ECEF.group);
    ricGroup.add(planes.RIC.group);

    /* A faint ring for the target's orbit, shown in the RIC inset */
    const orbitRing = new THREE.LineLoop(
        new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(180 * 3), 3)),
        new THREE.LineBasicMaterial({ color: TARGET_COLOR, transparent: true, opacity: 0 })
    );
    orbitRing.frustumCulled = false;
    root.add(orbitRing);

    function updateOrbitRing() {
        const arr = orbitRing.geometry.attributes.position.array;
        const n = scenario.target.n;
        for (let i = 0; i < 180; i++) {
            const p = FM.positionEci(scenario.target, (i / 180) * 2 * Math.PI / n);
            arr.set([p[0] / RE, p[1] / RE, p[2] / RE], i * 3);
        }
        orbitRing.geometry.attributes.position.needsUpdate = true;
    }

    /* Paths: wide lines drawn in display space, computed from the analytic orbit */
    const TRAIL_POINTS = 720;
    const morphPoint = new THREE.Vector3();
    const earthTurn = new THREE.Quaternion();
    const spinAxis = new THREE.Vector3(0, 0, 1);

    class Ribbon {
        constructor(color, width) {
            const n = TRAIL_POINTS;
            this.points = new Float32Array(n * 3);
            this.position = new Float32Array(n * 6);
            this.prev = new Float32Array(n * 6);
            this.next = new Float32Array(n * 6);
            const side = new Float32Array(n * 2);
            const along = new Float32Array(n * 2);
            const index = new Uint32Array((n - 1) * 6);
            for (let i = 0; i < n; i++) {
                side[i * 2] = 1;
                side[i * 2 + 1] = -1;
                along[i * 2] = along[i * 2 + 1] = i / (n - 1);
            }
            for (let i = 0; i < n - 1; i++) {
                const a = i * 2;
                index.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6);
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
            geo.setAttribute('prevPoint', new THREE.BufferAttribute(this.prev, 3).setUsage(THREE.DynamicDrawUsage));
            geo.setAttribute('nextPoint', new THREE.BufferAttribute(this.next, 3).setUsage(THREE.DynamicDrawUsage));
            geo.setAttribute('side', new THREE.BufferAttribute(side, 1));
            geo.setAttribute('along', new THREE.BufferAttribute(along, 1));
            geo.setIndex(new THREE.BufferAttribute(index, 1));
            this.material = new THREE.ShaderMaterial({
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                uniforms: {
                    color: { value: new THREE.Color(color) },
                    opacity: { value: 1 },
                    width: { value: width },
                    resolution: { value: new THREE.Vector2(1, 1) }
                },
                vertexShader: `
                    attribute vec3 prevPoint;
                    attribute vec3 nextPoint;
                    attribute float side;
                    attribute float along;
                    uniform float width;
                    uniform vec2 resolution;
                    varying float vAlong;
                    void main() {
                        vAlong = along;
                        vec4 c = projectionMatrix * viewMatrix * vec4(position, 1.0);
                        vec4 p = projectionMatrix * viewMatrix * vec4(prevPoint, 1.0);
                        vec4 n = projectionMatrix * viewMatrix * vec4(nextPoint, 1.0);
                        vec2 d = (n.xy / n.w - p.xy / p.w) * resolution;
                        float len = length(d);
                        vec2 normal = len > 1e-5 ? vec2(-d.y, d.x) / len : vec2(0.0);
                        c.xy += normal * side * width / resolution * c.w;
                        gl_Position = c;
                    }`,
                fragmentShader: `
                    uniform vec3 color;
                    uniform float opacity;
                    varying float vAlong;
                    void main() {
                        gl_FragColor = vec4(color, opacity * mix(0.3, 1.0, pow(vAlong, 1.4)));
                    }`
            });
            this.mesh = new THREE.Mesh(geo, this.material);
            this.mesh.frustumCulled = false;
            this.mesh.renderOrder = 3;
            scene.add(this.mesh);
            this.from = new Float32Array(n * 3);
        }

        // Writes the sample points into the ribbon's vertex arrays.
        commit() {
            const n = TRAIL_POINTS, pts = this.points;
            for (let i = 0; i < n; i++) {
                const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
                for (let k = 0; k < 3; k++) {
                    const px = pts[i * 3 + k], pa = pts[a * 3 + k], pb = pts[b * 3 + k];
                    this.position[i * 6 + k] = this.position[i * 6 + 3 + k] = px;
                    this.prev[i * 6 + k] = this.prev[i * 6 + 3 + k] = pa;
                    this.next[i * 6 + k] = this.next[i * 6 + 3 + k] = pb;
                }
            }
            const attrs = this.mesh.geometry.attributes;
            attrs.position.needsUpdate = true;
            attrs.prevPoint.needsUpdate = true;
            attrs.nextPoint.needsUpdate = true;
        }
    }

    const trails = {
        target: new Ribbon(TARGET_COLOR, 2.2),
        second: new Ribbon(SECOND_COLOR, 2.2),
        track: new Ribbon(0xfdba74, 1.8)
    };

    function computeTrail(elementsObj, frame, t, out, surface) {
        const win = currentTrailWindow();
        const n = TRAIL_POINTS;
        for (let i = 0; i < n; i++) {
            const tk = t - win * (1 - i / (n - 1));
            const p = FM.positionEci(elementsObj, tk);
            const d = FM.toDisplay(frame, FM.coordinates(frame, p, tk, scenario));
            let x = d[0] / RE, y = d[1] / RE, z = d[2] / RE;
            if (surface) {
                const r = Math.hypot(x, y, z) / 1.004;
                if (r > 1e-9) {
                    x /= r; y /= r; z /= r;
                }
            }
            out[i * 3] = x;
            out[i * 3 + 1] = y;
            out[i * 3 + 2] = z;
        }
    }

    // The path during a change between ECI and ECEF. Each sample turns about the spin axis
    // by a share of Earth's rotation since that sample, then with the scene. The newest point
    // therefore stays on the spacecraft, and every point keeps its distance from Earth.
    function computeSpinMorph(elementsObj, t, share, sceneQuaternion, out) {
        const win = currentTrailWindow();
        const n = TRAIL_POINTS;
        const now = FM.earthAngle(t);
        for (let i = 0; i < n; i++) {
            const tk = t - win * (1 - i / (n - 1));
            const p = FM.positionEci(elementsObj, tk);
            const angle = share * (now - FM.earthAngle(tk));
            const c = Math.cos(angle), s = Math.sin(angle);
            morphPoint.set((c * p[0] - s * p[1]) / RE, (s * p[0] + c * p[1]) / RE, p[2] / RE);
            morphPoint.applyQuaternion(sceneQuaternion);
            out[i * 3] = morphPoint.x;
            out[i * 3 + 1] = morphPoint.y;
            out[i * 3 + 2] = morphPoint.z;
        }
    }

    /* Labels: HTML elements placed over the canvas */
    const labelRoot = $('labels');
    const labels = [];

    function addLabel(anchor, html, frame, kind) {
        const el = document.createElement('div');
        el.className = 'scene-label';
        el.innerHTML = html;
        labelRoot.appendChild(el);
        const item = { anchor, el, frame, kind };
        labels.push(item);
        return item;
    }

    for (const key of ['ECI', 'ECEF', 'RIC']) {
        const def = FRAMES[key];
        triads[key].tips.forEach((tip, i) => {
            // The RIC triad's local axes are R, I, C, in the order the frame names them.
            // The ECI and ECEF triads' local axes are also in naming order.
            const html = `<b style="color:${CSS_COLORS[key]}">${def.axes[i]}</b><span class="hint">${AXIS_HINTS[key][i]}</span>`;
            addLabel(tip, html, key, 'axis');
        });
    }
    addLabel(targetMarker, '<b style="font-family:var(--font-sans);font-size:0.76rem;">Target</b>', null, 'target');
    addLabel(secondMarker, '<b style="font-family:var(--font-sans);font-size:0.76rem;color:#e6c15a;">Second spacecraft</b>', null, 'second');
    addLabel(siteMarker, '<span style="color:#34d399;font-weight:600;">Ground site</span>', null, 'site');
    addLabel(sunMarker, '<span style="color:#ffd76a;font-weight:600;">Sun direction</span>', null, 'sun');

    /* ------------------------------------------------------------------ */
    /* View transform and frame blending                                   */
    /* ------------------------------------------------------------------ */

    const TRANSITION = 1.5; // seconds
    const FRAME_KEYS = ['ECI', 'ECEF', 'RIC'];

    const blend = {
        s: 1,
        fromQ: new THREE.Quaternion(),
        fromP: new THREE.Vector3(),
        weights: { ECI: 1, ECEF: 0, RIC: 0 },
        fromWeights: { ECI: 1, ECEF: 0, RIC: 0 }
    };

    const views = { global: { az: 35, el: 22, dist: 21 }, local: { az: -68, el: 16, dist: 0.46 } };
    const cam = { az: 35, el: 22, logDist: Math.log(21) };
    const camFrom = { az: 35, el: 22, logDist: Math.log(21) };

    function viewKey(frame) {
        return frame === 'RIC' ? 'local' : 'global';
    }

    const matrix = new THREE.Matrix4();
    const tmpQ = new THREE.Quaternion();
    const tmpP = new THREE.Vector3();

    function frameTransform(frame, t, q, p) {
        const tf = FM.displayTransform(frame, t, scenario);
        const r = tf.rows, o = tf.origin;
        matrix.set(
            r[0][0], r[0][1], r[0][2], 0,
            r[1][0], r[1][1], r[1][2], 0,
            r[2][0], r[2][1], r[2][2], 0,
            0, 0, 0, 1
        );
        q.setFromRotationMatrix(matrix);
        p.set(
            -(r[0][0] * o[0] + r[0][1] * o[1] + r[0][2] * o[2]) / RE,
            -(r[1][0] * o[0] + r[1][1] * o[1] + r[1][2] * o[2]) / RE,
            -(r[2][0] * o[0] + r[2][1] * o[1] + r[2][2] * o[2]) / RE
        );
    }

    // Records the current view, so that the next change starts from it without a jump.
    function beginTransition() {
        if (blend.s >= 1 && !trails.second.mesh.visible) {
            computeTrail(scenario.second, state.frame, state.t, trails.second.points, false);
        }
        blend.fromQ.copy(root.quaternion);
        blend.fromP.copy(root.position);
        Object.assign(blend.fromWeights, blend.weights);
        trails.target.from.set(trails.target.points);
        trails.second.from.set(trails.second.points);
        camFrom.az = cam.az;
        camFrom.el = cam.el;
        camFrom.logDist = cam.logDist;
        blend.s = 0;
        blend.spinMorph = false;
    }

    function selectFrame(frame) {
        if (frame === state.frame) return;
        const settled = blend.s >= 1;
        beginTransition();
        blend.spinMorph = settled && frame !== 'RIC' && state.frame !== 'RIC';
        state.frame = frame;
        updateFrameUi();
        dirty = true;
    }

    const smoothstep = (x) => x * x * (3 - 2 * x);
    const lerp = (a, b, x) => a + (b - a) * x;

    function angleLerp(a, b, x) {
        const d = ((b - a + 540) % 360) - 180;
        return a + d * x;
    }

    /* ------------------------------------------------------------------ */
    /* Per-frame scene update                                              */
    /* ------------------------------------------------------------------ */

    const worldPos = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const toPoint = new THREE.Vector3();
    let viewW = 1, viewH = 1;
    let insetW = 0, insetH = 0;
    let started = false;

    function sceneExtent() {
        return { axis: Math.max(1.9, 1.12 * scenario.a / RE) };
    }

    function updateScene(dt) {
        const t = state.t;

        if (blend.s < 1) {
            blend.s = Math.min(1, blend.s + dt / TRANSITION);
            dirty = true;
        }
        const s = smoothstep(blend.s);

        for (const key of FRAME_KEYS) {
            const goal = key === state.frame ? 1 : 0;
            blend.weights[key] = lerp(blend.fromWeights[key], goal, s);
        }
        const w = blend.weights;

        /* Root transform: the single change that defines each frame */
        frameTransform(state.frame, t, tmpQ, tmpP);
        root.quaternion.copy(blend.fromQ).slerp(tmpQ, s);
        root.position.copy(blend.fromP).lerp(tmpP, s);
        starGroup.quaternion.copy(root.quaternion);

        /* Earth and everything fixed to it */
        earthPivot.rotation.z = FM.earthAngle(t);

        /* Spacecraft */
        const pA = FM.positionEci(scenario.target, t);
        const pB = FM.positionEci(scenario.second, t);
        targetMarker.position.set(pA[0] / RE, pA[1] / RE, pA[2] / RE);
        secondMarker.position.set(pB[0] / RE, pB[1] / RE, pB[2] / RE);

        const siteE = scenario.siteEcef;
        siteMarker.position.set(siteE[0] / RE * 1.012, siteE[1] / RE * 1.012, siteE[2] / RE * 1.012);

        /* RIC group: rows are the axes expressed in ECI */
        const b = FM.ricBasis(scenario, t);
        matrix.set(
            b.R[0], b.I[0], b.C[0], 0,
            b.R[1], b.I[1], b.C[1], 0,
            b.R[2], b.I[2], b.C[2], 0,
            0, 0, 0, 1
        );
        ricGroup.quaternion.setFromRotationMatrix(matrix);
        ricGroup.position.copy(targetMarker.position);

        /* Sizes of the axes and planes */
        const cfg = ORBITS[state.orbit];
        const axisLen = sceneExtent().axis;
        triads.ECI.group.scale.setScalar(axisLen);
        triads.ECEF.group.scale.setScalar(axisLen * 0.94);
        const ricGlobal = Math.max(0.42, 0.34 * scenario.a / RE);
        const ricLocal = cfg.separation * 3 / RE;
        const ricScale = Math.exp(lerp(Math.log(ricGlobal), Math.log(ricLocal), w.RIC));
        triads.RIC.group.scale.setScalar(ricScale);
        planes.RIC.group.scale.set(ricLocal * 0.57, ricLocal * 0.92, 1); // local x = R, y = I
        planes.ECI.group.scale.setScalar(axisLen * 0.92);
        planes.ECEF.group.scale.setScalar(axisLen * 0.92);
        radialLine.scale.setScalar(scenario.a / RE);

        /* Opacity of the axes. Earth-centered axes fade out in the RIC close view. */
        const ghost = state.show.others ? 0.3 : 0;
        const earthCenteredGhost = ghost * (1 - w.RIC);
        triads.ECI.material.opacity = lerp(earthCenteredGhost, 1, w.ECI);
        triads.ECEF.material.opacity = lerp(earthCenteredGhost, 1, w.ECEF);
        triads.RIC.material.opacity = lerp(ghost, 1, w.RIC);
        for (const key of FRAME_KEYS) {
            triads[key].group.visible = triads[key].material.opacity > 0.005;
        }
        radialLine.material.opacity = 0.55 * w.RIC;

        /* Fundamental plane of the selected frame */
        const planeOn = state.show.plane ? 1 : 0;
        for (const key of FRAME_KEYS) {
            const o = w[key] * planeOn;
            planes[key].fill.opacity = 0.075 * o;
            planes[key].line.opacity = 0.2 * o;
            planes[key].group.visible = o > 0.003;
        }

        orbitRing.material.opacity = 0.5 * w.RIC;
        orbitRing.visible = w.RIC > 0.01;

        /* Paths: the same orbit evaluated in the selected frame, morphing during a change */
        const trailOn = state.show.trails ? 1 : 0;
        trails.target.material.uniforms.opacity.value = 0.95 * trailOn;
        trails.target.mesh.visible = trailOn > 0;
        trails.second.material.uniforms.opacity.value = 0.95 * trailOn * w.RIC;
        trails.second.mesh.visible = trailOn * w.RIC > 0.005;
        for (const name of ['target', 'second']) {
            const ribbon = trails[name];
            if (!ribbon.mesh.visible && blend.s >= 1) continue;
            if (name === 'target' && blend.spinMorph && blend.s < 1) {
                computeSpinMorph(scenario.target, t, w.ECEF, root.quaternion, ribbon.points);
                ribbon.commit();
                continue;
            }
            const live = ribbon.live || (ribbon.live = new Float32Array(TRAIL_POINTS * 3));
            computeTrail(name === 'second' ? scenario.second : scenario.target, state.frame, t, live, false);
            for (let i = 0; i < live.length; i++) {
                ribbon.points[i] = lerp(ribbon.from[i], live[i], s);
            }
            ribbon.commit();
        }
        const stationary = state.orbit === 'GEO' && state.inclination === 0;
        const trackOn = (state.show.track ? 1 : 0) * trailOn * w.ECEF * (stationary ? 0 : 1);
        trails.track.material.uniforms.opacity.value = 0.9 * trackOn;
        trails.track.mesh.visible = trackOn > 0.005;
        if (trails.track.mesh.visible) {
            computeTrail(scenario.target, 'ECEF', t, trails.track.points, true);
            if (blend.s < 1) {
                earthTurn.setFromAxisAngle(spinAxis, FM.earthAngle(t)).premultiply(root.quaternion);
                const pts = trails.track.points;
                for (let i = 0; i < pts.length; i += 3) {
                    morphPoint.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(earthTurn);
                    pts[i] = morphPoint.x;
                    pts[i + 1] = morphPoint.y;
                    pts[i + 2] = morphPoint.z;
                }
            }
            trails.track.commit();
        }

        /* Sunlight and the Sun marker */
        const sun = FM.sunDirection(t);
        tmpP.set(sun[0], sun[1], sun[2]).applyQuaternion(root.quaternion);
        sunLight.position.copy(tmpP).multiplyScalar(100);

        /* Camera */
        const key = viewKey(state.frame);
        const view = views[key];
        const aspect = viewW / Math.max(1, viewH);
        const fit = Math.min(1, aspect * 0.85); // Pulls back on narrow screens.
        const goalLog = Math.log(view.dist / fit);
        if (blend.s < 1) {
            cam.az = angleLerp(camFrom.az, view.az, s);
            cam.el = lerp(camFrom.el, view.el, s);
            cam.logDist = lerp(camFrom.logDist, goalLog, s);
        } else {
            cam.az = view.az;
            cam.el = view.el;
            cam.logDist = goalLog;
        }
        const d = Math.exp(cam.logDist);
        const ce = Math.cos(cam.el * D2R), se = Math.sin(cam.el * D2R);
        const ca = Math.cos(cam.az * D2R), sa = Math.sin(cam.az * D2R);
        // In the Earth-centered views, aim slightly up the spin axis so that its arrow stays in view.
        const lift = sceneExtent().axis * 0.15 * (1 - blend.weights.RIC);
        camera.position.set(d * ce * ca, d * ce * sa, d * se + lift);
        camera.lookAt(0, 0, lift);

        const earthDistance = camera.position.distanceTo(root.position);
        const farReach = earthDistance + 8;
        const starRadius = Math.max(farReach * 3, 40);
        starGroup.scale.setScalar(starRadius);
        camera.near = Math.max(0.002, d * 0.02);
        camera.far = starRadius * 1.3;
        camera.updateProjectionMatrix();
        sunMarker.position.copy(tmpP).multiplyScalar(starRadius * 0.9);

        /* Marker sizes in screen pixels */
        const px = (size) => size / viewH / 1.45;
        targetMarker.scale.setScalar(px(22));
        secondMarker.scale.setScalar(px(20));
        siteMarker.scale.setScalar(px(15));
        sunMarker.scale.setScalar(px(30));
    }

    /* Inset camera for the RIC view: same scene, pulled back to include Earth. */
    function updateInsetCamera() {
        const a = scenario.a / RE;
        const midpoint = -a * 0.5;
        const dist = Math.max(4.4, (a + 1.5) * 1.75);
        const el = 8 * D2R;
        insetCamera.position.set(0, -dist * Math.cos(el), midpoint + dist * Math.sin(el));
        insetCamera.lookAt(0, 0, midpoint);
        const reach = insetCamera.position.distanceTo(root.position) + 8;
        insetCamera.near = Math.max(0.05, dist * 0.05);
        insetCamera.far = Math.max(reach * 3, 40) * 1.3;
        insetCamera.aspect = insetW / Math.max(1, insetH);
        insetCamera.updateProjectionMatrix();
    }

    /* Labels */
    function updateLabels() {
        const w = blend.weights;
        const earthCenter = root.position;
        const on = state.show.labels ? 1 : 0;
        const shown = [];
        for (const item of labels) {
            let opacity = on;
            if (item.kind === 'axis') {
                const crowded = item.frame === 'RIC' && viewW < 640;
                const ghostLabel = state.show.others && !crowded ? 0.5 * (item.frame === 'RIC' ? 1 : 1 - w.RIC) : 0;
                opacity *= lerp(ghostLabel, 1, w[item.frame]);
                const hint = item.el.querySelector('.hint');
                if (hint) hint.style.opacity = w[item.frame];
            } else if (item.kind === 'second') {
                opacity *= w.RIC;
            } else if (item.kind === 'site') {
                opacity *= 1 - w.RIC;
            }
            if (opacity < 0.02) {
                item.el.style.display = 'none';
                continue;
            }
            item.anchor.getWorldPosition(worldPos);

            // Hide a label when Earth blocks the line of sight to it.
            toPoint.copy(worldPos).sub(camera.position);
            const dist = toPoint.length();
            toPoint.divideScalar(dist);
            toCam.copy(earthCenter).sub(camera.position);
            const proj = toCam.dot(toPoint);
            const perp2 = toCam.lengthSq() - proj * proj;
            const sphereR = item.kind === 'site' ? 0.995 : 1;
            let hidden = false;
            if (perp2 < sphereR * sphereR) {
                const entry = proj - Math.sqrt(sphereR * sphereR - perp2);
                hidden = entry > 0 && entry < dist;
            }

            worldPos.project(camera);
            if (hidden || worldPos.z > 1 || worldPos.z < -1) {
                item.el.style.display = 'none';
                continue;
            }
            const x = (worldPos.x + 1) * 0.5 * viewW;
            const y = (1 - worldPos.y) * 0.5 * viewH;
            if (x < -60 || x > viewW + 60 || y < -30 || y > viewH + 30) {
                item.el.style.display = 'none';
                continue;
            }
            item.el.style.display = 'block';
            item.el.style.opacity = opacity;
            if (!item.width) {
                item.width = item.el.offsetWidth;
                item.height = item.el.offsetHeight;
                const core = item.el.firstElementChild;
                item.coreWidth = core ? core.offsetWidth : item.width;
            }
            const main = item.kind !== 'axis' || w[item.frame] > 0.5;
            shown.push({ item, x, y, main, box: main ? item.width : item.coreWidth });
        }
        placeLabels(shown);
    }

    // Places the most important labels first. Each later label takes a free spot beside
    // its point. A faded label or the Sun label is hidden when no spot is free.
    function placeLabels(shown) {
        const taken = [];
        if (hudBox) taken.push(hudBox);
        if (blend.weights.RIC > 0.6) {
            const m = viewportInset();
            const caption = 34;
            taken.push({ x: m.x, y: viewH - m.y - insetH - caption, w: insetW, h: insetH + caption });
        }
        const clash = (r) => taken.some((o) => r.x < o.x + o.w + 3 && o.x < r.x + r.w + 3 && r.y < o.y + o.h + 2 && o.y < r.y + r.h + 2);
        const rank = (s) => (s.main ? (s.item.kind === 'axis' ? 0 : 1) : 2);
        shown.sort((a, b) => rank(a) - rank(b));
        for (const s of shown) {
            const { item, x, y, box } = s;
            const h = item.height || 20;
            const spots = [
                [x + 10, y - 9], [x + 10, y - 9 - h], [x + 10, y + 7],
                [x - box - 10, y - 9], [x - box - 10, y - 9 - h], [x - box - 10, y + 7]
            ];
            const underHud = hudBox && x > hudBox.x - 10 && x < hudBox.x + hudBox.w + 10 && y > hudBox.y - 10 && y < hudBox.y + hudBox.h + 10;
            if (underHud) {
                spots.push([hudBox.x + hudBox.w + 8, y - 9], [x + 10, hudBox.y + hudBox.h + 6]);
            }
            const at = (i) => {
                const px = Math.min(Math.max(4, spots[i][0]), viewW - box - 6);
                const py = Math.min(Math.max(4, spots[i][1]), viewH - h - 4);
                return { x: px, y: py, w: box, h };
            };
            // Use the usual spot when free, then the previous spot, so that labels do not jump.
            let chosen = -1;
            const previous = (item.spot || 0) < spots.length ? (item.spot || 0) : 0;
            const order = [0, previous, ...spots.keys()];
            for (const i of order) {
                const r = at(i);
                // Screen edges can push a label back onto its own point, so reject that spot too.
                const onPoint = x > r.x - 8 && x < r.x + box + 8 && y > r.y - 2 && y < r.y + h + 2;
                if (!onPoint && !clash(r)) { chosen = i; break; }
            }
            if (chosen < 0) {
                if (!s.main || item.kind === 'sun') {
                    item.el.style.display = 'none';
                    continue;
                }
                chosen = 0;
            }
            item.spot = chosen;
            const r = at(chosen);
            taken.push(r);
            item.el.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Render                                                              */
    /* ------------------------------------------------------------------ */

    function setRibbonResolution(w, h) {
        for (const r of Object.values(trails)) r.material.uniforms.resolution.value.set(w, h);
    }

    const insetFrame = $('inset-frame');

    function render() {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, viewW, viewH);
        setRibbonResolution(viewW, viewH);
        renderer.render(scene, camera);

        const w = blend.weights.RIC;
        insetFrame.style.opacity = w;
        if (w > 0.6) {
            const m = viewportInset();
            updateInsetCamera();
            setRibbonResolution(insetW, insetH);
            renderer.setScissorTest(true);
            renderer.setViewport(m.x, m.y, insetW, insetH);
            renderer.setScissor(m.x, m.y, insetW, insetH);
            // The star field must enclose the inset camera's view too.
            const starScale = starGroup.scale.x;
            starGroup.scale.setScalar(insetCamera.far / 1.3);
            renderer.render(scene, insetCamera);
            starGroup.scale.setScalar(starScale);
            renderer.setScissorTest(false);
        }
    }

    // Matches the 0.7rem offset of the inset's outline in the page styles.
    function viewportInset() {
        const offset = Math.round(0.7 * parseFloat(getComputedStyle(document.documentElement).fontSize));
        return { x: offset, y: offset };
    }

    // Areas of the view that labels must stay clear of.
    let hudBox = null;
    function measureObstacles() {
        const hud = $('hud');
        const view = viewport.getBoundingClientRect();
        const box = hud.getBoundingClientRect();
        const overlaid = getComputedStyle(hud).position === 'absolute';
        hudBox = overlaid ? { x: box.left - view.left, y: box.top - view.top, w: box.width, h: box.height } : null;
    }

    function resize() {
        viewW = Math.max(1, viewport.clientWidth);
        viewH = Math.max(1, viewport.clientHeight);
        renderer.setSize(viewW, viewH, false);
        camera.aspect = viewW / viewH;
        insetW = Math.round(Math.max(130, Math.min(250, viewW * 0.26)));
        insetH = Math.round(insetW * 0.72);
        insetFrame.style.width = insetW + 'px';
        insetFrame.style.height = insetH + 'px';
        for (const item of labels) item.width = 0;
        measureObstacles();
        dirty = true;
        // Resizing clears the canvas, so draw at once to avoid a blank frame.
        if (started) {
            updateScene(0);
            updateLabels();
            render();
            dirty = false;
        }
    }

    new ResizeObserver(resize).observe(viewport);

    /* ------------------------------------------------------------------ */
    /* Interface                                                           */
    /* ------------------------------------------------------------------ */

    const coordsBody = $('coords-body');
    const coordCells = {};
    for (const key of FRAME_KEYS) {
        const row = document.createElement('tr');
        row.dataset.frame = key;
        row.innerHTML = `<td>${key}</td>` +
            FRAMES[key].axes.map((axis, i) => `<td><span class="axis">${axis}</span><span data-c="${i}">0</span></td>`).join('') +
            '<td><span class="axis">&nbsp;</span><span data-c="speed">0</span></td>';
        coordsBody.appendChild(row);
        coordCells[key] = {
            row,
            c: [0, 1, 2].map((i) => row.querySelector(`[data-c="${i}"]`)),
            speed: row.querySelector('[data-c="speed"]')
        };
    }

    const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

    function formatKm(v) {
        const r = Math.round(v);
        if (r === 0) return '0';
        return (r > 0 ? '+' : '−') + numberFormat.format(Math.abs(r));
    }

    function updateCoordinates() {
        const positionAt = (time) => objectPosition(state.object, time);
        const p = positionAt(state.t);
        for (const key of FRAME_KEYS) {
            const c = FM.coordinates(key, p, state.t, scenario);
            const cells = coordCells[key];
            for (let i = 0; i < 3; i++) cells.c[i].textContent = formatKm(c[i]);
            cells.speed.textContent = FM.speedInFrame(key, positionAt, state.t, scenario).toFixed(2);
        }
        const elapsedMin = Math.floor(state.t / 60);
        const days = Math.floor(elapsedMin / 1440);
        const hours = Math.floor(elapsedMin / 60) % 24;
        const mins = elapsedMin % 60;
        $('elapsed').textContent = `${days} d ${String(hours).padStart(2, '0')} h ${String(mins).padStart(2, '0')} m`;
        $('turned').textContent = `${numberFormat.format(Math.floor(FM.earthAngle(state.t) / D2R))}°`;
    }

    function updateNotice() {
        const def = FRAMES[state.frame];
        $('question').textContent = def.question;
        $('notice').textContent = noticeText(state.frame, state.orbit, state.inclination);
        $('coords-note').textContent = OBJECT_NOTES[state.object][state.frame];
    }

    function updateFrameUi() {
        const def = FRAMES[state.frame];
        document.querySelectorAll('.frame-btn').forEach((btn) => {
            btn.setAttribute('aria-pressed', String(btn.dataset.frame === state.frame));
        });
        for (const key of FRAME_KEYS) {
            coordCells[key].row.classList.toggle('active', key === state.frame);
        }
        const hud = $('hud');
        hud.textContent = '';
        const heldLine = document.createElement('div');
        heldLine.innerHTML = `<strong style="color:${CSS_COLORS[state.frame]}">${state.frame} view.</strong> <strong>Held still:</strong> `;
        heldLine.append(def.held);
        const movingLine = document.createElement('div');
        movingLine.className = 'moving';
        movingLine.textContent = `Appears to move: ${def.moving}`;
        hud.append(heldLine, movingLine);
        measureObstacles();

        $('anatomy-name').textContent = def.name;
        const pill = $('class-pill');
        pill.textContent = def.classLabel;
        pill.className = `class-pill ${def.classStyle}`;

        const list = $('anatomy');
        list.textContent = '';
        for (const entry of def.anatomy) {
            const dt = document.createElement('dt');
            dt.textContent = entry[0];
            if (entry.length === 3) {
                const sym = document.createElement('span');
                sym.className = 'mono';
                sym.style.color = CSS_COLORS[state.frame];
                sym.textContent = ` ${entry[1]}`;
                dt.append(sym);
            }
            const dd = document.createElement('dd');
            dd.textContent = entry[entry.length - 1];
            list.append(dt, dd);
        }
        updateNotice();
    }

    function setPlaying(value) {
        state.playing = value;
        $('play').textContent = value ? 'Pause' : 'Play';
        dirty = true;
    }

    function applyOrbitDefaults() {
        const cfg = ORBITS[state.orbit];
        state.inclination = cfg.inclination;
        state.speedStop = cfg.speedStop;
        $('tilt').value = cfg.inclination;
        $('tilt-value').textContent = `${cfg.inclination}°`;
        $('speed').value = cfg.speedStop;
        $('speed-value').textContent = SPEEDS[cfg.speedStop].label;
        $('orbit-caption').textContent = cfg.caption;
        views.global.dist = cfg.globalDistance;
        views.local.dist = cfg.localDistance;
    }

    function selectOrbit(name) {
        if (name === state.orbit) return;
        beginTransition();
        state.orbit = name;
        state.t = 0;
        document.querySelectorAll('[data-orbit]').forEach((btn) => {
            btn.setAttribute('aria-pressed', String(btn.dataset.orbit === name));
        });
        applyOrbitDefaults();
        rebuildScenario();
        updateOrbitRing();
        updateNotice();
        dirty = true;
    }

    document.querySelectorAll('.frame-btn').forEach((btn) => {
        btn.addEventListener('click', () => selectFrame(btn.dataset.frame));
    });
    document.querySelectorAll('[data-orbit]').forEach((btn) => {
        btn.addEventListener('click', () => selectOrbit(btn.dataset.orbit));
    });
    document.querySelectorAll('[data-object]').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.object = btn.dataset.object;
            document.querySelectorAll('[data-object]').forEach((other) => {
                other.setAttribute('aria-pressed', String(other === btn));
            });
            updateCoordinates();
            updateNotice();
        });
    });
    $('play').addEventListener('click', () => setPlaying(!state.playing));
    $('restart').addEventListener('click', () => {
        state.t = 0;
        dirty = true;
    });
    $('reset-view').addEventListener('click', () => {
        beginTransition();
        const cfg = ORBITS[state.orbit];
        Object.assign(views.global, { az: 35, el: 22, dist: cfg.globalDistance });
        Object.assign(views.local, { az: -68, el: 16, dist: cfg.localDistance });
        dirty = true;
    });
    $('speed').addEventListener('input', (e) => {
        state.speedStop = Number(e.target.value);
        $('speed-value').textContent = SPEEDS[state.speedStop].label;
    });
    $('tilt').addEventListener('input', (e) => {
        state.inclination = Number(e.target.value);
        $('tilt-value').textContent = `${state.inclination}°`;
        rebuildScenario();
        updateOrbitRing();
        updateNotice();
        dirty = true;
    });
    for (const [id, key] of [['show-trails', 'trails'], ['show-plane', 'plane'], ['show-others', 'others'], ['show-labels', 'labels'], ['show-track', 'track']]) {
        $(id).addEventListener('change', (e) => {
            state.show[key] = e.target.checked;
            dirty = true;
        });
    }

    /* Drag to rotate; wheel or pinch to zoom */
    const pointers = new Map();
    let pinchStart = 0;
    let pinchDist = 0;

    function limitsFor(key) {
        return key === 'local'
            ? { elMin: -6, elMax: 86, distMin: 0.08, distMax: 30 }
            : { elMin: -86, elMax: 86, distMin: 1.6, distMax: 90 };
    }

    canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
            pinchDist = views[viewKey(state.frame)].dist;
        }
        $('view-hint').style.display = 'none';
    });
    canvas.addEventListener('pointermove', (e) => {
        const last = pointers.get(e.pointerId);
        if (!last) return;
        const view = views[viewKey(state.frame)];
        const limits = limitsFor(viewKey(state.frame));
        if (pointers.size === 1) {
            view.az -= (e.clientX - last.x) * 0.35;
            view.el = Math.min(limits.elMax, Math.max(limits.elMin, view.el + (e.clientY - last.y) * 0.3));
        }
        last.x = e.clientX;
        last.y = e.clientY;
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const now = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinchStart > 0) {
                view.dist = Math.min(limits.distMax, Math.max(limits.distMin, pinchDist * pinchStart / now));
            }
        }
        dirty = true;
    });
    const endPointer = (e) => pointers.delete(e.pointerId);
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const view = views[viewKey(state.frame)];
        const limits = limitsFor(viewKey(state.frame));
        view.dist = Math.min(limits.distMax, Math.max(limits.distMin, view.dist * Math.exp(e.deltaY * 0.0012)));
        dirty = true;
    }, { passive: false });

    /* ------------------------------------------------------------------ */
    /* Start                                                               */
    /* ------------------------------------------------------------------ */

    applyOrbitDefaults();
    rebuildScenario();
    updateOrbitRing();
    resize();
    updateFrameUi();
    setPlaying(state.playing);
    statusEl.style.display = 'none';
    started = true;

    // Labels are measured for placement, so measure again once the page fonts arrive.
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            for (const item of labels) item.width = 0;
            measureObstacles();
            dirty = true;
        });
    }

    let lastTime = performance.now();
    let lastReadout = 0;

    function loop(now) {
        requestAnimationFrame(loop);
        const dt = Math.min(0.1, (now - lastTime) / 1000);
        lastTime = now;
        if (state.playing) {
            state.t += dt * SPEEDS[state.speedStop].rate;
            dirty = true;
        }
        if (!dirty) return;
        dirty = false;
        updateScene(dt);
        updateLabels();
        render();
        if (now - lastReadout > 100) {
            updateCoordinates();
            lastReadout = now;
        }
        if (blend.s < 1) dirty = true;
    }
    updateCoordinates();
    requestAnimationFrame(loop);
})();
