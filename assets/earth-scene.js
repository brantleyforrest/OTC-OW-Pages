// Shared 3D Earth and star field for Three.js tools. Load as a classic script after earth-land.js.
// Earth has a radius of 1 and is centered on the origin of its parent. Z points north.
// _template/tool-template-3d.js shows how to use it.
(function (global) {
    'use strict';

    // WebGL textures must be drawn on a canvas at run time, so that tools run from a local file.
    function buildEarthTexture(THREE, renderer, width, primeMeridian) {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = width / 2;
        const g = c.getContext('2d');
        g.fillStyle = '#123258';
        g.fillRect(0, 0, c.width, c.height);

        const sx = c.width / 360, sy = c.height / 180;
        g.fillStyle = '#5f8a70';
        g.beginPath();
        for (const ring of global.EARTH_LAND) {
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

        // The equator, and optionally the Prime Meridian in the ECEF color.
        g.lineWidth = Math.max(2, width / 1024);
        g.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        g.beginPath();
        g.moveTo(0, c.height / 2);
        g.lineTo(c.width, c.height / 2);
        g.stroke();
        if (primeMeridian) {
            g.strokeStyle = 'rgba(251, 146, 60, 0.85)';
            g.beginPath();
            g.moveTo(180 * sx, 0);
            g.lineTo(180 * sx, c.height);
            g.stroke();
        }

        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        return tex;
    }

    // Adds Earth and its atmosphere to parent. Set pivot.rotation.z to turn Earth to the east.
    function addEarth(THREE, renderer, parent, { primeMeridian = false } = {}) {
        const pivot = new THREE.Group();
        parent.add(pivot);

        const width = Math.min(renderer.capabilities.maxTextureSize, global.innerWidth < 800 ? 2048 : 4096);
        const geometry = new THREE.SphereGeometry(1, 128, 96);
        geometry.rotateX(Math.PI / 2); // Places the poles on the Z axis.
        const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({
            map: buildEarthTexture(THREE, renderer, width, primeMeridian)
        }));
        pivot.add(mesh);

        // A thin atmosphere at the limb
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
        parent.add(atmosphere);

        return { pivot, mesh, atmosphere };
    }

    // Adds a star field that is drawn behind everything else. Each frame, call
    // stars.follow(camera), so that the stars stay fixed in direction as the camera moves.
    function addStars(THREE, scene, count = 2400) {
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
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const stars = new THREE.Points(geometry, new THREE.PointsMaterial({
            size: 1.7,
            sizeAttenuation: false,
            vertexColors: true,
            depthWrite: false,
            depthTest: false
        }));
        stars.frustumCulled = false;
        stars.renderOrder = -10;
        stars.follow = (camera) => {
            stars.position.copy(camera.position);
            stars.scale.setScalar((camera.near + camera.far) / 2);
        };
        scene.add(stars);
        return stars;
    }

    global.EarthScene = { addEarth, addStars };
})(window);
