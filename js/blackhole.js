/*
 * Black hole hero — a small WebGL ray tracer.
 *
 * Every pixel shoots a light ray from the camera. The ray is bent toward the
 * black hole (an approximation of how gravity curves light), and we add up the
 * glow of the orange accretion disk each time the ray passes through it. Rays
 * that fall inside the event horizon stay black; the rest show the starfield.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("blackhole");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var gl =
    canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" }) ||
    canvas.getContext("experimental-webgl");

  function fallback() {
    document.documentElement.classList.add("no-webgl");
  }

  if (!gl) return fallback();

  var VERT = [
    "attribute vec2 aPos;",
    "void main() { gl_Position = vec4(aPos, 0.0, 1.0); }"
  ].join("\n");

  var FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform vec2  uMouse;   // smoothed, roughly -1..1
uniform float uIntro;   // 0 -> 1 over the first seconds

const float R_IN  = 2.6;   // inner edge of the disk (horizon radius = 1)
const float R_OUT = 12.0;  // outer edge of the disk

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

// Swirling gas texture; inner parts orbit faster than outer parts.
float diskPattern(float r, float ang, float t) {
  float a = ang + t * pow(r, -1.5) * 2.4;
  vec2 q = vec2(cos(a), sin(a)) * r;
  float n = fbm(q * 0.9 + 3.1);
  float rings = 0.5 + 0.5 * sin(r * 6.5 + n * 7.0);
  return mix(n, rings, 0.5);
}

// Emission (rgb) and opacity (a) of the disk at point p, seen along dir.
vec4 disk(vec3 p, vec3 dir) {
  float r = length(p.xz);
  if (r < R_IN || r > R_OUT) return vec4(0.0);

  float x = (r - R_IN) / (R_OUT - R_IN);
  float ang = atan(p.z, p.x);

  // Two time-offset samples cross-faded so the texture can loop forever
  // without winding itself into noise.
  float T = 8.0;
  float ph = fract(uTime / T);
  float wA = 1.0 - abs(2.0 * ph - 1.0);
  float pat = mix(diskPattern(r, ang, fract(ph + 0.5) * T),
                  diskPattern(r, ang, ph * T), wA);

  vec3 hot  = vec3(1.0, 0.74, 0.42);
  vec3 mid  = vec3(1.0, 0.42, 0.07);
  vec3 cool = vec3(0.50, 0.08, 0.02);
  vec3 c = mix(hot, mid, smoothstep(0.0, 0.3, x));
  c = mix(c, cool, smoothstep(0.3, 1.0, x));

  float I = smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.65, 1.0, x));
  I *= (0.3 + 1.2 * pat) * (2.4 * (1.0 - x) * (1.0 - x) + 0.12);

  // Doppler beaming: gas moving toward us is brighter and hotter.
  vec3 vdir = normalize(vec3(-p.z, 0.0, p.x));
  float beta = 0.5 / sqrt(r);
  float g = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(vdir, -normalize(dir)));
  I *= g * g * g;
  c = mix(c, hot, clamp((g - 1.0) * 0.8, 0.0, 0.6));

  return vec4(c * I, clamp(I * 0.85, 0.0, 0.95));
}

vec3 background(vec3 d) {
  vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0)));
  vec3 c = vec3(0.0);

  for (int l = 0; l < 2; l++) {
    float scale = l == 0 ? 38.0 : 85.0;
    vec2 g = sp * scale;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id + float(l) * 17.0);
    if (h > 0.965) {
      vec2 o = vec2(hash21(id + 7.0), hash21(id + 13.0)) - 0.5;
      float b = smoothstep(0.09, 0.0, length(f - o * 0.7)) * (h - 0.965) * 28.0;
      c += b * mix(vec3(1.0, 0.78, 0.55), vec3(0.85, 0.88, 1.0), hash21(id + 3.0));
    }
  }

  float n = fbm(sp * 1.8 + 10.0);
  c += vec3(0.30, 0.08, 0.02) * pow(n, 3.0) * 0.5;
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  vec2 screen = uv;
  uv.y -= 0.07; // sit the black hole slightly above center, leaving room for the words

  float yaw   = uMouse.x * 0.22;
  float pitch = 0.12 + uMouse.y * 0.05;
  float dist  = mix(30.0, 15.0, uIntro);

  vec3 ro = dist * vec3(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch));
  vec3 fwd = normalize(-ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  // A tiny roll gives the composition some tension.
  float roll = -0.12;
  vec3 r2 = cos(roll) * right + sin(roll) * up;
  vec3 u2 = cos(roll) * up - sin(roll) * right;
  float zoom = uRes.y > uRes.x ? 1.4 : 1.05; // get closer on portrait screens
  vec3 rd = normalize(fwd * zoom + uv.x * r2 + uv.y * u2);

  vec3 pos = ro, vel = rd;
  vec3 h = cross(pos, vel);
  float h2 = dot(h, h);

  vec3 col = vec3(0.0);
  float trans = 1.0;
  float minR = 1e3;
  bool captured = false;

  for (int i = 0; i < 260; i++) {
    float r = length(pos);
    minR = min(minR, r);
    if (r < 1.0) { captured = true; break; }

    float dt = clamp(0.05 * r, 0.02, 1.0);
    float r2s = r * r;
    vec3 acc = -1.5 * h2 * pos / (r2s * r2s * r);

    vec3 prev = pos;
    vel += acc * dt;
    pos += vel * dt;

    if (prev.y * pos.y < 0.0) {
      vec3 p = mix(prev, pos, prev.y / (prev.y - pos.y));
      vec4 e = disk(p, vel);
      col += trans * e.rgb;
      trans *= 1.0 - e.a;
      if (trans < 0.02) break;
    }

    if (r > 45.0 && dot(pos, vel) > 0.0) break;
  }

  if (!captured) {
    col += trans * background(normalize(vel));
    // Thin glow hugging the photon sphere
    col += trans * vec3(1.0, 0.45, 0.12) * 0.35 * exp(-max(minR - 1.5, 0.0) * 5.0);
  }

  col = 1.0 - exp(-col * 1.35);                       // tone map
  col *= 1.0 - 0.45 * dot(screen, screen);           // vignette
  col *= smoothstep(0.0, 0.6, uIntro);               // fade in from black
  col += (hash21(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0; // dither

  gl_FragColor = vec4(col, 1.0);
}
`;

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return fallback();

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    return fallback();
  }
  gl.useProgram(prog);

  // One triangle that covers the whole screen
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(prog, "uRes");
  var uTime = gl.getUniformLocation(prog, "uTime");
  var uMouse = gl.getUniformLocation(prog, "uMouse");
  var uIntro = gl.getUniformLocation(prog, "uIntro");

  // ---- Resolution & adaptive quality ----
  // The shader is heavy, so we render below native resolution and let the
  // browser upscale. If frames are slow, we lower the scale further.
  var scale = Math.min(window.devicePixelRatio || 1, 1.25) * 0.85;
  var MIN_SCALE = 0.35;

  function resize() {
    var w = Math.max(1, Math.floor(window.innerWidth * scale));
    var h = Math.max(1, Math.floor(window.innerHeight * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }
  window.addEventListener("resize", resize);
  resize();

  // ---- Mouse parallax ----
  var target = { x: 0, y: 0 };
  var mouse = { x: 0, y: 0 };
  window.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    target.x = (e.clientX / window.innerWidth) * 2 - 1;
    target.y = -((e.clientY / window.innerHeight) * 2 - 1);
  });

  // ---- Loop ----
  var start = performance.now();
  var last = start;
  var slowFrames = 0;
  var running = true;
  var timeScale = reduceMotion ? 0.15 : 1;

  // Debug / preview: ?still=6 renders a single frame at t = 6s and stops.
  var still = parseFloat(new URLSearchParams(location.search).get("still"));
  if (!isNaN(still)) {
    start = performance.now() - still * 1000;
    mouse.x = target.x = 0;
    mouse.y = target.y = 0;
  }

  document.addEventListener("visibilitychange", function () {
    running = !document.hidden;
    if (running) {
      last = performance.now();
      requestAnimationFrame(frame);
    }
  });

  function frame(now) {
    if (!running) return;

    var dtMs = now - last;
    last = now;

    // Adaptive quality: drop resolution if we're consistently under ~45fps
    if (dtMs > 22 && dtMs < 200) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 20 && scale > MIN_SCALE) {
      scale = Math.max(MIN_SCALE, scale * 0.85);
      slowFrames = 0;
      resize();
    }

    var t = (now - start) / 1000;

    // Gentle idle drift so it still feels alive on touch devices
    var driftX = Math.sin(t * 0.13) * 0.25;
    var driftY = Math.sin(t * 0.09) * 0.2;
    var k = !isNaN(still) ? 0 : reduceMotion ? 0.01 : 0.03;
    mouse.x += (target.x + driftX - mouse.x) * k;
    mouse.y += (target.y + driftY - mouse.y) * k;

    var intro = reduceMotion ? 1 : Math.min(1, t / 3.5);
    intro = 1 - Math.pow(1 - intro, 3); // ease-out

    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, t * timeScale);
    gl.uniform2f(uMouse, mouse.x, mouse.y);
    gl.uniform1f(uIntro, intro);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!isNaN(still)) return;
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
