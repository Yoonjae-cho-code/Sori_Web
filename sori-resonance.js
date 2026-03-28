/**
 * ============================================================
 *  SORI · 소리  —  sori-resonance.js  v3
 *  Organic Wellness Sphere  ·  Three.js WebGL  ·  ES Module
 * ============================================================
 *
 *  v3 CHANGES vs v2
 *  ─────────────────────────────────────────────────────────
 *  COMPLETE REDESIGN of geometry, shaders, colour, and motion.
 *
 *  Geometry
 *    IcosahedronGeometry (detail 5, ~5 k triangles) replaces
 *    the previous high-frequency spiky mesh.  All displacement
 *    is produced in the vertex shader — zero JavaScript noise.
 *
 *  GLSL Simplex Noise
 *    Full Stefan Gustavson / Ian McEwan 3-D snoise() embedded
 *    directly in the vertex shader.  No external texture needed.
 *    Three fbm octaves give a cloud-like, rounded form.
 *
 *  Colour
 *    Strictly follows the Sori brand palette  (sori-global.css):
 *      Silky Cream     #F6F4F0   dominant base
 *      Oatmeal Beige   #E3DCCB   warm shadow
 *      Dawn Sage       #A9B4AA   cool inflection
 *      Mother-of-Pearl #E8E2E5   fresnel rim
 *    Supplemented with two accent tones from the Emotion Map
 *    (Dusty Rose #D4A5A0 · Soft Lavender #C4B7D6) to achieve
 *    the iridescent wellness reference palette.
 *
 *  Motion  —  "Living Entity" spec
 *    • Deep-breath breathing: sin-based 4-second inhale/exhale
 *      drives a subtle scale oscillation (0.94 → 1.06×).
 *    • Heartbeat micro-pulse: double-bump envelope every 1.4 s,
 *      ±0.025 scale, reinforces biological presence.
 *    • Fluid drift: very slow uTime-driven noise evolution
 *      ensures the surface continuously and non-repeatably
 *      morphs — it never settles into a mechanical loop.
 *    • Gentle rotation: y-axis 0.06 rad/s + rocking x-tilt.
 *
 *  Performance
 *    • Pixel-ratio capped at 2 (no retina over-render).
 *    • Icosahedron detail 5 = 5,120 triangles (smooth, fast).
 *    • Only three uniforms updated per frame (uTime, uBreath,
 *      uHeartbeat) — no CPU→GPU texture uploads.
 *    • requestAnimationFrame-driven; renderer pauses when the
 *      gateway step is hidden (IntersectionObserver).
 *    • All noise arithmetic stays on the GPU.
 *
 *  Public API
 *    window.soriResonance.setEmotionState(key)  — future hook
 *    for per-emotion colour shifts (colour uniforms ready).
 *
 *  DOM dependency
 *    <canvas id="resonance-field" class="resonance-canvas">
 *    inside  #gateway  inside  #step-gateway
 * ============================================================
 */

import * as THREE from 'three';

(function () {
  'use strict';

  console.log('[sori-resonance] ✅ v3 loading — organic wellness sphere');

  // ──────────────────────────────────────────────────────────────────────────
  //  § 1  GLSL BLOCKS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Full 3-D Simplex noise (Stefan Gustavson, 2012 — ashima-arts)
   * Ported to a single GLSL snippet; no external dependency.
   * Returns noise in the range [−1, 1].
   */
  const GLSL_SIMPLEX_3D = /* glsl */`
    // ── mod289 helpers ────────────────────────────────────────────────────
    vec3 _mod289v3(vec3 x) {
      return x - floor(x * (1.0 / 289.0)) * 289.0;
    }
    vec4 _mod289v4(vec4 x) {
      return x - floor(x * (1.0 / 289.0)) * 289.0;
    }
    vec4 _permute(vec4 x) {
      return _mod289v4(((x * 34.0) + 1.0) * x);
    }
    vec4 _taylorInvSqrt(vec4 r) {
      return 1.79284291400159 - 0.85373472095314 * r;
    }

    // ── snoise(vec3) ─────────────────────────────────────────────────────
    float snoise(vec3 v) {
      const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

      vec3 i  = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);

      vec3 g  = step(x0.yzx, x0.xyz);
      vec3 l  = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);

      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;

      i = _mod289v3(i);
      vec4 p = _permute(_permute(_permute(
                 i.z + vec4(0.0, i1.z, i2.z, 1.0))
               + i.y + vec4(0.0, i1.y, i2.y, 1.0))
               + i.x + vec4(0.0, i1.x, i2.x, 1.0));

      float n_ = 0.142857142857;
      vec3  ns  = n_ * D.wyz - D.xzx;
      vec4  j   = p - 49.0 * floor(p * ns.z * ns.z);

      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x  = x_ * ns.x + ns.yyyy;
      vec4 y  = y_ * ns.x + ns.yyyy;
      vec4 h  = 1.0 - abs(x) - abs(y);

      vec4 b0 = vec4(x.xy,  y.xy);
      vec4 b1 = vec4(x.zw,  y.zw);
      vec4 s0 = floor(b0) * 2.0 + 1.0;
      vec4 s1 = floor(b1) * 2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));

      vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);

      vec4 norm = _taylorInvSqrt(vec4(
        dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;

      vec4 m = max(0.6 - vec4(
        dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;

      return 42.0 * dot(m * m, vec4(
        dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }

    // ── fbm(vec3, int) — fractional Brownian motion ───────────────────
    // 3 octaves: enough richness, cheap enough for mobile.
    float fbm(vec3 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 3; i++) {
        v += a * snoise(p);
        p  = p * 2.1 + vec3(1.73, 2.31, 0.97);  // spatial offset each octave
        a *= 0.5;
      }
      return v;   // range ≈ [−1, 1]
    }
  `;

  // ──────────────────────────────────────────────────────────────────────────
  //  § 2  VERTEX SHADER
  // ──────────────────────────────────────────────────────────────────────────
  const vertexShader = /* glsl */`
    ${GLSL_SIMPLEX_3D}

    // ── uniforms ──────────────────────────────────────────────────────────
    uniform float uTime;        // elapsed seconds — drives noise evolution
    uniform float uBreath;      // 0 → 1 breathing phase (sin-based, 4 s cycle)
    uniform float uHeartbeat;   // 0 → 1 heartbeat micro-pulse (double-bump)

    // ── varyings passed to fragment shader ───────────────────────────────
    varying vec3  vNormal;      // world-space perturbed normal (approx)
    varying vec3  vWorldPos;    // displaced world position
    varying float vNoise;       // raw fbm value for colour mapping
    varying float vNoise2;      // second noise sample (colour variety)

    void main() {
      // ── 1. Noise-based smooth vertex displacement ──────────────────────
      //
      //   We sample fbm at a slowly evolving frequency.
      //   Key parameters for the "smooth rounded mass" look:
      //     • frequency 0.55  → large, sweeping undulations
      //     • time scale 0.14 → very slow drift, never mechanical
      //
      vec3  noiseCoord = position * 0.55 + uTime * 0.14;
      float disp       = fbm(noiseCoord);               // ≈ [−1, 1]

      // A softer second sample at different frequency provides
      // the subtle iridescent surface variation for colour.
      vec3  noiseCoord2 = position * 1.30 + uTime * 0.11 + vec3(5.3, 2.1, 8.7);
      vNoise2 = snoise(noiseCoord2) * 0.5 + 0.5;       // [0, 1]

      // Displacement magnitude: 0.32 keeps form rounded, not spiky.
      float dispAmt = 0.32;
      vec3  displaced = position + normalize(position) * disp * dispAmt;

      // ── 2. Breathing / heartbeat scale ────────────────────────────────
      //
      //   uBreath    → smooth 4 s inhale-exhale: scale 0.94 … 1.06
      //   uHeartbeat → double-bump micro-pulse: ±0.025 on top
      //
      float breathScale = 0.94 + uBreath * 0.12 + uHeartbeat * 0.025;
      displaced *= breathScale;

      // ── 3. Approximate normal for lighting & colour ───────────────────
      //   True displaced normal would need finite differences; for this
      //   aesthetic a mix of the geometric normal and world position is
      //   sufficient and much cheaper.
      vNormal   = normalize(normalMatrix * normal);
      vWorldPos = displaced;
      vNoise    = disp * 0.5 + 0.5;    // remap [−1,1] → [0,1]

      gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
    }
  `;

  // ──────────────────────────────────────────────────────────────────────────
  //  § 3  FRAGMENT SHADER
  // ──────────────────────────────────────────────────────────────────────────
  const fragmentShader = /* glsl */`
    precision mediump float;

    varying vec3  vNormal;
    varying vec3  vWorldPos;
    varying float vNoise;
    varying float vNoise2;

    // ── Sori brand palette (exact hex → linear sRGB) ──────────────────────
    //
    //   Silky Cream     #F6F4F0  → (0.965, 0.957, 0.941)  dominant base
    //   Oatmeal Beige   #E3DCCB  → (0.890, 0.863, 0.796)  warm shadow
    //   Dawn Sage       #A9B4AA  → (0.663, 0.706, 0.667)  cool facet
    //   Mother-of-Pearl #E8E2E5  → (0.910, 0.886, 0.898)  rim highlight
    //   Dusty Rose      #D4A5A0  → (0.831, 0.647, 0.627)  warm accent
    //   Soft Lavender   #C4B7D6  → (0.769, 0.718, 0.839)  cool accent
    //
    const vec3 cCream    = vec3(0.965, 0.957, 0.941);
    const vec3 cBeige    = vec3(0.890, 0.863, 0.796);
    const vec3 cSage     = vec3(0.663, 0.706, 0.667);
    const vec3 cPearl    = vec3(0.910, 0.886, 0.898);
    const vec3 cRose     = vec3(0.831, 0.647, 0.627);
    const vec3 cLavender = vec3(0.769, 0.718, 0.839);

    void main() {
      vec3 n = normalize(vNormal);

      // ── 1. View-direction approximation ──────────────────────────────────
      //   For a centred object the view vector is simply +Z in view space.
      //   Using the normal's z-component is a fast, good-enough proxy.
      float nDotV = clamp(n.z, 0.0, 1.0);

      // ── 2. Fresnel rim  (pow 3.5 → soft, pearl-like falloff) ─────────────
      float fresnel = pow(1.0 - nDotV, 3.5);

      // ── 3. Primary colour from noise ──────────────────────────────────────
      //   Low noise value → shadowed concavity → warm beige / rose
      //   High noise value → raised convex peak → cool sage / cream
      vec3 base = mix(cBeige, cCream, vNoise);

      // Sage inflection at mid-noise range
      float midMask = 1.0 - abs(vNoise * 2.0 - 1.0);  // peaks at 0.5
      base = mix(base, cSage, midMask * 0.28);

    // ── 4. Second noise layer — iridescent colour shift ──────────────────
    //   vNoise2 shifts between Dusty Rose and Soft Lavender in the
    //   "valleys" of the form — gives the subtle iridescent quality
    //   seen in the reference without requiring environment maps.
    //
    //   Mother-of-Pearl (#E8E2E5) tones are expressed through the Fresnel
    //   rim below (step 6) — NOT through the background.  The iridescence
    //   here is masked to the interior convex surface only (valleyMask cut
    //   off at 0.65 and clamped by nDotV) so it never bleeds past the
    //   sphere silhouette onto the Silky Cream canvas behind it.
    vec3 iridescent = mix(cRose, cLavender, vNoise2);
    float valleyMask = (1.0 - smoothstep(0.30, 0.65, vNoise)) * nDotV;
    base = mix(base, iridescent, valleyMask * 0.18);

      // ── 5. Directional hemisphere light ──────────────────────────────────
      //   Top-left warm key light; bottom-right cool fill.
      float keyLight  = dot(n, normalize(vec3( 0.4,  1.0, 0.6))) * 0.5 + 0.5;
      float fillLight = dot(n, normalize(vec3(-0.3, -0.5, 0.4))) * 0.3 + 0.3;
      float light = keyLight * 0.70 + fillLight * 0.30;
      base *= 0.75 + light * 0.40;

      // ── 6. Pearl rim glow ─────────────────────────────────────────────────
      base = mix(base, cPearl, fresnel * 0.60);

      // ── 7. Subtle specular highlight (Blinn-Phong, single lobe) ──────────
      vec3  halfDir  = normalize(vec3(0.4, 1.0, 0.6) + vec3(0.0, 0.0, 1.0));
      float specular = pow(max(dot(n, halfDir), 0.0), 28.0) * 0.18;
      base += vec3(specular) * cPearl;

      // ── Output ────────────────────────────────────────────────────────────
      gl_FragColor = vec4(clamp(base, 0.0, 1.0), 1.0);
    }
  `;

  // ──────────────────────────────────────────────────────────────────────────
  //  § 4  SCENE BOOTSTRAP
  // ──────────────────────────────────────────────────────────────────────────

  const canvas = document.getElementById('resonance-field');
  if (!canvas) {
    console.warn('[sori-resonance] ❌ #resonance-field canvas not found in DOM');
    return;
  }

  // // — Renderer ——————————————————————————————————
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,            // 캔버스 배경 투명화 활성화
    premultipliedAlpha: false, // 모바일 브라우저의 투명도 합성 오류 방지
    powerPreference: 'high-performance',
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight); // 초기 크기 명시적 설정
  renderer.setClearColor(0x000000, 0); // 배경을 완전히 투명(Alpha 0)으로 설정

  // [중요] Scene 자체에 배경색이 설정되어 있다면 투명도가 작동하지 않습니다.
  // scene 정의부 근처에서 아래 코드가 있는지 확인하고 null로 설정하세요.
  // scene.background = null;
  // ── Camera ────────────────────────────────────────────────────────────────
  //   FOV 45° keeps the sphere looking naturally round (not fish-eyed).
  //   z = 3.4 → the sphere (r ≈ 1.0 + max-disp 0.32) fills ~50 % of height.
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 3.4;

  // Scene background 제거 → 캔버스 뒤의 CSS 배경색(#DBC9E3)이 그대로 표시됨
  const scene = new THREE.Scene();
  // scene.background는 설정하지 않음 (투명 유지)

  // ── Geometry — smooth icosphere, detail 5 = 5 120 tris ───────────────────
  //   IcosahedronGeometry produces a perfectly uniform vertex distribution
  //   ideal for noise-based displacement (no pole singularity, no seams).
  const geometry = new THREE.IcosahedronGeometry(1.0, 5);

  // ── Uniforms ──────────────────────────────────────────────────────────────
  const uniforms = {
    uTime: { value: 0.0 },
    uBreath: { value: 0.0 },
    uHeartbeat: { value: 0.0 },
  };

  // ── ShaderMaterial ────────────────────────────────────────────────────────
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // ──────────────────────────────────────────────────────────────────────────
  //  § 5  RESPONSIVE RESIZE
  // ──────────────────────────────────────────────────────────────────────────

  function _resize() {
    // The canvas fills its CSS container; read the rendered size from the
    // parent section so we stay pixel-perfect without inline style hacks.
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 600;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 600;

    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) ||
      renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);   // false → don't override CSS size
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  _resize();
  window.addEventListener('resize', _resize, { passive: true });


  // ──────────────────────────────────────────────────────────────────────────
  //  § 6  ANIMATION LOOP
  // ──────────────────────────────────────────────────────────────────────────

  let _startTime = performance.now();
  let _rafId = null;
  let _paused = false;

  /**
   * _heartbeatEnvelope(phase)
   *
   * Produces the classic "lub-dub" double-bump shape within a 0→1 phase.
   * Designed to feel biological, not mechanical:
   *   lub  — stronger first beat (60 % of phase)
   *   dub  — softer rebound beat (remaining 40 %)
   *   rest — silence until the next beat
   */
  function _heartbeatEnvelope(phase) {
    // First bump  (lub): phase 0.00 → 0.12 rise, 0.12 → 0.22 fall
    if (phase < 0.12) return phase / 0.12;
    if (phase < 0.22) return 1.0 - (phase - 0.12) / 0.10;
    // Second bump (dub): phase 0.28 → 0.38 rise, 0.38 → 0.46 fall (×0.55)
    if (phase < 0.28) return 0.0;
    if (phase < 0.38) return (phase - 0.28) / 0.10 * 0.55;
    if (phase < 0.46) return 0.55 - (phase - 0.38) / 0.08 * 0.55;
    // Rest
    return 0.0;
  }

  function _animate() {
    _rafId = requestAnimationFrame(_animate);
    if (_paused) return;

    const elapsed = (performance.now() - _startTime) * 0.001;  // seconds

    // ── uTime — drives noise evolution on GPU ──────────────────────────────
    uniforms.uTime.value = elapsed;

    // ── uBreath — deep 4-second breathing cycle ────────────────────────────
    //   Frequency: (2π / 4) = π/2 rad/s
    //   sin() goes −1 → 1; remap to 0 → 1 for smooth ease in/out.
    const breathRaw = Math.sin(elapsed * (Math.PI / 2.0));
    uniforms.uBreath.value = (breathRaw + 1.0) * 0.5;

    // ── uHeartbeat — lub-dub pulse every 1.4 s ────────────────────────────
    const beatPhase = (elapsed % 1.4) / 1.4;
    uniforms.uHeartbeat.value = _heartbeatEnvelope(beatPhase);

    // ── Mesh orientation — slow organic drift, no mechanical spin ─────────
    //   y-rotation: 0.06 rad/s (one revolution ≈ 105 s)
    //   x-tilt: gentle rocking, 22-second period
    mesh.rotation.y = elapsed * 0.06;
    mesh.rotation.x = Math.sin(elapsed * (Math.PI / 11.0)) * 0.07;

    renderer.render(scene, camera);
  }

  // ── Pause when gateway canvas is off-screen (battery saving) ──────────────
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      function (entries) {
        _paused = !entries[0].isIntersecting;
      },
      { threshold: 0.01 }
    );
    observer.observe(canvas);
  }

  _animate();
  console.log('[sori-resonance] ✅ v3 organic sphere — render loop started');


  // ──────────────────────────────────────────────────────────────────────────
  //  § 7  EMOTION STATE  (colour shift hook — future extension)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Emotion-to-colour map for future uniform-driven tinting.
   * Currently logs the change; full colour interpolation can be wired
   * by adding vec3 uEmotionTint / float uEmotionBlend uniforms.
   *
   * Palette drawn from sori-global.css emotion colour tokens:
   *   burned-out   #C9B8A8   anxious     #A9C2D6
   *   numb         #B0C0B0   meh         #C8BFA8
   *   lonely       #B8B0D0   okay        #D0BFA0
   *   lighter      #A8C8B8   proud       #D0A8B8
   */
  const _EMOTION_COLOURS = {
    'burned-out': [0.788, 0.722, 0.659],
    'anxious': [0.663, 0.761, 0.839],
    'numb': [0.690, 0.753, 0.690],
    'meh': [0.784, 0.749, 0.659],
    'lonely': [0.722, 0.690, 0.816],
    'okay': [0.816, 0.749, 0.627],
    'lighter': [0.659, 0.784, 0.722],
    'proud': [0.816, 0.659, 0.722],
  };

  let _currentEmotion = null;

  function setEmotionState(emotionKey) {
    if (!emotionKey || emotionKey === _currentEmotion) return;
    _currentEmotion = emotionKey;

    const col = _EMOTION_COLOURS[emotionKey];
    if (col) {
      // Ready for when uEmotionTint uniform is added:
      // uniforms.uEmotionTint.value.set(...col);
      console.log('[sori-resonance] 🎨 emotion →', emotionKey, col);
    } else {
      console.log('[sori-resonance] 🎨 unknown emotion key:', emotionKey);
    }
  }


  // ──────────────────────────────────────────────────────────────────────────
  //  § 8  PUBLIC API
  // ──────────────────────────────────────────────────────────────────────────

  window.soriResonance = Object.freeze({
    /**
     * setEmotionState(key)
     * Called by sori-flow.js when the user selects an emotion card.
     * Prepares a future per-emotion colour shift without breaking v2 API.
     */
    setEmotionState,
  });

  console.log('[sori-resonance] ✅ window.soriResonance API registered');

})();
