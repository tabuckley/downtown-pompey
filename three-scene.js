import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

let scene, camera, renderer, composer, bloomPass;
let mouseX = 0, mouseY = 0, targetX = 0, targetY = 0;
// Default framing, overridden by applyCameraMarker() once/if the room
// model's "Cone" marker object is found — mouse-look parallax in animate()
// pans around whichever of these is currently active.
const baseCamPos = new THREE.Vector3(0, 0.4, 8.5);
const lookTarget = new THREE.Vector3(0, 0.2, -2);
// The old full-range pan (±2.2 / ±1.2 units) put the best-looking framing at
// the bottom-left screen corner instead of centre. RECENTER_OFFSET shifts the
// base position to where that corner used to point, so it becomes the new
// default. Full corner (fraction 1.0 of (-2.2,-1.2)) was tested and actually
// over-shoots into an ugly close-up crop; 0.6 was the best-composed of several
// sampled fractions (0, 0.4, 0.6, 1.0) — dramatic, disco-ball-centred framing
// while still showing the full room depth. PAN_RANGE_X/Y is ~15% of the old
// ±2.2/±1.2 so mouse movement is now a subtle parallax, not a wide swing.
const RECENTER_OFFSET = new THREE.Vector2(-2.2 * 0.6, -1.2 * 0.6);
const PAN_RANGE_X = 0.33;
const PAN_RANGE_Y = 0.18;
const clickables = [];
const spinners = [];
let clickCb = null;
let hoverCb = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Wall slots for framed photos: back wall, then left and right walls.
const PHOTO_SLOTS = [
    { pos: [-5.2, 0.8, -9.8], rotY: 0 },
    { pos: [0, 0.8, -9.8], rotY: 0 },
    { pos: [5.2, 0.8, -9.8], rotY: 0 },
    { pos: [-9.8, 0.8, -4], rotY: Math.PI / 2 },
    { pos: [-9.8, 0.8, 2], rotY: Math.PI / 2 },
    { pos: [9.8, 0.8, -4], rotY: -Math.PI / 2 },
    { pos: [9.8, 0.8, 2], rotY: -Math.PI / 2 },
];
let photoSlot = 0;

// Floor positions for 3D objects.
const MODEL_SLOTS = [
    [-3.2, -3.5, -3],
    [3.2, -3.5, -1.5],
    [0, -3.5, -5],
];
let modelSlot = 0;

export function initRoom(canvasId = 'room-canvas') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0d0d0d, 16, 34);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.copy(baseCamPos);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // The room model's spot lights (KHR_lights_punctual) carry Blender's raw
    // candela values — thousands of units, meant for a tone-mapped renderer.
    // Without this, those lights just clip straight to solid white. Exposure
    // is lower than tone-mapping's own neutral (1.0) on top of that, to get
    // back the contrast/shadow depth the flat exposure-1 render was missing.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.55;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x0d0d0d);

    // Bloom is most of what makes the fake light beams and hot highlights
    // actually read as glowing rather than just semi-transparent shapes —
    // passes run in linear HDR space, OutputPass does tone mapping + color
    // space conversion on the way to the screen (must be last in the chain).
    // Threshold is deliberately high — low thresholds bloomed the curtains'
    // entire lit surface instead of just the genuinely bright highlights.
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.3,   // strength
        0.4,   // radius
        1.0    // threshold
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    // The room: a box viewed from inside. Floor at y=-3.5, ceiling at y=6.5.
    // Stays in place as an immediate-render fallback — swapped out (see
    // loadEnvironment below) the moment the real modelled room finishes
    // loading, so there's never a black void while that (7MB) file downloads.
    const room = new THREE.Mesh(
        new THREE.BoxGeometry(20, 10, 20),
        new THREE.MeshStandardMaterial({ color: 0x151515, side: THREE.BackSide, roughness: 0.95 })
    );
    room.position.y = 1.5;
    scene.add(room);

    const grid = new THREE.GridHelper(20, 24, 0x2c2c2c, 0x1b1b1b);
    grid.position.y = -3.49;
    scene.add(grid);

    loadEnvironment('models/dtpAAG.glb', room, grid);

    // Low-level fill only — the room model's own 10 spot lights (see
    // rescaleImportedLights) are the actual designed lighting once loaded.
    // The old hardcoded key/point lights were compensating for having no
    // real lights at all; keeping them alongside the real ones double-lit
    // the scene and was a big part of the washed-out/overexposed look.
    scene.add(new THREE.AmbientLight(0xffffff, 0.15));

    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onResize);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', () => { if (hoverCb) hoverCb(false); });

    // Touch look-around: drag pans the camera (mousemove never fires on touch)
    let dragging = false, lastPX = 0, lastPY = 0;
    canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse') {
            dragging = true;
            lastPX = e.clientX;
            lastPY = e.clientY;
        }
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        mouseX = clamp(mouseX - (e.clientX - lastPX) / 150, -2, 2);
        mouseY = clamp(mouseY - (e.clientY - lastPY) / 200, -1.5, 1.5);
        lastPX = e.clientX;
        lastPY = e.clientY;
    });
    window.addEventListener('pointerup', () => { dragging = false; });

    animate();
}

export function onObjectClick(cb) { clickCb = cb; }
export function onObjectHover(cb) { hoverCb = cb; }

// Resolves with the item's data on success, null on failure — callers can
// count what actually made it into the scene. Slots are only consumed on
// success so a failed load doesn't leave a permanent gap on the wall.
export function addFramedPhoto(url, data) {
    return new Promise((resolve) => {
        if (!scene) return resolve(null);
        new THREE.TextureLoader().load(url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            const aspect = tex.image.width / tex.image.height;
            let h = 2.6;
            let w = h * aspect;
            if (w > 4.4) { w = 4.4; h = w / aspect; }

            const group = new THREE.Group();

            const frame = new THREE.Mesh(
                new THREE.BoxGeometry(w + 0.28, h + 0.28, 0.12),
                new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.4 })
            );
            group.add(frame);

            const photo = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h),
                new THREE.MeshBasicMaterial({ map: tex })
            );
            photo.position.z = 0.07;
            group.add(photo);

            const slot = PHOTO_SLOTS[photoSlot % PHOTO_SLOTS.length];
            photoSlot++;
            group.position.set(...slot.pos);
            group.rotation.y = slot.rotY;
            group.userData.itemData = data;
            scene.add(group);
            clickables.push(group);
            resolve(data);
        }, undefined, (err) => {
            console.warn('Photo load failed:', url, err);
            resolve(null);
        });
    });
}

// Swaps the placeholder box room for the actual modelled gallery space once
// it's loaded — the pop-up placeholder geometry / archive photos & models
// are added separately (see populate() in editorial.js) and sit in front of
// whatever room mesh is current at that point, placeholder or real.
function loadEnvironment(url, fallbackRoom, fallbackGrid) {
    new GLTFLoader().load(url, (gltf) => {
        if (!scene) return;
        scene.remove(fallbackRoom, fallbackGrid);
        scene.add(gltf.scene);
        applyCameraMarker(gltf.scene);
        rescaleImportedLights(gltf.scene);
        removeScatterVolumeCube(gltf.scene);
        fixDiscoBallReflection(gltf.scene);
    }, undefined, (err) => {
        console.warn('Room environment load failed, keeping placeholder room:', url, err);
    });
}

// The model is a merge of several separately-sourced sub-assets with
// inconsistent unit scale baked in (visible in the wildly varying node
// scale factors throughout the file) — so Blender's raw KHR_lights_punctual
// candela values, combined with real-world inverse-square falloff, land at
// wildly different effective brightness per light rather than anything
// physically sane. Rescaling to the same rough range as this scene's other,
// hand-tuned lights (see the ~25–60 point lights above) gets a usable result
// without hand-tuning all ten individually. Each rescaled spot light also
// gets a soft additive cone standing in for its (Blender-only, not
// glTF-exportable) volumetric beam — see addLightBeam.
const IMPORTED_LIGHT_SCALE = 1 / 150;
function rescaleImportedLights(root) {
    root.traverse((obj) => {
        if (obj.isSpotLight || obj.isPointLight) {
            obj.intensity *= IMPORTED_LIGHT_SCALE;
        }
        if (obj.isSpotLight) {
            scene.add(addLightBeam(obj));
        }
    });
}

// A cheap stand-in for real volumetric scattering (which glTF/Three.js
// doesn't do out of the box): a soft-edged, additively-blended cone matching
// the light's actual position/direction/angle/color, brightest near the
// source and fading along its length. Overlapping beams from several lights
// naturally glow brighter where they cross, which is most of what reads as
// "hazy" here — good enough without a real raymarched fog volume.
const BEAM_LENGTH = 3.2;
const beamVertexShader = `
    varying float vY;
    void main() {
        vY = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const beamFragmentShader = `
    uniform vec3 uColor;
    uniform float uLength;
    varying float vY;
    void main() {
        float t = clamp(-vY / uLength, 0.0, 1.0);
        float fade = pow(1.0 - t, 2.0);
        gl_FragColor = vec4(uColor, fade * 0.16);
    }
`;
function addLightBeam(light) {
    const angle = light.angle ?? Math.PI / 8;
    const radius = Math.tan(angle) * BEAM_LENGTH;
    const geo = new THREE.ConeGeometry(radius, BEAM_LENGTH, 24, 1, true);
    geo.translate(0, -BEAM_LENGTH / 2, 0); // apex at local origin, opening toward -Y

    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: light.color.clone() },
            uLength: { value: BEAM_LENGTH },
        },
        vertexShader: beamVertexShader,
        fragmentShader: beamFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    const lightPos = light.getWorldPosition(new THREE.Vector3());
    const targetPos = light.target.getWorldPosition(new THREE.Vector3());
    mesh.position.copy(lightPos);
    // Object3D.getWorldDirection() returns local +Z, but glTF/Three.js spot
    // lights actually shine along -Z — using it here (as this used to) put
    // every beam exactly backwards. position -> target is what SpotLight
    // itself uses for real shading, so it's unambiguously the true direction.
    const dir = targetPos.sub(lightPos).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    mesh.raycast = () => {}; // decorative only — never blocks clicks on real objects
    return mesh;
}

// Stand-in for a proper volumetric-fog bounding volume in Blender (a cube
// with a Volume Scatter material) — meaningless without that shader, so it's
// removed rather than rendered as a plain grey box.
function removeScatterVolumeCube(root) {
    let cube = null;
    root.traverse((obj) => { if (obj.name === 'Cube' && obj.isMesh) cube = obj; });
    if (cube) cube.parent.remove(cube);
}

// The "Sphere" mesh (disco/mirror ball) ships as a metalness:1, roughness:0
// perfect mirror with no envMap and no scene.environment — with nothing to
// reflect, that's black everywhere except direct specular hotspots, which is
// exactly the "mostly black" symptom. A real HDRI would need external
// assets, so instead this bakes one reflection probe of the actual lit room
// via CubeCamera — a single snapshot right after load (not per-frame; nothing
// here animates enough to need it live, and it's not cheap to redo often).
function fixDiscoBallReflection(root) {
    let ball = null;
    root.traverse((obj) => { if (obj.name === 'Sphere' && obj.isMesh) ball = obj; });
    if (!ball) return;

    ball.material = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0xe8dff0),
        metalness: 0.92,
        roughness: 0.14,
        envMapIntensity: 1.6,
        clearcoat: 0.2,
        clearcoatRoughness: 0.08,
        emissive: new THREE.Color(0x160817),
        emissiveIntensity: 0.035,
    });

    const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, {
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
    });
    const cubeCamera = new THREE.CubeCamera(0.1, 50, cubeRenderTarget);
    scene.add(cubeCamera);

    const worldPosition = ball.getWorldPosition(new THREE.Vector3());
    ball.visible = false;
    cubeCamera.position.copy(worldPosition);
    cubeCamera.update(renderer, scene);
    ball.visible = true;

    ball.material.envMap = cubeRenderTarget.texture;
}

// glTF export doesn't carry Blender's camera, so the room is authored with a
// "Cone" mesh standing in for it instead — apex at the intended camera
// position, opening up toward what it should look at. Reads that, points
// the (existing, already-lit/animated) camera to match, and removes the
// cone itself so it never renders as scene geometry. Silently does nothing
// if the model has no such marker, leaving the default framing in place.
function applyCameraMarker(root) {
    root.updateMatrixWorld(true);
    let marker = null;
    root.traverse((obj) => { if (obj.name === 'Cone' && obj.isMesh) marker = obj; });
    if (!marker) return;

    const posAttr = marker.geometry.attributes.position;
    const verts = [];
    const centroid = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
        verts.push(v);
        centroid.add(v);
    }
    centroid.divideScalar(verts.length);

    // The tip is whichever vertex sits farthest from the local centroid —
    // works regardless of how the cone's own origin/pivot was set in Blender.
    let tipIndex = 0, tipDist = -1;
    verts.forEach((v, i) => {
        const d = v.distanceTo(centroid);
        if (d > tipDist) { tipDist = d; tipIndex = i; }
    });

    const baseCentroid = new THREE.Vector3();
    verts.forEach((v, i) => { if (i !== tipIndex) baseCentroid.add(v); });
    baseCentroid.divideScalar(verts.length - 1);

    baseCamPos.copy(verts[tipIndex]).applyMatrix4(marker.matrixWorld);
    baseCamPos.x += RECENTER_OFFSET.x;
    baseCamPos.y += RECENTER_OFFSET.y;
    lookTarget.copy(baseCentroid).applyMatrix4(marker.matrixWorld);
    camera.position.copy(baseCamPos);
    camera.lookAt(lookTarget);

    marker.parent.remove(marker);
}

export function addModel(url, data) {
    return new Promise((resolve) => {
        if (!scene) return resolve(null);
        new GLTFLoader().load(url, (gltf) => {
            const model = gltf.scene;

            // Normalise size so the largest dimension is ~2.2 units
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const scale = 2.2 / Math.max(size.x, size.y, size.z, 0.001);
            model.scale.setScalar(scale);

            // Sit it on the floor
            const slot = MODEL_SLOTS[modelSlot % MODEL_SLOTS.length];
            modelSlot++;
            const scaledBox = new THREE.Box3().setFromObject(model);
            model.position.set(slot[0], slot[1] - scaledBox.min.y, slot[2]);

            model.userData.itemData = data;
            scene.add(model);
            clickables.push(model);
            spinners.push(model);
            resolve(data);
        }, undefined, (err) => {
            console.warn('Model load failed:', url, err);
            resolve(null);
        });
    });
}

export function addPlaceholders() {
    if (!scene) return [];
    const wireMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5,
    });
    const geos = [
        new THREE.IcosahedronGeometry(1.1, 1),
        new THREE.TorusKnotGeometry(0.8, 0.24, 64, 8),
        new THREE.OctahedronGeometry(1.0),
    ];
    const placed = [];
    geos.forEach((geo, i) => {
        const mesh = new THREE.Mesh(geo, wireMat.clone());
        const slot = MODEL_SLOTS[i % MODEL_SLOTS.length];
        mesh.position.set(slot[0], slot[1] + 1.6, slot[2]);
        mesh.userData.itemData = {
            title: 'Placeholder object',
            project: 'Coming soon',
            year: '—',
            description: 'A stand-in until items from the archive are published. Everything you will see here comes from the Downtown Pompey archive.',
        };
        scene.add(mesh);
        clickables.push(mesh);
        spinners.push(mesh);
        placed.push(mesh.userData.itemData);
    });
    return placed;
}

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

function findItemData(object) {
    let o = object;
    while (o && !o.userData.itemData) o = o.parent;
    return o ? o.userData.itemData : null;
}

function setPointerFromEvent(e) {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function raycastClickables() {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(clickables, true);
    return hits.length ? findItemData(hits[0].object) : null;
}

function onClick(e) {
    setPointerFromEvent(e);
    const data = raycastClickables();
    if (data && clickCb) clickCb(data);
}

function onPointerMove(e) {
    setPointerFromEvent(e);
    if (hoverCb) hoverCb(!!raycastClickables());
}

function onMouseMove(e) {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
}

function onResize() {
    if (!renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    bloomPass.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    // Under prefers-reduced-motion: static camera, no spinning — the scene
    // still renders so async-loaded photos/models appear.
    if (!reduceMotion) {
        targetX += (mouseX - targetX) * 0.04;
        targetY += (mouseY - targetY) * 0.04;
        camera.position.x = baseCamPos.x + targetX * PAN_RANGE_X;
        camera.position.y = baseCamPos.y - targetY * PAN_RANGE_Y;
        camera.position.z = baseCamPos.z;
        camera.lookAt(lookTarget);

        spinners.forEach(obj => { obj.rotation.y += 0.004; });
    }

    composer.render();
}
