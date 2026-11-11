/* Precision Landing Lab: presentation overlays (browser only).
 *
 *   createM3Hud(svg)        M3 video HUD over the onboard camera view
 *                           (design/vertiport-concept.html, section C)
 *   createPipOverlay(svg)   small marks over the onboard picture-in-picture
 *   createCineOverlay(el)   cinematic mode: brand, lower thirds, outro card, bars
 *
 * Models come from PLVHud.hudModel (hud-core.js) and PLVCine.cineAt
 * (cine-core.js). Run data is written with textContent / attributes only,
 * never innerHTML. The HUD keeps its own dark styling in both page themes
 * because it sits on top of video.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const H = () => root.PLVHud;
  const C = { ink: '#e9f3f6', cyan: '#19e6ff', yellow: '#ffd34d', white: '#ffffff', limit: '#ff6b5b', limitText: '#ff8a7d', panel: 'rgba(6,10,14,.66)', panelLine: 'rgba(233,243,246,.22)' };
  const TONE = { good: '#2fd16b', caution: '#f2a516', bad: '#ff4a3d' };

  function s(tag, attrs, parent, text) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  const set = (e, attrs) => { for (const k in attrs) e.setAttribute(k, attrs[k]); };
  const show = (e, on) => e.setAttribute('opacity', on ? 1 : 0);
  const f1 = (x) => x.toFixed(1);
  const pts = (list) => list.map((q) => f1(q.x) + ',' + f1(q.y)).join(' ');

  /** Point on the edge of rect r (inset by m) along the ray from its centre toward (x, y). */
  function edgePoint(r, x, y, m) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = x - cx, dy = y - cy;
    const kx = dx ? (r.w / 2 - m) / Math.abs(dx) : Infinity, ky = dy ? (r.h / 2 - m) / Math.abs(dy) : Infinity;
    const k = Math.min(kx, ky, 1);
    return { x: cx + dx * k, y: cy + dy * k, ang: Math.atan2(dy, dx) };
  }

  /* ======================= M3 HUD ======================= */
  function createM3Hud(svg) {
    svg.textContent = '';
    const defs = s('defs', null, svg);
    const vg = s('radialGradient', { id: 'm3vig', cx: '.5', cy: '.5', r: '.72' }, defs);
    s('stop', { offset: '.6', 'stop-color': '#000', 'stop-opacity': '0' }, vg);
    s('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': '.55' }, vg);
    const vig = s('rect', { fill: 'url(#m3vig)' }, svg);
    const L = s('g', { fill: C.ink }, svg);

    s('path', { d: 'M28 64 V40 H52 M1252 64 V40 H1228 M28 656 V680 H52 M1252 656 V680 H1228', stroke: C.ink, 'stroke-width': 2, fill: 'none', opacity: '.7' }, L);
    // top-left meta
    const tl = s('g', { transform: 'translate(44 74)' }, L);
    s('circle', { cx: 6, cy: -5, r: 6, fill: '#ff4a3d', class: 'blink' }, tl);
    const camTxt = s('text', { x: 20, y: 0, 'font-size': 17, 'font-weight': 600, 'letter-spacing': 1.2 }, tl);
    s('text', { x: 20, y: 24, 'font-size': 13.5, 'font-weight': 600, 'letter-spacing': 2, fill: C.cyan }, tl, 'SIMULATED PREVIEW');
    const tSim = s('text', { x: 20, y: 46, 'font-size': 14.5, opacity: '.75' }, tl);
    // chips
    const chips = s('g', { transform: 'translate(640 56)', 'text-anchor': 'middle' }, L);
    let chipKey = '', chipEls = [];
    // top-right mode
    const tr = s('g', { transform: 'translate(1236 74)', 'text-anchor': 'end' }, L);
    const modeTxt = s('text', { 'font-size': 17, 'font-weight': 600, 'letter-spacing': 1.5 }, tr);
    const srcTxt = s('text', { y: 24, 'font-size': 14.5, opacity: '.75' }, tr);
    // search ring
    const searchG = s('g', { opacity: 0 }, L);
    s('circle', { cx: 640, cy: 360, r: 210, fill: 'none', stroke: C.ink, 'stroke-width': 1.6, 'stroke-dasharray': '4 10', opacity: '.55' }, searchG);
    s('text', { x: 640, y: 604, 'text-anchor': 'middle', 'font-size': 18, 'letter-spacing': 3, opacity: '.85' }, searchG, 'SCANNING FOR TARGET…');
    // crosshair at the image centre (aircraft nadir)
    const ch = s('g', { transform: 'translate(640 360)', stroke: C.ink, 'stroke-width': 2, fill: 'none', opacity: '.9' }, L);
    s('path', { d: 'M-40 0 H-12 M12 0 H40 M0 -40 V-12 M0 12 V40' }, ch);
    s('circle', { r: 4, fill: C.ink, stroke: 'none' }, ch);
    // tag box (projected from the known pad pose) and detection quad (if the run has one)
    const tagG = s('g', null, L);
    const tagPoly = s('polygon', { fill: 'rgba(25,230,255,.08)', stroke: C.cyan, 'stroke-width': 2.5, 'stroke-dasharray': '10 6' }, tagG);
    const tagCorners = s('g', { fill: C.cyan }, tagG);
    const tagCornerEls = [0, 1, 2, 3].map(() => s('rect', { width: 10, height: 10 }, tagCorners));
    const detPoly = s('polygon', { fill: 'rgba(25,230,255,.12)', stroke: C.cyan, 'stroke-width': 3, opacity: 0 }, L);
    const tagLabel = s('g', null, L);
    const tagLabelBg = s('rect', { x: 0, y: 0, width: 330, height: 30, rx: 4, fill: 'rgba(5,12,16,.78)', stroke: C.cyan, 'stroke-width': 1.2 }, tagLabel);
    const tagTxt = s('text', { x: 12, y: 21, 'font-size': 15, fill: C.cyan, 'font-weight': 600 }, tagLabel);
    // markers: error line (nadir -> pad truth), truth cross, estimate ring, off-image arrow
    const errLine = s('line', { stroke: C.yellow, 'stroke-width': 2, 'stroke-dasharray': '5 4', x1: 640, y1: 360 }, L);
    const truthMark = s('g', { stroke: C.white, 'stroke-width': 2.5 }, L);
    s('path', { d: 'M-9 -9 L9 9 M9 -9 L-9 9' }, truthMark);
    const estMark = s('g', null, L);
    s('circle', { r: 16, fill: 'none', stroke: C.cyan, 'stroke-width': 2.5 }, estMark);
    s('circle', { r: 3, fill: C.cyan }, estMark);
    const offArrow = s('g', { opacity: 0 }, L);
    s('path', { d: 'M0 0 L-18 -11 L-18 11 Z', fill: C.white, opacity: '.9' }, offArrow);
    const offTxt = s('text', { x: -28, y: 5, 'font-size': 13, 'text-anchor': 'end', fill: C.white }, offArrow, 'PAD');

    // bottom-left: error panel
    const ep = s('g', { transform: 'translate(40 500)' }, L);
    s('rect', { width: 340, height: 184, rx: 10, fill: C.panel, stroke: C.panelLine }, ep);
    const errTitle = s('text', { x: 20, y: 32, 'font-size': 14, 'letter-spacing': 2, opacity: '.75' }, ep);
    const errBig = s('text', { x: 20, y: 92, 'font-size': 56, 'font-weight': 600 }, ep);
    const errUnit = s('text', { x: 138, y: 92, 'font-size': 22, opacity: '.85' }, ep, 'cm');
    const eeG = s('g', null, ep);
    s('text', { x: 222, y: 66, 'font-size': 14, opacity: '.75' }, eeG, 'est − truth');
    const eeTxt = s('text', { x: 222, y: 90, 'font-size': 22, 'font-weight': 600, fill: C.cyan }, eeG);
    const sp = s('g', { transform: 'translate(20 108)' }, ep);
    s('rect', { width: 300, height: 56, fill: 'rgba(255,255,255,.04)' }, sp);
    const limLine = s('line', { x1: 0, x2: 300, stroke: C.limit, 'stroke-width': 1.2, 'stroke-dasharray': '4 4' }, sp);
    const limTxt = s('text', { x: 298, 'font-size': 11.5, 'text-anchor': 'end', fill: C.limitText }, sp);
    const spark = s('polyline', { fill: 'none', stroke: C.yellow, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, sp);
    s('text', { x: 0, y: 72, 'font-size': 11.5, opacity: '.6' }, sp, '−10 s');
    s('text', { x: 300, y: 72, 'font-size': 11.5, 'text-anchor': 'end', opacity: '.6' }, sp, 'now');

    // bottom-centre: confidence + telemetry
    const cp = s('g', { transform: 'translate(400 590)' }, L);
    const cpBg = s('rect', { width: 480, height: 94, rx: 10, fill: C.panel, stroke: C.panelLine }, cp);
    const confG = s('g', null, cp);
    s('text', { x: 20, y: 30, 'font-size': 14, 'letter-spacing': 2, opacity: '.75' }, confG, 'CONFIDENCE');
    const confTxt = s('text', { x: 460, y: 30, 'font-size': 18, 'font-weight': 600, 'text-anchor': 'end' }, confG);
    s('rect', { x: 20, y: 42, width: 440, height: 12, rx: 6, fill: 'rgba(255,255,255,.12)' }, confG);
    const confBar = s('rect', { x: 20, y: 42, width: 0, height: 12, rx: 6 }, confG);
    const minTick = s('line', { y1: 36, y2: 60, stroke: '#fff', 'stroke-width': 2 }, confG);
    const minTxt = s('text', { y: 34, 'font-size': 11, 'text-anchor': 'middle', opacity: '.7' }, confG);
    const telem = s('text', { x: 20, y: 82, 'font-size': 15 }, cp);

    // bottom-right: pad-centre offset inset (NED, north up, 3 px per cm)
    const ip = s('g', { transform: 'translate(900 444)' }, L);
    s('rect', { width: 340, height: 240, rx: 10, fill: C.panel, stroke: C.panelLine }, ip);
    s('text', { x: 20, y: 30, 'font-size': 14, 'letter-spacing': 2, opacity: '.75' }, ip, 'PAD-CENTRE OFFSET · NED');
    const ic = s('g', { transform: 'translate(170 126)' }, ip);
    s('circle', { r: 75, fill: 'none', stroke: C.limit, 'stroke-width': 1.4, 'stroke-dasharray': '4 4' }, ic);
    s('circle', { r: 30, fill: 'none', stroke: 'rgba(233,243,246,.35)' }, ic);
    s('path', { d: 'M-88 0 H88 M0 -88 V88', stroke: 'rgba(233,243,246,.18)' }, ic);
    const insetLim = s('text', { x: 54, y: -58, 'font-size': 11.5, fill: C.limitText }, ic);
    s('text', { x: 22, y: -24, 'font-size': 11.5, opacity: '.6' }, ic, '10');
    s('text', { x: 5, y: -78, 'font-size': 11, opacity: '.6' }, ic, 'N');
    const insetTruth = s('g', { stroke: '#fff', 'stroke-width': 2.2 }, ic);
    s('path', { d: 'M-7 -7 L7 7 M7 -7 L-7 7' }, insetTruth);
    const insetEst = s('g', null, ic);
    s('circle', { r: 7, fill: 'none', stroke: C.cyan, 'stroke-width': 2.2 }, insetEst);
    s('circle', { r: 4, fill: C.yellow }, ic);
    const leg = s('g', { transform: 'translate(20 226)', 'font-size': 12 }, ip);
    s('circle', { cx: 5, cy: -4, r: 4, fill: C.yellow }, leg); s('text', { x: 14, y: 0 }, leg, 'aircraft');
    const legEst = s('g', null, leg);
    s('circle', { cx: 94, cy: -4, r: 5, fill: 'none', stroke: C.cyan, 'stroke-width': 2 }, legEst); s('text', { x: 104, y: 0 }, legEst, 'estimate');
    const legTruth = s('g', null, leg);
    s('path', { d: 'M188 -9 l9 9 m0 -9 l-9 9', stroke: '#fff', 'stroke-width': 2 }, legTruth);
    const legTruthTxt = s('text', { x: 204, y: 0 }, legTruth, 'pad');

    // banner
    const banner = s('g', { opacity: 0 }, L);
    const bannerBg = s('rect', { x: 200, y: 132, width: 880, height: 60, rx: 8 }, banner);
    const bannerTxt = s('text', { x: 640, y: 170, 'font-size': 21, 'font-weight': 600, 'text-anchor': 'middle', 'letter-spacing': 1.2, fill: '#fff' }, banner);

    let intr = null, img = { x: 160, y: 0, w: 960, h: 720 };

    function setChips(list) {
      const key = list.map((c) => c.label).join('|');
      if (key !== chipKey) {
        chipKey = key; chips.textContent = ''; chipEls = [];
        const n = Math.max(1, list.length), gap = 8, cw = Math.min(112, (600 - gap * (n - 1)) / n), x0 = -(n * cw + (n - 1) * gap) / 2;
        list.forEach((c, k) => {
          const g = s('g', { transform: 'translate(' + f1(x0 + k * (cw + gap) + cw / 2) + ' 0)' }, chips);
          const r = s('rect', { x: f1(-cw / 2), y: -4, width: f1(cw), height: 34, rx: 6 }, g);
          const fs = Math.min(14, (cw - 12) / (0.62 * Math.max(4, c.label.length)));
          const t = s('text', { y: 18, 'font-size': f1(fs), 'font-weight': 600, 'letter-spacing': 1 }, g, c.label);
          chipEls.push({ r, t });
        });
      }
      list.forEach((c, k) => {
        const e = chipEls[k];
        set(e.r, { fill: c.active ? c.color : 'rgba(6,10,14,.6)', stroke: c.active ? c.color : 'rgba(233,243,246,.3)' });
        e.t.setAttribute('fill', c.fg);
      });
    }

    return {
      /** Camera intrinsics (PLVHud.cameraIntrinsics) and the label in the top-left corner. */
      setCamera(i) {
        intr = i;
        const a = H().imageToHud(0, 0, i), b = H().imageToHud(i.width, i.height, i);
        img = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
        set(vig, { x: f1(img.x), y: f1(img.y), width: f1(img.w), height: f1(img.h) });
        camTxt.textContent = 'CAM ↓ ' + i.width + '×' + i.height + ' · ' + Math.round(i.hfov) + '° HFOV';
      },
      /** m: hudModel; info: {t, runId, hist: [{t, err}]} */
      update(m, info) {
        if (!intr) return;
        const toHud = (p) => H().imageToHud(p.u, p.v, intr);
        tSim.textContent = 't_sim ' + info.t.toFixed(2) + ' s · run ' + (info.runId || '—');
        setChips(m.chips);
        modeTxt.textContent = 'MODE ' + (m.mode || '—');
        srcTxt.textContent = m.showEstimate ? 'estimate src = ' + (m.source || '?') + ' · truth: eval only' : 'no estimate stream in this run';
        const est = m.est;
        const searching = m.cat === 'search' && !(est && est.valid);
        show(searchG, searching);
        // tag box
        if (m.tagVisible) {
          const q = m.tagPx.map(toHud);
          tagPoly.setAttribute('points', pts(q));
          q.forEach((p, k) => set(tagCornerEls[k], { x: f1(p.x - 5), y: f1(p.y - 5) }));
          const valid = est ? est.valid : true;
          tagG.setAttribute('opacity', m.det ? 0.35 : searching || !valid ? 0.4 : 1);
          const right = Math.max(q[1].x, q[2].x), top = Math.min(q[0].y, q[1].y);
          const lx = Math.min(right + 18, img.x + img.w - 340), ly = Math.max(top - 36, 112);
          tagLabel.setAttribute('transform', 'translate(' + f1(Math.max(img.x + 8, lx)) + ' ' + f1(Math.min(ly, 560)) + ')');
          tagTxt.textContent = m.det
            ? 'tag36h11 #0 · detected' + (m.det.margin !== null ? ' · dm ' + Math.round(m.det.margin) : '')
            : 'tag36h11 #0 · 0.24 m · projected';
          tagLabelBg.setAttribute('width', f1(24 + tagTxt.textContent.length * 9.05));
          tagLabel.setAttribute('opacity', searching ? 0 : 1);
        } else { tagG.setAttribute('opacity', 0); tagLabel.setAttribute('opacity', 0); }
        if (m.det) {
          detPoly.setAttribute('points', pts(m.det.corners.map((c) => H().imageToHud(c[0], c[1], intr))));
          detPoly.setAttribute('opacity', 1);
        } else detPoly.setAttribute('opacity', 0);
        // truth / estimate markers
        const tp = m.truthPx;
        const inImg = tp && tp.inImage;
        if (inImg) {
          const p = toHud(tp);
          truthMark.setAttribute('transform', 'translate(' + f1(p.x) + ' ' + f1(p.y) + ')');
          set(errLine, { x2: f1(p.x), y2: f1(p.y) });
        }
        show(truthMark, inImg && !searching); show(errLine, inImg && !searching);
        if (tp && !inImg && tp.inFront) {
          // keep the arrow clear of the top text and the bottom panels
          const safe = { x: img.x + 36, y: 150, w: img.w - 72, h: 320 };
          const p = toHud(tp), e = edgePoint(safe, p.x, p.y, 0);
          offArrow.setAttribute('transform', 'translate(' + f1(e.x) + ' ' + f1(e.y) + ') rotate(' + f1((e.ang * 180) / Math.PI) + ')');
          offTxt.setAttribute('transform', Math.abs(e.ang) > Math.PI / 2 ? 'rotate(180) translate(56 0)' : '');
          offTxt.setAttribute('text-anchor', Math.abs(e.ang) > Math.PI / 2 ? 'start' : 'end');
          show(offArrow, true);
        } else show(offArrow, false);
        if (m.estPx && m.estPx.inImage) {
          const p = toHud(m.estPx);
          estMark.setAttribute('transform', 'translate(' + f1(p.x) + ' ' + f1(p.y) + ')');
          show(estMark, true);
        } else show(estMark, false);
        // error panel
        const L_ = m.limit, Hc = H();
        errTitle.textContent = 'HORIZONTAL ERROR · ' + (m.posSrc === 'truth' ? 'TRUTH' : 'TELEMETRY');
        const big = Hc.formatCm(m.err);
        errBig.textContent = big;
        errBig.setAttribute('fill', m.errTone === 'bad' ? C.limit : C.ink);
        errUnit.setAttribute('x', f1(20 + big.length * 33.6 + 8));
        show(eeG, m.showEstimate);
        eeTxt.textContent = m.estErr === null ? 'no est.' : Hc.formatCm(m.estErr) + ' cm';
        const ly = 56 - Math.min(L_ * 100, 32) / 32 * 56;
        set(limLine, { y1: f1(ly), y2: f1(ly) });
        set(limTxt, { y: f1(Math.max(10, ly - 3)) });
        limTxt.textContent = Math.round(L_ * 100) + ' cm pass limit';
        spark.setAttribute('points', (info.hist || []).map((h) => f1((h.t + 10) * 30) + ',' + f1(56 - Math.min(h.err * 100, 32) / 32 * 56)).join(' '));
        // confidence panel
        show(confG, m.showConfidence);
        cp.setAttribute('transform', m.showConfidence ? 'translate(400 590)' : 'translate(400 634)');
        set(cpBg, { height: m.showConfidence ? 94 : 50 });
        telem.setAttribute('y', m.showConfidence ? 82 : 32);
        if (m.showConfidence) {
          const c = Math.max(0, Math.min(1, m.confidence || 0));
          confTxt.textContent = c.toFixed(2);
          set(confBar, { width: f1(440 * c), fill: TONE[m.confTone] || TONE.bad });
          const mx = 20 + 440 * m.minConf;
          set(minTick, { x1: f1(mx), x2: f1(mx) }); set(minTxt, { x: f1(mx) });
          minTxt.textContent = 'min ' + m.minConf.toFixed(2).replace(/0$/, '');
        }
        const parts = [];
        if (m.alt !== null) parts.push('AGL ' + m.alt.toFixed(2) + ' m');
        if (m.vdown !== null) parts.push('v↓ ' + m.vdown.toFixed(2) + ' m/s');
        if (m.latency !== null) parts.push('latency ' + Math.round(m.latency * 1000) + ' ms');
        if (m.rate) parts.push(m.rate + ' Hz');
        telem.textContent = parts.join(' · ');
        // offset inset (3 px per cm, clamp at the frame)
        const place = (g, o) => {
          if (!o) { show(g, false); return; }
          let x = o.e * 300, y = -o.n * 300;
          const r = Math.hypot(x, y);
          if (r > 86) { x *= 86 / r; y *= 86 / r; }
          g.setAttribute('transform', 'translate(' + f1(x) + ' ' + f1(y) + ')');
          show(g, true);
        };
        place(insetTruth, m.offsetNE);
        place(insetEst, m.estOffsetNE);
        show(legEst, m.showEstimate);
        legTruthTxt.textContent = m.posSrc === 'truth' ? 'truth' : 'pad';
        insetLim.textContent = Math.round(L_ * 100) + ' cm';
        // banner
        if (m.banner) {
          bannerBg.setAttribute('fill', m.banner.color);
          bannerTxt.textContent = m.banner.text;
          const fs = m.banner.text.length > 62 ? 18 : 21;
          bannerTxt.setAttribute('font-size', fs);
          const w = Math.min(1000, Math.max(520, m.banner.text.length * fs * 0.62 + 70));
          set(bannerBg, { x: f1(640 - w / 2), width: f1(w) });
        }
        show(banner, !!m.banner);
      },
    };
  }

  /* ======================= PiP marks ======================= */
  function createPipOverlay(svg) {
    svg.textContent = '';
    const g = s('g', null, svg);
    const ch = s('path', { stroke: C.ink, 'stroke-width': 2, fill: 'none', opacity: '.85' }, g);
    const poly = s('polygon', { fill: 'rgba(25,230,255,.10)', stroke: C.cyan, 'stroke-width': 3, 'stroke-dasharray': '10 6' }, g);
    const truth = s('path', { stroke: '#fff', 'stroke-width': 3 }, g);
    let intr = null;
    return {
      setCamera(i) {
        intr = i;
        svg.setAttribute('viewBox', '0 0 ' + i.width + ' ' + i.height);
        const cx = i.width / 2, cy = i.height / 2, a = i.height * 0.07, b = i.height * 0.025;
        ch.setAttribute('d', 'M' + (cx - a) + ' ' + cy + ' H' + (cx - b) + ' M' + (cx + b) + ' ' + cy + ' H' + (cx + a) + ' M' + cx + ' ' + (cy - a) + ' V' + (cy - b) + ' M' + cx + ' ' + (cy + b) + ' V' + (cy + a));
      },
      update(m) {
        if (!intr) return;
        if (m && m.tagVisible) {
          poly.setAttribute('points', m.tagPx.map((p) => f1(p.u) + ',' + f1(p.v)).join(' '));
          show(poly, true);
        } else show(poly, false);
        if (m && m.truthPx && m.truthPx.inImage) {
          const x = m.truthPx.u, y = m.truthPx.v, k = 10;
          truth.setAttribute('d', 'M' + f1(x - k) + ' ' + f1(y - k) + ' L' + f1(x + k) + ' ' + f1(y + k) + ' M' + f1(x + k) + ' ' + f1(y - k) + ' L' + f1(x - k) + ' ' + f1(y + k));
          show(truth, true);
        } else show(truth, false);
      },
    };
  }

  /* ======================= cinematic overlay ======================= */
  function div(cls, parent, text) {
    const e = document.createElement('div');
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function createCineOverlay(el) {
    el.textContent = '';
    const barT = div('c-bar c-bar-t', el), barB = div('c-bar c-bar-b', el);
    const brand = div('c-brand', el);
    div('c-brand-a', brand, 'PRECISION LANDING LAB');
    div('c-brand-b', brand, 'SIMULATION');
    const tele = div('c-tele', el);
    const teleChip = div('c-chip', tele);
    const teleAlt = div('c-alt', tele);
    const third = (id) => {
      const w = div('c-third', el); w.dataset.kind = id;
      const bar = div('c-accent', w);
      const body = div('c-body', w);
      return { w, bar, ey: div('c-ey', body), tt: div('c-tt', body), sb: div('c-sb', body) };
    };
    const thirds = { title: third('title'), run: third('run'), result: third('result') };
    const outro = div('c-outro', el);
    const oc = div('c-card', outro);
    const oEy = div('c-ey', oc), oTt = div('c-tt', oc), oVer = div('c-verdict', oc), oGrid = div('c-grid', oc), oFoot = div('c-foot', oc);

    return {
      /** content: {title, run, result: {ey, tt, sb, tone}}, outro: {ey, tt, verdict, tone, rows: [{k, v}], foot} */
      setContent(c) {
        for (const k of ['title', 'run', 'result']) {
          const t = thirds[k], v = c[k] || {};
          t.ey.textContent = v.ey || ''; t.tt.textContent = v.tt || ''; t.sb.textContent = v.sb || '';
          t.bar.style.background = v.tone || '#19e6ff';
        }
        const o = c.outro || {};
        oEy.textContent = o.ey || ''; oTt.textContent = o.tt || '';
        oVer.textContent = o.verdict || ''; oVer.style.background = o.tone || '#555';
        oGrid.textContent = '';
        (o.rows || []).forEach((r) => { const d = div('c-kv', oGrid); div('c-k', d, r.k); div('c-v', d, r.v); });
        oFoot.textContent = o.foot || '';
      },
      /** bars: letterbox bar height in px. */
      setBars(h) { barT.style.height = barB.style.height = Math.max(0, h) + 'px'; el.style.setProperty('--lb', Math.max(0, h) + 'px'); },
      /** d: PLVCine.cineAt result; t: {label, color, fg, alt} */
      update(d, t) {
        for (const k in thirds) {
          const a = d.thirds[k] || 0, w = thirds[k].w;
          w.style.opacity = a.toFixed(3);
          w.style.transform = 'translateX(' + ((1 - a) * -28).toFixed(1) + 'px)';
        }
        const intro = d.phase === 'establish' || d.phase === 'flyin';
        brand.style.opacity = d.outro > 0 ? '0' : '1';
        tele.style.opacity = intro || d.outro > 0 ? '0' : '1';
        if (t) {
          teleChip.textContent = t.label || '';
          teleChip.style.background = t.color || '#555';
          teleChip.style.color = t.fg || '#fff';
          teleAlt.textContent = t.alt;
        }
        outro.style.opacity = d.outro.toFixed(3);
        outro.style.visibility = d.outro > 0 ? 'visible' : 'hidden';
        oc.style.transform = 'translateY(' + ((1 - d.outro) * 14).toFixed(1) + 'px)';
      },
    };
  }

  root.PLVPresent = { createM3Hud, createPipOverlay, createCineOverlay, edgePoint };
})(typeof globalThis !== 'undefined' ? globalThis : this);
