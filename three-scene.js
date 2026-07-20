import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let scene, camera, renderer;
let mouseX = 0, mouseY = 0, targetX = 0, targetY = 0;
// Default framing, overridden by applyCameraMarker() once/if the room
// model's "Cone" marker object is found — mouse-look parallax in animate()
// pans around whichever of these is currently active.
const baseCamPos = new THREE.Vector3(0, 0.4, 8.5);
const lookTarget = new THREE.Vector3(0, 0.2, -2);
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
    renderer.setClearColor(0x0d0d0d);

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

    // Lighting: warm key, red + cool accents (r160 physical light units for point lights)
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    const key = new THREE.DirectionalLight(0xfff1e0, 2.2);
    key.position.set(4, 8, 6);
    scene.add(key);

    const brandLight = new THREE.PointLight(0xd01359, 60, 18, 2);
    brandLight.position.set(-7, 1, 4);
    scene.add(brandLight);

    const cool = new THREE.PointLight(0x8899ff, 25, 16, 2);
    cool.position.set(7, 3, -6);
    scene.add(cool);

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
    }, undefined, (err) => {
        console.warn('Room environment load failed, keeping placeholder room:', url, err);
    });
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
}

function animate() {
    requestAnimationFrame(animate);

    // Under prefers-reduced-motion: static camera, no spinning — the scene
    // still renders so async-loaded photos/models appear.
    if (!reduceMotion) {
        targetX += (mouseX - targetX) * 0.04;
        targetY += (mouseY - targetY) * 0.04;
        camera.position.x = baseCamPos.x + targetX * 2.2;
        camera.position.y = baseCamPos.y - targetY * 1.2;
        camera.position.z = baseCamPos.z;
        camera.lookAt(lookTarget);

        spinners.forEach(obj => { obj.rotation.y += 0.004; });
    }

    renderer.render(scene, camera);
}
