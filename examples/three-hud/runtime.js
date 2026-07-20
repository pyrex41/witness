// examples/three-hud/runtime.js — three.js scene + proven HUD texturing.
// Inlined into the generated index.html by build.js after the three.js UMD
// bundle and the injected window.HUD_DATA (proven fragments + metadata).
//
// Trust boundaries at runtime:
//   - Panel textures come from witness-proven HTML fragments (baked per
//     locale at build time; nothing here can make them overflow).
//   - The two runtime-dynamic strings (player name, score) are drawn with
//     plain canvas text INSIDE slots whose worst case build.js proved:
//     the font is strictly monospace, so an N-char ceiling is a complete
//     width proof for every possible value. This file's only obligation
//     is to enforce the same ceilings it received in HUD_DATA.bounds.
(function () {
  'use strict';
  const { fontFamily, fontDataUri, locales, bounds, defaultLocale } = window.HUD_DATA;
  const SCALE = 2; // texture supersampling for crisp text on GPU quads

  // --- HTML fragment -> canvas (SVG foreignObject rasterization) -------------
  // The @font-face inside the SVG embeds the exact TTF that witness measured
  // with at build time, so rendered glyph widths equal proven widths.
  const PANEL_CSS =
    'background:linear-gradient(165deg,rgba(15,23,42,0.94),rgba(8,13,26,0.96));' +
    'border:1px solid rgba(96,165,250,0.45);border-radius:10px;';
  // Color-only restyling, keyed off each span's inline font-size. Changing
  // font-family, weight, or spacing here would alter metrics and silently
  // invalidate the proven widths — see examples/card-cloth.js.
  const PANEL_STYLES = {
    status:
      'span[style*="font-size:11px"]{color:#60a5fa;}' +
      'span[style*="font-size:13px"]{color:#94a3b8;}',
    prompt:
      'span[style*="font-size:15px"]{color:#e2e8f0;}',
    tooltip:
      'span[style*="font-size:11px"]{color:#60a5fa;}' +
      'span[style*="font-size:18px"]{color:#fbbf24;}' +
      'span[style*="font-size:12px"]{color:#c084fc;}' +
      'span[style*="font-size:13px"]{color:#8fa3bf;}',
  };

  function rasterize(panel, styleKey) {
    const { frag, w, h } = panel;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<foreignObject width="100%" height="100%">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;' +
      'width:' + w + 'px;height:' + h + 'px;' + PANEL_CSS + '">' +
      '<style>@font-face{font-family:\'' + fontFamily + '\';' +
      'src:url(' + fontDataUri + ') format(\'truetype\');}' +
      'span{color:#cbd5e1;}' + (PANEL_STYLES[styleKey] || '') + '</style>' +
      frag + '</div></foreignObject></svg>';
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = w * SCALE;
        c.height = h * SCALE;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c);
      };
      img.onerror = () => reject(new Error('rasterize failed: ' + styleKey));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  function canvasTexture(source) {
    const tex = new THREE.CanvasTexture(source);
    tex.encoding = THREE.sRGBEncoding;
    tex.minFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    return tex;
  }

  // --- Game state -------------------------------------------------------------
  let locale = defaultLocale;
  let playerName = 'Reuben';
  let score = 0;
  let displayScore = 0; // tweens toward score
  let health = 0.82;
  let stamina = 1.0;
  let crystalHovered = false;
  let crystalCollected = false;

  const bakedCache = {}; // locale -> {status,prompt,tooltip} canvases

  async function bakeLocale(loc) {
    if (bakedCache[loc]) return bakedCache[loc];
    const L = locales[loc];
    const [status, prompt, tooltip] = await Promise.all([
      rasterize(L.status, 'status'),
      rasterize(L.prompt, 'prompt'),
      rasterize(L.tooltip, 'tooltip'),
    ]);
    bakedCache[loc] = { status, prompt, tooltip };
    return bakedCache[loc];
  }

  // --- Status panel compositing ----------------------------------------------
  // Baked texture (labels, proven) + runtime bars and score digits. Bar and
  // digit positions come from the solved layout rows build.js extracted, so
  // runtime drawing stays aligned with the proven label column.
  let statusCanvas, statusCtx, statusTex;

  function drawStatus(baked) {
    const { w, h, rows } = locales[locale].status;
    if (!statusCanvas) {
      statusCanvas = document.createElement('canvas');
      statusCtx = statusCanvas.getContext('2d');
    }
    statusCanvas.width = w * SCALE;
    statusCanvas.height = h * SCALE;
    const ctx = statusCtx;
    ctx.drawImage(baked.status, 0, 0);
    ctx.save();
    ctx.scale(SCALE, SCALE);

    // rows: [title, score, health, stamina] from the solved layout
    const barX = 12 + 110 + 8;          // panel padding + label slot + gap
    const barW = w - 12 - barX;         // to right padding
    const scoreRow = rows[1], healthRow = rows[2], staminaRow = rows[3];

    // score digits — worst case proven at build time: SCORE_DIGITS digits of
    // SCORE_FONT px mono fit SCORE_SLOT px. Clamp to the proven digit count.
    const capped = Math.min(Math.round(displayScore), Math.pow(10, bounds.SCORE_DIGITS) - 1);
    ctx.font = bounds.SCORE_FONT + 'px ' + fontFamily;
    ctx.fillStyle = '#fde047';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(capped), w - 12, scoreRow.top + scoreRow.h - 4);

    const bar = (row, frac, color) => {
      const y = row.top + row.h / 2 - 4;
      ctx.fillStyle = 'rgba(148,163,184,0.18)';
      ctx.beginPath(); ctx.roundRect(barX, y, barW, 8, 4); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(barX, y, Math.max(6, barW * frac), 8, 4); ctx.fill();
    };
    bar(healthRow, health, '#f87171');
    bar(staminaRow, stamina, '#4ade80');
    ctx.restore();
    if (statusTex) statusTex.needsUpdate = true;
  }

  // --- Nameplate (runtime canvas, bounded proof) ------------------------------
  // build.js proved: NAME_MAX chars of NAME_FONT px mono fit NAME_SLOT px.
  // Monospace makes that a total proof over ALL names of <= NAME_MAX chars,
  // provided we enforce the same ceiling here.
  let plateCanvas, plateTex, plateSprite;

  function drawNameplate() {
    const name = playerName.slice(0, bounds.NAME_MAX); // enforce the proven ceiling
    const padX = 12, padY = 7, fs = bounds.NAME_FONT;
    const w = bounds.NAME_SLOT + padX * 2, h = fs + padY * 2 + 4;
    if (!plateCanvas) plateCanvas = document.createElement('canvas');
    plateCanvas.width = w * SCALE;
    plateCanvas.height = h * SCALE;
    const ctx = plateCanvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = 'rgba(8,13,26,0.88)';
    ctx.strokeStyle = 'rgba(96,165,250,0.5)';
    ctx.beginPath(); ctx.roundRect(0.5, 0.5, w - 1, h - 1, 8); ctx.fill(); ctx.stroke();
    ctx.font = fs + 'px ' + fontFamily;
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, w / 2, h / 2 + 1);
    if (plateTex) plateTex.needsUpdate = true;
    if (plateSprite) plateSprite.scale.set(w / 90, h / 90, 1);
  }

  // --- three.js scene ---------------------------------------------------------
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1120);
  scene.fog = new THREE.Fog(0x0b1120, 14, 30);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  const orbit = { az: 0.6, pol: 1.12, r: 9.5, target: new THREE.Vector3(0, 1, 0) };
  function applyOrbit() {
    camera.position.set(
      orbit.target.x + orbit.r * Math.sin(orbit.pol) * Math.sin(orbit.az),
      orbit.target.y + orbit.r * Math.cos(orbit.pol),
      orbit.target.z + orbit.r * Math.sin(orbit.pol) * Math.cos(orbit.az)
    );
    camera.lookAt(orbit.target);
  }

  scene.add(new THREE.HemisphereLight(0x6b93c9, 0x0b1120, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 0.7);
  sun.position.set(5, 8, 3);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(15, 48),
    new THREE.MeshStandardMaterial({ color: 0x0c1526, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  scene.add(new THREE.GridHelper(30, 30, 0x1e3a8a, 0x16233f));

  // Player + nameplate
  const player = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 0.8, 6, 16),
    new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 })
  );
  player.position.y = 0.95;
  scene.add(player);

  // Collectible shards
  const shardColors = [0x22d3ee, 0x818cf8, 0x34d399, 0xf472b6, 0x38bdf8, 0xa78bfa];
  const shards = shardColors.map((color, i) => {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.55, roughness: 0.3,
      })
    );
    const angle = (i / shardColors.length) * Math.PI * 2;
    m.position.set(Math.sin(angle) * 4.4, 1.1, Math.cos(angle) * 4.4);
    m.userData = { baseY: 1.1, phase: i * 1.7, shard: true };
    scene.add(m);
    return m;
  });

  // Pedestal + prism (the tooltip target)
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.65, 0.5, 24),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 })
  );
  pedestal.position.set(2.6, 0.25, -1.4);
  scene.add(pedestal);
  const crystal = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.34),
    new THREE.MeshStandardMaterial({
      color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 0.7, roughness: 0.25,
    })
  );
  crystal.position.set(2.6, 1.15, -1.4);
  crystal.userData = { baseY: 1.15, phase: 0.4, crystal: true };
  scene.add(crystal);

  // World-space tooltip plane (billboarded, texture baked per locale)
  let tooltipMesh = null;
  function makeTooltip(baked) {
    const { w, h } = locales[locale].tooltip;
    const tex = canvasTexture(baked.tooltip);
    if (!tooltipMesh) {
      tooltipMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w / 130, h / 130),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.98 })
      );
      tooltipMesh.visible = false;
      scene.add(tooltipMesh);
    } else {
      tooltipMesh.geometry.dispose();
      tooltipMesh.geometry = new THREE.PlaneGeometry(w / 130, h / 130);
      tooltipMesh.material.map?.dispose();
    }
    tooltipMesh.material.map = tex;
    tooltipMesh.material.needsUpdate = true;
  }

  // --- Screen-space HUD (orthographic overlay scene) --------------------------
  const hudScene = new THREE.Scene();
  const hudCamera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
  let statusMesh = null, promptMesh = null;

  function hudPlane(tex, w, h) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    hudScene.add(mesh);
    return mesh;
  }
  function placeHud() {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    hudCamera.right = W; hudCamera.bottom = -H;
    hudCamera.updateProjectionMatrix();
    if (statusMesh) {
      const { w, h } = locales[locale].status;
      statusMesh.position.set(16 + w / 2, -(16 + h / 2), 0);
    }
    if (promptMesh) {
      const { w, h } = locales[locale].prompt;
      promptMesh.position.set(W / 2, -(H - 24 - h / 2), 0);
    }
  }

  async function applyLocale(loc) {
    locale = loc;
    const baked = await bakeLocale(loc);
    // status: composite canvas (baked + runtime bars/digits)
    drawStatus(baked);
    if (!statusTex) {
      statusTex = canvasTexture(statusCanvas);
      const { w, h } = locales[loc].status;
      statusMesh = hudPlane(statusTex, w, h);
    } else {
      statusTex.needsUpdate = true;
    }
    // prompt: baked texture straight onto its plane
    const promptTex = canvasTexture(baked.prompt);
    if (!promptMesh) {
      const { w, h } = locales[loc].prompt;
      promptMesh = hudPlane(promptTex, w, h);
      promptMesh.visible = false;
    } else {
      promptMesh.material.map?.dispose();
      promptMesh.material.map = promptTex;
      promptMesh.material.needsUpdate = true;
    }
    makeTooltip(baked);
    placeHud();
    document.querySelectorAll('[data-locale]').forEach(b =>
      b.classList.toggle('active', b.dataset.locale === loc));
  }

  // --- Interaction ------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = null;
  let downAt = null;

  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([...shards, crystal]);
    return hits[0]?.object || null;
  }

  canvas.addEventListener('pointerdown', e => {
    downAt = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (downAt && (e.buttons & 1)) {
      orbit.az -= e.movementX * 0.006;
      orbit.pol = Math.min(1.45, Math.max(0.45, orbit.pol - e.movementY * 0.004));
      return;
    }
    const target = pick(e);
    if (hovered && hovered !== target) hovered.material.emissiveIntensity = hovered.userData.crystal ? 0.7 : 0.55;
    hovered = target;
    if (hovered) hovered.material.emissiveIntensity = 1.2;
    crystalHovered = !!(hovered && hovered.userData.crystal && !crystalCollected);
    canvas.style.cursor = hovered ? 'pointer' : 'grab';
  });
  canvas.addEventListener('pointerup', e => {
    const moved = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5;
    downAt = null;
    if (moved) return;
    const target = pick(e);
    if (target && target.userData.shard) collectShard(target);
    if (target && target.userData.crystal) collectCrystal();
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    orbit.r = Math.min(15, Math.max(5, orbit.r + e.deltaY * 0.01));
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if ((e.key === 'e' || e.key === 'E') && crystalHovered) collectCrystal();
  });

  function collectShard(shard) {
    score += 125;
    stamina = Math.max(0.15, stamina - 0.18);
    shard.userData.respawn = 1.0; // shrink+respawn animation state
  }
  function collectCrystal() {
    if (crystalCollected) return;
    crystalCollected = true;
    crystalHovered = false;
    score += 500;
    crystal.visible = false;
    if (tooltipMesh) tooltipMesh.visible = false;
    setTimeout(() => { crystalCollected = false; crystal.visible = true; }, 4000);
  }

  // --- DOM chrome -------------------------------------------------------------
  document.querySelectorAll('[data-locale]').forEach(btn =>
    btn.addEventListener('click', () => applyLocale(btn.dataset.locale)));
  const nameInput = document.getElementById('name');
  nameInput.maxLength = bounds.NAME_MAX; // the DOM face of the proven ceiling
  nameInput.value = playerName;
  nameInput.addEventListener('input', () => {
    playerName = nameInput.value || 'Player';
    drawNameplate();
  });

  // --- Resize -----------------------------------------------------------------
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeHud();
  }
  window.addEventListener('resize', resize);

  // --- Main loop --------------------------------------------------------------
  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    for (const s of [...shards, crystal]) {
      s.rotation.y += dt * 0.9;
      s.position.y = s.userData.baseY + Math.sin(t * 1.6 + s.userData.phase) * 0.12;
      if (s.userData.respawn !== undefined) {
        s.userData.respawn -= dt * 2.2;
        if (s.userData.respawn <= 0) {
          delete s.userData.respawn;
          const a = Math.random() * Math.PI * 2, r = 3.2 + Math.random() * 2.6;
          s.position.x = Math.sin(a) * r;
          s.position.z = Math.cos(a) * r;
          s.scale.setScalar(1);
        } else {
          s.scale.setScalar(Math.abs(1 - 2 * Math.min(1, Math.max(0, s.userData.respawn))));
        }
      }
    }

    // bars regen; score tween
    health = Math.min(1, health + dt * 0.015);
    stamina = Math.min(1, stamina + dt * 0.05);
    displayScore += (score - displayScore) * Math.min(1, dt * 8);
    if (score - displayScore < 0.5) displayScore = score;
    if (bakedCache[locale]) drawStatus(bakedCache[locale]);

    if (tooltipMesh) {
      tooltipMesh.visible = crystalHovered;
      if (crystalHovered) {
        tooltipMesh.position.set(crystal.position.x, crystal.position.y + 1.35 + Math.sin(t * 2) * 0.04, crystal.position.z);
        tooltipMesh.lookAt(camera.position);
      }
    }
    if (promptMesh) promptMesh.visible = crystalHovered;

    plateSprite.position.set(player.position.x, 2.15, player.position.z);

    applyOrbit();
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(hudScene, hudCamera);
  }

  // --- Boot -------------------------------------------------------------------
  const face = new FontFace(fontFamily, 'url(' + fontDataUri + ')');
  document.fonts.add(face);
  face.load().then(async () => {
    drawNameplate();
    plateTex = canvasTexture(plateCanvas);
    plateSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: plateTex, transparent: true }));
    scene.add(plateSprite);
    drawNameplate(); // now that sprite exists, set its scale too
    await applyLocale(locale);
    resize();
    renderer.autoClear = false;
    frame();
  }).catch(err => {
    document.getElementById('hint').textContent = 'Font failed to load: ' + err.message;
  });

  // Test/debug hook: screen-space position of the tooltip target.
  window.__hud = {
    crystalScreen() {
      const v = crystal.position.clone().project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
  };
})();
