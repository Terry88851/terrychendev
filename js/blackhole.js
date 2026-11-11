/*
 * Front page scene, in three acts, rendered by one WebGL fragment shader:
 *
 *   1. Singularity — a tiny glowing point at the center that keeps pulling in
 *      streaks of light and dust. Scrolling makes it shrink and pull harder.
 *   2. Explosion   — at the end of the scroll it detonates: flash, shockwave,
 *      debris. The shockwave reveals...
 *   3. Gargantua   — a ray-traced black hole: light rays are bent toward the
 *      hole and pick up the glow of the orange accretion disk each time they
 *      cross it. Rays that fall in stay black.
 *
 * Debug / screenshot params (render one frozen frame):
 *   ?prog=0.5          singularity at 50% collapse
 *   ?boom=0.4          0.4s after the explosion
 *   ?still=6           time (seconds) to freeze at; combine with the above
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var canvas = document.getElementById("blackhole");
  var intro = document.querySelector(".intro");
  var skipBtn = document.querySelector(".skip");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var params = new URLSearchParams(location.search);
  var dbgStill = parseFloat(params.get("still"));
  var dbgProg = parseFloat(params.get("prog"));
  var dbgBoom = parseFloat(params.get("boom"));
  var debug = !isNaN(dbgStill) || !isNaN(dbgProg) || !isNaN(dbgBoom);

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);

  function finishIntro() {
    root.classList.add("is-exploded", "intro-done");
  }

  var gl =
    canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" }) ||
    canvas.getContext("experimental-webgl");

  function fallback() {
    root.classList.add("no-webgl");
    finishIntro();
  }

  if (!gl) return fallback();

  var VERT = "attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }";

  var FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;   // seconds since load
uniform vec2  uMouse;  // smoothed, roughly -1..1
uniform float uProg;   // 0..1 intro collapse (scroll driven)
uniform float uBoom;   // seconds since explosion, < 0 before it

#define PI 3.14159265

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

// ------------------------------------------------------------------
// Act 1: the singularity (cheap 2D effect)
// ------------------------------------------------------------------

vec3 stars2D(vec2 q) {
  vec3 c = vec3(0.0);
  for (int l = 0; l < 2; l++) {
    float scale = l == 0 ? 20.0 : 46.0;
    vec2 g = q * scale + float(l) * 31.7;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id);
    if (h > 0.955) {
      vec2 o = vec2(hash21(id + 7.0), hash21(id + 13.0)) - 0.5;
      float b = smoothstep(0.1, 0.0, length(f - o * 0.7)) * (h - 0.955) * 22.0;
      b *= 0.65 + 0.35 * sin(uTime * 1.7 + h * 80.0);
      c += b * mix(vec3(1.0, 0.78, 0.55), vec3(0.85, 0.88, 1.0), hash21(id + 3.0));
    }
  }
  return c;
}

// Thin streaks travelling inward along spiral paths.
// arms: number of spiral lanes; twist: how tightly they wind.
float streaks(float ang, float lr, float d, float px, float arms, float twist, float speed, float seed) {
  float k = (ang + twist * lr) * arms / (2.0 * PI) + seed;
  float id = floor(k);
  float w = fract(k) - 0.5;
  float hId = hash21(vec2(id, seed));
  // line width ~1.3px regardless of distance
  float lane = d * 2.0 * PI / arms / sqrt(1.0 + twist * twist);
  float line = exp(-pow(w * lane / (1.3 * px), 2.0));
  // break the lane into fragments that slide inward over time
  float t = lr * 2.2 + uTime * speed * (0.7 + 0.6 * hId) + hId * 17.0;
  float frag = smoothstep(0.58, 0.82, noise(vec2(t, id * 3.7 + seed)));
  return line * frag * step(0.35, hId);
}

vec3 singularity(vec2 p, float px) {
  float e = uProg;
  float ee = e * e * (3.0 - 2.0 * e);

  // core radius: small, shrinking toward a pin point
  float s = mix(0.026, 0.0035, pow(e, 0.75));
  s *= 1.0 + 0.05 * sin(uTime * 2.6);

  // instability near the end
  float shake = smoothstep(0.7, 1.0, e);
  p += shake * 0.006 * vec2(sin(uTime * 53.0), cos(uTime * 47.0)) * (0.5 + 0.5 * sin(uTime * 7.0));

  float d = max(length(p), 1e-4);
  float ang = atan(p.y, p.x);
  float lr = log(d);

  // gravitational lensing of the starfield, stronger as it collapses
  float rE = s * 2.6 + 0.045 * ee;
  vec2 q = p - p / d * (rE * rE / d);
  vec3 col = stars2D(q) * smoothstep(s, s * 4.0, d) * mix(1.0, 0.45, ee);

  // faint warm haze being pulled in
  float hz = fbm(vec2(ang * 2.0 + lr * 1.5 + uTime * 0.25, lr * 2.0 + uTime * 0.6));
  col += vec3(0.30, 0.08, 0.02) * pow(hz, 2.5) * exp(-d * 2.2) * 0.7;

  // light streaks spiralling inward
  float speed = 0.5 + 2.2 * ee;
  float fadeFar = smoothstep(0.85, 0.12, d) * smoothstep(s * 1.2, s * 2.5, d);
  float st = streaks(ang, lr, d, px, 9.0, 1.4, speed, 0.0)
           + 0.7 * streaks(ang, lr, d, px, 14.0, 2.3, speed * 1.3, 5.0)
           + 0.5 * streaks(ang + 1.3, lr, d, px, 6.0, 0.8, speed * 0.8, 11.0);
  col += mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.8, 0.55), smoothstep(0.3, 0.02, d))
         * st * fadeFar * (0.9 + 1.4 * ee) * (1.0 + 0.04 / (d + 0.02));

  // dust motes spiralling in
  {
    float k = (ang + 1.8 * lr) * 40.0 / (2.0 * PI);
    float t = lr * 9.0 + uTime * speed * 2.5;
    vec2 g = vec2(k, t);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id + 91.0);
    float mote = smoothstep(0.22, 0.0, length(f)) * step(0.86, h);
    col += vec3(1.0, 0.6, 0.25) * mote * fadeFar * 0.9;
  }

  // the glowing rim and halo
  float ring = exp(-pow((d - s * 1.12) / (s * 0.2 + 0.7 * px), 2.0));
  col += vec3(1.0, 0.78, 0.5) * ring * (1.8 + 2.5 * ee);
  col += vec3(1.0, 0.42, 0.08) * exp(-(d - s) / (s * 1.4)) * (0.7 + ee);
  col += vec3(1.0, 0.4, 0.08) * (s / d) * 0.12;

  // the dark core
  col *= smoothstep(s * 0.9, s * 1.02, d);
  return col;
}

// ------------------------------------------------------------------
// Act 3: Gargantua (ray traced)
// ------------------------------------------------------------------

// Swirling gas texture; inner parts orbit faster than outer parts.
float diskPattern(float r, float ang, float t) {
  float a = ang + t * pow(r, -1.5) * 2.4;
  vec2 q = vec2(cos(a), sin(a)) * r;
  float n = fbm(q * 0.9 + 3.1);
  float rings = 0.5 + 0.5 * sin(r * 6.5 + n * 7.0);
  return mix(n, rings, 0.5);
}

// Emission (rgb) and opacity (a) of the disk at point p, seen along dir.
vec4 disk(vec3 p, vec3 dir, float rOut) {
  float r = length(p.xz);
  if (r < R_IN || r > rOut) return vec4(0.0);

  float x = (r - R_IN) / (R_OUT - R_IN);
  float ang = atan(p.z, p.x);

  // Two time-offset samples cross-faded so the texture loops forever
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
  I *= 1.0 - smoothstep(rOut - 2.0, rOut, r);     // disk still forming
  I *= (0.3 + 1.2 * pat) * (2.4 * (1.0 - x) * (1.0 - x) + 0.12);

  // Doppler beaming: gas moving toward us is brighter and hotter
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

vec3 gargantua(vec2 uv, float tb) {
  float grow = 1.0 - exp(-tb * 1.8);
  float settle = 1.0 - pow(1.0 - clamp(tb / 3.0, 0.0, 1.0), 3.0);

  uv.y -= 0.07 * settle;                 // drift up to leave room for the words
  float dist = mix(70.0, 15.0, grow);    // born far away (tiny), rushes closer
  float rOut = mix(R_IN + 0.6, R_OUT, 1.0 - exp(-tb * 1.4));

  float yaw   = uMouse.x * 0.22;
  float pitch = 0.12 + uMouse.y * 0.05;
  vec3 ro = dist * vec3(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch));
  vec3 fwd = normalize(-ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  float roll = -0.12;
  vec3 r2 = cos(roll) * right + sin(roll) * up;
  vec3 u2 = cos(roll) * up - sin(roll) * right;
  float zoom = uRes.y > uRes.x ? 1.4 : 1.05;   // closer on portrait screens
  vec3 rd = normalize(fwd * zoom + uv.x * r2 + uv.y * u2);

  vec3 pos = ro, vel = rd;
  vec3 h = cross(pos, vel);
  float h2 = dot(h, h);
  float escape = max(45.0, dist * 1.1);

  vec3 col = vec3(0.0);
  float trans = 1.0;
  float minR = 1e3;
  bool captured = false;

  for (int i = 0; i < 280; i++) {
    float r = length(pos);
    minR = min(minR, r);
    if (r < 1.0) { captured = true; break; }

    float dt = clamp(0.05 * r, 0.02, 1.2);
    float r2s = r * r;
    vec3 acc = -1.5 * h2 * pos / (r2s * r2s * r);

    vec3 prev = pos;
    vel += acc * dt;
    pos += vel * dt;

    if (prev.y * pos.y < 0.0) {
      vec3 p = mix(prev, pos, prev.y / (prev.y - pos.y));
      vec4 e = disk(p, vel, rOut);
      col += trans * e.rgb;
      trans *= 1.0 - e.a;
      if (trans < 0.02) break;
    }
    if (r > escape && dot(pos, vel) > 0.0) break;
  }

  if (!captured) {
    col += trans * background(normalize(vel));
    col += trans * vec3(1.0, 0.45, 0.12) * 0.35 * exp(-max(minR - 1.5, 0.0) * 5.0);
  }

  // newborn: overexposed, then settles
  return col * (1.0 + 3.0 * exp(-tb * 1.8));
}

// ------------------------------------------------------------------

void main() {
  float minRes = min(uRes.x, uRes.y);
  float px = 1.0 / minRes;
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / minRes;
  vec3 col;

  if (uBoom < 0.0) {
    col = singularity(uv, px);
  } else {
    // Act 2 -> 3: shockwave reveals Gargantua
    float tb = uBoom;
    float d = length(uv);
    float R = 1.9 * (1.0 - exp(-tb * 2.4));
    float reveal = smoothstep(R, R - 0.18, d);

    vec3 garg = vec3(0.0);
    if (reveal > 0.0) garg = gargantua(uv, tb);
    col = mix(stars2D(uv) * 0.35, garg, reveal);

    // shockwave ring
    float ringW = 0.012 + 0.06 * tb;
    col += vec3(1.0, 0.6, 0.25) * exp(-pow((d - R) / ringW, 2.0)) * exp(-tb * 1.4) * 1.6;

    // debris flung outward
    float ang = atan(uv.y, uv.x);
    float bins = 110.0;
    float k = (ang + PI) / (2.0 * PI) * bins;
    float id = floor(k);
    float w = fract(k) - 0.5;
    float hd = hash21(vec2(id, 3.1));
    float head = (0.5 + 1.3 * hd) * (1.0 - exp(-tb * 2.2));
    float len = 0.03 + 0.12 * hd;
    float lane = d * 2.0 * PI / bins;
    float line = exp(-pow(w * lane / (1.2 * px), 2.0));
    float seg = smoothstep(head - len, head, d) * step(d, head);
    col += vec3(1.0, 0.65, 0.3) * line * seg * step(0.45, hd) * exp(-tb * 1.3) * 1.5;

    // flash
    col += vec3(1.0, 0.72, 0.45) * exp(-tb * 5.5) * (0.8 + 2.5 * exp(-d * 5.0));
  }

  col = 1.0 - exp(-col * 1.35);                       // tone map
  col *= 1.0 - 0.45 * dot(uv, uv);                    // vignette
  col *= smoothstep(0.0, 1.2, uTime);                 // fade in on load
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
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  var U = {};
  ["uRes", "uTime", "uMouse", "uProg", "uBoom"].forEach(function (n) {
    U[n] = gl.getUniformLocation(prog, n);
  });

  // ---- Resolution & adaptive quality ----
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

  // ---- Scroll -> collapse progress ----
  var progTarget = 0;
  var prog = 0;
  var boomAt = null; // performance.now() timestamp of the explosion (null = not yet)

  function readScroll() {
    if (boomAt !== null) return;
    var max = intro.offsetHeight - window.innerHeight;
    progTarget = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
  }
  window.addEventListener("scroll", readScroll, { passive: true });

  function explode(now) {
    if (boomAt !== null) return;
    boomAt = now;
    prog = progTarget = 1;
    root.classList.add("is-exploded");
    // Hidden behind the flash: drop the tall scroll area so the page starts at the hero
    setTimeout(function () {
      root.classList.add("intro-done");
      window.scrollTo(0, 0);
    }, 120);
  }

  skipBtn.addEventListener("click", function () {
    explode(performance.now());
  });

  // ---- Mouse parallax (Gargantua) ----
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
  var lastP = -1;

  if (reduceMotion) {
    // Skip straight to the settled black hole
    boomAt = start - 10000;
    finishIntro();
  }

  if (debug) {
    start = performance.now() - (isNaN(dbgStill) ? 6 : dbgStill) * 1000;
    if (!isNaN(dbgProg)) prog = progTarget = dbgProg;
    if (!isNaN(dbgBoom)) {
      boomAt = performance.now() - dbgBoom * 1000;
      root.classList.add("is-exploded", "intro-done");
    }
  }

  document.addEventListener("visibilitychange", function () {
    running = !document.hidden;
    if (running && !debug) {
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

    if (!debug) {
      prog += (progTarget - prog) * 0.07;
      if (boomAt === null && prog > 0.985) explode(now);
    }

    var p = Math.round(prog * 1000) / 1000;
    if (p !== lastP) {
      root.style.setProperty("--p", p);
      lastP = p;
    }

    var driftX = Math.sin(t * 0.13) * 0.25;
    var driftY = Math.sin(t * 0.09) * 0.2;
    var k = debug ? 0 : reduceMotion ? 0.01 : 0.03;
    mouse.x += (target.x + driftX - mouse.x) * k;
    mouse.y += (target.y + driftY - mouse.y) * k;

    var boom = boomAt === null ? -1 : (debug && !isNaN(dbgBoom) ? dbgBoom : (now - boomAt) / 1000);

    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, reduceMotion ? t * 0.15 : t);
    gl.uniform2f(U.uMouse, mouse.x, mouse.y);
    gl.uniform1f(U.uProg, prog);
    gl.uniform1f(U.uBoom, boom);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (debug) return;
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
