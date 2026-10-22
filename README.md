# designizer

**humanizer for UI: finds the default AI look in your interface and fixes it**

![Overlay on a generated landing page](examples/overview.jpg)

designizer is a Claude Code skill with a measuring tool inside. `detector.js` is one file with no dependencies. It runs inside a rendered page and reads computed styles and layout, so Tailwind, React, Astro and hand-written CSS all look the same to it. It reports each element that matches a known AI default, with the numbers that prove it (`letter-spacing 0.14em, 11px, uppercase`). The skill adds what a script can't see: the page's composition, invented testimonials, and whether a pattern follows from the product. Then it proposes the smallest CSS change and applies it only after you say yes.

The name and the structure come from [humanizer](https://github.com/blader/humanizer), which does the same for text. Copy found on a page is handed over to it.

## Results

Held-out results on pages the detector never saw while it was being built: 30 pages generated with Claude Code and 30 human-designed sites, half of them hard cases (Linear, Stripe, Vercel and the like). Each tool's threshold was tuned on a separate development split, then applied unchanged.

<!-- eval -->
<!-- /eval -->

RESULTS_NARRATIVE

## Install

```bash
git clone https://github.com/nightherd/designizer ~/.claude/skills/designizer
cd ~/.claude/skills/designizer && npm install
```

The CLI drives your installed Google Chrome through `playwright-core`, so nothing else is downloaded. Then ask Claude Code "does this page look AI-generated?" or "make localhost:3000 look less AI".

## Use the detector without the skill

```bash
node cli.mjs scan https://example.com --overlay overlay.jpg   # JSON report + screenshot with red outlines
node cli.mjs scan ./index.html --only eyebrow,mono-label --overlay eyebrow.jpg
```

Or paste `detector.js` into the DevTools console of any page:

```js
designizer.scan()      // { score, threshold, verdict, fired: [{ id, n, strength, scored, hits: [{ selector, evidence }] }] }
designizer.overlay()   // red outlines with the pattern name; designizer.clear() removes them
```

Decisions you made on purpose go in `.designizer.json` at the project root, and designizer stops reporting them:

```json
{ "allow": ["trendy-font", "accent-word"], "ignore": [".receipt"] }
```

## Patterns

The full catalogue, with what counts as a reason to keep each one, is in [SKILL.md](SKILL.md). Strength works as in humanizer: a strong pattern is worth fixing on its own, a weak one only next to others. Unscored patterns are still reported, but they don't count toward the page verdict, because in the development data they fired on at least as many human pages as AI ones.

PATTERN_TABLE

## How the evaluation works

**AI pages.** 74 landing pages built by Claude Code with `claude -p` on a subscription. Each prompt is one line ("Build a landing page for a family dental clinic in Denver"). Each page comes from Opus, Sonnet or Haiku 5.5 with one of three prompts: plain, plain plus "make it look less AI-generated", or "use the frontend-design skill". Every model meets every variant equally often. Each page is generated in an empty temp directory with user settings switched off, so no personal instructions, hooks or plugins leak in. All prompts and the resulting files are in [`eval/ai.json`](eval/ai.json) and [`eval/ai/`](eval/ai/); `npm run generate` rebuilds missing ones. Four of them (`ex-01`…`ex-04`) only exist to give first-wave patterns an example screenshot and are not part of the eval.

**Human pages.** 70 sites: design studios, type foundries, publishers, product companies with in-house design teams, brands and personal portfolios. Every site was compared with its Wayback Machine snapshot from June 2024, and kept only if the current design already existed then, before AI-built sites were common. The exceptions are hard negatives such as Linear and Stripe, kept because in-house design teams made them. The repo stores only their URLs and the scores, never their code or screenshots ([`eval/human.json`](eval/human.json), [`eval/results.json`](eval/results.json)).

**Protocol.** The commit history shows the order:

1. Rules were written against the dev split (10 AI + 10 human). The threshold was set to the lowest score at which no human dev page was flagged, and the detector was frozen ([3bc891d](../../commit/3bc891d)).
2. One run on the held-out test split (30 + 30) scored 75% with 5 human pages flagged, below the target of 80% and at most 3.
3. Using dev and test together as development data (80 pages), 12 patterns that fired on at least as many human as AI pages were left out of the score. The threshold stayed at 10. Frozen again ([9128f39](../../commit/9128f39)).
4. A fresh split, test-b (30 + 30), was generated and picked only after that freeze and run once. The table above is that run.

**Baselines.** [design-slop-cop](https://github.com/AdrianKrebs/design-slop-cop) (MIT, commit `e2fab6c`) and [impeccable](https://github.com/pbakaus/impeccable)'s in-page engine (Apache-2.0, `engine-v0.1.12`) run on the same loaded page as designizer, from [`eval/baselines.mjs`](eval/baselines.mjs). Neither has a single "this is AI" threshold that fits this task, so each gets the threshold that maximises its accuracy on the dev split, as designizer did.

**Reproduce.**

```bash
npm install
node cli.mjs eval --split test-b --baselines   # or dev, test, dev,test, all; --write updates this README
```

Human sites change, so a rerun on another day can differ by a page or two.

**Limits.**

- 30 + 30 pages give a margin of error of about ±10 percentage points on accuracy.
- AI pages are single-file prototypes from one vendor's models. Pages from v0, Lovable or Bolt, deployed apps and other models are not in the set.
- The human set is professional design. A small business site set in a free Google Font would score higher on patterns 1 and 2. That is why those two stay weak, even though no human page in the set used a template display font.
- AI pages have no real photography, and human sites do. To keep that from doing the work, designizer has no rule about images.
- The detector measures the look, but the eval labels pages by origin. A page generated with a careful design brief may not have the look at all, and then no detector should flag it (see the prompt-variant table).

## Credits

Pattern sources: [Impeccable's slop list](https://impeccable.style/slop), Adrian Krebs's [audit of 1,590 Show HN pages](https://www.adriankrebs.ch/blog/design-slop/), [Capital & Compute](https://capitalandcompute.net/blog/fix-ai-slop-design/) on the second wave, [Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website), [925studios](https://www.925studios.co/blog/ai-slop-design-tells), [CodeMySpec](https://codemyspec.com/blog/vibe-coded-websites-look-the-same), [vibecoded-design-tells](https://github.com/JCarterJohnson/vibecoded-design-tells), [ai-design-tells](https://github.com/hankimis/ai-design-tells), and Anthropic's [frontend-design](https://github.com/anthropics/skills) skill, which describes both waves of the look. Skill structure after [humanizer](https://github.com/blader/humanizer) by Siqi Chen (MIT).

MIT licence.
