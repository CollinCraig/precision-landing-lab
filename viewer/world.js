/* Precision Landing Lab: 3D city + rooftop vertiport scene (browser only).
 *
 * Needs globals THREE (three.js r170) and THREEX (Sky, EffectComposer,
 * RenderPass, UnrealBloomPass, OutputPass, mergeGeometries), loaded by
 * index.html, and PLVWorldCore (world-core.js). Everything is procedural:
 * no external textures or models.
 *
 * Axes: three.js world x = east, y = up, z = south. The pad deck top is the
 * origin, so the drone sits at (e, -d, -n) exactly as before. City coordinates
 * (ENU, city.json) map as X = x - pad.x, Y = z - pad.z, Z = -(y - pad.y).
 */
(function (root) {
  'use strict';
  const C = root.PLVWorldCore;

  function createWorld(opts) {
    const T = root.THREE, X = root.THREEX || {};
    if (!T) throw new Error('three.js did not load (offline?). Charts and timeline still work.');
    const container = opts.container;
    const city = opts.city;
    const pad = city.vertiport.pad;
    const cx = (x) => x - pad.x, cy = (z) => z - pad.z, cz = (y) => -(y - pad.y);
    const GROUND = cy(0);

    /* ================= renderer, scene, camera ================= */
    const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.info.autoReset = false;
    container.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.style.touchAction = 'none';
    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(46, 1, 0.05, 6000);

    /* ================= procedural textures ================= */
    function canvasOf(w, h, draw) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      return c;
    }
    function tex(c, srgb, rep) {
      const t = new T.CanvasTexture(c);
      if (srgb) t.colorSpace = T.SRGBColorSpace;
      if (rep !== false) t.wrapS = t.wrapT = T.RepeatWrapping;
      t.anisotropy = maxAniso;
      return t;
    }
    function speckle(g, w, h, amount, seed, blot) {
      const r = C.rng(seed);
      const id = g.getImageData(0, 0, w, h), d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (r() - 0.5) * amount;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      g.putImageData(id, 0, 0);
      if (blot) for (let k = 0; k < blot; k++) {
        g.fillStyle = 'rgba(0,0,0,' + (0.02 + r() * 0.05) + ')';
        g.beginPath(); g.arc(r() * w, r() * h, 4 + r() * w * 0.12, 0, Math.PI * 2); g.fill();
      }
    }
    const flat = (color, amount, seed, blot, size) => canvasOf(size || 256, size || 256, (g, w, h) => { g.fillStyle = color; g.fillRect(0, 0, w, h); speckle(g, w, h, amount, seed, blot); });

    // Facade tiles: 8 bays x 8 floors per texture, mapped in metres.
    const FAC = {
      glass: { bay: 1.5, floor: 3.8, wall: '#4a545d', glass: ['#1f2f3f', '#24384b', '#2b4155', '#1b2a37', '#30475b'], win: [0.0, 0.0, 1.0, 0.8], frame: '#a3abb2', wallR: 0.35, wallM: 0.85, glassR: 0.05, glassM: 0.9, curtain: true },
      office: { bay: 2.4, floor: 3.6, wall: '#bdb5a7', glass: ['#34424e', '#2d3a45', '#3b4a56'], win: [0.05, 0.3, 0.95, 0.86], frame: '#5b6166', wallR: 0.8, wallM: 0.0, glassR: 0.07, glassM: 0.75 },
      brick: { bay: 2.2, floor: 3.3, wall: '#8d4c38', glass: ['#262d33', '#2f373e', '#2a3238'], win: [0.27, 0.24, 0.73, 0.82], frame: '#e6e0d4', wallR: 0.92, wallM: 0.0, glassR: 0.09, glassM: 0.6, sill: true },
      concrete: { bay: 3.0, floor: 3.5, wall: '#c9c6bf', glass: ['#303a42', '#2a333a', '#36414a'], win: [0.16, 0.28, 0.84, 0.84], frame: '#3b4045', wallR: 0.86, wallM: 0.0, glassR: 0.08, glassM: 0.7, panel: true },
    };
    const NB = 8, NF = 8, FS = 512, CW = FS / NB, CH = FS / NF;
    function facadeMaterial(type, seed) {
      const f = FAC[type];
      const r = C.rng(seed);
      const lit = C.litPattern(seed + 1, NB, NF, type === 'glass' ? 0.45 : 0.4);
      const cell = (c, row) => [c * CW, FS - (row + 1) * CH]; // row 0 = bottom of tile
      const win = (c, row) => { const [x, y] = cell(c, row); return [x + f.win[0] * CW, y + (1 - f.win[3]) * CH, (f.win[2] - f.win[0]) * CW, (f.win[3] - f.win[1]) * CH]; };
      const glassCols = [];
      const albedo = canvasOf(FS, FS, (g) => {
        g.fillStyle = f.wall; g.fillRect(0, 0, FS, FS);
        speckle(g, FS, FS, type === 'brick' ? 34 : 14, seed + 2, 0);
        if (type === 'brick') { // brick courses
          g.fillStyle = 'rgba(40,20,14,0.18)';
          for (let y = 0; y < FS; y += 4) g.fillRect(0, y, FS, 1);
        }
        if (f.panel) { // precast panel joints
          g.fillStyle = 'rgba(0,0,0,0.12)';
          for (let c = 0; c <= NB; c++) g.fillRect(c * CW - 1, 0, 2, FS);
          for (let row = 0; row <= NF; row++) g.fillRect(0, row * CH - 1, FS, 2);
        }
        for (let row = 0; row < NF; row++) for (let c = 0; c < NB; c++) {
          const [x, y, w, h] = win(c, row);
          const col = f.glass[Math.floor(r() * f.glass.length)];
          glassCols.push(col);
          if (!f.curtain) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x - 2, y - 2, w + 4, h + 4); } // reveal
          g.fillStyle = col; g.fillRect(x, y, w, h);
          const gr = g.createLinearGradient(0, y, 0, y + h);
          gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)');
          g.fillStyle = gr; g.fillRect(x, y, w, h);
          g.fillStyle = f.frame;
          if (f.curtain) { g.fillRect(x, y, 2, h + (CH - h)); g.fillRect(x, y + h - 1, w, 2); g.fillRect(x + w / 2 - 0.5, y, 1, h); }
          else { g.fillRect(x, y, w, 2); g.fillRect(x, y + h - 2, w, 2); g.fillRect(x, y, 2, h); g.fillRect(x + w - 2, y, 2, h); g.fillRect(x + w / 2 - 1, y, 2, h); }
          if (f.sill) { g.fillStyle = '#d9d3c6'; g.fillRect(x - 3, y + h, w + 6, 3); }
        }
        if (f.curtain) { // spandrel band at each floor slab
          g.fillStyle = 'rgba(20,26,32,0.55)';
          for (let row = 0; row < NF; row++) { const y = FS - (row + 1) * CH; g.fillRect(0, y, FS, (1 - f.win[3]) * CH); }
        }
      });
      const orm = canvasOf(FS / 2, FS / 2, (g) => {
        const s = 0.5;
        g.fillStyle = 'rgb(255,' + Math.round(f.wallR * 255) + ',' + Math.round(f.wallM * 255) + ')'; g.fillRect(0, 0, FS * s, FS * s);
        for (let row = 0; row < NF; row++) for (let c = 0; c < NB; c++) {
          const [x, y, w, h] = win(c, row);
          const rr = f.glassR + r() * 0.04;
          g.fillStyle = 'rgb(255,' + Math.round(rr * 255) + ',' + Math.round(f.glassM * 255) + ')';
          g.fillRect(x * s, y * s, w * s, h * s);
        }
      });
      const emis = canvasOf(FS, FS, (g) => {
        g.fillStyle = '#000'; g.fillRect(0, 0, FS, FS);
        const warm = ['#ffcf8a', '#ffd9a6', '#ffe6bf', '#fff0d8'], cool = ['#e4ecff', '#d2e1ff', '#f2f5ff'];
        for (let row = 0; row < NF; row++) for (let c = 0; c < NB; c++) {
          if (!lit[row * NB + c]) continue;
          const [x, y, w, h] = win(c, row);
          const pal = r() < 0.6 ? warm : cool;
          g.globalAlpha = 0.45 + r() * 0.55;
          g.fillStyle = pal[Math.floor(r() * pal.length)]; g.fillRect(x + 2, y + 2, w - 4, h - 4);
          g.globalAlpha = 0.5; g.fillStyle = '#000';
          g.fillRect(x + 2, y + h * 0.78, w - 4, h * 0.22 - 2); // desks / furniture
          if (r() < 0.35) g.fillRect(x + 2, y + 2, w - 4, h * (0.2 + r() * 0.4)); // blinds
          g.globalAlpha = 1;
        }
      });
      const map = tex(albedo, true), ormT = tex(orm, false), em = tex(emis, true);
      const m = new T.MeshStandardMaterial({ map, roughnessMap: ormT, metalnessMap: ormT, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0, roughness: 1, metalness: 1 });
      m.userData.facade = true;
      return m;
    }

    /* ================= merged geometry builder ================= */
    function Buf(withColor) { this.p = []; this.n = []; this.u = []; this.c = withColor ? [] : null; this.i = []; }
    Buf.prototype.quad = function (a, b, c, d, nrm, uv, col) {
      const base = this.p.length / 3;
      for (const v of [a, b, c, d]) { this.p.push(v[0], v[1], v[2]); this.n.push(nrm[0], nrm[1], nrm[2]); }
      this.u.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7]);
      if (this.c) for (let k = 0; k < 4; k++) this.c.push(col[0], col[1], col[2]);
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    // Append any three geometry (with a transform matrix).
    Buf.prototype.geom = function (g, m, col) {
      const gg = g.index ? g.toNonIndexed() : g;
      if (m) gg.applyMatrix4(m);
      const P = gg.attributes.position.array, N = gg.attributes.normal.array, U = gg.attributes.uv ? gg.attributes.uv.array : null;
      const base = this.p.length / 3;
      for (let k = 0; k < P.length / 3; k++) {
        this.p.push(P[3 * k], P[3 * k + 1], P[3 * k + 2]); this.n.push(N[3 * k], N[3 * k + 1], N[3 * k + 2]);
        this.u.push(U ? U[2 * k] : 0, U ? U[2 * k + 1] : 0);
        if (this.c) this.c.push(col[0], col[1], col[2]);
        this.i.push(base + k);
      }
      gg.dispose(); if (gg !== g) g.dispose();
    };
    Buf.prototype.build = function () {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
      if (this.c) g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.p.length / 3 > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere();
      return g;
    };
    /** Axis-aligned box in three coords. o: {tu, tv (tile metres), u0, v0, top, bottom, sides, col} */
    function box(buf, x0, y0, z0, x1, y1, z1, o) {
      o = o || {};
      const tu = o.tu || 1, tv = o.tv || tu, u0 = o.u0 || 0, vb = o.v0 || 0;
      const col = o.col;
      const side = (ax, az, bx, bz, n, ul) => {
        const ua = u0 / tu, ub = (u0 + ul) / tu, va = (y0 + vb) / tv, vt = (y1 + vb) / tv;
        buf.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], n, [ua, va, ub, va, ub, vt, ua, vt], col);
      };
      if (o.sides !== false) {
        side(x0, z1, x1, z1, [0, 0, 1], x1 - x0);   // south
        side(x1, z1, x1, z0, [1, 0, 0], z1 - z0);   // east
        side(x1, z0, x0, z0, [0, 0, -1], x1 - x0);  // north
        side(x0, z0, x0, z1, [-1, 0, 0], z1 - z0);  // west
      }
      if (o.top !== false) {
        const t = o.ttu || tu;
        buf.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0 / t, -z1 / t, x1 / t, -z1 / t, x1 / t, -z0 / t, x0 / t, -z0 / t], col);
      }
      if (o.bottom) buf.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1], col);
    }
    // City-coordinate box (ENU footprint, z range).
    const cbox = (buf, f, z0, z1, o) => box(buf, cx(f[0]), cy(z0), cz(f[3]), cx(f[2]), cy(z1), cz(f[1]), o);
    const M4 = () => new T.Matrix4();
    const cylAt = (buf, r0, r1, h, x, y, z, seg, col) => buf.geom(new T.CylinderGeometry(r0, r1, h, seg || 12), M4().makeTranslation(x, y + h / 2, z), col);

    /* ================= materials ================= */
    const mats = {};
    const std = (o) => new T.MeshStandardMaterial(o);
    mats.facade = {};
    C.FACADES.forEach((f, k) => { mats.facade[f] = facadeMaterial(f, 100 + k * 17); });
    mats.roof = std({ map: tex(flat('#a9a59d', 40, 5, 0), true), roughness: 0.95 });
    mats.vroof = std({ map: tex(flat('#cfcbc2', 34, 6, 0), true), roughness: 0.95 });
    mats.trim = std({ map: tex(flat('#bdb8ae', 22, 7, 6), true), roughness: 0.88 });
    mats.metal = std({ color: 0xa3a9ae, roughness: 0.42, metalness: 0.75 });
    mats.dark = std({ color: 0x2c3136, roughness: 0.6, metalness: 0.4 });
    mats.asphalt = std({ map: tex(flat('#3b3e41', 26, 8, 30), true), roughness: 0.93 });
    mats.walk = std({ map: tex(canvasOf(256, 256, (g, w) => {
      g.fillStyle = '#b3afa6'; g.fillRect(0, 0, w, w); speckle(g, w, w, 22, 9, 8);
      g.fillStyle = 'rgba(0,0,0,0.16)'; for (let k = 0; k <= 4; k++) { g.fillRect(k * w / 4 - 1, 0, 2, w); g.fillRect(0, k * w / 4 - 1, w, 2); }
    }), true), roughness: 0.88 });
    mats.mark = std({ vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mats.trunk = std({ color: 0x4a3a2c, roughness: 0.9 });
    mats.leaf = std({ color: 0x4c6b34, roughness: 0.85, flatShading: true });
    mats.lamp = std({ color: 0xfff3dc, emissive: 0xffd9a0, emissiveIntensity: 0 });
    mats.padLight = std({ color: 0x0b3a1e, emissive: 0x3dff86, emissiveIntensity: 1, roughness: 0.3 });
    mats.redLight = std({ color: 0x3a0b0b, emissive: 0xff2a1a, emissiveIntensity: 0 });
    mats.flood = std({ color: 0xfff6e0, emissive: 0xfff1d0, emissiveIntensity: 0 });

    /* ================= city ================= */
    const cityRoot = new T.Group();
    scene.add(cityRoot);
    const contextList = C.contextBuildings(city);
    const shadowCasters = [];
    function addMesh(geo, mat, cast, recv, parent) {
      const m = new T.Mesh(geo, mat);
      m.castShadow = !!cast; m.receiveShadow = recv !== false;
      (parent || cityRoot).add(m);
      if (cast) shadowCasters.push(m);
      return m;
    }

    // ground, block slabs, markings
    (function streets() {
      const S = city.streets;
      const ground = new T.Mesh(new T.PlaneGeometry(4000, 4000), mats.asphalt);
      ground.rotation.x = -Math.PI / 2; ground.position.set(0, GROUND, 0); ground.receiveShadow = true;
      mats.asphalt.map.repeat.set(4000 / 7, 4000 / 7);
      cityRoot.add(ground);
      const walk = new Buf();
      for (const b of C.cityBlocks(city)) cbox(walk, b.outer, 0, S.curb_height, { tu: 2.4 });
      addMesh(walk.build(), mats.walk, false, true);
      // lane markings: one vertex-coloured mesh
      const mk = new Buf(true);
      const W = [0.93, 0.93, 0.9], Y = [0.95, 0.72, 0.16];
      const yM = GROUND + 0.012;
      const strip = (xa, za, xb, zb, w, col) => { // centreline strip in three coords
        const dx = xb - xa, dz = zb - za, L = Math.hypot(dx, dz), nx = (-dz / L) * w / 2, nz = (dx / L) * w / 2;
        mk.quad([xa - nx, yM, za - nz], [xa + nx, yM, za + nz], [xb + nx, yM, zb + nz], [xb - nx, yM, zb - nz], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], col);
      };
      const L = C.streetLines(city), hw = S.road_width / 2, lane = S.road_width / S.lanes;
      const seg = (along, a0, a1, horiz) => { // one street segment between two crossings
        const P = (a, off) => horiz ? [cx(a), cz(along + off)] : [cx(along + off), cz(a)];
        const ln = (off, w, col, dash, gap) => {
          if (!dash) { const p = P(a0, off), q = P(a1, off); strip(p[0], p[1], q[0], q[1], w, col); return; }
          for (let a = a0 + 1; a + dash <= a1 - 1; a += dash + gap) { const p = P(a, off), q = P(a + dash, off); strip(p[0], p[1], q[0], q[1], w, col); }
        };
        ln(-0.12, 0.11, Y); ln(0.12, 0.11, Y);
        for (let k = 1; k < S.lanes / 2; k++) { ln(k * lane, 0.12, W, 3, 6); ln(-k * lane, 0.12, W, 3, 6); }
        ln(hw - 0.35, 0.12, W); ln(-hw + 0.35, 0.12, W);
        // crosswalks + stop bars at both ends
        for (const [e, dir] of [[a0, 1], [a1, -1]]) {
          for (let o = -hw + 0.6; o <= hw - 0.6; o += 1.1) { const p = P(e + dir * 0.6, o), q = P(e + dir * 3.6, o); strip(p[0], p[1], q[0], q[1], 0.5, W); }
          const p = P(e + dir * 4.6, -hw + 0.4), q = P(e + dir * 4.6, hw - 0.4);
          strip(p[0], p[1], q[0], q[1], 0.35, W);
        }
      };
      for (const y of L.ys) for (let k = 0; k < L.xs.length - 1; k++) seg(y, L.xs[k] + hw, L.xs[k + 1] - hw, true);
      for (const x of L.xs) for (let k = 0; k < L.ys.length - 1; k++) seg(x, L.ys[k] + hw, L.ys[k + 1] - hw, false);
      addMesh(mk.build(), mats.mark, false, true);
    })();

    // buildings: facades merged per facade type (core casts shadows; context does not)
    const roofTops = [];
    (function buildings() {
      const curb = city.streets.curb_height;
      const fac = { core: {}, ctx: {} };
      C.FACADES.forEach((f) => { fac.core[f] = new Buf(); fac.ctx[f] = new Buf(); });
      const roofs = new Buf(), vroof = new Buf(), trim = new Buf(), metal = new Buf(), dark = new Buf();
      const all = city.buildings.map((b) => ({ b, ctx: false })).concat(contextList.map((b) => ({ b, ctx: true })));
      for (const { b, ctx } of all) {
        const F = FAC[b.facade], tu = F.bay * NB, tv = F.floor * NF;
        const rb = C.rng(b.id.length * 131 + Math.round(b.footprint[0] * 7 + b.footprint[1] * 13));
        const uOff = Math.floor(rb() * NB) * F.bay, vOff = Math.floor(rb() * NF) * F.floor;
        const tiers = C.buildingTiers(b);
        const isV = b.id === city.vertiport.building;
        tiers.forEach((t, k) => {
          const z0 = Math.max(t.z0, curb);
          const fb = (ctx ? fac.ctx : fac.core)[b.facade];
          box(fb, cx(t.x0), cy(z0), cz(t.y1), cx(t.x1), cy(t.z1), cz(t.y0), { tu, tv, u0: uOff, v0: vOff - cy(0), top: false });
          // roof slab + parapet
          box(isV ? vroof : roofs, cx(t.x0), cy(t.z1) - 0.02, cz(t.y1), cx(t.x1), cy(t.z1), cz(t.y0), { tu: 4, sides: false });
          const ph = isV ? city.vertiport.parapet.height : 0.9, pt = isV ? city.vertiport.parapet.thickness : 0.3;
          const f = [t.x0, t.y0, t.x1, t.y1], z1 = t.z1;
          cbox(trim, [f[0], f[1], f[2], f[1] + pt], z1, z1 + ph, { tu: 2 });
          cbox(trim, [f[0], f[3] - pt, f[2], f[3]], z1, z1 + ph, { tu: 2 });
          cbox(trim, [f[0], f[1] + pt, f[0] + pt, f[3] - pt], z1, z1 + ph, { tu: 2 });
          cbox(trim, [f[2] - pt, f[1] + pt, f[2], f[3] - pt], z1, z1 + ph, { tu: 2 });
          if (k === tiers.length - 1) roofTops.push({ b, f, z: z1, ctx });
        });
        // rooftop plant on listed buildings (not the vertiport: it has its own layout)
        if (!ctx && !isV) {
          const t = tiers[tiers.length - 1], w = t.x1 - t.x0, d = t.y1 - t.y0, z = t.z1;
          const n = 1 + Math.floor(rb() * 3);
          for (let k = 0; k < n; k++) {
            const bw = 2 + rb() * 3, bd = 1.5 + rb() * 2.5, bh = 1.2 + rb() * 1.4;
            const x = t.x0 + 1.5 + rb() * Math.max(0.1, w - bw - 3), y = t.y0 + 1.5 + rb() * Math.max(0.1, d - bd - 3);
            cbox(metal, [x, y, x + bw, y + bd], z, z + bh, {});
            cylAt(dark, 0.45, 0.45, 0.08, cx(x + bw / 2), cy(z + bh), cz(y + bd / 2), 16);
          }
          if (b.height > 40) { // mechanical penthouse
            const pw = Math.min(w * 0.4, 9), pd = Math.min(d * 0.4, 7), px = (t.x0 + t.x1 - pw) / 2, py = (t.y0 + t.y1 - pd) / 2;
            cbox(trim, [px, py, px + pw, py + pd], z, z + 3.6, { tu: 2 });
          } else if (b.facade === 'brick' && rb() < 0.8) { // water tank on legs
            const x = t.x0 + w * (0.25 + rb() * 0.5), y = t.y0 + d * (0.25 + rb() * 0.5);
            for (const [ox, oy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) cylAt(metal, 0.06, 0.06, 2, cx(x + ox * 0.9), cy(z), cz(y + oy * 0.9), 6);
            cylAt(dark, 1.4, 1.4, 2.6, cx(x), cy(z + 2), cz(y), 18);
            dark.geom(new T.ConeGeometry(1.5, 0.8, 18), M4().makeTranslation(cx(x), cy(z + 5), cz(y)));
          }
        }
      }
      C.FACADES.forEach((f) => {
        if (fac.core[f].p.length) addMesh(fac.core[f].build(), mats.facade[f], true, true);
        if (fac.ctx[f].p.length) addMesh(fac.ctx[f].build(), mats.facade[f], false, true);
      });
      addMesh(roofs.build(), mats.roof, false, true);
      addMesh(vroof.build(), mats.vroof, false, true);
      addMesh(trim.build(), mats.trim, true, true);
      addMesh(metal.build(), mats.metal, true, true);
      addMesh(dark.build(), mats.dark, true, true);
    })();

    // aviation obstruction lights on tall buildings
    const obst = (function () {
      const pts = [];
      for (const r of roofTops) if (r.b.height >= 45) {
        const f = r.f;
        for (const [x, y] of [[f[0] + 0.4, f[1] + 0.4], [f[2] - 0.4, f[3] - 0.4], [f[0] + 0.4, f[3] - 0.4], [f[2] - 0.4, f[1] + 0.4]]) pts.push([cx(x), cy(r.z + 1.2), cz(y)]);
      }
      const im = new T.InstancedMesh(new T.SphereGeometry(0.25, 8, 6), mats.redLight, Math.max(1, pts.length));
      pts.forEach((p, i) => im.setMatrixAt(i, M4().makeTranslation(p[0], p[1], p[2])));
      im.count = pts.length;
      cityRoot.add(im);
      return im;
    })();

    // trees (street + plaza), street lights, light pools
    const trees = (function () {
      const pts = C.sidewalkPoints(city, city.street_trees.spacing, city.street_trees.extent, 1.3, 0);
      if (city.plaza) {
        const f = city.plaza.footprint, rp = C.rng(77);
        for (let k = 0; k < city.plaza.trees; k++) pts.push({ x: f[0] + 2 + rp() * (f[2] - f[0] - 4), y: f[1] + 2 + rp() * (f[3] - f[1] - 4) });
      }
      const rt = C.rng(31);
      const canopy = new T.IcosahedronGeometry(1, 1);
      const pa = canopy.attributes.position;
      for (let k = 0; k < pa.count; k++) { const s = 0.85 + rt() * 0.3; pa.setXYZ(k, pa.getX(k) * s, pa.getY(k) * s * 0.85, pa.getZ(k) * s); }
      canopy.computeVertexNormals();
      const trunk = new T.InstancedMesh(new T.CylinderGeometry(0.11, 0.16, 1, 7), mats.trunk, pts.length);
      const leaf = new T.InstancedMesh(canopy, mats.leaf, pts.length);
      const col = new T.Color();
      const q = new T.Quaternion(), e = new T.Euler();
      pts.forEach((p, i) => {
        const h = 2.6 + rt() * 1.6, r = 1.7 + rt() * 1.3, y0 = cy(city.streets.curb_height);
        trunk.setMatrixAt(i, M4().compose(new T.Vector3(cx(p.x), y0 + h / 2, cz(p.y)), q, new T.Vector3(1, h, 1)));
        e.set(0, rt() * 6.28, 0); const ql = new T.Quaternion().setFromEuler(e);
        leaf.setMatrixAt(i, M4().compose(new T.Vector3(cx(p.x), y0 + h + r * 0.6, cz(p.y)), ql, new T.Vector3(r, r * (1.05 + rt() * 0.3), r)));
        col.setHSL(0.24 + rt() * 0.07, 0.35 + rt() * 0.2, 0.26 + rt() * 0.1); leaf.setColorAt(i, col);
      });
      trunk.castShadow = leaf.castShadow = true; trunk.receiveShadow = leaf.receiveShadow = true;
      cityRoot.add(trunk, leaf);
      return { trunk, leaf };
    })();

    const lamps = (function () {
      const L = city.street_lights;
      const pts = C.sidewalkPoints(city, L.spacing, L.extent, 0.5, L.spacing / 2);
      const pole = new Buf(), heads = new Buf();
      const y0 = cy(city.streets.curb_height);
      const dirOf = { S: [0, 1], N: [0, -1], W: [-1, 0], E: [1, 0] }; // toward the road, in three (x, z)
      const pools = [];
      for (const p of pts) {
        const d = dirOf[p.side], X0 = cx(p.x), Z0 = cz(p.y);
        cylAt(pole, 0.07, 0.11, L.height, X0, y0, Z0, 8);
        const ax = X0 + d[0] * 1.6, az = Z0 + d[1] * 1.6;
        box(pole, Math.min(X0, ax) - 0.04, y0 + L.height - 0.08, Math.min(Z0, az) - 0.04, Math.max(X0, ax) + 0.04, y0 + L.height, Math.max(Z0, az) + 0.04, {});
        box(heads, ax - 0.25, y0 + L.height - 0.16, az - 0.25, ax + 0.25, y0 + L.height - 0.06, az + 0.25, { bottom: true });
        pools.push([ax, az]);
      }
      const poles = addMesh(pole.build(), mats.metal, true, true);
      const hm = addMesh(heads.build(), mats.lamp, false, false);
      // light pools: additive radial decals on the street (cheap stand-in for many point lights)
      const pc = canvasOf(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(0.5, 'rgba(255,190,120,0.35)'); gr.addColorStop(1, 'rgba(255,180,110,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
      const poolMat = new T.MeshBasicMaterial({ map: tex(pc, true, false), transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
      const pg = new T.PlaneGeometry(9, 9); pg.rotateX(-Math.PI / 2);
      const pm = new T.InstancedMesh(pg, poolMat, pools.length);
      pools.forEach((p, i) => pm.setMatrixAt(i, M4().makeTranslation(p[0], GROUND + 0.03, p[1])));
      pm.renderOrder = 2;
      cityRoot.add(pm);
      return { poles, heads: hm, pools: pm, poolMat };
    })();

    /* ================= vertiport ================= */
    const V = city.vertiport;
    const vport = new T.Group();
    vport.rotation.y = -(V.pad.yaw_deg * Math.PI) / 180;
    scene.add(vport);
    const ROOF = -V.deck_height; // roof top, three y
    const sa = V.safety_area / 2;

    // pad surface texture (markings follow design/vertiport-concept.html)
    const PADPX = 1536;
    const padCanvas = canvasOf(PADPX, PADPX, (g, S) => {
      const ppm = S / V.safety_area, c = S / 2, m = (v) => v * ppm;
      g.fillStyle = '#585e66'; g.fillRect(0, 0, S, S);
      g.fillStyle = '#43484f'; g.fillRect(c - m(V.fato / 2), c - m(V.fato / 2), m(V.fato), m(V.fato));
      // steel deck plate pattern on SA and FATO
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let y = 0; y < S; y += m(0.05)) for (let x = (y / m(0.05)) % 2 ? m(0.025) : 0; x < S; x += m(0.05)) g.fillRect(x, y, m(0.018), m(0.006));
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let k = 1; k < 6; k++) { g.fillRect(m(k * 0.5) - 1, 0, 2, S); g.fillRect(0, m(k * 0.5) - 1, S, 2); }
      g.fillStyle = '#6e7379'; g.fillRect(c - m(V.tlof / 2), c - m(V.tlof / 2), m(V.tlof), m(V.tlof));
      // broomed concrete on the TLOF: fine east-west streaks
      const rr = C.rng(3);
      for (let k = 0; k < 900; k++) {
        g.fillStyle = rr() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
        g.fillRect(c - m(0.5) + rr() * m(0.9), c - m(0.5) + rr() * m(1), m(0.05 + rr() * 0.2), 1.5);
      }
      speckle(g, S, S, 16, 12, 0);
      g.strokeStyle = '#f6f5f0'; g.lineWidth = m(0.03);
      g.setLineDash([m(0.15), m(0.15)]); g.lineDashOffset = m(0.075);
      g.strokeRect(c - m(V.fato / 2 - 0.015), c - m(V.fato / 2 - 0.015), m(V.fato - 0.03), m(V.fato - 0.03));
      g.setLineDash([]);
      g.strokeRect(c - m(V.tlof / 2 - 0.015), c - m(V.tlof / 2 - 0.015), m(V.tlof - 0.03), m(V.tlof - 0.03));
      g.strokeStyle = '#f0c02e'; g.lineWidth = m(0.04);
      g.beginPath(); g.arc(c, c, m(0.27), 0, Math.PI * 2); g.stroke();
      // decorative 10x10-module tag; the Gazebo world supplies the real tag36h11 id 0 in M2
      const cell = m(0.03), x0 = c - cell * 5;
      g.fillStyle = '#ffffff'; g.fillRect(x0, x0, cell * 10, cell * 10);
      g.fillStyle = '#111111'; g.fillRect(x0 + cell, x0 + cell, cell * 8, cell * 8);
      let seed = 11;
      for (let r = 0; r < 6; r++) for (let k = 0; k < 6; k++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        g.fillStyle = (seed >> 16) & 1 ? '#ffffff' : '#111111';
        g.fillRect(x0 + cell * (2 + k), x0 + cell * (2 + r), cell, cell);
      }
      // size / weight box "2 / D1" in the TLOF's lower-right corner
      g.fillStyle = '#f6f5f0'; g.fillRect(c + m(0.29), c + m(0.25), m(0.15), m(0.2));
      g.fillStyle = '#111'; g.fillRect(c + m(0.29), c + m(0.35), m(0.15), m(0.006));
      g.font = '600 ' + Math.round(m(0.075)) + 'px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('2', c + m(0.365), c + m(0.3)); g.fillText('D1', c + m(0.365), c + m(0.4));
      // V ident in a blue circle + approach bar, approach (south) side, outside the TLOF
      g.fillStyle = '#2a5bd7'; g.beginPath(); g.arc(c, c + m(0.72), m(0.12), 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#f6f5f0'; g.lineWidth = m(0.025); g.lineJoin = 'miter';
      g.beginPath(); g.moveTo(c - m(0.065), c + m(0.66)); g.lineTo(c, c + m(0.79)); g.lineTo(c + m(0.065), c + m(0.66)); g.stroke();
      g.fillStyle = '#f6f5f0'; g.fillRect(c - m(0.125), c + m(0.87), m(0.25), m(0.05));
      // tyre scuffs near the ring
      for (let k = 0; k < 14; k++) { g.fillStyle = 'rgba(0,0,0,0.07)'; g.beginPath(); g.ellipse(c + (rr() - 0.5) * m(0.6), c + (rr() - 0.5) * m(0.6), m(0.06), m(0.02), rr() * 3, 0, 6.3); g.fill(); }
    });
    const padTex = tex(padCanvas, true, false);
    const padMat = std({ map: padTex, roughness: 0.78, metalness: 0.12 });
    const padTop = new T.Mesh(new T.PlaneGeometry(V.safety_area, V.safety_area), padMat);
    padTop.rotation.x = -Math.PI / 2; padTop.position.y = 0.001; padTop.receiveShadow = true;
    vport.add(padTop);

    (function deckStructure() {
      const steel = new Buf(), dk = new Buf();
      box(dk, -sa, -0.12, -sa, sa, -0.0005, sa, { top: false, bottom: true });
      // columns and beams
      const colAt = (x, z) => box(steel, x - 0.06, ROOF, z - 0.06, x + 0.06, -0.12, z + 0.06, {});
      for (const x of [-sa + 0.1, 0, sa - 0.1]) for (const z of [-sa + 0.1, 0, sa - 0.1]) if (x || z) colAt(x, z);
      for (const z of [-sa + 0.1, sa - 0.1]) box(steel, -sa + 0.05, -0.28, z - 0.05, sa - 0.05, -0.12, z + 0.05, {});
      for (const x of [-sa + 0.1, sa - 0.1]) box(steel, x - 0.05, -0.28, -sa + 0.05, x + 0.05, -0.12, sa - 0.05, {});
      // net frame: outer rail and brackets
      const nw = V.net_width, o = sa + nw;
      for (const s of [-1, 1]) {
        box(steel, -o, -0.07, s * o - 0.02, o, -0.03, s * o + 0.02, {});
        box(steel, s * o - 0.02, -0.07, -o, s * o + 0.02, -0.03, o, {});
        for (const k of [-1, 0, 1]) { box(steel, k * sa - 0.02, -0.16, s * sa, k * sa + 0.02, -0.12, s * o, {}); box(steel, s * sa, -0.16, k * sa - 0.02, s * o, -0.12, k * sa + 0.02, {}); }
      }
      // access stair from the deck down to the roof, east side, outside the net
      const sx = o + 0.05;
      for (let k = 0; k < 4; k++) { const y = -0.12 - k * 0.2, x0 = sx + k * 0.26; box(steel, x0, y - 0.04, -0.4, x0 + 0.28, y, 0.4, {}); }
      for (const z of [-0.42, 0.42]) {
        const g = new T.BoxGeometry(1.3, 0.05, 0.03);
        const m = M4().makeRotationZ(-0.62).premultiply(M4().makeTranslation(sx + 0.55, -0.52, z));
        steel.geom(g, m);
      }
      addMesh(steel.build(), mats.metal, true, true, vport);
      addMesh(dk.build(), mats.dark, true, true, vport);
      // safety net shelf: 4 trapezoids, tilted up slightly, never above the deck
      const netTex = tex(canvasOf(64, 64, (g) => { g.clearRect(0, 0, 64, 64); g.strokeStyle = 'rgba(40,44,48,0.9)'; g.lineWidth = 4; for (let k = 0; k <= 64; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 64); g.moveTo(0, k); g.lineTo(64, k); g.stroke(); } }), true);
      const net = new Buf();
      const yi = -0.09, yo = -0.04;
      const sides = [
        [[-sa, yi, sa], [sa, yi, sa], [o, yo, o], [-o, yo, o]],
        [[sa, yi, sa], [sa, yi, -sa], [o, yo, -o], [o, yo, o]],
        [[sa, yi, -sa], [-sa, yi, -sa], [-o, yo, -o], [o, yo, -o]],
        [[-sa, yi, -sa], [-sa, yi, sa], [-o, yo, o], [-o, yo, -o]],
      ];
      for (const q of sides) {
        const uv = q.map((p) => [p[0] / 0.1, p[2] / 0.1]);
        net.quad(q[0], q[3], q[2], q[1], [0, 1, 0], [uv[0][0], uv[0][1], uv[3][0], uv[3][1], uv[2][0], uv[2][1], uv[1][0], uv[1][1]]);
      }
      const nm = new T.Mesh(net.build(), std({ map: netTex, transparent: true, depthWrite: false, side: T.DoubleSide, color: 0x30363c, roughness: 0.8 }));
      nm.castShadow = true; nm.receiveShadow = true;
      vport.add(nm);
    })();

    // green perimeter lights: 16 around the TLOF, 8 around the FATO
    const padLights = (function () {
      const pts = [];
      const ring = (half, n) => {
        for (let k = 0; k < n; k++) {
          const s = (k / n) * 8 * half, side = Math.floor(s / (2 * half)), u = s - side * 2 * half - half;
          pts.push([[u, -half], [half, u], [-u, half], [-half, -u]][side]);
        }
      };
      ring(V.tlof / 2 + 0.05, 16);
      ring(V.fato / 2 + 0.07, 8);
      const im = new T.InstancedMesh(new T.CylinderGeometry(0.024, 0.028, 0.03, 10), mats.padLight, pts.length);
      pts.forEach((p, i) => im.setMatrixAt(i, M4().makeTranslation(p[0], 0.015, p[1])));
      vport.add(im);
      return im;
    })();

    // stair tower, HVAC, windsock (city coordinates, not rotated with the pad)
    const floods = [];
    let sock = null;
    (function roofPlant() {
      const z0 = V.pad.z - V.deck_height;
      const tr = new Buf(), mt = new Buf(), dk = new Buf();
      if (V.stair_tower) {
        const f = V.stair_tower.footprint, h = V.stair_tower.height;
        cbox(tr, f, z0, z0 + h, { tu: 2 });
        cbox(tr, [f[0] - 0.25, f[1] - 0.25, f[2] + 0.25, f[3] + 0.25], z0 + h, z0 + h + 0.2, { tu: 2 });
        // door on the west face
        const dy = (f[1] + f[3]) / 2;
        box(dk, cx(f[0]) - 0.03, cy(z0), cz(dy + 0.5), cx(f[0]) + 0.01, cy(z0 + 2.1), cz(dy - 0.5), {});
        // floodlights on the corner nearest the pad, aimed down at the TLOF
        const n = V.stair_tower.floodlights;
        for (let k = 0; k < n; k++) {
          const px = f[0] + 0.3 + k * 0.7, py = f[3] - 0.2;
          const P = new T.Vector3(cx(px), cy(z0 + h + 1.4), cz(py));
          cylAt(mt, 0.035, 0.035, 1.3, P.x, cy(z0 + h + 0.2), P.z, 6);
          const housing = new T.Mesh(new T.BoxGeometry(0.28, 0.18, 0.12), mats.dark);
          const lens = new T.Mesh(new T.PlaneGeometry(0.24, 0.14), mats.flood);
          lens.position.z = -0.061; lens.rotation.y = Math.PI;
          const g = new T.Group(); g.add(housing, lens); g.position.copy(P);
          g.lookAt(new T.Vector3(0, 0, 0)); g.rotateY(Math.PI);
          scene.add(g);
          const sp = new T.SpotLight(0xfff1d6, 0, 24, 0.4, 0.6, 1.6);
          sp.position.copy(P); sp.target.position.set(0, 0, 0);
          scene.add(sp, sp.target);
          floods.push(sp);
        }
      }
      for (const u of V.hvac) {
        const f = u.footprint;
        cbox(mt, f, z0, z0 + u.height, {});
        const fx = (f[0] + f[2]) / 2, fy = (f[1] + f[3]) / 2, r = Math.min(f[2] - f[0], f[3] - f[1]) * 0.32;
        cylAt(dk, r, r, 0.06, cx(fx), cy(z0 + u.height), cz(fy), 20);
        // grille stripes on the long faces
        for (let k = 1; k < 6; k++) box(dk, cx(f[0] + (k / 6) * (f[2] - f[0])) - 0.02, cy(z0 + 0.2), cz(f[1]) - 0.005, cx(f[0] + (k / 6) * (f[2] - f[0])) + 0.02, cy(z0 + u.height - 0.2), cz(f[1]) + 0.005, {});
        box(mt, cx(f[0]) + 0.1, cy(z0 + u.height * 0.6), cz(f[3]) - 0.5, cx(f[0]) + 0.3, cy(z0 + u.height * 0.6) + 0.2, cz(f[3]) - 0.1, {});
      }
      if (V.windsock) {
        const w = V.windsock, X0 = cx(w.x), Z0 = cz(w.y), Y0 = cy(z0);
        box(dk, X0 - 0.15, Y0, Z0 - 0.15, X0 + 0.15, Y0 + 0.08, Z0 + 0.15, {});
        cylAt(mt, 0.02, 0.028, w.mast_height, X0, Y0, Z0, 8);
        // sock: truncated cone, 5 bands orange/white (darker at both ends), hinged at the mast top
        const L = w.length, r0 = L * 0.125, r1 = L * 0.0625;
        const g = new T.CylinderGeometry(r0, r1, L, 14, 5, true);
        g.translate(0, -L / 2, 0); g.rotateX(Math.PI / 2); // wide mouth at the hinge, tail along -z
        const colors = [], pos = g.attributes.position, oc = new T.Color(0xf26a12), wc = new T.Color(0xf2f2ee);
        for (let k = 0; k < pos.count; k++) { const band = Math.min(4, Math.floor((-pos.getZ(k) / L) * 5 - 1e-6 + 1e-3)); const c = band % 2 ? wc : oc; colors.push(c.r, c.g, c.b); }
        g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
        const sm = new T.Mesh(g, std({ vertexColors: true, roughness: 0.85, side: T.DoubleSide }));
        sm.castShadow = true;
        const ring = new T.Mesh(new T.TorusGeometry(r0, 0.006, 6, 16), mats.metal);
        const hinge = new T.Group(); hinge.add(sm, ring);
        hinge.position.set(X0, Y0 + w.mast_height - 0.02, Z0);
        const lamp = new T.Mesh(new T.SphereGeometry(0.03, 8, 6), mats.lamp); lamp.position.set(X0, Y0 + w.mast_height + 0.04, Z0);
        scene.add(hinge, lamp);
        sock = { hinge, t: 0 };
      }
      if (tr.p.length) addMesh(tr.build(), mats.trim, true, true, scene);
      if (mt.p.length) addMesh(mt.build(), mats.metal, true, true, scene);
      if (dk.p.length) addMesh(dk.build(), mats.dark, true, true, scene);
    })();

    /* ================= drone (about 0.6 m tip to tip) ================= */
    const drone = new T.Group();
    const props = [], discs = [], navLeds = [];
    (function buildDrone() {
      const merge = X.mergeGeometries;
      const shellM = std({ color: 0xe3e6e8, roughness: 0.32, metalness: 0.05 });
      const carbonM = std({ color: 0x1b1e21, roughness: 0.45, metalness: 0.3 });
      const accentM = std({ color: 0xff6f1a, roughness: 0.4 });
      const bellM = std({ color: 0x9aa3ab, roughness: 0.25, metalness: 0.9 });
      const T4 = (x, y, z) => M4().makeTranslation(x, y, z);
      const parts = { shell: [], carbon: [], accent: [], bell: [] };
      const add = (k, g, m) => { if (m) g.applyMatrix4(m); parts[k].push(g); };
      const shell = new T.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      add('shell', shell, M4().makeScale(0.075, 0.042, 0.11).premultiply(T4(0, 0.012, 0)));
      add('carbon', new T.BoxGeometry(0.13, 0.024, 0.2), T4(0, 0, 0));
      add('carbon', new T.BoxGeometry(0.07, 0.036, 0.13), T4(0, -0.03, 0.01));
      add('accent', new T.BoxGeometry(0.072, 0.006, 0.02), T4(0, -0.012, -0.05));
      add('carbon', new T.CylinderGeometry(0.004, 0.004, 0.06, 6), T4(0, 0.07, 0.06));
      add('shell', new T.CylinderGeometry(0.028, 0.03, 0.012, 16), T4(0, 0.1, 0.06));
      add('carbon', new T.SphereGeometry(0.02, 12, 8), T4(0, -0.03, -0.085));
      const up = new T.Vector3(0, 1, 0);
      const motors = [[-0.16, -0.16], [0.16, -0.16], [0.16, 0.16], [-0.16, 0.16]]; // FL, FR, RR, RL (forward = -z)
      motors.forEach(([mx, mz], i) => {
        const dir = new T.Vector3(mx, 0, mz), L = dir.length();
        const arm = new T.CylinderGeometry(0.011, 0.013, L, 8);
        arm.applyMatrix4(M4().makeRotationFromQuaternion(new T.Quaternion().setFromUnitVectors(up, dir.clone().normalize())));
        add(i < 2 ? 'accent' : 'carbon', arm, T4(mx / 2, 0, mz / 2));
        add('carbon', new T.CylinderGeometry(0.021, 0.021, 0.026, 14), T4(mx, 0.012, mz));
        add('bell', new T.CylinderGeometry(0.019, 0.021, 0.014, 14), T4(mx, 0.032, mz));
        // landing legs under the motors
        add('carbon', new T.CylinderGeometry(0.005, 0.006, 0.07, 6), T4(mx * 0.95, -0.035, mz * 0.95));
        add('carbon', new T.SphereGeometry(0.009, 8, 6), T4(mx * 0.95, -0.07, mz * 0.95));
        // prop: two tapered blades + hub, spun about y
        const blade = new T.BoxGeometry(0.2, 0.003, 0.02);
        const bp = blade.attributes.position;
        for (let k = 0; k < bp.count; k++) { const x = bp.getX(k), t = 1 - Math.abs(x) / 0.1 * 0.55; bp.setZ(k, bp.getZ(k) * t + (x > 0 ? 0.002 : -0.002)); bp.setY(k, bp.getY(k) + bp.getZ(k) * 0.25 * Math.sign(x)); }
        blade.computeVertexNormals();
        const hub = new T.CylinderGeometry(0.008, 0.01, 0.012, 10);
        const pg = merge([blade, hub]);
        const prop = new T.Mesh(pg, carbonM); prop.position.set(mx, 0.044, mz); prop.castShadow = true;
        const disc = new T.Mesh(new T.CircleGeometry(0.1, 28), new T.MeshBasicMaterial({ color: 0xd8dee2, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }));
        disc.rotation.x = -Math.PI / 2; disc.position.set(mx, 0.045, mz);
        drone.add(prop, disc); props.push(prop); discs.push(disc);
        // nav LEDs: red port (left), green starboard (right), white strobes at the rear
        const ledCol = i === 0 ? 0xff2020 : i === 1 ? 0x20ff60 : 0xffffff;
        const led = new T.Mesh(new T.SphereGeometry(0.009, 10, 8), std({ color: 0x111111, emissive: ledCol, emissiveIntensity: 4 }));
        led.position.set(mx, -0.004, mz + (i < 2 ? -0.022 : 0.022));
        drone.add(led); navLeds.push(led);
      });
      for (const [k, m] of [['shell', shellM], ['carbon', carbonM], ['accent', accentM], ['bell', bellM]]) {
        const g = merge(parts[k]);
        const mesh = new T.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true;
        drone.add(mesh);
      }
    })();
    const GEAR = 0.078; // origin height above the skid feet
    scene.add(drone);

    const dropMat = new T.LineBasicMaterial({ color: 0x3fd0ee, transparent: true, opacity: 0.5, toneMapped: false });
    const drop = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3(0, -1, 0)]), dropMat);
    scene.add(drop);

    /* ================= trail + altitude ruler ================= */
    let trail = null, pts = [], segMats = [], headIdx = -1, ruler = null;
    const yAxis = new T.Vector3(0, 1, 0);
    function segMatrix(a, b, out) {
      const dir = new T.Vector3().subVectors(b, a), len = dir.length(), q = new T.Quaternion();
      if (len > 1e-9) q.setFromUnitVectors(yAxis, dir.divideScalar(len));
      return out.compose(new T.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new T.Vector3(0.018, Math.max(len, 1e-6), 0.018));
    }
    function textSprite(text) {
      const c = canvasOf(128, 48, (g) => {
        g.font = '600 30px ' + (opts.mono || 'monospace'); g.textBaseline = 'middle';
        g.lineWidth = 6; g.strokeStyle = 'rgba(8,12,16,0.75)'; g.strokeText(text, 6, 26);
        g.fillStyle = '#eef3f6'; g.fillText(text, 6, 26);
      });
      const sp = new T.Sprite(new T.SpriteMaterial({ map: tex(c, true, false), transparent: true, depthWrite: false, toneMapped: false }));
      sp.scale.set(0.42, 0.16, 1); sp.center.set(0, 0.5);
      return sp;
    }
    function buildRuler(maxAlt) {
      if (ruler) { scene.remove(ruler); ruler.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); }
      ruler = new T.Group();
      const top = Math.max(2, Math.ceil(maxAlt + 1));
      const v = [0, 0, 0, 0, top, 0];
      for (let a = 1; a <= top; a++) { const L = a % 5 === 0 ? 0.24 : 0.12; v.push(0, a, 0, L, a, 0); }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(v, 3));
      ruler.add(new T.LineSegments(geo, new T.LineBasicMaterial({ color: 0xdfe8ee, transparent: true, opacity: 0.7, toneMapped: false })));
      const every = top > 12 ? 5 : 2;
      for (let a = every; a <= top; a += every) { const s = textSprite(a + ' m'); s.position.set(0.28, a, 0); ruler.add(s); }
      ruler.position.set(-sa - 0.45, 0, -sa - 0.45); // NW corner: behind the pad from the default chase view
      scene.add(ruler);
    }
    function recolorTrail() {
      if (!trail) return;
      const c = new T.Color();
      pts.forEach((p, i) => { c.set(opts.trailColor(p.code)); trail.setColorAt(i, c); });
      if (trail.instanceColor) trail.instanceColor.needsUpdate = true;
    }
    let store = null, maxAlt = 6;
    function setData(st) {
      store = st;
      if (trail) { scene.remove(trail); trail.geometry.dispose(); trail.material.dispose(); trail = null; }
      pts = []; segMats = []; headIdx = -1;
      const stride = Math.max(1, Math.ceil(st.length / 3000));
      let lastP = null;
      for (let i = 0; i < st.length; i += stride) {
        const p = new T.Vector3(st.cols.e[i] - st.pad.e, -st.cols.d[i], -(st.cols.n[i] - st.pad.n));
        const tt = st.cols.t[i];
        if (lastP && p.distanceTo(lastP.p) < 0.02 && tt - lastP.t < 0.25 && st.cols.state[i] === st.cols.state[lastP.i]) continue;
        const rec = { p, t: tt, i, code: st.hasState ? st.cols.state[i] : st.cols.mode[i] };
        pts.push(rec); lastP = rec;
      }
      if (pts.length) {
        trail = new T.InstancedMesh(new T.CylinderGeometry(1, 1, 1, 6, 1, true), new T.MeshBasicMaterial({ toneMapped: false }), pts.length);
        trail.frustumCulled = false;
        for (let i = 0; i < pts.length; i++) { const m = M4(); segMatrix(pts[i].p, pts[Math.min(i + 1, pts.length - 1)].p, m); segMats.push(m); trail.setMatrixAt(i, m); }
        scene.add(trail);
        recolorTrail();
        trail.count = 0;
      }
      maxAlt = st.cols.alt.reduce((a, b) => Math.max(a, b), 0);
      buildRuler(maxAlt);
      resetView(true);
    }

    /* ================= sky, sun, environment ================= */
    const sky = X.Sky ? new X.Sky() : null;
    if (sky) { sky.scale.setScalar(5000); scene.add(sky); }
    const hemi = new T.HemisphereLight(0xbcd6ff, 0x8a8070, 0.7);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xffffff, 3);
    sun.castShadow = true;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    const pmrem = new T.PMREMGenerator(renderer);
    let envRT = null, envScene = null, envSky = null;
    if (X.Sky) { envScene = new T.Scene(); envSky = new X.Sky(); envSky.scale.setScalar(1000); envScene.add(envSky); }
    let tod = C.timeOfDay(opts.tod || 'day');
    const sunDir = new T.Vector3();
    function applyTod(name) {
      tod = C.timeOfDay(name);
      const v = C.sunVector(tod.sunElev, tod.sunAz);
      sunDir.set(v.x, v.y, v.z);
      for (const s of [sky, envSky]) {
        if (!s) continue;
        const u = s.material.uniforms;
        u.turbidity.value = tod.turbidity; u.rayleigh.value = tod.rayleigh; u.mieCoefficient.value = tod.mie; u.mieDirectionalG.value = tod.mieG;
        u.sunPosition.value.copy(sunDir);
      }
      if (!sky) scene.background = new T.Color(tod.fog);
      renderer.toneMappingExposure = tod.exposure;
      sun.color.set(tod.sunColor); sun.intensity = tod.sun;
      hemi.color.set(tod.hemiSky); hemi.groundColor.set(tod.hemiGround); hemi.intensity = tod.hemi;
      scene.fog = new T.FogExp2(tod.fog, tod.fogDensity);
      if (envScene) {
        if (envRT) envRT.dispose();
        envRT = pmrem.fromScene(envScene, 0, 1, 3000);
        scene.environment = envRT.texture;
        scene.environmentIntensity = tod.envIntensity;
      }
      C.FACADES.forEach((f) => { mats.facade[f].emissiveIntensity = tod.windows; });
      mats.lamp.emissiveIntensity = tod.lights * 2.2;
      lamps.poolMat.opacity = Math.min(1, Math.max(0, (tod.lights - 0.8) / 2.2)) * 0.55;
      mats.padLight.emissiveIntensity = 1.0 + tod.lights * 0.8;
      mats.redLight.emissiveIntensity = tod.lights > 1 ? 4 : 0;
      obst.visible = tod.lights > 1;
      mats.flood.emissiveIntensity = tod.lights > 1 ? 6 : 0;
      floods.forEach((f) => { f.intensity = tod.lights > 1 ? 7 * tod.lights : 0; });
      if (bloom) bloom.strength = tod.bloom;
      applyQuality(quality);
    }

    /* ================= quality + post ================= */
    let quality = opts.quality === 'low' ? 'low' : 'high';
    let composer = null, bloom = null, rt = null;
    function buildComposer() {
      if (composer || !X.EffectComposer) return;
      rt = new T.WebGLRenderTarget(2, 2, { type: T.HalfFloatType, samples: 4 });
      composer = new X.EffectComposer(renderer, rt);
      composer.addPass(new X.RenderPass(scene, camera));
      bloom = new X.UnrealBloomPass(new T.Vector2(256, 256), tod.bloom, 0.4, 0.85);
      composer.addPass(bloom);
      composer.addPass(new X.OutputPass());
    }
    let shadowType = null;
    function applyQuality(q) {
      quality = q === 'low' ? 'low' : 'high';
      const dpr = window.devicePixelRatio || 1;
      renderer.setPixelRatio(quality === 'high' ? Math.min(dpr, 2) : Math.min(dpr, 1.25));
      const size = quality === 'high' ? 4096 : 2048;
      if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
      const type = quality === 'high' ? T.PCFSoftShadowMap : T.PCFShadowMap;
      if (type !== shadowType) { shadowType = type; renderer.shadowMap.type = type; scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); }); }
      trees.leaf.castShadow = trees.trunk.castShadow = quality === 'high';
      sun.castShadow = tod.sun > 0.5;
      if (quality === 'high' && tod.bloom > 0) buildComposer();
      resize();
    }

    /* ================= cameras ================= */
    const CAM = {
      chase: { az: -0.45, pol: 1.2, zoom: 1 },
      orbit: { az: 0.6, pol: 1.12, dist: 13, target: new T.Vector3(0, 2.5, 0) },
      top: { zoom: 1 },
      city: { az: -0.25, zoom: 1 },
    };
    const HOME = JSON.parse(JSON.stringify({ chase: CAM.chase, top: CAM.top, city: CAM.city }));
    let camMode = C.CAMERAS.includes(opts.cam) ? opts.cam : 'chase';
    let blend = null, clock = 0, curPose = null;
    const focus = new T.Vector3(0, 0, 0); // smoothed drone position
    const dronePos = new T.Vector3();
    function modePose(mode) {
      const d = { x: focus.x, y: focus.y, z: focus.z };
      if (mode === 'chase') return C.chasePose(d, CAM.chase);
      if (mode === 'top') return C.topPose(d, CAM.top);
      if (mode === 'city') return C.cityPose(clock, CAM.city);
      const o = CAM.orbit;
      if (opts.follow && opts.follow()) o.target.lerp(dronePos, 0.12);
      return C.orbitPose(o.target.x, o.target.y, o.target.z, o.az, o.pol, o.dist, camera.aspect < 1.1 ? 52 : 40);
    }
    function setCamera(mode, instant) {
      if (!C.CAMERAS.includes(mode)) return;
      if (curPose && !instant) blend = { from: Object.assign({}, curPose), t: 0, dur: mode === 'city' || camMode === 'city' ? 2.2 : 1.2 };
      camMode = mode;
      updateShadowFrustum();
    }
    function updateShadowFrustum() {
      const s = sun.shadow.camera, half = camMode === 'city' ? 260 : 45;
      s.left = -half; s.right = half; s.top = half; s.bottom = -half; s.near = 1; s.far = 1600;
      s.updateProjectionMatrix();
    }
    function placeSun() {
      const c = camMode === 'city' ? new T.Vector3(0, GROUND, 0) : new T.Vector3(focus.x * 0.5, 0, focus.z * 0.5);
      sun.target.position.copy(c);
      sun.position.copy(c).addScaledVector(sunDir.y > 0.05 ? sunDir : new T.Vector3(sunDir.x, 0.05, sunDir.z).normalize(), 700);
      sun.target.updateMatrixWorld();
    }
    function resetView(silent) {
      Object.assign(CAM.chase, HOME.chase); Object.assign(CAM.top, HOME.top); Object.assign(CAM.city, HOME.city);
      const o = CAM.orbit; o.az = 0.6; o.pol = 1.12; o.dist = Math.max(10, maxAlt * 1.7 + 5.5); o.target.set(0, Math.max(2.2, maxAlt * 0.5), 0);
      if (!silent && curPose) blend = { from: Object.assign({}, curPose), t: 0, dur: 0.8 };
    }

    // pointer: drag rotates, wheel / pinch zooms (per camera mode)
    const pointers = new Map();
    let moved = 0, pinch0 = 0;
    function drag(dx, dy) {
      const c = CAM[camMode];
      if (camMode === 'top') return;
      c.az -= dx * 0.007;
      if (camMode !== 'city') c.pol = Math.min(1.5, Math.max(0.12, c.pol - dy * 0.007));
    }
    function zoom(f) {
      const c = CAM[camMode];
      if (camMode === 'orbit') c.dist = Math.min(80, Math.max(2.5, c.dist * f));
      else c.zoom = Math.min(camMode === 'city' ? 2.5 : 6, Math.max(0.35, c.zoom * f));
    }
    canvas.addEventListener('pointerdown', (ev) => { canvas.setPointerCapture(ev.pointerId); pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); moved = 0; pinch0 = 0; });
    canvas.addEventListener('pointermove', (ev) => {
      const p = pointers.get(ev.pointerId);
      if (!p) return;
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
      p.x = ev.clientX; p.y = ev.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 1) drag(dx, dy);
      else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values()), d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0) zoom(pinch0 / d);
        pinch0 = d;
      }
    });
    const up = (ev) => { pointers.delete(ev.pointerId); pinch0 = 0; if (ev.type === 'pointerup' && pointers.size === 0 && moved < 5 && api.onTap) api.onTap(); };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); zoom(Math.exp(ev.deltaY * 0.001)); }, { passive: false });

    function resize() {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      canvas.style.width = '100%'; canvas.style.height = '100%';
      camera.aspect = w / h; camera.updateProjectionMatrix();
      if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
    }
    new ResizeObserver(resize).observe(container);

    /* ================= per-sample update + per-frame render ================= */
    const tmp = new T.Vector3(), prev = new T.Vector3(), qYaw = new T.Quaternion(), qTilt = new T.Quaternion();
    let curArmed = 0, hasSample = false, spin = 0, firstSample = true;
    function update(s) {
      hasSample = !!s;
      if (!s) { drone.visible = drop.visible = false; if (trail) trail.count = 0; return; }
      drone.visible = drop.visible = true;
      tmp.set(s.e - store.pad.e, -s.d, -(s.n - store.pad.n));
      dronePos.copy(tmp);
      if (firstSample) { focus.copy(tmp); firstSample = false; }
      drone.position.set(tmp.x, tmp.y + GEAR, tmp.z);
      // tilt into the horizontal velocity (from the sample 0.3 s earlier), like a real multirotor
      const p0 = store.sampleAt(Math.max(0, s.t - 0.3));
      let vx = 0, vz = 0;
      if (p0 && s.t > 0.05) { prev.set(p0.e - store.pad.e, -p0.d, -(p0.n - store.pad.n)); const dt = Math.max(0.05, s.t - p0.t); vx = (tmp.x - prev.x) / dt; vz = (tmp.z - prev.z) / dt; }
      const ang = Math.min(0.35, Math.hypot(vx, vz) * 0.12);
      qYaw.setFromAxisAngle(yAxis, -(s.hdg * Math.PI) / 180);
      if (ang > 1e-4) qTilt.setFromAxisAngle(new T.Vector3(-vz, 0, vx).normalize(), -ang); else qTilt.identity();
      drone.quaternion.copy(qTilt).multiply(qYaw);
      curArmed = s.armed;
      const onDeck = Math.abs(tmp.x) < sa && Math.abs(tmp.z) < sa;
      const gy = onDeck ? 0 : ROOF;
      drop.position.copy(tmp); drop.scale.set(1, Math.max(0.001, tmp.y - gy), 1);
      if (trail) {
        let lo = 0, hi = pts.length - 1, k2 = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (pts[mid].t <= s.t) { k2 = mid; lo = mid + 1; } else hi = mid - 1; }
        if (headIdx >= 0 && headIdx < segMats.length) trail.setMatrixAt(headIdx, segMats[headIdx]);
        headIdx = -1;
        if (k2 >= 0) { const hm = M4(); segMatrix(pts[k2].p, tmp, hm); trail.setMatrixAt(k2, hm); headIdx = k2; }
        trail.count = k2 + 1;
        trail.instanceMatrix.needsUpdate = true;
      }
    }

    let fpsAcc = 0, fpsN = 0, fps = 0, last = { calls: 0, triangles: 0 };
    function frame(dt, playing) {
      clock += dt;
      // smooth focus toward the drone
      const k = 1 - Math.exp(-dt * 5);
      focus.lerp(dronePos, hasSample ? k : 0);
      // props
      const spinning = hasSample && curArmed;
      if (spinning) { spin += dt * (playing ? 90 : 0); props.forEach((p, i) => { p.rotation.y = spin * (i % 2 ? 1 : -1); }); }
      discs.forEach((d) => { d.material.opacity = spinning && playing ? 0.16 : 0; });
      // nav LEDs: steady red/green, white rear strobes double-flash
      const ph = clock % 1.2, strobe = ph < 0.05 || (ph > 0.15 && ph < 0.2);
      navLeds[2].material.emissiveIntensity = navLeds[3].material.emissiveIntensity = strobe ? 12 : 0.2;
      // windsock: points downwind, droops in light wind, flutters
      if (sock) {
        const w = opts.wind ? opts.wind() : V.wind;
        const p = C.windsockPose(w.from_deg, w.speed_mps);
        sock.t += dt;
        const fl = Math.sin(sock.t * 7.3) * 0.5 + Math.sin(sock.t * 3.1) * 0.5;
        const amp = Math.min(1, w.speed_mps / 6);
        sock.hinge.rotation.set(0, 0, 0);
        sock.hinge.rotateY(-(p.towardDeg * Math.PI) / 180 + fl * 0.08 * amp);
        sock.hinge.rotateX(-((p.droop + fl * 4 * amp) * Math.PI) / 180);
      }
      // aviation lights blink at 40 per minute
      mats.redLight.emissiveIntensity = tod.lights > 1 && clock % 1.5 < 0.75 ? 5 : 0;
      // camera
      let pose = modePose(camMode);
      if (blend) {
        blend.t += dt;
        const f = C.easeInOut(blend.t / blend.dur);
        pose = C.lerpPose(blend.from, pose, f);
        if (blend.t >= blend.dur) blend = null;
      }
      curPose = pose;
      if (ruler) ruler.visible = camMode === 'chase' || camMode === 'orbit';
      camera.position.set(pose.px, pose.py, pose.pz);
      camera.lookAt(pose.tx, pose.ty, pose.tz);
      if (Math.abs(camera.fov - pose.fov) > 0.01) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
      placeSun();
      renderer.info.reset();
      if (composer && quality === 'high' && tod.bloom > 0) composer.render(dt); else renderer.render(scene, camera);
      last = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      fpsAcc += dt; fpsN++;
      if (fpsAcc >= 1) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    }

    const api = {
      setData, update, frame, resize, onTap: null,
      refreshTheme() { recolorTrail(); },
      resetView() { resetView(false); },
      setCamera, setTimeOfDay: applyTod, setQuality: applyQuality,
      get camera() { return camMode; }, get timeOfDay() { return tod.name; }, get quality() { return quality; },
      stats() { return { fps: Math.round(fps * 10) / 10, calls: last.calls, triangles: last.triangles, quality, camera: camMode, tod: tod.name, buildings: city.buildings.length, context: contextList.length }; },
    };
    updateShadowFrustum();
    applyTod(tod.name);
    resize();
    return api;
  }

  root.PLVWorld = { createWorld };
})(typeof globalThis !== 'undefined' ? globalThis : this);
