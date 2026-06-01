import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let initialized = false;
let renderer, scene, camera, animId;
let mouseX = 0, mouseY = 0;
let targetX = 0, targetY = 0;
const objects = [];

export function initScene() {
    if (initialized) return;

    const canvas = document.getElementById('hero-canvas');
    if (!canvas) return;

    initialized = true;

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(55, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    camera.position.z = 9;

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(5, 8, 5);
    scene.add(keyLight);

    const redLight = new THREE.PointLight(0xe8000a, 4, 12);
    redLight.position.set(-4, 2, 3);
    scene.add(redLight);

    const rimLight = new THREE.PointLight(0xffffff, 1, 10);
    rimLight.position.set(4, -3, -2);
    scene.add(rimLight);

    // Placeholder floating objects
    const wireMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
    });

    const solidMat = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.3,
        metalness: 0.8,
    });

    const shapes = [
        { geo: new THREE.IcosahedronGeometry(1.3, 1), pos: [-3.5, 1.2, 0], mat: wireMat, rotSpeed: [0.004, 0.006] },
        { geo: new THREE.TorusGeometry(1.0, 0.25, 10, 30), pos: [3.2, -0.8, -1], mat: wireMat, rotSpeed: [0.005, -0.003] },
        { geo: new THREE.OctahedronGeometry(0.9), pos: [1.8, 2.2, -2.5], mat: solidMat, rotSpeed: [-0.006, 0.004] },
        { geo: new THREE.IcosahedronGeometry(0.5, 0), pos: [-1.5, -2.5, -1], mat: wireMat, rotSpeed: [0.008, -0.005] },
        { geo: new THREE.TorusKnotGeometry(0.7, 0.2, 64, 8), pos: [0.5, -1.5, -3], mat: solidMat, rotSpeed: [0.003, 0.007] },
    ];

    shapes.forEach(({ geo, pos, mat, rotSpeed }) => {
        const mesh = new THREE.Mesh(geo, mat.clone());
        mesh.position.set(...pos);
        mesh.userData.rotSpeed = rotSpeed;
        mesh.userData.floatOffset = Math.random() * Math.PI * 2;
        scene.add(mesh);
        objects.push(mesh);
    });

    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onResize);

    animate();
}

export function pauseScene() {
    if (animId) cancelAnimationFrame(animId);
}

export function resumeScene() {
    if (initialized) animate();
}

export function loadModel(url, position = [0, 0, 0], scale = 1.5) {
    if (!initialized) return;
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(scale);
        model.position.set(...position);
        model.userData.rotSpeed = [0.003, 0.005];
        model.userData.floatOffset = Math.random() * Math.PI * 2;
        scene.add(model);
        objects.push(model);
    }, undefined, (err) => {
        console.warn('Model load failed:', url, err);
    });
}

function onMouseMove(e) {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
}

function onResize() {
    const canvas = document.getElementById('hero-canvas');
    if (!canvas || !renderer) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

function animate() {
    animId = requestAnimationFrame(animate);

    const t = performance.now() * 0.001;

    // Smooth mouse follow for camera
    targetX += (mouseX - targetX) * 0.035;
    targetY += (mouseY - targetY) * 0.035;

    camera.position.x = targetX * 1.8;
    camera.position.y = -targetY * 1.0;
    camera.lookAt(scene.position);

    // Rotate and float each object
    objects.forEach(obj => {
        const [rx, ry] = obj.userData.rotSpeed || [0.003, 0.003];
        const offset = obj.userData.floatOffset || 0;
        obj.rotation.x += rx;
        obj.rotation.y += ry;
        obj.position.y += Math.sin(t + offset) * 0.002;
    });

    renderer.render(scene, camera);
}
