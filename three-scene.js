import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';

let scene, camera, renderer, composer, bloomPass, outlinePass;
let discoBall = null;
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
// "Zoom to object" camera focus, triggered on click alongside the info
// panel opening (see focusOnObject/clearFocus below, and editorial.js's
// showPanel/closePanel) — eased in/out via focusBlend in animate() rather
// than snapped, and skipped entirely once it settles back near 0 so the
// normal ambient roam stays exactly as cheap as before this existed.
let focusedObject = null;
let focusBlend = 0;
const FOCUS_BLEND_SPEED = 0.045;
const FOCUS_MOVE_FRACTION = 0.22; // how far from the roam position toward the object to move — partial/soft, not a close-up dolly-in
const FOCUS_LOOK_OFFSET = 0.5; // how far past the object (toward camera-right) to aim, which is what pushes the object itself toward screen-LEFT
// Renders at a reduced internal resolution while the canvas's own CSS size
// (a flex child filling .room-window — see styles.css) stretches it back up
// — paired with #room-canvas's image-rendering:pixelated, that upscale is
// nearest-neighbour rather than smooth, so this reads as genuinely blocky
// PS1-era pixelation rather than a soft low-res blur. The backing-buffer-
// to-CSS-pixel ratio is constant regardless of the canvas's own size (both
// scale off canvas.clientWidth/clientHeight together, see initRoom/
// onResize), so this value directly IS the on-screen block size: 1/2 = 1
// backing pixel per 2 CSS pixels = a 2px "pixel."
const RETRO_RENDER_SCALE = 1 / 2;
// Low-poly collectibles render on this camera layer, in a second plain
// renderer.render() pass straight after the main composer.render() — see
// animate(). That's what actually keeps them clean: MeshBasicMaterial +
// toneMapped:false already made them ignore per-object lighting/tone
// mapping, but UnrealBloomPass still operates on the WHOLE composited frame
// regardless of any single material's settings, so the room's very bright
// pink bloom was still bleeding onto them from neighbouring pixels. Doing
// their draw entirely outside the composer/bloom pipeline is the only way
// to actually exempt them from that bleed rather than just from lighting.
const MODEL_LAYER = 1;
// The site's hot-pink brand colour (matches styles.css's --accent: #d01359,
// itself sampled from the actual logo — its opaque core pixels are
// #d4145a, near-identical) — used for the hover outline specifically, kept
// separate from the low-poly models' own warm-gold ambient glow/sparkle
// colour, which isn't a hover state and isn't part of this ask.
const HOVER_OUTLINE_COLOR = 0xd01359;
const clickables = [];
const spinners = [];
// Objects that pivot side-to-side and bob up/down rather than doing a full
// 360° spin — for models (like the low-poly collectibles) whose back side
// has no real texture/geometry detail, so a full rotation would eventually
// show a blank/black back. Pauses instead of the generic hover-scale every
// other clickable gets — see animate() and the hoverTarget exclusion below.
// { obj, baseY, baseRotY, phase }.
const floaters = [];
const floaterObjects = new Set(); // mirrors floaters' .obj values, for O(1) exclusion lookup in animate()
// { group, shadow } per low-poly collectible — separate from clickables/
// floaters/floaterObjects above (which track ALL clickable types, not just
// these) so clearLowPolyModels() can undo exactly and only what
// addLowPolyModel() did, for the room window's refresh button.
const lowPolyEntries = [];
let clickCb = null;
let hoverCb = null;
// Scales whatever's currently hovered up slightly (see animate()) as a
// generic "this is clickable" affordance across every clickable in the
// room — framed photos, archive 3D models, placeholders, low-poly pieces.
// Base scale is recorded lazily on first encounter rather than at each of
// the several push sites, so it works for all of them without touching each.
let hoverTarget = null;
const HOVER_SCALE = 1.08;
const hoverBaseScale = new WeakMap();
const raycaster = new THREE.Raycaster();
raycaster.layers.enableAll(); // independent of camera.layers, which now toggles per-frame between the room and model-layer render passes — see animate()
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

export function initRoom(canvasId = 'room-canvas', onEnvironmentReady = () => {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0d0d0d, 16, 34);

    camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    camera.position.copy(baseCamPos);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // setSize's third arg (false) keeps the canvas's CSS size as laid out by
    // styles.css (a flex child filling .room-window, not the raw viewport —
    // see the "windowed" room frame there) while its actual drawing buffer —
    // and so the whole render — is smaller; the browser's normal smooth
    // upscaling does the rest. See RETRO_RENDER_SCALE above.
    renderer.setSize(canvas.clientWidth * RETRO_RENDER_SCALE, canvas.clientHeight * RETRO_RENDER_SCALE, false);
    renderer.setPixelRatio(1);
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
        new THREE.Vector2(canvas.clientWidth * RETRO_RENDER_SCALE, canvas.clientHeight * RETRO_RENDER_SCALE),
        0.3,   // strength
        0.4,   // radius
        1.0    // threshold
    );
    composer.addPass(bloomPass);

    // Hover outline: masks the hovered floater and edge-detects the mask
    // itself, so the line traced is the model's exact silhouette from
    // whatever angle the camera currently sees it — not an approximation
    // via inflated geometry (see the note above buildSparkleRing/where
    // buildOutline used to live). selectedObjects is toggled in
    // onPointerMove/the pointerleave handler below. Added AFTER bloomPass
    // rather than before — a bright, hot-pink edge run through bloom first
    // is exactly what re-introduces a soft halo even with edgeGlow:0,
    // since bloom doesn't know or care that OutlinePass's own glow is
    // turned off. Drawing the line after bloom keeps it crisp/hard.
    outlinePass = new OutlinePass(
        new THREE.Vector2(canvas.clientWidth * RETRO_RENDER_SCALE, canvas.clientHeight * RETRO_RENDER_SCALE),
        scene,
        camera
    );
    // edgeStrength stays high to keep the line crisp/opaque even at a
    // small edgeThickness — this scene's internal render buffer is tiny
    // (RETRO_RENDER_SCALE), so without a strong value a thin edge fades
    // toward transparent instead of reading as a hard line. edgeGlow:0 —
    // a hard line instead of a soft glow, per direct request.
    outlinePass.edgeStrength = 10;
    outlinePass.edgeGlow = 0;
    outlinePass.edgeThickness = 1;
    outlinePass.visibleEdgeColor.set(HOVER_OUTLINE_COLOR);
    outlinePass.hiddenEdgeColor.set(HOVER_OUTLINE_COLOR);
    outlinePass.pulsePeriod = 0;
    composer.addPass(outlinePass);

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

    loadEnvironment('models/dtpAAG.glb', room, grid, onEnvironmentReady);

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
    canvas.addEventListener('pointerleave', () => {
        hoverTarget = null;
        updateOutlineSelection();
        if (hoverCb) hoverCb(false);
    });

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

// Smoothly moves the camera in close to `object`, framing it toward the
// left of the screen — called alongside opening the info panel (which
// docks on the right), so the object stays visible next to its own info
// rather than getting covered by the panel. clearFocus() eases back out
// to the normal ambient parallax view when the panel closes.
export function focusOnObject(object) { focusedObject = object; }
export function clearFocus() { focusedObject = null; }

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
function loadEnvironment(url, fallbackRoom, fallbackGrid, onReady = () => {}) {
    new GLTFLoader().load(url, (gltf) => {
        if (!scene) return;
        scene.remove(fallbackRoom, fallbackGrid);
        scene.add(gltf.scene);
        applyCameraMarker(gltf.scene);
        rescaleImportedLights(gltf.scene);
        removeScatterVolumeCube(gltf.scene);
        fixDiscoBallReflection(gltf.scene);
        onReady();
    }, undefined, (err) => {
        console.warn('Room environment load failed, keeping placeholder room:', url, err);
        onReady();
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
// Beam cones nearest the camera read as a big translucent pink wash right
// across the foreground rather than a distant atmospheric light shaft —
// this room is only ~2-3 units across, so a light that's already close to
// the camera puts its whole cone in/near the foreground. Skipping the fake
// beam mesh for those (the real light itself is untouched) clears the
// foreground without changing the room's actual lighting.
const FOREGROUND_BEAM_HIDE_DIST = 2.0;
function rescaleImportedLights(root) {
    root.traverse((obj) => {
        if (obj.isSpotLight || obj.isPointLight) {
            obj.intensity *= IMPORTED_LIGHT_SCALE;
        }
        if (obj.isSpotLight) {
            const worldPos = obj.getWorldPosition(new THREE.Vector3());
            if (worldPos.distanceTo(baseCamPos) >= FOREGROUND_BEAM_HIDE_DIST) {
                scene.add(addLightBeam(obj));
            }
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

    discoBall = ball;
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

// ===== LOW-POLY COLLECTIBLES =====
// A separate system from addModel()'s archive-photo 3D items — these are
// decorative, game-collectible-styled pieces (one test model for now;
// eventually a pool to randomly draw 3 from each load, replacing the
// floating-gif overlay). MeshToonMaterial (banded lighting rather than
// smooth PBR) is what actually reads as "retro game" on a low-poly mesh,
// while still genuinely responding to the room's real lights rather than
// being an unlit decal.
// A custom DataTexture gradientMap (an early version of this tried a 3-band
// one built from a THREE.RedFormat DataTexture) rendered the whole model
// pure black regardless of lighting — confirmed via an isolated side-by-side
// test against the same material with no gradientMap at all, which renders
// correctly. Rather than chase that texture-format bug, this just omits
// gradientMap and uses MeshToonMaterial's own built-in default banding.
//
// A ring of small additive-blended sparkle points circling the object —
// standing in for the "collectible glow" ring iconic to N64-era platformers
// (Mario 64 stars, Banjo-Kazooie jiggies). It pivots for free by living
// inside the same group that gets pushed to `floaters`, rather than
// animating independently.
function buildSparkleRing(radius, count, color) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = Math.sin(angle * 3) * radius * 0.15; // gentle up/down wave around the ring
        positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
        color,
        size: 0.035,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.raycast = () => {}; // decorative only
    return points;
}

// Hover outlining is now handled by a real edge-detection post-process
// pass (OutlinePass, wired up in initRoom/onPointerMove below) instead of
// a hand-built inflated-hull glow. The hull version never actually tracked
// a model's real silhouette — a convex hull can't represent a concave
// shape, so the glow visibly drifted off the model's actual edge from most
// angles no matter how it was tuned. OutlinePass masks the selected object
// and edge-detects the mask itself, which is exact by construction at any
// camera angle.

// A soft radial-gradient disc for the low-poly models' drop shadow —
// CanvasTexture rather than a lighting-based shadow map, since these models
// don't cast/receive real shadows at all (unlit material, separate render
// pass from the room). Cheap, and only needs to exist once per model.
function buildDropShadow(radius) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0.5)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 24),
        new THREE.MeshBasicMaterial({
            map: new THREE.CanvasTexture(canvas),
            transparent: true,
            depthWrite: false,
            toneMapped: false,
        })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.raycast = () => {}; // decorative only
    return mesh;
}

export function addLowPolyModel(url, data = {}, position = [0.55, 0.28, 0.55], modelRotationZ = 0, baseRotY = 0, modelRotationX = 0, modelSpinY = 0) {
    return new Promise((resolve) => {
        if (!scene) return resolve(null);
        new GLTFLoader().load(url, (gltf) => {
            const model = gltf.scene;

            // Normalise to a "handheld collectible" scale relative to this
            // room, which is itself only ~2-3 units across — NOT the old
            // placeholder box room's ~20-unit scale that addModel()'s own
            // 2.2-unit target was tuned against. 0.544 is 0.64 (itself a 20%
            // reduction from a round 0.8, requested once two of these needed
            // to share the foreground without crowding each other) taken
            // down a further 15% on top.
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const scale = 0.544 / Math.max(size.x, size.y, size.z, 0.001);
            model.scale.setScalar(scale);

            // The doll model is wider than it is tall (raw bounding box
            // ~1.9 x 0.65 x 0.95) — rotating 90° around Z stood it up so its
            // longest dimension reads as height instead, portrait rather
            // than landscape. Not every model needs this, hence it's a
            // parameter rather than hardcoded — pass 0 for anything that's
            // already reasonably balanced. modelRotationX is the same idea
            // for scans that came out lying flat (like a photo on a table)
            // instead of standing upright facing the camera.
            model.rotation.z = modelRotationZ;
            model.rotation.x = modelRotationX;
            // Spins the model around its OWN local Y axis (its face-normal,
            // once already tilted upright above) — composed on top of the
            // Euler rotation via rotateOnAxis rather than another Euler
            // property, since Three.js's default XYZ Euler order applies Y
            // BEFORE Z, which would spin the model before it's standing up
            // rather than after. For a flat scan facing the camera, this is
            // an in-plane clockwise/counter-clockwise turn of the image.
            if (modelSpinY) model.rotateOnAxis(new THREE.Vector3(0, 1, 0), modelSpinY);

            // Fully unlit rather than toon-shaded — the room's strongly
            // pink/magenta lights (and, via those, bloom) were dominating
            // the model's own colours no matter how much the previous toon
            // + emissive setup tried to compensate. MeshBasicMaterial
            // ignores every scene light entirely, and toneMapped:false
            // means it also ignores the room's overall exposure/tone
            // mapping — this shows the model's raw texture colours exactly,
            // completely independent of anything else in the scene. That
            // also happens to stop it tripping bloom's threshold, since
            // there's no added light pushing its pixel values above 1.0
            // the way the point light + toon shading previously could.
            model.traverse((obj) => {
                if (!obj.isMesh) return;
                const old = obj.material;
                const map = old.map || null;
                // Nearest-neighbour instead of the default smooth bilinear
                // sampling — texels show as hard blocks rather than a soft
                // blur, which is most of what actually reads as "00s pixel
                // art" versus a low-poly model with a normal photo texture.
                // Both mag and min (not just mag) for the full PS1-era
                // effect, shimmer at a distance included — that aliasing is
                // part of the retro character, not a bug to mipmap away.
                if (map) {
                    map.magFilter = THREE.NearestFilter;
                    map.minFilter = THREE.NearestFilter;
                    map.needsUpdate = true;
                }
                obj.material = new THREE.MeshBasicMaterial({
                    map,
                    color: old.color ? old.color.clone() : new THREE.Color(0xffffff),
                    toneMapped: false,
                });
            });

            const group = new THREE.Group();
            group.add(model);

            const scaledBox = new THREE.Box3().setFromObject(model);
            model.position.y -= scaledBox.min.y; // sit the model on the group's own local floor (y=0)

            // Sparkle ring at the model's vertical midpoint, on the model's
            // own render layer — no point light here any more. A warm
            // PointLight used to sit alongside it, but since the model itself
            // is fully unlit MeshBasicMaterial (ignores it entirely), its
            // only real effect was spilling onto the room's own floor and
            // curtain, tinting them independently of the actual scene
            // lighting. Removed rather than layer-restricted, since a light
            // that can no longer reach anything is dead weight.
            const midY = (scaledBox.max.y - scaledBox.min.y) / 2;
            // The group's own origin sits at the model's FEET (see the
            // floor-anchoring line above), not its middle. The camera-focus
            // logic in animate() needs the vertical centre instead — aiming
            // at the feet meant zooming in cropped the top off anything
            // reasonably tall, since more of the object's height ended up
            // above the look point the closer the camera got.
            group.userData.focusCenterY = midY;
            const glowColor = 0xffd27a;
            const ring = buildSparkleRing(Math.max(size.x, size.z) * scale * 0.75, 14, glowColor);
            ring.position.y = midY;
            group.add(ring);
            ring.layers.set(MODEL_LAYER);

            model.traverse(obj => obj.layers.set(MODEL_LAYER));

            // Floats clear of the floor rather than sitting on it.
            group.position.set(...position);

            // A soft shadow anchored to the real room floor beneath the
            // model, marking where it'd land if it weren't floating. Found
            // via a downward raycast rather than a hardcoded floor Y — this
            // low-poly coordinate space (~0-1 units) doesn't map to any
            // single floor constant already in this file (the room import
            // has its own). Added straight to the scene, not as a child of
            // `group`, so it stays put on the floor while the model bobs
            // above it, and left on the default layer so it composites with
            // the room's own lighting/bloom like a real shadow would, rather
            // than the model's separate bloom-free pass.
            const shadowRay = new THREE.Raycaster(
                new THREE.Vector3(position[0], position[1], position[2]),
                new THREE.Vector3(0, -1, 0)
            );
            shadowRay.layers.set(0);
            const floorHit = shadowRay.intersectObjects(scene.children, true)[0];
            let shadow = null;
            if (floorHit) {
                shadow = buildDropShadow(Math.max(size.x, size.z) * scale * 0.42);
                shadow.position.set(position[0], floorHit.point.y + 0.005, position[2]);
                scene.add(shadow);
            }

            // The doll model's default orientation faced away from the
            // camera — baseRotY is what the pivot in animate() oscillates
            // around, so flipping it 180° made it face front instead. Also
            // a parameter now rather than hardcoded, since a different
            // model isn't guaranteed to need the same flip.
            group.rotation.y = baseRotY;
            group.userData.itemData = {
                title: data.title || 'Low-poly test piece',
                project: data.project || '',
                year: data.year || '',
                description: data.description || 'A low-poly model from the editorial room\'s rotating collectible pool.',
                type: data.type,
                url: data.url,
                thumbnail: data.thumbnail,
                credit: data.credit,
                tags: data.tags,
            };
            scene.add(group);
            clickables.push(group);
            floaters.push({ obj: group, baseY: group.position.y, baseRotY, phase: Math.random() * Math.PI * 2 });
            floaterObjects.add(group);
            lowPolyEntries.push({ group, shadow });
            // Resolves with the item's data (like addFramedPhoto/addModel
            // do), not the Three.js group itself, so callers can treat every
            // clickable type the same way — e.g. passing it straight to a
            // keyboard/screen-reader item list.
            resolve(group.userData.itemData);
        }, undefined, (err) => {
            console.warn('Low-poly model load failed:', url, err);
            resolve(null);
        });
    });
}

// Undoes exactly what addLowPolyModel() did for every collectible currently
// in the room — for the room window's refresh button (editorial.js), which
// needs the old 3 gone before the newly-picked 3 arrive, not just added on
// top of them. Disposes geometry/textures too since this can be triggered
// repeatedly in one session, unlike everything else in this file which
// only ever runs once per page load.
export function clearLowPolyModels() {
    if (!scene) return;
    lowPolyEntries.forEach(({ group, shadow }) => {
        scene.remove(group);
        if (shadow) scene.remove(shadow);
        const ci = clickables.indexOf(group);
        if (ci !== -1) clickables.splice(ci, 1);
        const fi = floaters.findIndex(f => f.obj === group);
        if (fi !== -1) floaters.splice(fi, 1);
        floaterObjects.delete(group);
        if (hoverTarget === group) hoverTarget = null;
        if (focusedObject === group) focusedObject = null;
        group.traverse((obj) => {
            if (!obj.isMesh) return;
            obj.geometry?.dispose();
            if (obj.material) {
                obj.material.map?.dispose();
                obj.material.dispose();
            }
        });
    });
    lowPolyEntries.length = 0;
    updateOutlineSelection();
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

// Walks up to whichever ancestor was actually pushed to `clickables` — that's
// always the one carrying itemData, regardless of how deep the raycast hit
// landed inside it.
function findClickableRoot(object) {
    let o = object;
    while (o && !o.userData.itemData) o = o.parent;
    return o;
}

function setPointerFromEvent(e) {
    // Canvas-relative, not viewport-relative — the room window (see
    // .room-window in styles.css) no longer fills the full viewport, so a
    // raw window.innerWidth/innerHeight mapping would raycast against the
    // wrong point whenever the canvas doesn't start at (0,0).
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function onClick(e) {
    setPointerFromEvent(e);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(clickables, true);
    if (!hits.length) return;
    const root = findClickableRoot(hits[0].object);
    if (root && root.userData.itemData && clickCb) clickCb(root.userData.itemData, root);
}

function onPointerMove(e) {
    setPointerFromEvent(e);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(clickables, true);
    hoverTarget = hits.length ? findClickableRoot(hits[0].object) : null;
    updateOutlineSelection();
    if (hoverCb) hoverCb(!!hoverTarget);
}

// Scoped to floaters (the low-poly collectibles) only, matching the old
// hull-outline's scope — other clickables (framed photos, archive models,
// placeholders) keep the plain hover-scale bump instead, unchanged.
function updateOutlineSelection() {
    outlinePass.selectedObjects = (hoverTarget && floaterObjects.has(hoverTarget)) ? [hoverTarget] : [];
}

function onMouseMove(e) {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
}

function onResize() {
    if (!renderer) return;
    const canvas = renderer.domElement;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    const w = canvas.clientWidth * RETRO_RENDER_SCALE;
    const h = canvas.clientHeight * RETRO_RENDER_SCALE;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloomPass.setSize(w, h);
    outlinePass.setSize(w, h);
}

function animate() {
    requestAnimationFrame(animate);

    // Under prefers-reduced-motion: static camera, no spinning — the scene
    // still renders so async-loaded photos/models appear.
    if (!reduceMotion) {
        targetX += (mouseX - targetX) * 0.04;
        targetY += (mouseY - targetY) * 0.04;

        const focusGoal = focusedObject ? 1 : 0;
        focusBlend += (focusGoal - focusBlend) * FOCUS_BLEND_SPEED;

        const roamX = baseCamPos.x + targetX * PAN_RANGE_X;
        const roamY = baseCamPos.y - targetY * PAN_RANGE_Y;

        const roamPos = new THREE.Vector3(roamX, roamY, baseCamPos.z);

        if (focusBlend > 0.001 && focusedObject) {
            const objPos = new THREE.Vector3();
            focusedObject.getWorldPosition(objPos);
            // Low-poly models are anchored at their feet, not their middle
            // (see addLowPolyModel) — without this offset the camera moves
            // toward and looks at the object's base, cropping the top off
            // anything tall as it gets closer. Framed photos/other
            // clickables have no such offset stored, so this is a no-op
            // for them (already centred on their own local origin).
            objPos.y += focusedObject.userData.focusCenterY || 0;

            // A fixed close distance from the object clipped the camera
            // below the floor for anything sitting low/at floor height,
            // since the approach direction is mostly +Z with barely any Y
            // component — the camera ended up matching the OBJECT's height
            // instead of staying near the room's normal eye level. Moving
            // only partway from the room's base position toward the object
            // (not all the way to some close fixed distance) keeps most of
            // that eye-level height intact — a soft nudge toward the object
            // rather than a dolly-in. Anchored to baseCamPos specifically
            // (not the live mouse-parallax roamPos) — once focused, the
            // camera should hold completely still regardless of where the
            // mouse goes; blending from a value that itself depended on
            // live mouse position meant it never actually stopped moving.
            const focusPos = new THREE.Vector3(baseCamPos.x, baseCamPos.y, baseCamPos.z).lerp(objPos, FOCUS_MOVE_FRACTION);
            // Looking at a point offset toward camera-right of the object
            // is what pushes the object itself toward screen-LEFT — where
            // the info panel (docked on the right) leaves room for it.
            const approachDir = new THREE.Vector3().subVectors(baseCamPos, lookTarget).normalize();
            const rightDir = new THREE.Vector3().crossVectors(camera.up, approachDir).normalize();
            const focusLook = objPos.clone().addScaledVector(rightDir, FOCUS_LOOK_OFFSET);

            camera.position.copy(roamPos).lerp(focusPos, focusBlend);
            camera.lookAt(lookTarget.clone().lerp(focusLook, focusBlend));
        } else {
            camera.position.copy(roamPos);
            camera.lookAt(lookTarget);
        }

        spinners.forEach(obj => { obj.rotation.y += 0.004; });

        // Real mirror-ball motors run ~1 RPM — much slower than the
        // clickable-item spin rate above, so it gets its own increment.
        if (discoBall) discoBall.rotation.y += 0.0015;

        const t = performance.now() * 0.001;
        floaters.forEach(f => {
            const hovered = f.obj === hoverTarget;
            if (hovered) {
                // Eases back to its canonical front-facing orientation and
                // holds there, rather than just freezing wherever the pivot
                // happened to be mid-drift — makes the hover pause always
                // show the model's actual front instead of a random angle.
                f.obj.rotation.y += (f.baseRotY - f.obj.rotation.y) * 0.15;
            } else {
                f.obj.rotation.y = f.baseRotY + Math.sin(t * 0.4 + f.phase) * 0.5; // pivot ±~29° around its facing direction, never shows the back
                f.obj.position.y = f.baseY + Math.sin(t * 0.3 + f.phase) * 0.08; // slow drift up/down
            }
        });
    }

    // Outside the reduceMotion gate deliberately — this only ever moves in
    // direct response to the user hovering something, not ambient animation,
    // so it's the same kind of feedback a native :hover style would give.
    // Floaters (see above) get a pause + outline instead of this scale-up.
    clickables.forEach(obj => {
        if (floaterObjects.has(obj)) return;
        if (!hoverBaseScale.has(obj)) hoverBaseScale.set(obj, obj.scale.clone());
        const base = hoverBaseScale.get(obj);
        const targetScale = base.clone().multiplyScalar(obj === hoverTarget ? HOVER_SCALE : 1);
        obj.scale.lerp(targetScale, 0.15);
    });

    // Two passes: the room through the normal composer (tone mapping +
    // bloom), then the low-poly models straight to the canvas afterward,
    // entirely outside that pipeline — see MODEL_LAYER above for why.
    // OutlinePass lives inside this first pass, though, and camera.layers
    // is what any render call uses to decide what's even visible to it —
    // with the camera locked to layer 0 here, OutlinePass's own internal
    // mask render (using this same camera) could never actually see a
    // hovered floater to trace its silhouette, regardless of
    // selectedObjects being set correctly. Briefly including MODEL_LAYER
    // just for this call, only while a floater is hovered, fixes that.
    // The floater itself still gets fully redrawn a moment later by the
    // raw pass below (which clears depth first) — so the only trace left
    // from this pass is bloom/outline bleeding past its silhouette, not a
    // visible double-render of the model itself.
    camera.layers.set(0);
    if (hoverTarget && floaterObjects.has(hoverTarget)) camera.layers.enable(MODEL_LAYER);
    composer.render();

    camera.layers.set(MODEL_LAYER);
    // autoClear:false is what keeps this from erasing the room that's
    // already there. Viewport/scissor are reset because EffectComposer's
    // internal passes (bloom's downsampled blur mips in particular) leave
    // both set to their own smaller render-target sizes, which otherwise
    // silently clips this entire pass to nothing. clearDepth() is
    // deliberate too, not just defensive: EffectComposer's passes after the
    // first only carry plain 2D colour textures forward (no depth), so the
    // canvas's own default-framebuffer depth is never actually written by
    // any of that pipeline — without clearing it, these models depth-test
    // against leftover/undefined values and silently lose. A side effect of
    // starting with a fresh depth buffer is that these always render in
    // front of the room regardless of actual depth, which is exactly the
    // "separate layer on top" behaviour that's the point of this whole pass.
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
    renderer.setScissorTest(false);
    renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.autoClear = true;
    camera.layers.set(0);
}
