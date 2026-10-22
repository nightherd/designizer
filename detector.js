/* designizer detector · https://github.com/nightherd/designizer · MIT
 *
 * Finds the default AI look in a rendered page. Paste it into the console or inject it, then:
 *   designizer.scan({ allow: ['accent-word'], ignore: ['.receipt'] })  → JSON report
 *   designizer.overlay()                                                → red outlines with the pattern name
 * It reads computed styles and layout only, so it does not care whether the page is Tailwind, React, Astro or plain CSS.
 * Pattern numbers match the catalogue in SKILL.md. Patterns 34 and 36 need a model and are not here.
 */
(() => {
  const VERSION = '0.2.0';
  // Lowest score at which no human page in the dev split was flagged (eval/README.md). Tuned once, before the test run.
  const THRESHOLD = 10;
  const WEIGHT = { strong: 3, medium: 2, weak: 1 };
  // scored: false = reported for the skill to judge, but left out of the page verdict: on the 80 development pages
  // (eval/results.json, splits dev and test) these fired on at least as many human pages as AI pages.
  const PATTERNS = {
    'default-sans': { n: 1, w: 'weak', name: 'Default sans everywhere' },
    'trendy-font': { n: 2, w: 'weak', name: 'Template display font' },
    'accent-word': { n: 3, w: 'strong', name: 'One accented word in a heading' },
    eyebrow: { n: 4, w: 'medium', name: 'Tracked caps eyebrow over a heading' },
    'tracked-caps': { n: 5, w: 'medium', name: 'Tracked all-caps labels' },
    'mono-label': { n: 6, w: 'medium', name: 'Monospace labels that are not code' },
    numbered: { n: 7, w: 'medium', name: '01 / 02 / 03 numbering' },
    'meta-string': { n: 8, w: 'weak', name: 'A · B · C meta strings' },
    'arrow-links': { n: 9, w: 'weak', scored: false, name: 'Arrow on every link' },
    'type-scale': { n: 10, w: 'weak', name: 'Sentence-long display headline or flat scale' },
    'crushed-tracking': { n: 11, w: 'weak', name: 'Crushed tracking on display type' },
    purple: { n: 12, w: 'medium', scored: false, name: 'Purple or indigo buttons' },
    'gradient-text': { n: 13, w: 'strong', scored: false, name: 'Gradient text' },
    gradients: { n: 14, w: 'medium', name: 'Gradients, blobs and halos everywhere' },
    'dark-glow': { n: 15, w: 'medium', scored: false, name: 'Dark mode with grey text and coloured glow' },
    'warm-editorial': { n: 16, w: 'medium', name: 'Cream, serif and terracotta' },
    'dark-acid': { n: 17, w: 'medium', scored: false, name: 'Near-black with one acid accent' },
    'card-kit': { n: 18, w: 'weak', scored: false, name: 'One radius and one shadow on every card' },
    'side-stripe': { n: 19, w: 'strong', name: 'Coloured stripe on a card edge' },
    'nested-cards': { n: 20, w: 'medium', name: 'Cards inside cards' },
    glass: { n: 21, w: 'medium', scored: false, name: 'Glassmorphism' },
    decor: { n: 22, w: 'weak', name: 'Ghost cards, grid background or grain' },
    hero: { n: 23, w: 'medium', scored: false, name: 'Pill badge over a centred hero' },
    'icon-cards': { n: 24, w: 'weak', name: 'Identical cards with an icon' },
    'stat-row': { n: 25, w: 'medium', name: 'Row of big numbers' },
    faq: { n: 26, w: 'weak', name: 'Stock page order (FAQ accordion)' },
    broadsheet: { n: 27, w: 'medium', name: 'Newspaper cosplay' },
    'fake-window': { n: 28, w: 'medium', scored: false, name: 'Fake window chrome or terminal' },
    'uniform-spacing': { n: 29, w: 'weak', name: 'Same spacing everywhere' },
    reveal: { n: 30, w: 'medium', scored: false, name: 'Every section fades up' },
    'infinite-motion': { n: 31, w: 'medium', scored: false, name: 'Pulsing dot, marquee or blinking cursor' },
    bounce: { n: 32, w: 'weak', name: 'Bouncy easing' },
    emoji: { n: 33, w: 'strong', name: 'Emoji as icons' },
    sparkles: { n: 35, w: 'medium', scored: false, name: 'Sparkles and robots as the AI icon' },
  };

  const DEFAULT_SANS = /^(inter( var| variable| display)?|geist( sans)?|roboto|arial|helvetica( neue)?|system-ui|-apple-system|blinkmacsystemfont|segoe ui|sans-serif|ui-sans-serif|dm sans|manrope|plus jakarta sans|open sans|lato|poppins|montserrat|nunito( sans)?|work sans|figtree|onest|outfit)$/;
  const TRENDY = /^(space grotesk|fraunces|instrument serif|playfair( display)?|syne|bricolage grotesque|young serif|dm serif (display|text)|cormorant( garamond)?|sora|clash display|cabinet grotesk|general sans|satoshi|unbounded|newsreader|instrument sans|archivo|epilogue|lexend|urbanist|be vietnam pro|gloock|libre caslon (text|display)|eb garamond|space mono)$/;
  const SERIF = /garamond|playfair|fraunces|georgia|times|baskerville|caslon|cormorant|lora|merriweather|crimson|newsreader|tiempos|canela|sectra|recoleta|spectral|bodoni|didot|freight|domaine|reckless|editorial new|alpina|literata|young serif|instrument serif|dm serif|source serif|noto serif|pt serif|plex serif|charter|iowan|hoefler|minion|signifier|lyon|publico|tobias|gambarino|zodiak|erode|sentient|boska|gloock|bitter|zilla|slab|rockwell/;
  const MONO = /mono|code|courier|consol|menlo|monaco|^monospace$/;
  const CODEY = /[{}();=<>$@]|(^|\s)--?\w|\w\.\w+\(|^\/|\/\w+\/|\.\w{1,4}$|^\w+_\w+$|^[A-Z0-9_]{3,}=|^v?\d+\.\d+(\.\d+)?$|^[⌘⌥⇧⌃]|\b(npm|npx|git|curl|pip|brew|sudo)\b/;
  const DATA = /^[\d\s.,:%/+×x–—-]+$/;
  const STAT = /^[~≈<>+]?[$€£]?\d[\d,.]*\s?([kKmMbB]|%|\+|x|×|\/\d+|ms|hrs?|h|s|min|★)*\+?$/;
  const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;
  const ARROW = /^[←→↗↘➜➔⟶›»]|[←→↗↘➜➔⟶›»]$/;
  const COLOR_FN = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)|#[0-9a-f]{3,8}\b|\btransparent\b/gi;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BR', 'WBR', 'IFRAME', 'OPTION', 'HEAD', 'META', 'LINK']);

  // ---------- small helpers ----------
  const px = v => parseFloat(v) || 0;
  const em = (s, fs) => (s.letterSpacing === 'normal' ? 0 : px(s.letterSpacing) / (fs || 16));
  const short = t => (t.length > 42 ? t.slice(0, 40) + '…' : t);
  const hex = c => '#' + c.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
  const styles = new Map();
  const st = el => styles.get(el) || (styles.set(el, getComputedStyle(el)), styles.get(el));

  // Any CSS colour to [r, g, b, a] through a canvas, so oklch and lab from Tailwind v4 work as well as rgb.
  const cvs = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const colors = new Map();
  function rgba(c) {
    if (!c || c === 'transparent') return [0, 0, 0, 0];
    if (colors.has(c)) return colors.get(c);
    cvs.clearRect(0, 0, 1, 1);
    cvs.fillStyle = '#000';
    cvs.fillStyle = c;
    cvs.fillRect(0, 0, 1, 1);
    const d = cvs.getImageData(0, 0, 1, 1).data;
    const v = [d[0], d[1], d[2], d[3] / 255];
    colors.set(c, v);
    return v;
  }
  function hsl([r, g, b]) {
    (r /= 255), (g /= 255), (b /= 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    return [h < 0 ? h + 360 : h, d / (1 - Math.abs(2 * l - 1)), l];
  }
  const lin = c => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => Math.round(v * fg[3] + bg[i] * (1 - fg[3])));
  const saturated = (c, s = 0.35) => c[3] > 0.4 && hsl(c)[1] >= s && hsl(c)[2] > 0.15 && hsl(c)[2] < 0.85;

  function shadows(v) {
    if (!v || v === 'none') return [];
    return v.split(/,(?![^(]*\))/).map(part => {
      const color = (part.match(COLOR_FN) || ['rgb(0, 0, 0)'])[0];
      const n = (part.replace(color, '').match(/-?[\d.]+px/g) || []).map(px);
      return { color: rgba(color), blur: n[2] || 0, inset: /inset/.test(part) };
    });
  }
  const radius = (s, r) => {
    const v = s.borderTopLeftRadius;
    return v.endsWith('%') ? (px(v) / 100) * Math.min(r.width, r.height) : px(v);
  };
  const border = (s, side) => (s[`border${side}Style`] === 'none' ? 0 : px(s[`border${side}Width`]));

  // Font actually rendered: first family in the stack that is installed or loaded (canvas width test).
  const fonts = new Map();
  function available(f) {
    if (/^(serif|sans-serif|monospace|system-ui|ui-\w+|cursive|fantasy|-apple-system|blinkmacsystemfont)$/.test(f)) return true;
    if (fonts.has(f)) return fonts.get(f);
    const w = font => ((cvs.font = `72px ${font}`), cvs.measureText('mmmmmmmmmmlli10OQ@#').width);
    const ok = w(`"${f}", monospace`) !== w('monospace') || w(`"${f}", serif`) !== w('serif');
    fonts.set(f, ok);
    return ok;
  }
  function family(s) {
    const stack = s.fontFamily.split(',').map(f =>
      f.trim().replace(/^["']|["']$/g, '').replace(/^_+|_[0-9a-f]{5,}$/gi, '').replace(/_/g, ' ').replace(/\s+fallback$/i, '').toLowerCase());
    return stack.find(available) || stack[stack.length - 1] || '';
  }
  const isSerif = f => f === 'serif' || f === 'ui-serif' || (!/sans/.test(f) && (/serif/.test(f) || SERIF.test(f)));
  const isCaps = (r, t = r.t) =>
    r.s.textTransform === 'uppercase' || /all-(small|petite)-caps/.test(r.s.fontVariantCaps) ||
    (/[A-Z].*[A-Z]/.test(t) && t === t.toUpperCase());

  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue + ' ';
    return t.replace(/\s+/g, ' ').trim();
  }

  function selector(el) {
    const parts = [];
    for (let e = el; e && e !== document.body && e !== document.documentElement && parts.length < 4; e = e.parentElement) {
      if (e.id && /^[a-z][\w-]*$/i.test(e.id)) { parts.unshift('#' + e.id); break; }
      let p = e.tagName.toLowerCase();
      const cls = [...e.classList].filter(c => /^[a-z][\w-]*$/i.test(c) && c.length < 30).slice(0, 2);
      if (cls.length) p += '.' + cls.join('.');
      const sib = e.parentElement ? [...e.parentElement.children].filter(c => c.tagName === e.tagName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(e) + 1})`;
      parts.unshift(p);
    }
    return parts.join(' > ');
  }

  // ---------- page model ----------
  function model(ignore) {
    const recs = [];
    const map = new Map();
    for (const el of document.body.querySelectorAll('*')) {
      if (SKIP.has(el.tagName) || el.ownerSVGElement || el.closest('[data-designizer]')) continue;
      if (ignore && el.closest(ignore)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const s = st(el);
      if (s.visibility === 'hidden') continue;
      const rec = { el, s, r, t: ownText(el), fs: px(s.fontSize), top: r.top + scrollY };
      recs.push(rec);
      map.set(el, rec);
    }
    const text = recs.filter(r => r.t.length > 0);
    const bgCache = new Map();
    const bgOf = el => {
      if (bgCache.has(el)) return bgCache.get(el);
      let c = [255, 255, 255];
      for (let e = el; e; e = e.parentElement) {
        const v = rgba(st(e).backgroundColor);
        if (v[3] >= 0.5) { c = v.slice(0, 3); break; }
      }
      bgCache.set(el, c);
      return c;
    };
    const weigh = key => {
      const m = new Map();
      for (const r of text) { const k = key(r); if (k != null) m.set(k, (m.get(k) || 0) + r.t.length); }
      const total = [...m.values()].reduce((a, b) => a + b, 0) || 1;
      const [k, v] = [...m].sort((a, b) => b[1] - a[1])[0] || [null, 0];
      return { key: k, share: v / total };
    };
    const vw = innerWidth, vh = innerHeight;
    const headings = recs.filter(r => /^H[1-3]$/.test(r.el.tagName) || r.el.getAttribute('role') === 'heading');
    const fold = text.filter(r => r.top < vh);
    const h1 = recs.find(r => r.el.tagName === 'H1' && r.top < vh * 1.2) || [...fold].sort((a, b) => b.fs - a.fs)[0];
    const pageBg = weigh(r => bgOf(r.el).join(',')).key?.split(',').map(Number) || [255, 255, 255];
    const children = el => [...el.children].map(c => map.get(c)).filter(Boolean);
    const fixed = r => {
      for (let e = r.el, i = 0; e && i < 4; e = e.parentElement, i++) if (/fixed|sticky/.test(st(e).position)) return true;
      return false;
    };
    const nav = r => !!r.el.closest('nav, header, footer') || fixed(r);
    return { recs, map, text, bgOf, weigh, vw, vh, headings, fold, h1, pageBg, children, nav, fixed };
  }

  const need = (hits, k = 1, w) => (hits.length >= k ? { hits, w } : null);

  // ---------- rules: each returns { hits: [[element, evidence]], w? } or null ----------
  const RULES = {
    'default-sans'(m) {
      const { key, share } = m.weigh(r => family(r.s));
      if (!key || !DEFAULT_SANS.test(key) || share < 0.6) return null;
      const r = m.text.find(r => family(r.s) === key && r.t.length > 20) || m.text[0];
      return need([[r.el, `font-family: ${key} on ${Math.round(share * 100)}% of the text`]]);
    },

    'trendy-font'(m) {
      const seen = new Set();
      const hits = [];
      for (const r of m.text) {
        const f = family(r.s);
        if ((/^H[1-3]$/.test(r.el.tagName) || r.fs >= 32) && TRENDY.test(f) && !seen.has(f)) {
          seen.add(f);
          hits.push([r.el, `font-family: ${f} on ${r.el.tagName.toLowerCase()} (${Math.round(r.fs)}px)`]);
        }
      }
      return need(hits);
    },

    'accent-word'(m) {
      const hits = [];
      for (const h of m.headings.filter(h => h.fs >= 28)) {
        const whole = h.el.textContent.trim();
        if (whole.length < 4) continue;
        for (const d of h.el.querySelectorAll('*')) {
          const t = d.textContent.trim();
          const r = m.map.get(d);
          if (!r || !t || t.length > whole.length * 0.6 || d.closest('a') !== h.el.closest('a')) continue;
          const diff = [];
          if (r.s.fontStyle !== h.s.fontStyle) diff.push(`font-style: ${r.s.fontStyle}`);
          if (family(r.s) !== family(h.s)) diff.push(`font-family: ${family(r.s)}`);
          const a = rgba(r.s.color), b = rgba(h.s.color);
          if (a.slice(0, 3).reduce((s, v, i) => s + Math.abs(v - b[i]), 0) > 60) diff.push(`color: ${hex(a)} vs ${hex(b)}`);
          if (/text/.test(r.s.backgroundClip + r.s.webkitBackgroundClip) && /gradient/.test(r.s.backgroundImage)) diff.push('gradient fill');
          if (diff.length) { hits.push([h.el, `"${short(t)}" in "${short(whole)}": ${diff.join('; ')}`]); break; }
        }
      }
      return need(hits);
    },

    eyebrow(m) {
      const label = r => r && r.t.length >= 2 && r.t.length <= 60 && r.t.split(' ').length <= 8 && r.fs <= 15 && isCaps(r) && em(r.s, r.fs) >= 0.06;
      const find = el => {
        const r = m.map.get(el);
        if (!r) return null;
        if (label(r)) return r;
        if (el.textContent.trim().length > 60) return null;
        for (const d of el.querySelectorAll('*')) if (label(m.map.get(d))) return m.map.get(d);
        return null;
      };
      const hits = [];
      for (const h of m.headings) {
        let el = h.el, prev = null;
        for (let up = 0; up < 3 && el && !prev; up++, el = el.parentElement) {
          if (el.previousElementSibling) prev = el.previousElementSibling;
          else if (el.parentElement?.firstElementChild !== el) break;
        }
        const r = prev && find(prev);
        if (r) hits.push([r.el, `"${short(r.t)}" ${Math.round(r.fs)}px, letter-spacing ${em(r.s, r.fs).toFixed(2)}em, uppercase, above ${h.el.tagName.toLowerCase()}`]);
      }
      return need(hits, 1, hits.length >= 3 ? 'strong' : undefined);
    },

    'tracked-caps'(m) {
      const hits = m.text
        .filter(r => r.t.length >= 2 && /\p{L}/u.test(r.t) && r.fs <= 16 && isCaps(r) && em(r.s, r.fs) >= 0.08)
        .map(r => [r.el, `"${short(r.t)}" ${Math.round(r.fs)}px, letter-spacing ${em(r.s, r.fs).toFixed(2)}em, uppercase`]);
      return need(hits, 4);
    },

    'mono-label'(m) {
      const hits = m.text
        .filter(r => MONO.test(family(r.s)) && /\p{L}.*\p{L}/u.test(r.t) && !DATA.test(r.t) && !CODEY.test(r.t) &&
          !r.el.closest('pre, code, kbd, samp, textarea, input'))
        .map(r => [r.el, `font-family: ${family(r.s)}; "${short(r.t)}"`]);
      return need(hits, 3);
    },

    numbered(m) {
      const cands = [];
      for (const r of m.text) {
        const a = r.t.match(/^(?:n[°º]\s*|#)?(\d{1,2})(?:[.):/]|\s*[—–-])?$/i);
        const b = r.t.match(/^(0\d)[.):]?\s+[—–-]?\s*\p{L}/u);
        const v = a?.[1] || b?.[1];
        if (!v) continue;
        const zero = v.startsWith('0');
        const round = radius(r.s, r.r) >= 0.4 * r.r.width && (rgba(r.s.backgroundColor)[3] > 0.1 || border(r.s, 'Top') > 0);
        if (!zero && !round && r.fs < 24) continue;
        cands.push({ r, v: +v, key: `${Math.round(r.fs)}|${family(r.s)}` });
      }
      for (const r of m.recs) {
        if (/decimal-leading-zero/.test(r.s.listStyleType + getComputedStyle(r.el, '::before').content))
          cands.push({ r, v: 0, key: 'css-counter' });
      }
      const hits = [];
      let strong = false;
      const groups = new Map();
      for (const c of cands) groups.set(c.key, [...(groups.get(c.key) || []), c]);
      for (const [key, g] of groups) {
        const run = key === 'css-counter' ? (g.length >= 3 ? g : []) : g.filter((c, i) => g.some(d => d.v === c.v + 1) || g.some(d => d.v === c.v - 1));
        if (key !== 'css-counter' && !(g.some(c => c.v === 1) && g.some(c => c.v === 2) && g.some(c => c.v === 3))) continue;
        for (const c of run) {
          const inHead = c.r.el.closest('h1, h2, h3') || /^H[1-3]$/.test(c.r.el.nextElementSibling?.tagName || '');
          strong ||= !!inHead;
          hits.push([c.r.el, `"${c.r.t || 'counter'}"${inHead ? ' on a section heading' : ''}, ${Math.round(c.r.fs)}px ${family(c.r.s)}`]);
        }
      }
      return need(hits, 3, strong ? 'strong' : undefined);
    },

    'meta-string'(m) {
      const hits = m.text
        .filter(r => /\S\s+[·•]\s+\S/.test(r.t) || /^\/\/\s*\S/.test(r.t) || /\bN[°º]\s*\d/.test(r.t))
        .map(r => [r.el, `"${short(r.t)}"`]);
      return need(hits, 2);
    },

    'arrow-links'(m) {
      const hits = m.recs
        .filter(r => r.el.matches('a, button, [role=button]'))
        .filter(r => {
          const t = r.el.textContent.trim();
          const pseudo = getComputedStyle(r.el, '::after').content + getComputedStyle(r.el, '::before').content;
          const icon = r.el.querySelector('svg[class*="arrow" i], svg[data-lucide*="arrow"], [class*="arrow-right" i]');
          return ARROW.test(t) || /[→↗➜➔⟶]/.test(pseudo) || icon;
        })
        .map(r => [r.el, `"${short(r.el.textContent.trim())}" with an arrow`]);
      return need(hits, 3);
    },

    'type-scale'(m) {
      const h = m.h1;
      if (!h) return null;
      const t = h.el.textContent.trim();
      if (h.fs >= 64 && t.length >= 40) return need([[h.el, `${Math.round(h.fs)}px headline with ${t.length} characters`]]);
      const body = +(m.weigh(r => (r.fs <= 20 ? Math.round(r.fs) : null)).key || 16);
      if (h.fs / body < 1.5) return need([[h.el, `headline ${Math.round(h.fs)}px vs body ${body}px`]]);
      return null;
    },

    'crushed-tracking'(m) {
      const hits = m.text
        .filter(r => r.fs >= 28 && em(r.s, r.fs) <= -0.045)
        .map(r => [r.el, `${Math.round(r.fs)}px, letter-spacing ${em(r.s, r.fs).toFixed(3)}em`]);
      return need(hits);
    },

    purple(m) {
      const purple = c => { const [h, s, l] = hsl(c); return c[3] >= 0.6 && h >= 235 && h <= 300 && s >= 0.35 && l > 0.3 && l < 0.75; };
      const hits = m.recs
        .filter(r => r.el.matches('a, button, [role=button], input[type=submit], input[type=button]'))
        .filter(r => purple(rgba(r.s.backgroundColor)) || (r.s.backgroundImage.match(COLOR_FN) || []).some(c => purple(rgba(c))))
        .map(r => [r.el, `background ${/gradient/.test(r.s.backgroundImage) ? r.s.backgroundImage.slice(0, 60) : hex(rgba(r.s.backgroundColor))} on "${short(r.el.textContent.trim())}"`]);
      return need(hits);
    },

    'gradient-text'(m) {
      const hits = m.recs
        .filter(r => /text/.test(r.s.backgroundClip + r.s.webkitBackgroundClip) && /gradient/.test(r.s.backgroundImage) &&
          (r.s.backgroundImage.match(COLOR_FN) || []).some(c => saturated(rgba(c), 0.3)))
        .map(r => [r.el, `background-clip: text on ${r.s.backgroundImage.slice(0, 70)}`]);
      return need(hits);
    },

    gradients(m) {
      const hits = [];
      for (const r of m.recs) {
        const area = r.r.width * r.r.height;
        const img = r.s.backgroundImage;
        if (/gradient/.test(img) && !/text/.test(r.s.backgroundClip + r.s.webkitBackgroundClip)) {
          const cs = (img.match(COLOR_FN) || []).map(rgba);
          const vis = cs.filter(c => c[3] >= 0.15);
          const distinct = vis.some(a => vis.some(b => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 60));
          const halo = /radial/.test(img) && cs.some(c => c[3] < 0.05) && vis.some(c => saturated(c, 0.3));
          if ((distinct && area >= 4000) || (halo && area >= 20000))
            hits.push([r.el, `${halo ? 'halo' : 'gradient'}: ${img.slice(0, 70)}`]);
        }
        const blur = px((r.s.filter.match(/blur\(([\d.]+)px/) || [])[1]);
        if (blur >= 30 && (saturated(rgba(r.s.backgroundColor), 0.3) || /gradient/.test(img))) hits.push([r.el, `blob: filter blur(${blur}px)`]);
      }
      return need(hits, 3);
    },

    'dark-glow'(m) {
      const glows = [];
      for (const r of m.recs) {
        const g = shadows(r.s.boxShadow).find(x => !x.inset && x.blur >= 16 && x.color[3] >= 0.15 && saturated(x.color, 0.35)) ||
          shadows(r.s.textShadow).find(x => x.blur >= 8 && x.color[3] >= 0.2 && saturated(x.color, 0.35));
        if (g) glows.push([r.el, `glow ${hex(g.color)} blur ${g.blur}px`]);
      }
      if (glows.length >= 2) return need(glows, 2);
      let dark = 0, muted = 0, all = 0;
      for (const r of m.text) {
        const bg = m.bgOf(r.el), n = r.t.length;
        all += n;
        if (lum(bg) >= 0.05) continue;
        dark += n;
        const c = blend(rgba(r.s.color), bg);
        if (contrast(c, bg) < 7 && hsl([...c, 1])[1] < 0.2) muted += n;
      }
      if (dark / (all || 1) < 0.6 || muted / (dark || 1) < 0.3) return null;
      const r = m.text.find(r => lum(m.bgOf(r.el)) < 0.05 && contrast(blend(rgba(r.s.color), m.bgOf(r.el)), m.bgOf(r.el)) < 7);
      return need([[r.el, `dark page (${Math.round((dark / all) * 100)}% of text), ${Math.round((muted / dark) * 100)}% of it grey below 7:1`]], 1, 'weak');
    },

    'warm-editorial'(m) {
      const [r, g, b] = m.pageBg;
      const cream = Math.min(r, g, b) >= 200 && r >= g && g >= b && r - b >= 6 && r - b <= 48;
      if (!cream || !m.h1) return null;
      const serif = isSerif(family(m.h1.s));
      const isTerra = v => { const [h, s, l] = hsl(v); return v[3] > 0.5 && h >= 5 && h <= 32 && s >= 0.35 && l >= 0.35 && l <= 0.65; };
      const terra = m.recs.map(x => [x, [x.s.color, x.s.backgroundColor].map(rgba).find(isTerra)]).filter(([, v]) => v);
      if (!serif && terra.length < 2) return null;
      const hits = [[m.h1.el, `page background ${hex(m.pageBg)}${serif ? `, serif headline (${family(m.h1.s)})` : ''}`]];
      if (terra.length >= 2) hits.push([terra[0][0].el, `terracotta accent ${hex(terra[0][1])} on ${terra.length} elements`]);
      return need(hits, 1, serif && terra.length >= 2 ? 'strong' : undefined);
    },

    'dark-acid'(m) {
      if (lum(m.pageBg) >= 0.02) return null;
      const acc = [];
      for (const r of m.recs) for (const c of [r.s.color, r.s.backgroundColor, r.s.borderTopColor]) {
        const v = rgba(c);
        if (v[3] > 0.5 && hsl(v)[1] >= 0.6 && hsl(v)[2] > 0.35 && hsl(v)[2] < 0.75) { acc.push([r, v]); break; }
      }
      if (acc.length < 3) return null;
      const bucket = h => Math.floor(((h + 15) % 360) / 30);
      const counts = new Map();
      for (const [, v] of acc) counts.set(bucket(hsl(v)[0]), (counts.get(bucket(hsl(v)[0])) || 0) + 1);
      const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
      const hue = top * 30;
      if (n / acc.length < 0.8 || !((hue >= 60 && hue <= 150) || hue <= 15 || hue >= 345)) return null;
      const [r, v] = acc.find(([, v]) => bucket(hsl(v)[0]) === top);
      return need([[r.el, `background ${hex(m.pageBg)}, single accent ${hex(v)} on ${n} elements`]]);
    },

    'card-kit'(m) {
      const cards = cardsOf(m, 12, 12000);
      if (cards.length < 4) return null;
      const key = r => `${Math.round(radius(r.s, r.r))}px | ${r.s.boxShadow === 'none' ? 'no shadow' : r.s.boxShadow.slice(0, 50)}`;
      const k = new Map();
      for (const c of cards) k.set(key(c), (k.get(key(c)) || 0) + 1);
      const [top, n] = [...k].sort((a, b) => b[1] - a[1])[0];
      if (n / cards.length < 0.8) return null;
      return need(cards.filter(c => key(c) === top).map(c => [c.el, `border-radius ${top} on ${n} of ${cards.length} cards`]));
    },

    'side-stripe'(m) {
      const hits = [];
      for (const r of m.recs) {
        if (r.r.height < 40 || r.r.width < 100 || r.el.matches('blockquote, input, textarea, td, th, hr, li') || m.nav(r)) continue;
        if (r.el.textContent.trim().length < 10) continue;
        for (const [side, others] of [['Left', ['Right', 'Top', 'Bottom']], ['Top', ['Right', 'Left', 'Bottom']]]) {
          const w = border(r.s, side), o = Math.max(...others.map(x => border(r.s, x)));
          const c = rgba(r.s[`border${side}Color`]);
          const card = radius(r.s, r.r) >= 4 || r.s.boxShadow !== 'none' || rgba(r.s.backgroundColor)[3] > 0.05;
          if (w >= 2 && o <= 1 && card && saturated(c, 0.25)) { hits.push([r.el, `border-${side.toLowerCase()}: ${w}px ${hex(c)}, other sides ${o}px`]); break; }
        }
      }
      return need(hits);
    },

    'nested-cards'(m) {
      const cards = cardsOf(m, 8, 6000);
      const set = new Set(cards.map(c => c.el));
      const hits = [];
      for (const c of cards) {
        let p = c.el.parentElement;
        for (let i = 0; p && i < 5; i++, p = p.parentElement) {
          if (set.has(p) && m.map.get(p).r.width * m.map.get(p).r.height > 1.2 * c.r.width * c.r.height) {
            hits.push([c.el, `card (radius ${Math.round(radius(c.s, c.r))}px) inside ${selector(p)}`]);
            break;
          }
        }
      }
      return need(hits, 2);
    },

    glass(m) {
      const hits = m.recs
        .filter(r => /blur\(/.test(r.s.backdropFilter + r.s.webkitBackdropFilter) && !(m.nav(r) && r.top < 140))
        .filter(r => { const a = rgba(r.s.backgroundColor)[3]; return a < 0.92 && r.r.width * r.r.height >= 5000; })
        .map(r => [r.el, `backdrop-filter: ${r.s.backdropFilter}; background ${r.s.backgroundColor}`]);
      return need(hits);
    },

    decor(m) {
      const hits = [];
      for (const r of m.recs) {
        const img = r.s.backgroundImage;
        if (/repeating-(linear|radial)-gradient/.test(img) || ((img.match(/gradient\(/g) || []).length >= 2 && /\b([1-9]\d?|1[01]\d)px/.test(r.s.backgroundSize)))
          hits.push([r.el, `pattern background: ${img.slice(0, 60)}, size ${r.s.backgroundSize}`]);
        else if (/feTurbulence|noise/i.test(decodeURIComponent(img))) hits.push([r.el, 'grain: noise background image']);
      }
      const turb = document.querySelector('feTurbulence')?.closest('svg');
      if (turb && !hits.length) hits.push([turb.parentElement, 'grain: SVG feTurbulence filter']);
      const ghosts = m.recs.filter(r => border(r.s, 'Top') === 1 && rgba(r.s.borderTopColor)[3] <= 0.25 &&
        shadows(r.s.boxShadow).some(x => x.blur >= 24 && x.color[3] <= 0.25) && r.r.width * r.r.height >= 6000);
      if (ghosts.length >= 3) hits.push(...ghosts.map(r => [r.el, `1px border + wide soft shadow: ${r.s.boxShadow.slice(0, 50)}`]));
      return need(hits);
    },

    hero(m) {
      const h = m.h1;
      if (!h || h.top > m.vh) return null;
      const centred = h.s.textAlign === 'center' || st(h.el.parentElement).textAlign === 'center';
      const pill = m.recs.find(r => {
        const H = r.r.height, W = r.r.width, gap = h.r.top - r.r.bottom;
        return gap >= -2 && gap <= 220 && H >= 16 && H <= 56 && W >= 40 && W <= 600 && r.top > 40 && !r.el.closest('nav') && !m.fixed(r) &&
          radius(r.s, r.r) >= H / 2 - 1 && (rgba(r.s.backgroundColor)[3] >= 0.03 || border(r.s, 'Top') >= 1) &&
          r.r.left < h.r.right && r.r.right > h.r.left && r.el.textContent.trim().length >= 2 && r.el.textContent.trim().length <= 80;
      });
      if (pill) return need([[pill.el, `pill "${short(pill.el.textContent.trim())}" ${Math.round(pill.r.height)}px tall above the h1${centred ? ', hero centred' : ''}`]], 1, centred ? 'strong' : undefined);
      return centred ? need([[h.el, 'centred hero headline']], 1, 'weak') : null;
    },

    'icon-cards'(m) {
      const hits = [];
      for (const p of m.recs) {
        if (p.el.closest('nav, footer')) continue;
        const kids = m.children(p.el).filter(k => k.r.width >= 140);
        if (kids.length < 3 || kids.length > 8 || kids.length % 3 && kids.length % 4) continue;
        const w0 = kids[0].r.width;
        if (!kids.every(k => Math.abs(k.r.width - w0) <= w0 * 0.06)) continue;
        if (kids.filter(k => Math.abs(k.r.top - kids[0].r.top) < 4).length < 3) continue;
        const iconic = kids.filter(k => {
          if (k.el.textContent.trim().length < 20) return false;
          if ([...k.el.querySelectorAll('img, video')].some(i => i.getBoundingClientRect().width > 100)) return false;
          return [...k.el.querySelectorAll('svg, img, i, span')].some(i => {
            const b = i.getBoundingClientRect();
            return b.width >= 16 && b.width <= 72 && Math.abs(b.width - b.height) <= b.width * 0.3 && b.top - k.r.top <= k.r.height * 0.45 && (i.tagName !== 'SPAN' || i.querySelector('svg') || EMOJI.test(i.textContent));
          });
        });
        if (iconic.length === kids.length) hits.push([p.el, `${kids.length} equal cards, each with an icon on top`]);
      }
      return need(hits);
    },

    'stat-row'(m) {
      const hits = [];
      for (const p of m.recs) {
        const kids = m.children(p.el);
        if (kids.length < 3 || kids.length > 6) continue;
        if (!kids.every(k => Math.abs(k.r.top - kids[0].r.top) < 8)) continue;
        const nums = kids.map(k => {
          if (k.el.querySelector('button, [role=button]') || k.el.querySelectorAll('li').length >= 3) return null;
          const inner = [m.map.get(k.el), ...[...k.el.querySelectorAll('*')].map(e => m.map.get(e))].filter(r => r && r.t);
          const big = inner.sort((a, b) => b.fs - a.fs)[0];
          return big && big.fs >= 22 && STAT.test(big.t.replace(/\s+/g, '')) ? big : null;
        });
        if (nums.filter(Boolean).length >= 3) hits.push([p.el, `stats ${nums.filter(Boolean).map(n => n.t).join(' / ')}`]);
      }
      return need(hits);
    },

    faq(m) {
      const docH = document.documentElement.scrollHeight;
      const items = m.recs.filter(r => (r.el.tagName === 'DETAILS' || r.el.matches('button[aria-expanded]')) && r.top > docH * 0.4);
      return items.length >= 3 ? need([[items[0].el.parentElement, `${items.length} accordion items in the lower part of the page`]]) : null;
    },

    broadsheet(m) {
      if (!m.h1 || !isSerif(family(m.h1.s))) return null;
      const rules = m.recs.filter(r => r.r.width >= m.vw * 0.3 && (border(r.s, 'Top') === 1 || border(r.s, 'Bottom') === 1) && !border(r.s, 'Left') && !border(r.s, 'Right'));
      const double = m.recs.find(r => /double/.test(r.s.borderTopStyle + r.s.borderBottomStyle));
      const mast = m.text.find(r => /\b(vol\.?|no\.|issue|edition|est\.)\s*[\divxlc]+|n[°º]\s*\d/i.test(r.t));
      const cols = m.recs.find(r => +r.s.columnCount > 1);
      if (rules.length < 12 || !(double || mast || cols)) return null;
      return need([[m.h1.el, `serif headline, ${rules.length} hairline rules${double ? ', double rule' : ''}${mast ? `, masthead text "${short(mast.t)}"` : ''}${cols ? ', text columns' : ''}`]]);
    },

    'fake-window'(m) {
      const hits = [];
      const dot = k => k.r.width >= 6 && k.r.width <= 16 && Math.abs(k.r.width - k.r.height) <= 1 && radius(k.s, k.r) >= 0.4 * k.r.width && rgba(k.s.backgroundColor)[3] >= 0.5;
      for (const p of m.recs) {
        const all = m.children(p.el);
        const i = all.findIndex((k, j) => j + 2 < all.length && [k, all[j + 1], all[j + 2]].every(dot));
        if (i < 0) continue;
        const kids = all.slice(i, i + 3);
        const hs = kids.map(k => hsl(rgba(k.s.backgroundColor)));
        const mac = (hs[0][0] < 15 || hs[0][0] > 345) && hs[1][0] >= 30 && hs[1][0] <= 60 && hs[2][0] >= 85 && hs[2][0] <= 160;
        const grey = hs.every(x => x[1] < 0.12);
        if (mac || grey) hits.push([p.el.parentElement || p.el, `three ${mac ? 'red/yellow/green' : 'grey'} window dots`]);
      }
      for (const r of m.text) if (/^[$❯>]\s\w/.test(r.t) && MONO.test(family(r.s)) && lum(m.bgOf(r.el)) < 0.05) { hits.push([r.el, `terminal prompt "${short(r.t)}"`]); break; }
      return need(hits);
    },

    'uniform-spacing'(m) {
      const root = document.querySelector('main') || document.body;
      const secs = m.children(root).filter(r => r.r.height >= 200 && r.r.width >= m.vw * 0.8);
      const pads = secs.map(r => px(r.s.paddingTop)).filter(v => v >= 24);
      if (pads.length < 4) return null;
      const k = new Map();
      for (const v of pads) k.set(v, (k.get(v) || 0) + 1);
      const [v, n] = [...k].sort((a, b) => b[1] - a[1])[0];
      return n / secs.length >= 0.85 ? need([[root, `padding-top ${v}px on ${n} of ${secs.length} sections`]]) : null;
    },

    reveal(m) {
      const names = new Set();
      const walk = rules => {
        for (const rule of rules) {
          if (rule.type === CSSRule.KEYFRAMES_RULE) {
            const first = [...rule.cssRules].find(k => /^(from|0%)/.test(k.keyText));
            if (first && (first.style.opacity === '0' || /translate|scale/.test(first.style.transform + first.style.translate))) names.add(rule.name);
          } else if (rule.cssRules) walk(rule.cssRules);
        }
      };
      for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* cross-origin sheet */ } }
      const hits = [];
      for (const r of m.recs) {
        const anim = r.s.animationName.split(', ').some(n => names.has(n));
        const timeline = /view|scroll/.test(r.s.animationTimeline || '') && r.s.animationName !== 'none';
        const lib = r.el.matches('[data-aos], [data-sal], [data-scroll], [data-reveal], [data-animate]') ||
          /\b(reveal|fade-?(in|up)|animate-on-scroll|scroll-reveal|aos-animate|in-view)\b/i.test(r.el.className?.baseVal ?? r.el.className);
        const framer = /opacity:\s*1;?.*transform:\s*none/.test(r.el.getAttribute('style') || '');
        if (anim || timeline || lib || framer)
          hits.push([r.el, timeline ? `animation-timeline: ${r.s.animationTimeline}` : anim ? `animation: ${r.s.animationName}` : lib ? 'scroll-reveal class or attribute' : 'framer-motion entrance']);
      }
      return need(hits, 6);
    },

    'infinite-motion'(m) {
      const hits = [];
      for (const r of m.recs) {
        if (r.s.animationName === 'none' || !/infinite/.test(r.s.animationIterationCount) || r.s.animationPlayState === 'paused') continue;
        if (/spin|rotate|load|skeleton|shimmer/i.test(r.s.animationName) && r.r.width <= 48) continue;
        const kind = r.r.width <= 20 && r.r.height <= 20 ? 'pulsing dot' : r.el.scrollWidth > r.r.width * 1.5 || r.r.width > m.vw * 1.2 ? 'marquee' : /^[|_▍▌█]$/.test(r.t) ? 'blinking cursor' : 'looping animation';
        hits.push([r.el, `${kind}: ${r.s.animationName} ${r.s.animationDuration} infinite`]);
      }
      return need(hits);
    },

    bounce(m) {
      const hits = [];
      for (const r of m.recs) {
        const fn = `${r.s.transitionTimingFunction} ${r.s.animationTimingFunction}`;
        const over = [...fn.matchAll(/cubic-bezier\(([^)]*)\)/g)].some(x => { const v = x[1].split(',').map(Number); return v[1] > 1.05 || v[3] > 1.05 || v[1] < -0.05 || v[3] < -0.05; });
        if (over) hits.push([r.el, fn.match(/cubic-bezier\([^)]*\)/)[0]]);
      }
      return need(hits, 2);
    },

    emoji(m) {
      const hits = m.text
        .filter(r => EMOJI.test(r.t) && !/\p{Regional_Indicator}/u.test(r.t))
        .filter(r => r.t.replace(new RegExp(EMOJI.source, 'gu'), '').trim().length <= 2 ||
          (r.el.closest('h1, h2, h3, h4, nav, button, li') && EMOJI.test([...r.t][0] + ([...r.t][1] || ''))))
        .map(r => [r.el, `emoji "${short(r.t)}"`]);
      return need(hits, 2);
    },

    sparkles(m) {
      const hits = m.text.filter(r => /[✨🪄🤖🧠]/u.test(r.t)).map(r => [r.el, `"${short(r.t)}"`]);
      for (const svg of document.querySelectorAll('svg[class*="sparkle" i], svg[class*="lucide-bot" i], svg[class*="wand" i], [data-lucide="sparkles"], [data-lucide="bot"]')) {
        if (svg.getBoundingClientRect().width > 0) hits.push([svg.parentElement, `icon ${svg.getAttribute('class') || svg.getAttribute('data-lucide')}`]);
      }
      return need(hits);
    },
  };

  // Card-like boxes: rounded, and set off by a shadow, a border or their own background.
  function cardsOf(m, minRadius, minArea) {
    return m.recs.filter(r => {
      const area = r.r.width * r.r.height;
      if (area < minArea || r.r.width > m.vw * 0.95 || radius(r.s, r.r) < minRadius || radius(r.s, r.r) >= r.r.height / 2 - 1) return false;
      const bg = rgba(r.s.backgroundColor);
      const own = bg[3] > 0.05 && r.el.parentElement && bg.slice(0, 3).join() !== m.bgOf(r.el.parentElement).join();
      return r.s.boxShadow !== 'none' || border(r.s, 'Top') >= 1 || own;
    });
  }

  // Signs of hand-made work that lower the score: a type family that is neither a default nor on the template lists.
  function craft(m) {
    const out = [];
    const seen = new Set();
    for (const r of [m.h1, m.text.find(r => r.t.length > 60)].filter(Boolean)) {
      const f = family(r.s);
      if (seen.has(f) || !f || DEFAULT_SANS.test(f) || TRENDY.test(f) || MONO.test(f) || /^(serif|ui-\w+|georgia|times new roman|times)$/.test(f)) continue;
      if ([...document.fonts].some(ff => ff.family.replace(/["']/g, '').toLowerCase() === f && ff.status === 'loaded')) {
        seen.add(f);
        out.push({ id: 'custom-type', evidence: `${f} on ${r.el.tagName.toLowerCase()}` });
      }
    }
    return out.slice(0, 1);
  }

  let last = [];
  function scan(opts = {}) {
    styles.clear();
    const allow = new Set(opts.allow || []);
    const m = model((opts.ignore || []).join(', '));
    const fired = [];
    last = [];
    for (const [id, rule] of Object.entries(RULES)) {
      let res = null;
      try { res = rule(m); } catch (e) { console.warn('designizer', id, e); }
      if (!res) continue;
      const p = PATTERNS[id];
      const strength = res.w || p.w;
      fired.push({
        id, n: p.n, name: p.name, strength, scored: p.scored !== false, allowed: allow.has(id), count: res.hits.length,
        hits: res.hits.slice(0, 12).map(([el, evidence]) => ({ selector: selector(el), evidence })),
      });
      for (const [el] of res.hits) last.push({ id, el });
    }
    const credits = craft(m);
    const score = fired.filter(f => f.scored && !f.allowed).reduce((a, f) => a + WEIGHT[f.strength], 0) - credits.length;
    const threshold = opts.threshold ?? THRESHOLD;
    return { version: VERSION, url: location.href, score, threshold, verdict: score >= threshold ? 'ai' : 'human', fired, craft: credits };
  }

  function clear() {
    document.querySelectorAll('[data-designizer]').forEach(e => e.remove());
  }

  // Red outline and pattern label on every hit; pass pattern ids to show only those.
  function overlay(ids) {
    clear();
    const root = document.createElement('div');
    root.setAttribute('data-designizer', '');
    root.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
    const byEl = new Map();
    for (const { id, el } of last) if (!ids || ids.includes(id)) byEl.set(el, [...(byEl.get(el) || []), id]);
    for (const [el, list] of byEl) {
      const r = el.getBoundingClientRect();
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px;outline:2px solid #e5112b;outline-offset:1px;box-sizing:border-box`;
      const tag = document.createElement('div');
      tag.textContent = [...new Set(list)].map(id => `${PATTERNS[id].n} ${id}`).join(' · ');
      tag.style.cssText = 'position:absolute;left:-1px;bottom:100%;margin-bottom:3px;background:#e5112b;color:#fff;font:600 11px/1.3 system-ui,sans-serif;padding:1px 5px;white-space:nowrap;letter-spacing:0;text-transform:none';
      box.appendChild(tag);
      root.appendChild(box);
    }
    document.documentElement.appendChild(root);
    return byEl.size;
  }

  window.designizer = { version: VERSION, PATTERNS, scan, overlay, clear };
})();
