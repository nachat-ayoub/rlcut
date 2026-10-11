import type { Preset, Video } from '../types';
import type { CompositionSource, Scene } from './compositor';
const vertex = `attribute vec2 position;attribute vec2 uv;varying vec2 coord;void main(){coord=uv;gl_Position=vec4(position,0.,1.);}`;
const sprite = `precision mediump float;uniform sampler2D image;uniform vec4 crop;uniform vec2 mask;uniform float feather;uniform float brightness;varying vec2 coord;void main(){vec4 color=texture2D(image,crop.xy+coord*crop.zw);float alpha=1.;if(mask.x>0.){float distance=length((coord-.5)*mask);alpha=feather>0.?clamp((1.-distance)/feather,0.,1.):step(distance,1.);}gl_FragColor=vec4(clamp(color.rgb+brightness,0.,1.),alpha);}`;
const blur = `precision mediump float;uniform sampler2D image;uniform vec2 stepSize;uniform float brightness;varying vec2 coord;void main(){vec2 base=vec2(coord.x,1.-coord.y);vec3 sum=vec3(0.);float weight=0.;for(int i=-8;i<=8;i++){float x=float(i)*.375;float w=exp(-.5*x*x);sum+=texture2D(image,base+float(i)*stepSize).rgb*w;weight+=w;}gl_FragColor=vec4(clamp(sum/weight+brightness,0.,1.),1.);}`;
export class GPUCompositor {
  private width = 0;
  private height = 0;
  private sprite: WebGLProgram;
  private blur: WebGLProgram;
  private buffer: WebGLBuffer;
  private source: WebGLTexture;
  private sourceWidth = 0;
  private sourceHeight = 0;
  private targets: { texture: WebGLTexture; framebuffer: WebGLFramebuffer }[];
  constructor(private canvas: HTMLCanvasElement, private gl: WebGLRenderingContext) {
    this.sprite = this.program(sprite); this.blur = this.program(blur);
    this.buffer = gl.createBuffer()!; this.source = this.texture();
    this.targets = [0, 1].map(() => ({ texture: this.texture(), framebuffer: gl.createFramebuffer()! }));
    gl.disable(gl.DEPTH_TEST); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  }
  private program(fragment: string) {
    const gl = this.gl;
    const shader = (type: number, text: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, text); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Preview shader compilation failed'); return s; };
    const v = shader(gl.VERTEX_SHADER, vertex), f = shader(gl.FRAGMENT_SHADER, fragment), program = gl.createProgram()!;
    gl.attachShader(program, v); gl.attachShader(program, f); gl.linkProgram(program); gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Preview shader linking failed');
    return program;
  }
  private texture() {
    const gl = this.gl, texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }
  private quad(program: WebGLProgram, texture: WebGLTexture, x: number, y: number, w: number, h: number) {
    const gl = this.gl, left = x / this.canvas.width * 2 - 1, right = (x + w) / this.canvas.width * 2 - 1;
    const top = 1 - y / this.canvas.height * 2, bottom = 1 - (y + h) / this.canvas.height * 2;
    gl.useProgram(program); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([left, top, 0, 0, left, bottom, 0, 1, right, top, 1, 0, right, bottom, 1, 1]), gl.STREAM_DRAW);
    for (const [name, offset] of [['position', 0], ['uv', 8]] as const) { const location = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset); }
  }
  private paint(texture: WebGLTexture, rect: { x: number; y: number; width: number; height: number }, crop = [0, 0, 1, 1], mask = [0, 0], feather = 0, brightness = 0) {
    const gl = this.gl; this.quad(this.sprite, texture, rect.x, rect.y, rect.width, rect.height);
    gl.uniform4fv(gl.getUniformLocation(this.sprite, 'crop'), crop); gl.uniform2fv(gl.getUniformLocation(this.sprite, 'mask'), mask);
    gl.uniform1f(gl.getUniformLocation(this.sprite, 'feather'), feather); gl.uniform1f(gl.getUniformLocation(this.sprite, 'brightness'), brightness);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  draw(source: CompositionSource, video: Pick<Video, 'width' | 'height'>, preset: Preset, plan: Scene, before: boolean) {
    const gl = this.gl, width = plan.width, height = plan.height;
    if (this.width !== width || this.height !== height) {
      this.width = width; this.height = height;
      this.canvas.width = width; this.canvas.height = height;
      for (const target of this.targets) {
        gl.bindTexture(gl.TEXTURE_2D, target.texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Preview framebuffer allocation failed');
      }
    }
    gl.viewport(0, 0, width, height); gl.bindTexture(gl.TEXTURE_2D, this.source);
    if ('pixels' in source) {
      if (source.width !== this.sourceWidth || source.height !== this.sourceHeight) {
        this.sourceWidth = source.width; this.sourceHeight = source.height;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.pixels);
      } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, source.width, source.height, gl.RGBA, gl.UNSIGNED_BYTE, source.pixels);
    } else {
      this.sourceWidth = 0; this.sourceHeight = 0;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    }
    gl.disable(gl.BLEND); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const full = { x: 0, y: 0, width, height };
    if (before) { this.paint(this.source, full); return; }
    const bg = plan.background, crop = [bg.x / bg.width, bg.y / bg.height, width / bg.width, height / bg.height];
    const brightness = preset.background.brightness * 255 / 219;
    if (preset.background.blur > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[0].framebuffer); this.paint(this.source, full, crop);
      const sigma = preset.background.blur * width / 1080;
      for (let pass = 0; pass < 2; pass++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, pass === 0 ? this.targets[1].framebuffer : null);
        this.quad(this.blur, this.targets[pass].texture, 0, 0, width, height);
        gl.uniform2f(gl.getUniformLocation(this.blur, 'stepSize'), pass === 0 ? sigma * .375 / width : 0, pass === 1 ? sigma * .375 / height : 0);
        gl.uniform1f(gl.getUniformLocation(this.blur, 'brightness'), pass === 1 ? brightness : 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    } else this.paint(this.source, full, crop, [0, 0], 0, brightness);
    this.paint(this.source, plan.gameplay);
    if (preset.boost.enabled) {
      const b = plan.boost, c = plan.crop;
      const radius = Math.min(b.width, b.height) / 2;
      const mask = preset.boost.shape === 'circle' ? [b.width / radius, b.height / radius] : [2, 2];
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.paint(this.source, b, [c.x / video.width, c.y / video.height, c.width / video.width, c.height / video.height], mask, preset.boost.feather); gl.disable(gl.BLEND);
    }
  }
  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.sprite); gl.deleteProgram(this.blur); gl.deleteBuffer(this.buffer); gl.deleteTexture(this.source);
    for (const target of this.targets) { gl.deleteTexture(target.texture); gl.deleteFramebuffer(target.framebuffer); }
  }
}
