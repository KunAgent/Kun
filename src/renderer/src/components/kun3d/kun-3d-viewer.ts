import * as THREE from 'three'
import { GLTFLoader, type GLTF, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { measureKun3dScene, type Kun3dModelStats } from './kun-3d-stats'

export const KUN_3D_VIEWS = ['front', 'threeQuarter', 'left', 'back', 'right', 'top'] as const
export type Kun3dView = (typeof KUN_3D_VIEWS)[number]
export const KUN_3D_SHADINGS = ['original', 'toon', 'clay', 'wireframe'] as const
export type Kun3dShading = (typeof KUN_3D_SHADINGS)[number]
export const KUN_3D_LIGHTINGS = ['studio', 'day', 'dusk', 'night'] as const
export type Kun3dLighting = (typeof KUN_3D_LIGHTINGS)[number]

// Azimuth and elevation in degrees. The model faces +Z, so its left side is seen from +X.
const VIEW_ANGLES: Record<Kun3dView, [number, number]> = {
  front: [0, 4], threeQuarter: [35, 12], left: [90, 4], back: [180, 4], right: [-90, 4], top: [0, 84]
}
const LIGHTS: Record<Kun3dLighting, { env: number; key: [number, number]; keyAt: [number, number, number]; sky: number; ground: number; hemi: number; rim: number }> = {
  studio: { env: 1, key: [0xffffff, 2.2], keyAt: [3, 5, 4], sky: 0xffffff, ground: 0xb8c0cc, hemi: 0.6, rim: 0.6 },
  day: { env: 0.8, key: [0xfff4e0, 2.6], keyAt: [4, 6, 3], sky: 0xbfdcff, ground: 0xc9c2a8, hemi: 0.8, rim: 0.4 },
  dusk: { env: 0.5, key: [0xff9a5c, 2.1], keyAt: [5, 2, 2], sky: 0x9a7bd0, ground: 0x4a3550, hemi: 0.7, rim: 0.9 },
  night: { env: 0.25, key: [0x8fb4ff, 1.2], keyAt: [-3, 5, 3], sky: 0x2a3a70, ground: 0x0e1224, hemi: 0.5, rim: 1.2 }
}
/** The three-view template puts the drawing's longest side at 80% of a square canvas. */
export const KUN_3D_REFERENCE_FILL = 0.8

type Saved = { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }
/** Models are shown scaled to this radius so camera and shadow settings work for any asset scale. Stats are measured before scaling. */
const DISPLAY_RADIUS = 5
/** Toon outline width on screen; navy as in the 2D art. */
const OUTLINE_PIXELS = 2.5
const OUTLINE_COLOR = 0x0e2f66

/** Swaps GLTFLoader's image-bitmap path (which fetches blob: URLs) for <img> loading, which the app's CSP allows. */
function imageTextures(parser: GLTFParser) {
  (parser as unknown as { textureLoader: THREE.TextureLoader }).textureLoader = new THREE.TextureLoader()
  return { name: 'KUN_image_textures' }
}

function toonRamp(): THREE.DataTexture {
  const ramp = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat)
  ramp.minFilter = THREE.NearestFilter
  ramp.magFilter = THREE.NearestFilter
  ramp.needsUpdate = true
  return ramp
}

export class Kun3dViewer {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly perspective = new THREE.PerspectiveCamera(30, 1, 0.01, 200)
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200)
  private camera: THREE.Camera = this.perspective
  private readonly controls: OrbitControls
  private readonly environment: THREE.Texture
  private readonly hemi = new THREE.HemisphereLight()
  private readonly key = new THREE.DirectionalLight()
  private readonly rim = new THREE.DirectionalLight(0xffffff, 0.6)
  private readonly ground: THREE.Mesh
  private readonly grid = new THREE.GridHelper(4, 16, 0x9aa3b5, 0xd5dae3)
  private readonly ramp = toonRamp()
  private readonly timer = new THREE.Timer()
  private readonly resizer: ResizeObserver
  private model: THREE.Object3D | null = null
  private animated: THREE.Object3D | null = null
  private saved: Saved[] = []
  private overrides: THREE.Material[] = []
  private outlines = new Map<THREE.Mesh, THREE.MeshBasicMaterial>()
  private mixer: THREE.AnimationMixer | null = null
  private clips: THREE.AnimationClip[] = []
  private center = new THREE.Vector3()
  private radius = 1
  private size = new THREE.Vector3(1, 1, 1)
  /** Longest side seen from the overlay view: height against width (front/back) or depth (left/right). */
  private extent = 1
  private shading: Kun3dShading = 'original'
  private lighting: Kun3dLighting = 'studio'
  private frame = 0
  private disposed = false

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.domElement.className = 'kun3d-canvas'
    host.appendChild(this.renderer.domElement)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    this.scene.environment = this.environment
    this.key.castShadow = true
    this.key.shadow.mapSize.set(1024, 1024)
    this.rim.position.set(-3, 3, -4)
    this.scene.add(this.hemi, this.key, this.key.target, this.rim)
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.18 }))
    this.ground.receiveShadow = true
    this.grid.visible = false
    this.scene.add(this.ground, this.grid)
    this.controls = new OrbitControls(this.perspective, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.autoRotateSpeed = 1.6
    this.setLighting('studio')
    this.resizer = new ResizeObserver(() => this.resize())
    this.resizer.observe(host)
    this.resize()
    this.loop()
  }

  /** Loads a binary glTF, frames it and returns what it costs. */
  async load(data: ArrayBuffer): Promise<Kun3dModelStats> {
    const loader = new GLTFLoader()
    const draco = new DRACOLoader()
    loader.setDRACOLoader(draco)
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.register(imageTextures)
    let gltf: GLTF
    try { gltf = await loader.parseAsync(data, '') } finally { draco.dispose() }
    if (this.disposed) throw new Error('viewer closed')
    this.clear()
    const stats = measureKun3dScene(gltf.scene, gltf.animations)
    const original = new THREE.Box3().setFromObject(gltf.scene)
    const pivot = new THREE.Group()
    pivot.add(gltf.scene)
    pivot.scale.setScalar(DISPLAY_RADIUS / Math.max(original.getSize(new THREE.Vector3()).length() / 2, 1e-4))
    this.model = pivot
    this.animated = gltf.scene
    this.clips = gltf.animations
    this.model.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      this.saved.push({ mesh, material: mesh.material })
    })
    this.scene.add(this.model)
    const box = new THREE.Box3().setFromObject(this.model)
    box.getCenter(this.center)
    const size = box.getSize(new THREE.Vector3())
    this.size.copy(size).max(new THREE.Vector3(1e-3, 1e-3, 1e-3))
    this.extent = Math.max(this.size.x, this.size.y)
    this.radius = Math.max(size.length() / 2, 1e-3)
    // Ground and grid sit under the model's feet, wherever its origin is.
    this.ground.position.set(this.center.x, box.min.y, this.center.z)
    this.ground.scale.setScalar(this.radius * 2.2)
    this.grid.position.copy(this.ground.position)
    this.grid.scale.setScalar(this.radius * 1.2)
    this.setLighting(this.lighting)
    this.key.target.position.copy(this.center)
    const shadow = this.key.shadow.camera
    shadow.left = shadow.bottom = -this.radius * 2
    shadow.right = shadow.top = this.radius * 2
    shadow.far = this.radius * 20
    shadow.updateProjectionMatrix()
    this.perspective.near = this.radius / 100
    this.perspective.far = this.radius * 100
    this.controls.minDistance = this.radius * 0.4
    this.controls.maxDistance = this.radius * 12
    this.applyShading()
    this.setView('front', false)
    return stats
  }

  setView(view: Kun3dView, animate = true): void {
    const [azimuth, elevation] = VIEW_ANGLES[view]
    const a = THREE.MathUtils.degToRad(azimuth), e = THREE.MathUtils.degToRad(elevation)
    const distance = this.radius / Math.sin(THREE.MathUtils.degToRad(this.perspective.fov / 2)) * 1.1
    const direction = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e))
    const target = this.center.clone()
    const position = target.clone().add(direction.multiplyScalar(distance))
    if (!animate) {
      this.perspective.position.copy(position)
      this.controls.target.copy(target)
      this.controls.update()
    } else this.tween(position, target)
    this.ortho.position.copy(this.center).add(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(this.radius * 4))
    this.ortho.lookAt(this.center)
  }

  setShading(shading: Kun3dShading): void {
    this.shading = shading
    this.applyShading()
  }

  setLighting(preset: Kun3dLighting): void {
    this.lighting = preset
    const light = LIGHTS[preset]
    this.scene.environmentIntensity = light.env
    this.hemi.color.set(light.sky)
    this.hemi.groundColor.set(light.ground)
    this.hemi.intensity = light.hemi
    this.key.color.set(light.key[0])
    this.key.intensity = light.key[1]
    this.key.position.copy(this.center).add(new THREE.Vector3(...light.keyAt).multiplyScalar(this.radius))
    this.rim.intensity = light.rim
  }

  setAutoRotate(on: boolean): void { this.controls.autoRotate = on }
  setGrid(on: boolean): void { this.grid.visible = on }

  /** Orthographic camera with the model's longest visible side at 80% of the square, so a three-view drawing lines up. */
  setOrthographic(view: Kun3dView | null): void {
    if (!view) {
      this.camera = this.perspective
      this.controls.enabled = true
      return
    }
    this.extent = view === 'left' || view === 'right' ? Math.max(this.size.z, this.size.y)
      : view === 'top' ? Math.max(this.size.x, this.size.z) : Math.max(this.size.x, this.size.y)
    this.setView(view, false)
    this.controls.enabled = false
    this.controls.autoRotate = false
    this.camera = this.ortho
    this.resize()
  }

  playAnimation(name: string | null): void {
    this.mixer?.stopAllAction()
    const clip = name ? this.clips.find((entry) => (entry.name || 'clip') === name) : undefined
    if (!clip || !this.model) return
    this.mixer ??= new THREE.AnimationMixer(this.animated ?? this.model)
    this.mixer.clipAction(clip).reset().play()
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.resizer.disconnect()
    this.clear()
    this.controls.dispose()
    this.environment.dispose()
    this.ramp.dispose()
    this.ground.geometry.dispose()
    ;(this.ground.material as THREE.Material).dispose()
    this.grid.dispose()
    this.timer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private tween(position: THREE.Vector3, target: THREE.Vector3): void {
    const fromPosition = this.perspective.position.clone(), fromTarget = this.controls.target.clone()
    const start = performance.now()
    const step = () => {
      if (this.disposed) return
      const t = Math.min(1, (performance.now() - start) / 450)
      const k = 1 - Math.pow(1 - t, 3)
      this.perspective.position.lerpVectors(fromPosition, position, k)
      this.controls.target.lerpVectors(fromTarget, target, k)
      if (t < 1) requestAnimationFrame(step)
    }
    step()
  }

  private applyShading(): void {
    for (const material of this.overrides) material.dispose()
    this.overrides = []
    const toon = this.shading === 'toon'
    this.renderer.toneMapping = toon ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping
    for (const { mesh, material } of this.saved) {
      if (this.shading === 'original') { mesh.material = material; continue }
      const source = (Array.isArray(material) ? material[0] : material) as THREE.MeshStandardMaterial | undefined
      const next = this.shading === 'toon'
        ? new THREE.MeshToonMaterial({ color: source?.color ?? new THREE.Color(0xffffff), map: source?.map ?? null, gradientMap: this.ramp,
          transparent: source?.transparent ?? false, opacity: source?.opacity ?? 1 })
        : this.shading === 'clay'
          ? new THREE.MeshStandardMaterial({ color: 0xd9dce3, roughness: 0.85, metalness: 0 })
          : new THREE.MeshBasicMaterial({ color: 0x3f5bd9, wireframe: true })
      this.overrides.push(next)
      mesh.material = next
    }
  }

  /** Inverted hull: back faces pushed out along their normals by a fixed number of screen pixels, drawn in navy. */
  private renderOutline(): void {
    const heightPx = Math.max(1, this.renderer.domElement.clientHeight)
    const perPixel = this.camera === this.ortho ? (this.ortho.top - this.ortho.bottom) / heightPx
      : 2 * this.perspective.position.distanceTo(this.controls.target) * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2)) / heightPx
    const swapped: Saved[] = []
    for (const { mesh } of this.saved) {
      let outline = this.outlines.get(mesh)
      if (!outline) {
        const width = { value: 0 }
        outline = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide })
        outline.onBeforeCompile = (shader) => {
          shader.uniforms.outlineWidth = width
          shader.vertexShader = 'uniform float outlineWidth;\n' + shader.vertexShader.replace('#include <begin_vertex>',
            '#include <begin_vertex>\n\ttransformed += normalize( normal ) * outlineWidth;')
        }
        outline.userData.width = width
        this.outlines.set(mesh, outline)
      }
      ;(outline.userData.width as { value: number }).value = OUTLINE_PIXELS * perPixel / Math.max(mesh.matrixWorld.getMaxScaleOnAxis(), 1e-6)
      swapped.push({ mesh, material: mesh.material })
      mesh.material = outline
    }
    const { autoClear } = this.renderer, shadows = this.renderer.shadowMap.autoUpdate
    const ground = this.ground.visible, grid = this.grid.visible
    this.renderer.autoClear = false
    this.renderer.shadowMap.autoUpdate = false
    this.ground.visible = this.grid.visible = false
    this.renderer.render(this.scene, this.camera)
    this.renderer.autoClear = autoClear
    this.renderer.shadowMap.autoUpdate = shadows
    this.ground.visible = ground
    this.grid.visible = grid
    for (const { mesh, material } of swapped) mesh.material = material
  }

  private clear(): void {
    for (const outline of this.outlines.values()) outline.dispose()
    this.outlines.clear()
    this.mixer?.stopAllAction()
    this.mixer = null
    for (const material of this.overrides) material.dispose()
    this.overrides = []
    // The saved originals own the geometry, materials and textures, whatever shading is showing.
    for (const { mesh, material } of this.saved) {
      mesh.geometry?.dispose()
      for (const entry of Array.isArray(material) ? material : [material]) {
        for (const value of Object.values(entry ?? {})) if ((value as THREE.Texture | null)?.isTexture) (value as THREE.Texture).dispose()
        entry?.dispose()
      }
    }
    this.saved = []
    if (this.model) this.scene.remove(this.model)
    this.model = null
    this.animated = null
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(width, height, false)
    this.perspective.aspect = width / height
    this.perspective.updateProjectionMatrix()
    // World units per pixel so the model's longest visible side fills 80% of the centered square.
    const unit = this.extent / (KUN_3D_REFERENCE_FILL * Math.min(width, height))
    this.ortho.left = -width / 2 * unit
    this.ortho.right = width / 2 * unit
    this.ortho.top = height / 2 * unit
    this.ortho.bottom = -height / 2 * unit
    this.ortho.near = 0.01
    this.ortho.far = this.radius * 10
    this.ortho.updateProjectionMatrix()
  }

  private loop = (): void => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.loop)
    if (document.hidden) return
    this.timer.update()
    const delta = this.timer.getDelta()
    this.mixer?.update(delta)
    if (this.camera === this.perspective) this.controls.update()
    this.renderer.render(this.scene, this.camera)
    if (this.shading === 'toon') this.renderOutline()
  }
}
