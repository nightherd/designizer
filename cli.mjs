#!/usr/bin/env node
// designizer CLI (Chrome via playwright-core).
//   node cli.mjs scan <url|file> [--overlay out.jpg] [--only id,id] [--config .designizer.json]
//   node cli.mjs eval [--split dev|test|test-b|all] [--baselines] [--write] [--report-only]
//   node cli.mjs examples            screenshot one overlay per pattern from the AI pages into examples/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DETECTOR = readFileSync(join(ROOT, 'detector.js'), 'utf8');
const RESULTS = join(ROOT, 'eval/results.json');
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, dflt) => { const i = rest.indexOf(`--${name}`); return i < 0 ? dflt : rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[i + 1]; };
const read = f => JSON.parse(readFileSync(f, 'utf8'));

async function open(browser, target) {
  const url = existsSync(target) ? pathToFileURL(resolve(target)).href : target;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', bypassCSP: true });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  // Scroll through once so lazy content and scroll-reveal states exist, then measure from the top.
  await page.evaluate(async () => {
    for (let y = 0, i = 0; y < document.documentElement.scrollHeight && i < 40; y += innerHeight * 0.8, i++) {
      scrollTo({ top: y, behavior: 'instant' });
      await new Promise(r => setTimeout(r, 250));
    }
    scrollTo({ top: 0, behavior: 'instant' });
    await document.fonts.ready;
    await new Promise(r => setTimeout(r, 600));
  });
  await page.evaluate(DETECTOR);
  return { page, close: () => context.close() };
}

const scanPage = (page, opts = {}) => page.evaluate(o => window.designizer.scan(o), opts);

async function scan() {
  const target = rest.find(a => !a.startsWith('--') && a !== flag('overlay') && a !== flag('only') && a !== flag('config'));
  if (!target) throw new Error('usage: node cli.mjs scan <url|file> [--overlay out.jpg] [--only id,id]');
  const cfgPath = flag('config', existsSync('.designizer.json') ? '.designizer.json' : null);
  const opts = cfgPath ? read(cfgPath) : {};
  const browser = await chromium.launch({ channel: 'chrome' });
  const { page, close } = await open(browser, target);
  const report = await scanPage(page, opts);
  if (flag('overlay')) await shoot(page, flag('overlay'), flag('only') ? String(flag('only')).split(',') : undefined);
  console.log(JSON.stringify(report, null, 2));
  await close();
  await browser.close();
}

// Overlay screenshot: the whole page, or a crop around the first hits when --only is given.
async function shoot(page, file, only) {
  await page.evaluate(ids => window.designizer.overlay(ids), only);
  if (!only) return page.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 72 });
  const box = await page.evaluate(ids => {
    const rs = [...document.querySelectorAll('[data-designizer] > div')].slice(0, 3).map(d => d.getBoundingClientRect());
    if (!rs.length) return null;
    const x0 = Math.min(...rs.map(r => r.left)) + scrollX, y0 = Math.min(...rs.map(r => r.top)) + scrollY - 24;
    const x1 = Math.max(...rs.map(r => r.right)) + scrollX, y1 = Math.max(...rs.map(r => r.bottom)) + scrollY;
    const w = Math.max(x1 - x0 + 120, 900), h = Math.max(y1 - y0 + 120, 420);
    const x = Math.max(0, Math.min(x0 - 60, innerWidth - w)), y = Math.max(0, y0 - 60);
    return { x, y, width: Math.min(w, innerWidth - x), height: Math.min(h, 1400, document.documentElement.scrollHeight - y) };
  }, only);
  return box && page.screenshot({ path: file, clip: box, fullPage: true, type: 'jpeg', quality: 72 });
}

function sets(split) {
  const ai = read(join(ROOT, 'eval/ai.json')).map(e => ({ id: e.id, label: 'ai', split: e.split, variant: e.variant, target: join(ROOT, 'eval', e.file) }));
  const human = read(join(ROOT, 'eval/human.json')).map(e => ({ id: e.id, label: 'human', split: e.split, target: e.url, hard: e.hard }));
  return [...ai, ...human].filter(e => split === 'all' || split.split(',').includes(e.split));
}

async function evaluate() {
  const split = flag('split', 'test');
  if (flag('report-only')) return finish(read(RESULTS), split);
  const items = sets(split);
  const baselines = flag('baselines') ? await import('./eval/baselines.mjs') : null;
  const browser = await chromium.launch({ channel: 'chrome' });
  const old = existsSync(RESULTS) ? read(RESULTS) : {};
  const queue = [...items];
  const out = {};
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let e; (e = queue.shift()); ) {
      let page, close;
      try {
        ({ page, close } = await open(browser, e.target));
        const r = await scanPage(page);
        const row = { label: e.label, split: e.split, variant: e.variant, score: r.score, verdict: r.verdict, fired: r.fired.map(f => f.id), strength: Object.fromEntries(r.fired.map(f => [f.id, f.strength])), url: e.label === 'human' ? e.target : undefined, scanned: new Date().toISOString().slice(0, 10) };
        if (baselines) {
          row.baselines = {};
          for (const [name, fn] of Object.entries(baselines)) {
            if (typeof fn !== 'function') continue;
            try { row.baselines[name] = await fn(page); } catch (err) { row.baselines[name] = { error: String(err.message).slice(0, 120) }; }
          }
        } else if (old[e.id]?.baselines) row.baselines = old[e.id].baselines;
        out[e.id] = row;
        process.stderr.write(`${e.id.padEnd(6)} ${e.label.padEnd(5)} score ${String(r.score).padStart(2)} ${r.verdict === (e.label) ? 'ok ' : 'MISS'} ${row.fired.join(' ')}\n`);
      } catch (err) {
        process.stderr.write(`${e.id} failed: ${err.message.split('\n')[0]}\n`);
      } finally {
        await close?.();
      }
    }
  }));
  await browser.close();
  const merged = Object.fromEntries(Object.entries({ ...old, ...out }).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(RESULTS, JSON.stringify(merged, null, 2) + '\n');
  finish(merged, split);
}

function finish(merged, split) {
  const table = report(merged, split);
  console.log(table.text);
  if (flag('write')) {
    const alt = charts(table, split);
    const pic = (name, text) => `<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="eval/charts/${name}-dark.svg">\n  <img alt="${text}" src="eval/charts/${name}-light.svg">\n</picture>`;
    const block = [pic('results', alt.results), '', table.md, '', pic('patterns', alt.patterns)].join('\n');
    const readme = join(ROOT, 'README.md');
    const src = readFileSync(readme, 'utf8');
    writeFileSync(readme, src.replace(/<!-- eval -->[\s\S]*<!-- \/eval -->/, `<!-- eval -->\n${block}\n<!-- /eval -->`));
  }
  if (/test/.test(split) && !table.pass) process.exitCode = 1;
}

// Accuracy and false alarms for designizer and for each baseline. Baseline thresholds are tuned on the dev split,
// the same way designizer's threshold was, then applied unchanged to the split being reported.
function report(results, split) {
  const rows = Object.entries(results).filter(([, r]) => split === 'all' || split.split(',').includes(r.split));
  // Development data: dev for the first test run; dev + test once test had been seen (v2), for every tool alike.
  const devSplits = split === 'test-b' ? ['dev', 'test'] : ['dev'];
  const dev = Object.values(results).filter(r => devSplits.includes(r.split));
  const stats = (rs, isAi) => {
    const ai = rs.filter(r => r.label === 'ai'), hu = rs.filter(r => r.label === 'human');
    const tp = ai.filter(isAi).length, fp = hu.filter(isAi).length;
    return { n: rs.length, acc: (tp + hu.length - fp) / (rs.length || 1), tp, ai: ai.length, fp, hu: hu.length };
  };
  const tools = [{ name: 'designizer', isAi: r => r.verdict === 'ai', note: 'threshold in detector.js' }];
  const names = [...new Set(rows.flatMap(([, r]) => Object.keys(r.baselines || {})))];
  for (const name of names) {
    const score = r => r.baselines?.[name]?.score;
    const cands = [...new Set(dev.map(score).filter(v => typeof v === 'number'))].sort((a, b) => a - b);
    let best = { t: Infinity, acc: -1 };
    for (const t of cands) { const s = stats(dev.filter(r => typeof score(r) === 'number'), r => score(r) >= t); if (s.acc > best.acc) best = { t, acc: s.acc }; }
    tools.push({ name, isAi: r => typeof score(r) === 'number' && score(r) >= best.t, note: `score ≥ ${best.t} (tuned on ${devSplits.join(' + ')})` });
  }
  const md = ['| Tool | Accuracy | AI pages caught | Human pages flagged as AI | Verdict rule |', '|---|---|---|---|---|'];
  let text = `\n${split} split, ${rows.length} pages\n`;
  let pass = false;
  const toolStats = [];
  for (const t of tools) {
    const s = stats(rows.map(([, r]) => r), t.isAi);
    toolStats.push({ name: t.name, ...s });
    if (t.name === 'designizer') pass = s.acc >= 0.8 && s.fp <= 3;
    md.push(`| ${t.name === 'slopcop' ? 'design-slop-cop' : t.name} | ${(s.acc * 100).toFixed(0)}% | ${s.tp} / ${s.ai} | ${s.fp} / ${s.hu} | ${t.note} |`);
    text += `${t.name.padEnd(12)} accuracy ${(s.acc * 100).toFixed(1)}%  caught ${s.tp}/${s.ai}  false alarms ${s.fp}/${s.hu}  (${t.note})\n`;
  }
  const variants = ['plain', 'less-ai', 'skill'].map(v => {
    const vs = rows.filter(([, r]) => r.variant === v);
    return { v, caught: vs.filter(([, r]) => r.verdict === 'ai').length, n: vs.length };
  });
  text += '\nby prompt variant: ' + variants.map(x => `${x.v} ${x.caught}/${x.n}`).join(', ') + '\n';
  const per = new Map();
  for (const [, r] of rows) for (const id of r.fired) { const p = per.get(id) || { ai: 0, human: 0 }; p[r.label]++; per.set(id, p); }
  text += '\npattern            ai  human\n' + [...per].sort((a, b) => b[1].ai - a[1].ai).map(([id, p]) => `${id.padEnd(18)} ${String(p.ai).padStart(3)} ${String(p.human).padStart(6)}`).join('\n');
  const misses = rows.filter(([, r]) => (r.verdict === 'ai') !== (r.label === 'ai')).map(([id, r]) => `${id} (${r.label}, score ${r.score})`);
  text += `\n\nmisses: ${misses.join(', ') || 'none'}\n${pass ? 'PASS' : 'BELOW TARGET'} (target: accuracy ≥ 80%, ≤ 3 human pages flagged)`;
  return { text, md: md.join('\n'), pass, toolStats, per };
}

// Butterfly charts for the README, one SVG per GitHub theme: human pages grow left, AI pages grow right.
const THEMES = {
  light: { text: '#1f2328', muted: '#59636e', rule: '#d1d9e0', ai: '#2a78d6', human: '#eb6834' },
  dark: { text: '#f0f6fc', muted: '#9198a1', rule: '#3d444d', ai: '#3987e5', human: '#d95926' },
};
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

function butterfly(rows, o, c) {
  const W = 760, top = 44, gap = 34, side = (W - o.labelW) / 2 - gap;
  const x0 = gap + side, x1 = x0 + o.labelW, h = o.barH, r = 4;
  const len = v => (v / o.max) * side;
  const bar = (x, y, w, dir, fill) => w <= 0 ? '' : (() => {
    const k = Math.min(r, w / 2), e = x + dir * w;
    return `<path fill="${fill}" d="M${x} ${y}H${e - dir * k}Q${e} ${y} ${e} ${y + k}V${y + h - k}Q${e} ${y + h} ${e - dir * k} ${y + h}H${x}Z"/>`;
  })();
  const H = top + rows.length * o.rowH + (o.note ? 30 : 8);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family='${FONT}' font-size="12">`];
  out.push(`<rect x="${x0 - 14}" y="12" width="10" height="10" rx="2" fill="${c.human}"/><text x="${x0 - 20}" y="21" text-anchor="end" fill="${c.text}" font-weight="600">${o.left}</text>`);
  out.push(`<rect x="${x1 + 4}" y="12" width="10" height="10" rx="2" fill="${c.ai}"/><text x="${x1 + 20}" y="21" fill="${c.text}" font-weight="600">${o.right}</text>`);
  out.push(`<path stroke="${c.rule}" d="M${x0} ${top - 6}V${top + rows.length * o.rowH}M${x1} ${top - 6}V${top + rows.length * o.rowH}"/>`);
  rows.forEach((row, i) => {
    const y = top + i * o.rowH + (o.rowH - h) / 2, mid = y + h / 2 + 4;
    out.push(bar(x0, y, len(row.human), -1, c.human), bar(x1, y, len(row.ai), 1, c.ai));
    out.push(`<text x="${x0 - len(row.human) - 6}" y="${mid}" text-anchor="end" fill="${c.muted}">${row.human}</text>`);
    out.push(`<text x="${x1 + len(row.ai) + 6}" y="${mid}" fill="${c.muted}">${row.ai}</text>`);
    out.push(`<text x="${(x0 + x1) / 2}" y="${mid}" text-anchor="middle" fill="${row.dim ? c.muted : c.text}"${row.bold ? ' font-weight="600"' : ''}>${row.label}</text>`);
  });
  if (o.note) out.push(`<text x="${W / 2}" y="${H - 10}" text-anchor="middle" fill="${c.muted}">${o.note}</text>`);
  return out.join('') + '</svg>\n';
}

function charts({ toolStats, per }, split) {
  const NAMES = { slopcop: 'design-slop-cop' };
  const unscored = new Set([...DETECTOR.matchAll(/'?([\w-]+)'?: \{ n: \d+, w: '\w+', scored: false/g)].map(m => m[1]));
  const tools = toolStats.map(t => ({ label: NAMES[t.name] || t.name, ai: t.tp, human: t.fp, bold: t.name === 'designizer' }));
  const pats = [...per].map(([id, p]) => ({ label: id, ai: p.ai, human: p.human, dim: unscored.has(id) }))
    .sort((a, b) => b.ai - a.ai || a.human - b.human);
  const n = toolStats[0];
  mkdirSync(join(ROOT, 'eval/charts'), { recursive: true });
  for (const [theme, c] of Object.entries(THEMES)) {
    writeFileSync(join(ROOT, `eval/charts/results-${theme}.svg`), butterfly(tools,
      { labelW: 140, rowH: 34, barH: 18, max: n.ai, left: `Human sites flagged as AI (of ${n.hu})`, right: `AI pages caught (of ${n.ai})` }, c));
    writeFileSync(join(ROOT, `eval/charts/patterns-${theme}.svg`), butterfly(pats,
      { labelW: 150, rowH: 20, barH: 12, max: Math.max(...pats.flatMap(p => [p.ai, p.human])),
        left: `Human sites it fired on (of ${n.hu})`, right: `AI pages it fired on (of ${n.ai})`,
        note: 'Grey names are reported but not counted toward the page verdict.' }, c));
  }
  return {
    results: `${split}: ` + tools.map(t => `${t.label} caught ${t.ai} of ${n.ai} AI pages and flagged ${t.human} of ${n.hu} human sites`).join('; '),
    patterns: `How often each pattern fired on ${split}, AI pages vs human sites: ` + pats.map(p => `${p.label} ${p.ai}/${p.human}`).join(', '),
  };
}

async function examples() {
  const results = read(RESULTS);
  const ai = read(join(ROOT, 'eval/ai.json'));
  const patterns = await (async () => {
    const browser = await chromium.launch({ channel: 'chrome' });
    const p = await (await browser.newContext()).newPage();
    await p.evaluate(DETECTOR);
    const v = await p.evaluate(() => window.designizer.PATTERNS);
    await browser.close();
    return v;
  })();
  mkdirSync(join(ROOT, 'examples'), { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const index = [];
  for (const [id, p] of Object.entries(patterns)) {
    const e = ai.find(e => results[e.id]?.fired.includes(id));
    if (!e) { index.push({ id, n: p.n, file: null }); console.log(`${id}: no AI page shows it`); continue; }
    const { page, close } = await open(browser, join(ROOT, 'eval', e.file));
    await scanPage(page);
    const file = `examples/${String(p.n).padStart(2, '0')}-${id}.jpg`;
    await shoot(page, join(ROOT, file), [id]);
    await close();
    index.push({ id, n: p.n, file, page: e.id });
    console.log(`${id}: ${file} from ${e.id}`);
  }
  // Hero image for the README: the top of the highest-scoring dev page with every outline on.
  const top = ai.filter(e => e.split === 'dev' && results[e.id]).sort((a, b) => results[b.id].score - results[a.id].score)[0];
  const { page, close } = await open(browser, join(ROOT, 'eval', top.file));
  await scanPage(page);
  await page.evaluate(() => window.designizer.overlay());
  await page.screenshot({ path: join(ROOT, 'examples/overview.jpg'), clip: { x: 0, y: 0, width: 1440, height: 1000 }, type: 'jpeg', quality: 72 });
  await close();
  await browser.close();
  writeFileSync(join(ROOT, 'examples/index.json'), JSON.stringify(index, null, 2) + '\n');
  // Pattern table for the README, straight from the detector so the two can't drift apart.
  const model = { 34: 'Invented testimonials and numbers', 36: 'Template copy' };
  const rows = [...index.map(x => ({ ...x, p: patterns[x.id] })), ...Object.entries(model).map(([n, name]) => ({ n: +n, name }))]
    .sort((a, b) => a.n - b.n)
    .map(x => x.p
      ? `| ${x.n} | ${x.p.name} | \`${x.id}\` | ${x.p.w} | ${x.p.scored === false ? 'no' : 'yes'} | ${x.file ? `[${x.page}](${x.file})` : '–'} |`
      : `| ${x.n} | ${x.name} | model only | strong / medium | – | – |`);
  const table = ['| # | Pattern | Id | Strength | Counts toward verdict | Example |', '|---|---|---|---|---|---|', ...rows].join('\n');
  const readme = join(ROOT, 'README.md');
  writeFileSync(readme, readFileSync(readme, 'utf8').replace(/<!-- patterns -->[\s\S]*<!-- \/patterns -->/, `<!-- patterns -->\n${table}\n<!-- /patterns -->`));
}

const commands = { scan, eval: evaluate, examples };
if (!commands[cmd]) {
  console.error('usage: node cli.mjs scan <url|file> | eval [--split dev|test|all] [--baselines] [--write] | examples');
  process.exit(2);
}
await commands[cmd]();
