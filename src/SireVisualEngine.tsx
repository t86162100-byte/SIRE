import { useEffect, useRef } from 'react';

type Props = { className?: string };

const vertex = `#version 300 es
precision highp float;
in vec2 a_position;
in float a_size;
in float a_phase;
uniform float u_time;
uniform float u_ratio;
out float v_phase;
void main() {
  float t = u_time * 0.00022;
  float z = fract(a_phase + t * (0.10 + 0.05 * sin(a_phase * 17.0)));
  float depth = 0.22 + z * 0.78;
  float x = a_position.x + sin(t * 3.0 + a_phase * 9.0) * 0.035 * depth;
  float y = a_position.y + cos(t * 2.0 + a_phase * 13.0) * 0.025 * depth;
  gl_Position = vec4(x, y, 0.0, 1.0);
  gl_PointSize = a_size * (0.35 + depth) * (1.0 + 0.18 * sin(t * 8.0 + a_phase * 19.0));
  v_phase = a_phase;
}`;

const fragment = `#version 300 es
precision highp float;
in float v_phase;
out vec4 outColor;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  float glow = smoothstep(0.5, 0.0, d);
  float core = smoothstep(0.16, 0.0, d);
  vec3 c1 = vec3(0.08, 0.52, 1.0);
  vec3 c2 = vec3(0.58, 0.22, 1.0);
  vec3 c = mix(c1, c2, 0.5 + 0.5 * sin(v_phase * 31.0));
  outColor = vec4(c * (0.35 * glow + 1.15 * core), glow * 0.55 + core * 0.7);
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
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
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
    const count = reduced ? 180 : mobile ? 420 : 900;
    const positions = new Float32Array(count * 2);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.pow(Math.random(), 0.62);
      positions[i * 2] = Math.cos(angle) * radius * 1.2;
      positions[i * 2 + 1] = Math.sin(angle) * radius * 0.72;
      sizes[i] = (mobile ? 2.0 : 2.4) + Math.random() * (mobile ? 3.0 : 5.0);
      phases[i] = Math.random();
    }

    const program = createProgram(gl);
    const buffer = gl.createBuffer();
    const sizeBuffer = gl.createBuffer();
    const phaseBuffer = gl.createBuffer();
    if (!buffer || !sizeBuffer || !phaseBuffer) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    const positionLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.STATIC_DRAW);
    const sizeLoc = gl.getAttribLocation(program, 'a_size');
    gl.enableVertexAttribArray(sizeLoc);
    gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, phaseBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, phases, gl.STATIC_DRAW);
    const phaseLoc = gl.getAttribLocation(program, 'a_phase');
    gl.enableVertexAttribArray(phaseLoc);
    gl.vertexAttribPointer(phaseLoc, 1, gl.FLOAT, false, 0, 0);

    const timeLoc = gl.getUniformLocation(program, 'u_time');
    const ratioLoc = gl.getUniformLocation(program, 'u_ratio');
    let frame = 0;
    let running = true;

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
      if (running) frame = requestAnimationFrame(draw);
      else cancelAnimationFrame(frame);
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
