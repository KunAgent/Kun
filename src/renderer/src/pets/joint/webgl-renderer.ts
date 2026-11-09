import { armLayerVertices } from './arm-layer'
import type { JointFrame } from './timeline'
import type { JointTexture } from './assets'
import { blinkCell } from './assets'
import { createRigMesh, paintRigVertices, type RigMesh } from './mesh'
import { drawJointGround, drawJointObjects } from './draw-world'

const VERTEX = `
attribute vec2 a_position;
attribute vec2 a_uv;
attribute float a_grip;
uniform vec2 u_resolution;
varying vec2 v_uv;
varying float v_grip;
varying float v_y;
void main() {
  vec2 p = a_position / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  v_uv = a_uv; v_grip = a_grip; v_y = a_position.y;
}`
const FRAGMENT = `
precision mediump float;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform float u_hands;
uniform float u_solo;
uniform float u_column;
uniform float u_contact;
varying vec2 v_uv;
varying float v_grip;
varying float v_y;
void main() {
  vec4 base = texture2D(u_texture, v_uv);
  vec4 solo = texture2D(u_texture, vec2(v_uv.x + (6.0 - u_column) / 7.0, v_uv.y));
  float mask = u_hands > 1.5 ? 1.0 - smoothstep(u_contact, u_contact + 0.5, v_y)
    : mix(1.0, smoothstep(0.60, 0.94, v_grip), u_hands);
  gl_FragColor = mix(base, solo, u_solo) * u_opacity * mask;
}`

type MeshResource = { mesh: RigMesh; vertices: WebGLBuffer; indices: WebGLBuffer; texture: WebGLTexture; arms?: WebGLTexture }
export class JointWebGLRenderer {
  private readonly program: WebGLProgram
  private readonly locations: Record<string, WebGLUniformLocation | null>
  private readonly resources = new Map<string, MeshResource>()
  private readonly layer = document.createElement('canvas')
  private readonly layerContext = this.layer.getContext('2d')!
  private readonly layerTexture: WebGLTexture
  private readonly quad: WebGLBuffer
  private readonly quadIndices: WebGLBuffer
  private readonly position: number
  private readonly uv: number
  private readonly grip: number
  private disposed = false

  constructor(private readonly gl: WebGLRenderingContext, textures: JointTexture[], frame: JointFrame) {
    const vertex = this.shader(gl.VERTEX_SHADER, VERTEX), fragment = this.shader(gl.FRAGMENT_SHADER, FRAGMENT)
    const program = gl.createProgram()!
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program)
    gl.deleteShader(vertex); gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); throw new Error('Joint animation shader linking failed') }
    this.program = program
    this.locations = Object.fromEntries(['resolution', 'opacity', 'hands', 'solo', 'column', 'texture', 'contact'].map((name) => [name, gl.getUniformLocation(program, `u_${name}`)]))
    this.position = gl.getAttribLocation(program, 'a_position'); this.uv = gl.getAttribLocation(program, 'a_uv'); this.grip = gl.getAttribLocation(program, 'a_grip')
    this.layerTexture = this.texture()
    this.quad = gl.createBuffer()!; this.quadIndices = gl.createBuffer()!
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndices)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 1, 3, 2]), gl.STATIC_DRAW)
    for (const a of frame.actors) {
      const source = textures.find((texture) => texture.id === a.pet.id)
      const atlas = source?.atlas
      if (!atlas) continue
      const mesh = createRigMesh(a.rig), texture = this.texture()
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas)
      const vertices = gl.createBuffer()!, indices = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, vertices); gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices.byteLength, gl.DYNAMIC_DRAW)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW)
      let arms: WebGLTexture | undefined
      if (source?.arms) {
        arms = this.texture()
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.arms)
      }
      this.resources.set(a.pet.id, { mesh, texture, vertices, indices, arms })
    }
  }

  paint(frame: JointFrame, elapsed: number, reduced: boolean): void {
    const gl = this.gl
    if (this.disposed || gl.isContextLost()) return
    const canvas = gl.canvas as HTMLCanvasElement
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.round(frame.width * ratio), height = Math.round(frame.height * ratio)
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    if (this.layer.width !== width || this.layer.height !== height) { this.layer.width = width; this.layer.height = height }
    gl.viewport(0, 0, width, height); gl.useProgram(this.program)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this.locations.texture, 0)
    gl.uniform2f(this.locations.resolution, frame.width, frame.height)
    this.paintLayer(frame, ratio, drawJointGround)
    const ordered = frame.actors.map((a, i) => ({ a, i })).sort((x, y) => x.a.root.y - y.a.root.y)
    for (const { a, i } of ordered) {
      const resource = this.resources.get(a.pet.id)
      if (!resource || a.opacity < .001) continue
      const column = blinkCell(elapsed, i, reduced)
      this.bindVertices(resource.vertices)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, paintRigVertices(resource.mesh, a, column))
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resource.indices)
      gl.bindTexture(gl.TEXTURE_2D, resource.texture)
      this.uniforms(a.opacity, 0, a.soloBlend, column)
      gl.drawElements(gl.TRIANGLES, resource.mesh.indices.length, gl.UNSIGNED_SHORT, 0)
    }
    this.paintLayer(frame, ratio, drawJointObjects)
    // Foreground limbs cover the prop; typing uses isolated silhouettes and a key plane.
    for (const { a, i } of ordered) {
      if (a.opacity < .001) continue
      const resource = this.resources.get(a.pet.id)
      if (!resource) continue
      if (a.armLayers && resource.arms) {
        gl.bindTexture(gl.TEXTURE_2D, resource.arms)
        this.bindVertices(this.quad)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndices)
        for (const side of [0, 1] as const) {
          gl.bufferData(gl.ARRAY_BUFFER, armLayerVertices(a, side), gl.STREAM_DRAW)
          this.uniforms(a.opacity, 2, a.soloBlend, 0)
          gl.uniform1f(this.locations.contact, a.armLayers.contactY[side])
          gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
        }
        continue
      }
      if (Math.max(...a.grips) < .65) continue
      this.bindVertices(resource.vertices); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resource.indices)
      gl.bindTexture(gl.TEXTURE_2D, resource.texture)
      this.uniforms(a.opacity, 1, a.soloBlend, blinkCell(elapsed, i, reduced))
      gl.drawElements(gl.TRIANGLES, resource.mesh.indices.length, gl.UNSIGNED_SHORT, 0)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    for (const resource of this.resources.values()) {
      gl.deleteBuffer(resource.vertices); gl.deleteBuffer(resource.indices); gl.deleteTexture(resource.texture); if (resource.arms) gl.deleteTexture(resource.arms)
    }
    this.resources.clear(); gl.deleteBuffer(this.quad); gl.deleteBuffer(this.quadIndices)
    gl.deleteTexture(this.layerTexture); gl.deleteProgram(this.program)
    this.layer.width = this.layer.height = 0
  }

  private paintLayer(frame: JointFrame, ratio: number, draw: typeof drawJointGround): void {
    const { gl, layerContext: ctx } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.layer.width, this.layer.height)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); draw(ctx, frame)
    gl.bindTexture(gl.TEXTURE_2D, this.layerTexture)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.layer)
    this.bindVertices(this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 0, 0, frame.width, 0, 1, 0, 0,
      0, frame.height, 0, 1, 0, frame.width, frame.height, 1, 1, 0]), gl.STREAM_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndices); this.uniforms(1, 0, 0, 0)
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
  }

  private uniforms(opacity: number, hands: number, solo: number, column: number): void {
    const gl = this.gl
    gl.uniform1f(this.locations.opacity, opacity); gl.uniform1f(this.locations.hands, hands)
    gl.uniform1f(this.locations.solo, solo); gl.uniform1f(this.locations.column, column)
  }
  private bindVertices(buffer: WebGLBuffer): void {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    for (const index of [this.position, this.uv, this.grip]) gl.enableVertexAttribArray(index)
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 20, 0)
    gl.vertexAttribPointer(this.uv, 2, gl.FLOAT, false, 20, 8)
    gl.vertexAttribPointer(this.grip, 1, gl.FLOAT, false, 20, 16)
  }
  private texture(): WebGLTexture {
    const gl = this.gl, texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    return texture
  }
  private shader(type: number, source: string): WebGLShader {
    const gl = this.gl, shader = gl.createShader(type)!
    gl.shaderSource(shader, source); gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Joint animation shader compilation failed') }
    return shader
  }
}
