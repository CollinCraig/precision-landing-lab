// Run: node --test viewer/tests/
// One design language: the lab core colour tokens are the same on all surfaces
// (viewer/, learn/, design/) and the text tokens pass WCAG 2.1 AA on the lab surfaces.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../app.js');

const ROOT = path.join(__dirname, '..', '..');
const SURFACES = [
  'viewer/style.css',
  'learn/index.html',
  'learn/01-how-a-drone-flies.html',
  'learn/02-frames-ned-body-camera.html',
  'learn/03-precision-landing-big-picture.html',
  'design/site-hub.html',
  'design/vertiport-concept.html',
];
// Tokens that every surface must define with these values.
const CORE = {
  light: { bg: '#f3f1eb', panel: '#fbfaf6', 'panel-2': '#f1eee6', ink: '#1a1e23', 'ink-2': '#4b535c', 'ink-3': '#626a73', rule: '#d8d4ca', accent: '#2a5bd7' },
  dark: { bg: '#0d1115', panel: '#141a20', 'panel-2': '#1a2129', ink: '#e7eaed', 'ink-2': '#a9b1ba', 'ink-3': '#8a949e', rule: '#26303a', accent: '#7d9dff' },
};
// Text tokens that a surface can define; if it does, the value must be this one.
const STATUS = {
  light: { ok: '#1a7a3e', warn: '#946000', bad: '#c2352a' },
  dark: { ok: '#46c779', warn: '#e3a33a', bad: '#ff6b5e' },
};

/** Body of the first CSS block that starts with the given selector text. */
function block(css, selector) {
  const i = css.indexOf(selector + '{');
  assert.notEqual(i, -1, 'missing block ' + selector);
  const j = css.indexOf('}', i);
  return css.slice(i + selector.length + 1, j);
}
function tokens(body) {
  const out = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function load(rel) {
  const css = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return {
    light: tokens(block(css, ':root')),
    dark: tokens(block(css, ':root[data-theme="dark"]')),
    darkAuto: tokens(block(css, ':root:not([data-theme="light"])')),
  };
}

for (const rel of SURFACES) {
  test('core tokens are the lab values: ' + rel, () => {
    const t = load(rel);
    for (const theme of ['light', 'dark']) {
      for (const [k, v] of Object.entries(CORE[theme])) assert.equal(t[theme][k], v, theme + ' --' + k);
      for (const [k, v] of Object.entries(STATUS[theme])) if (t[theme][k] !== undefined) assert.equal(t[theme][k], v, theme + ' --' + k);
    }
    assert.deepEqual(t.darkAuto, t.dark, 'the automatic dark block and the manual dark block must agree');
  });
}

test('text tokens pass WCAG AA (4.5:1) on the lab surfaces', () => {
  for (const theme of ['light', 'dark']) {
    const c = CORE[theme];
    for (const surface of [c.bg, c.panel, c['panel-2']]) {
      for (const k of ['ink', 'ink-2', 'ink-3', 'accent']) {
        assert.ok(P.contrastRatio(c[k], surface) >= 4.5, theme + ' --' + k + ' on ' + surface + ' = ' + P.contrastRatio(c[k], surface).toFixed(2));
      }
      for (const [k, v] of Object.entries(STATUS[theme])) {
        assert.ok(P.contrastRatio(v, surface) >= 4.5, theme + ' --' + k + ' on ' + surface + ' = ' + P.contrastRatio(v, surface).toFixed(2));
      }
    }
  }
});

test('viewer text colours pass AA on the page and panel backgrounds', () => {
  const t = load('viewer/style.css');
  for (const theme of ['light', 'dark']) {
    const v = { ...t.light, ...t[theme] }; // dark overrides light
    for (const k of ['cyan', 'bad']) {
      for (const surface of [v.bg, v.panel]) {
        assert.ok(P.contrastRatio(v[k], surface) >= 4.5, theme + ' --' + k + ' on ' + surface + ' = ' + P.contrastRatio(v[k], surface).toFixed(2));
      }
    }
    // state fills carry a label in the text colour that readableOn selects
    for (const k of ['vblue', 'cyan', 'tdpc', 'lit', 'landed', 'amber', 'red', 'ink-3']) {
      assert.ok(P.contrastRatio(v[k], P.readableOn(v[k])) >= 4.5, theme + ' label on --' + k);
    }
  }
});

test('every surface is a complete document with one theme storage key', () => {
  for (const rel of SURFACES.filter((f) => f.endsWith('.html')).concat('viewer/index.html')) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(html, /^<!doctype html>/i, rel + ': doctype');
    assert.match(html, /<html lang="en">/, rel + ': lang');
    assert.match(html, /<meta charset="utf-8">/, rel + ': charset');
    assert.match(html, /<meta name="viewport"/, rel + ': viewport');
    assert.match(html, /<main[\s>]/, rel + ': main landmark');
    assert.doesNotMatch(html, /◐/, rel + ': theme glyph that IBM Plex does not have');
  }
  const keyUsers = SURFACES.filter((f) => f.endsWith('.html')).concat('viewer/app.js');
  for (const rel of keyUsers) {
    assert.match(fs.readFileSync(path.join(ROOT, rel), 'utf8'), /'pll-theme'/, rel + ': shared theme key');
  }
});
