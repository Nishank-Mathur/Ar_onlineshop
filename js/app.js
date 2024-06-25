import * as THREE from '../libs/three125/three.module.js';
import { GLTFLoader } from '../libs/three/jsm/GLTFLoader.js';
import { RGBELoader } from '../libs/three/jsm/RGBELoader.js';
import { LoadingBar } from '../libs/LoadingBar.js';

const assetsPath = '../webxr-online/assets/ar-shop/';
const hdrPath = '../webxr-online/assets/hdr/venice_sunset_1k.hdr';
const reticlePath = 'https://immersive-web.github.io/webxr-samples/media/gltf/reticle/reticle.gltf';

const initScene = () => {
    const scene = new THREE.Scene();
    const ambient = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    ambient.position.set(0.5, 1, 0.25);
    scene.add(ambient);
    return scene;
};

const initCamera = () => {
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    camera.position.set(0, 1.6, 0);
    return camera;
};

const initRenderer = (container) => {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);
    return renderer;
};

const setEnvironment = async (renderer, scene) => {
    const loader = new RGBELoader().setDataType(THREE.UnsignedByteType);
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    try {
        const texture = await loader.loadAsync(hdrPath);
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        pmremGenerator.dispose();
        scene.environment = envMap;
    } catch (err) {
        console.error('An error occurred setting the environment', err);
    }
};

const loadReticle = async (scene) => {
    const loader = new GLTFLoader();
    try {
        const gltf = await loader.loadAsync(reticlePath);
        const reticle = gltf.scene;
        reticle.visible = false;
        scene.add(reticle);
        return reticle;
    } catch (err) {
        console.error('An error occurred loading the reticle', err);
    }
};

const setupXR = (renderer, scene, reticle) => {
    renderer.xr.enabled = true;

    if ('xr' in navigator) {
        navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
            if (supported) {
                document.querySelectorAll('.ar-button').forEach(el => {
                    el.style.display = 'block';
                });
            }
        });
    }

    let hitTestSourceRequested = false;
    let hitTestSource = null;
    let chair = null;

    const onSelect = () => {
        if (chair && reticle.visible) {
            chair.position.setFromMatrixPosition(reticle.matrix);
            chair.visible = true;
        }
    };

    const controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    const requestHitTestSource = async () => {
        const session = renderer.xr.getSession();
        const referenceSpace = await session.requestReferenceSpace('viewer');
        hitTestSource = await session.requestHitTestSource({ space: referenceSpace });

        session.addEventListener('end', () => {
            hitTestSourceRequested = false;
            hitTestSource = null;
        });

        hitTestSourceRequested = true;
    };

    const getHitTestResults = (frame) => {
        if (!hitTestSource) return;

        const hitTestResults = frame.getHitTestResults(hitTestSource);
        if (hitTestResults.length) {
            const referenceSpace = renderer.xr.getReferenceSpace();
            const pose = hitTestResults[0].getPose(referenceSpace);

            reticle.visible = true;
            reticle.matrix.fromArray(pose.transform.matrix);
        } else {
            reticle.visible = false;
        }
    };

    const render = (timestamp, frame) => {
        if (frame && !hitTestSourceRequested) {
            requestHitTestSource();
        }

        if (frame) {
            getHitTestResults(frame);
        }

        renderer.render(scene, camera);
    };

    return { render, setChair: (newChair) => chair = newChair };
};

const loadChair = async (scene, id) => {
    const loader = new GLTFLoader().setPath(assetsPath);
    const loadingBar = new LoadingBar();
    loadingBar.visible = true;

    try {
        const gltf = await loader.loadAsync(`chair${id}.glb`);
        const chair = gltf.scene;
        chair.visible = false;
        scene.add(chair);
        loadingBar.visible = false;
        return chair;
    } catch (err) {
        console.error('An error occurred loading the chair', err);
    }
};

const initAR = async (renderer, scene, chair, reticle) => {
    let currentSession = null;

    const sessionInit = { requiredFeatures: ['hit-test'] };

    const onSessionStarted = (session) => {
        session.addEventListener('end', onSessionEnded);

        renderer.xr.setReferenceSpaceType('local');
        renderer.xr.setSession(session);

        currentSession = session;
    };

    const onSessionEnded = () => {
        if (currentSession) {
            currentSession.removeEventListener('end', onSessionEnded);
            currentSession = null;

            if (chair) {
                scene.remove(chair);
                chair = null;
            }

            renderer.setAnimationLoop(null);
        }
    };

    if (currentSession === null) {
        const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
        onSessionStarted(session);
    } else {
        currentSession.end();
    }
};

const initApp = async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const scene = initScene();
    const camera = initCamera();
    const renderer = initRenderer(container);

    await setEnvironment(renderer, scene);
    const reticle = await loadReticle(scene);
    const { render, setChair } = setupXR(renderer, scene, reticle);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.querySelectorAll('.ar-button').forEach(el => {
        el.addEventListener('click', async () => {
            const chairId = el.dataset.chairId;
            const chair = await loadChair(scene, chairId);
            setChair(chair);
            initAR(renderer, scene, chair, reticle);
            renderer.setAnimationLoop(render);
        });
    });
};

initApp();
