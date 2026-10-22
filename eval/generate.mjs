// Builds the AI half of the eval set with Claude Code (`claude -p`, runs on a subscription).
// Every page is made in a fresh temp dir with user settings off, so no personal CLAUDE.md, hooks or plugins leak in.
// Usage: node eval/generate.mjs [count]   (skips pages that already exist)
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(ROOT, 'ai.json');
const SKILL_URL =
  'https://raw.githubusercontent.com/anthropics/skills/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design/SKILL.md';

const PRODUCTS = [
  'a B2B invoicing SaaS for freelancers',
  'a specialty coffee roaster that sells subscriptions',
  'a family dental clinic in Denver',
  'a cybersecurity startup that monitors leaked credentials',
  'a yoga studio in Lisbon',
  'a boutique law firm that works with startups',
  'an after-school coding club for kids',
  'a wedding photographer based in Tuscany',
  'a fresh dog food subscription',
  'a network of EV fast-charging stations',
  'an AI meeting note-taker app',
  'a craft brewery with a taproom',
  'a real estate agency for city apartments',
  'a bike repair and service shop',
  'a small architecture practice',
  'a three-day electronic music festival',
  'an online plant nursery',
  'a Spanish language school',
  'an HR and payroll platform for small businesses',
  'a mental health journaling app',
  'a boutique hotel in Kyoto',
  'an artisan sourdough bakery',
  'a personal budgeting app',
  'an open-source time-series database',
  'a self-custody crypto wallet',
  'a Scandinavian furniture brand',
  'a podcast hosting platform',
  'a bouldering gym',
  'a veterinary clinic',
  'a residential solar installer',
  'a translation agency',
  'a ceramics studio that runs pottery classes',
  'a freight forwarding company',
  'a command-line tool for managing database migrations',
  'a food bank nonprofit',
  'a museum exhibition about the history of maps',
  'a tech recruitment agency',
  'a clean skincare brand',
  'a travel agency for small-group tours in Japan',
  'an accounting firm for e-commerce sellers',
  // Added after the first test run, as a fresh held-out split (test-b).
  'a project management tool for construction crews',
  'a vintage watch dealer',
  'a pediatric physiotherapy clinic',
  'a password manager for families',
  'a surf school in Portugal',
  'an employment law practice',
  'a robotics summer camp for teenagers',
  'a documentary film production company',
  'a cat litter subscription',
  'a bike-sharing service for a mid-sized city',
  'an AI customer-support chatbot platform',
  'a natural wine bar',
  'a property management company for landlords',
  'a mobile tire fitting service',
  'a landscape architecture studio',
  'a jazz club with live music every night',
  'a seed library and gardening co-op',
  'an online piano course',
  'an applicant tracking system for startups',
  'a sleep tracking app',
  'a mountain hut in the Dolomites',
  'a gluten-free bakery',
  'an invoice financing fintech',
  'an open-source feature-flag service',
  'a hardware wallet for Bitcoin',
  'a handmade leather goods brand',
  'a newsletter platform for independent writers',
  'a trampoline park',
  'an equine veterinary practice',
  'a home battery installer',
];
const MODELS = ['opus', 'sonnet', 'haiku'];
const TAIL = 'Put everything in a single index.html in the current directory (CDN links are fine).';
const VARIANTS = {
  plain: p => `Build a landing page for ${p}. ${TAIL}`,
  'less-ai': p => `Build a landing page for ${p}. Make it look less AI-generated, not like a generic AI template. ${TAIL}`,
  skill: p => `Use the frontend-design skill to build a landing page for ${p}. ${TAIL}`,
};

// Every model meets every variant once per 9 pages; every 4th of the first 40 goes to the dev (tuning) split,
// pages 41-70 form test-b, generated after the first test run and never used for tuning.
const plan = PRODUCTS.map((product, i) => {
  const variant = Object.keys(VARIANTS)[Math.floor(i / 3) % 3];
  return {
    id: `ai-${String(i + 1).padStart(2, '0')}`,
    split: i >= 40 ? 'test-b' : i % 4 === 3 ? 'dev' : 'test',
    model: MODELS[i % 3],
    variant,
    product,
    prompt: VARIANTS[variant](product),
  };
});

// Outside the eval: prompts that call up the first-wave look, so every pattern has an example screenshot.
const EXAMPLES = [
  'an AI writing assistant, with a dark futuristic look',
  'a crypto trading terminal for day traders',
  'a developer API for sending emails, with a code sample in the hero',
  'a Web3 NFT marketplace',
  'a late-night techno club, near-black with a single acid-green accent',
];
plan.push(...EXAMPLES.map((product, i) => ({
  id: `ex-${String(i + 1).padStart(2, '0')}`, split: 'examples', model: ['sonnet', 'haiku'][i % 2], variant: 'plain', product,
  prompt: VARIANTS.plain(product),
})));

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : [];
const done = new Set(manifest.map(e => e.id));
const todo = plan.filter(e => !done.has(e.id)).slice(0, Number(process.argv[2]) || Infinity);
const skill = todo.some(e => e.variant === 'skill') ? await (await fetch(SKILL_URL)).text() : '';

function run(entry) {
  const dir = mkdtempSync(join(tmpdir(), `designizer-${entry.id}-`));
  if (entry.variant === 'skill') {
    mkdirSync(join(dir, '.claude/skills/frontend-design'), { recursive: true });
    writeFileSync(join(dir, '.claude/skills/frontend-design/SKILL.md'), skill);
  }
  const args = ['-p', entry.prompt, '--model', entry.model, '--output-format', 'json', '--setting-sources', 'project',
    '--strict-mcp-config', '--allowedTools', 'Write,Edit,Read,Glob,Skill', '--no-session-persistence'];
  return new Promise(resolve => {
    execFile('claude', args, { cwd: dir, timeout: 20 * 60e3, maxBuffer: 64e6 }, (err, stdout) => {
      const out = join(dir, 'index.html');
      if (err || !existsSync(out)) return resolve(console.error(`${entry.id} failed: ${err?.message ?? 'no index.html'}`));
      let models = [];
      try { models = Object.keys(JSON.parse(stdout).modelUsage ?? {}); } catch {}
      mkdirSync(join(ROOT, 'ai'), { recursive: true });
      copyFileSync(out, join(ROOT, 'ai', `${entry.id}.html`));
      manifest.push({ ...entry, models, file: `ai/${entry.id}.html`, generated: new Date().toISOString().slice(0, 10) });
      manifest.sort((a, b) => a.id.localeCompare(b.id));
      writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
      console.log(`${entry.id} ok (${entry.model}, ${entry.variant})`);
      resolve();
    });
  });
}

// ponytail: fixed pool of 6 parallel sessions; lower it if the subscription rate-limits.
const queue = [...todo];
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await run(queue.shift()); }));
