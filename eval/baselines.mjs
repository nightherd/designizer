// Competitor baselines, run on a page the eval runner already loaded. Both return { score, fired }.
//
// slopcop: github.com/AdrianKrebs/design-slop-cop, MIT, commit e2fab6c (2026-07-07). Not on npm.
//   Their src/ is fetched once into .cache/ and imported: buildDetectorSource() makes the in-page
//   script, scoreReport() scores its signals in Node. score = their 0-100 = round(100 * fired / 14).
//   Their tiers: 0 None, 1-2 Low (counted as a pass), 3-4 Medium (score >= 21), 5+ High (score >= 36).
//
// impeccable: github.com/pbakaus/impeccable, Apache-2.0, tag engine-v0.1.12 = commit 83dc4b6 (2026-10-07).
//   The npm 4.x package ships only a native-binary shim, so the in-page bundle
//   (crates/live/assets/detect-antipatterns-browser.js, rules compiled to WASM) is fetched into .cache/
//   and window.impeccableDetect() is called: deterministic rules only, without the CLI URL engine's
//   screenshot contrast pass and hidden-content sweep. No single score, so score = distinct primary
//   (non-advisory) rule ids; their CLI fails a page (exit 2) on any primary finding, i.e. score >= 1.
//   fired also lists advisory ids. Strict-CSP pages without 'wasm-unsafe-eval' need bypassCSP: true.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const CACHE = new URL('../.cache/', import.meta.url);

async function cached(path, url) {
  const file = new URL(path, CACHE);
  if (!existsSync(file)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const body = await res.text();
    await mkdir(new URL('.', file), { recursive: true });
    await writeFile(file, body);
  }
  return file;
}

const SC_DIR = 'design-slop-cop@e2fab6c/';
const SC_URL = 'https://raw.githubusercontent.com/AdrianKrebs/design-slop-cop/e2fab6ce71ac5aef06663205d245a5b7ed96da75/';
const SC_FILES = [
  'detector', 'score', 'lib/color', 'lib/visibility', 'lib/emoji', 'lib/slop-fonts', 'patterns/index',
  ...['accent-stripe', 'centered-hero', 'colored-glows', 'faq-accordion', 'glassmorphism', 'gradients',
    'hero-eyebrow-pill', 'hero-font-mix', 'numbered-steps', 'perma-dark-mode', 'purple-accent',
    'sidebar-emoji', 'slop-fonts', 'stat-banner'].map(p => `patterns/${p}`),
].map(f => `src/${f}.js`);

let sc;
async function loadSlopcop() {
  await Promise.all(SC_FILES.map(f => cached(SC_DIR + f, SC_URL + f)));
  const { buildDetectorSource } = await import(new URL(SC_DIR + 'src/detector.js', CACHE));
  const { scoreReport } = await import(new URL(SC_DIR + 'src/score.js', CACHE));
  return { source: buildDetectorSource(), scoreReport };
}

export async function slopcop(page) {
  const { source, scoreReport } = await (sc ??= loadSlopcop());
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); // their harness scans from the top; hero patterns read rects
  const r = scoreReport(await page.evaluate(source));
  return { score: r.score, fired: r.patterns.filter(p => p.triggered).map(p => p.id) };
}

const IMP_URL = 'https://raw.githubusercontent.com/pbakaus/impeccable/83dc4b60ca4c3a13ea3cde748804858d37ef47c9/crates/live/assets/detect-antipatterns-browser.js';
let imp;

export async function impeccable(page) {
  const source = await (imp ??= cached('impeccable@engine-v0.1.12/detect-antipatterns-browser.js', IMP_URL)
    .then(f => readFile(f, 'utf8')));
  if (!(await page.evaluate(() => !!window.impeccableDetect))) {
    await page.evaluate(() => { window.__IMPECCABLE_CONFIG__ = { autoScan: false }; }); // no overlays
    await page.evaluate(source);
  }
  const groups = await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (window.__impeccableCoreError) throw new Error(window.__impeccableCoreError);
    const out = window.impeccableDetect();
    // The bundle adds one <style> for its overlay UI; drop it so the next detector sees the page as loaded.
    for (const s of document.querySelectorAll('style')) if (s.textContent.includes('.impeccable-overlay')) s.remove();
    return out;
  });
  const findings = groups.flatMap(g => g.findings);
  const primary = new Set(findings.filter(f => !f.advisory).map(f => f.type));
  return { score: primary.size, fired: [...new Set(findings.map(f => f.type))] };
}
