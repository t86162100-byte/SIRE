import { useEffect, useRef } from 'react';

type Props = { className?: string };

const vertex = `#version 300 es
precision highp float;
in vec3 a_position;
in float a_size;
in float a_phase;
uniform float u_time;
uniform float u_ratio;
out float v_phase;
out float v_depth;

mat3 rotY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c);
}
mat3 rotX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c);
}

void main() {
  float t = u_time * 0.00018;
  vec3 p = a_position;
  p = rotY(t * 0.55 + sin(a_phase * 4.0) * 0.08) * p;
  p = rotX(sin(t * 0.7) * 0.16) * p;

  float depth = p.z + 2.75;
  float perspective = 1.0 / max(0.45, depth);
  float wobble = 0.018 * sin(t * 8.0 + a_phase * 37.0);
  p.xy += vec2(wobble, wobble * 0.65);

  gl_Position = vec4((p.x / u_ratio) * perspective, p.y * perspective, 0.0, 1.0);
  gl_PointSize = a_size * (0.65 + perspective * 2.2);
  v_phase = a_phase;
  v_depth = perspective;
}`;

const fragment = `#version 300 es
precision highp float;
in float v_phase;
in float v_depth;
out vec4 outColor;

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  float glow = smoothstep(0.5, 0.0, d);
  float core = smoothstep(0.18, 0.0, d);
  vec3 blue = vec3(0.06, 0.48, 1.0);
  vec3 violet = vec3(0.62, 0.20, 1.0);
  vec3 cyan = vec3(0.08, 0.86, 0.96);
  float mixA = 0.5 + 0.5 * sin(v_phase * 28.0);
  vec3 c = mix(blue, violet, mixA);
  c = mix(c, cyan, smoothstep(0.72, 1.0, v_depth) * 0.42);
  float alpha = glow * (0.30 + v_depth * 0.48) + core * 0.62;
  outColor = vec4(c * (0.38 * glow + 1.05 * core), alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('shader creation failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || 'shader compilation failed');
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext) {
  const program = gl.createProgram();
  if (!program) throw new Error('program creation failed');
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
  }
  return program;
}

export default function SireVisualEngine({ className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
    if (!gl) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mobile = window.matchMedia('(max-width: 700px)').matches;
    const count = reduced ? 160 : mobile ? 420 : 900;

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const ring = i % 3 === 0;
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI * 2;
      const radius = ring ? 0.82 + Math.random() * 0.28 : Math.pow(Math.random(), 0.55) * 1.25;
      const x = ring ? (1.05 + 0.25 * Math.cos(b)) * Math.cos(a) : Math.sin(b) * Math.cos(a) * radius;
      const y = ring ? (0.32 + 0.10 * Math.sin(b)) * Math.sin(a) : Math.cos(b) * radius * 0.78;
      const z = ring ? 0.58 * Math.sin(b) : Math.sin(b) * Math.cos(a) * radius;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      sizes[i] = (mobile ? 1.6 : 2.0) + Math.random() * (mobile ? 2.8 : 4.4);
      phases[i] = Math.random();
    }

    const program = createProgram(gl);
    const buffer = gl.createBuffer();
    const sizeBuffer = gl.createBuffer();
    const phaseBuffer = gl.createBuffer();
    if (!buffer || !sizeBuffer || !phaseBuffer) return;

    const positionLoc = gl.getAttribLocation(program, 'a_position');
    const sizeLoc = gl.getAttribLocation(program, 'a_size');
    const phaseLoc = gl.getAttribLocation(program, 'a_phase');

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(sizeLoc);
    gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, phaseBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, phases, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(phaseLoc);
    gl.vertexAttribPointer(phaseLoc, 1, gl.FLOAT, false, 0, 0);

    const timeLoc = gl.getUniformLocation(program, 'u_time');
    const ratioLoc = gl.getUniformLocation(program, 'u_ratio');
    let frame = 0;
    let running = !document.hidden;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.7 : 2.35);
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      gl.uniform1f(ratioLoc, width / Math.max(1, height));
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const draw = (now: number) => {
      if (!running) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(program);
      gl.uniform1f(timeLoc, now);
      gl.drawArrays(gl.POINTS, 0, count);
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);

    const onVisibility = () => {
      running = !document.hidden;
      cancelAnimationFrame(frame);
      if (running) frame = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteBuffer(buffer);
      gl.deleteBuffer(sizeBuffer);
      gl.deleteBuffer(phaseBuffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
