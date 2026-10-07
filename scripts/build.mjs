// Renders every animated SVG in assets/ (dark + light) from data/live.json.
// Zero dependencies: plain template strings, CSS keyframes, and SMIL motion.
//
// Motion rules used throughout:
// - Entrance animations only define their `from` state and use `backwards`
//   fill, so the resting markup is the final frame. With reduced motion every
//   animation is switched off and the static frame is still complete.
// - Elements that need a positional `transform` are wrapped in a <g>, because
//   a CSS transform animation would otherwise override the attribute.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const live = JSON.parse(await readFile(new URL('data/live.json', ROOT), 'utf8'));

const THEMES = {
  dark: {
    name: 'dark', bg: '#080808', panel: '#0F0F0F', panel2: '#161616', ink: '#F0EDE8', muted: '#A3A3A3',
    faint: '#666666', line: '#FFFFFF', lineO: 0.1, gridO: 0.045, accent: '#D7FF3F', accentFill: '#D7FF3F',
    onAccent: '#080808', glow: '#D7FF3F', glowO: 0.16, danger: '#FF6B57',
    easy: '#1CBBA6', medium: '#FFC01E', hard: '#FF4D6A',
    cf: { newbie: '#9A9A9A', pupil: '#3DBB4C', specialist: '#22C3B6', expert: '#6B8CFF', cm: '#C95BE0' },
  },
  light: {
    name: 'light', bg: '#F4F1EA', panel: '#FAF8F3', panel2: '#ECE8DE', ink: '#0A0A0A', muted: '#57544F',
    faint: '#9C978D', line: '#0A0A0A', lineO: 0.12, gridO: 0.055, accent: '#5F7D00', accentFill: '#D7FF3F',
    onAccent: '#080808', glow: '#A7D600', glowO: 0.24, danger: '#D93A22',
    easy: '#008F7E', medium: '#C98A00', hard: '#D6234A',
    cf: { newbie: '#808080', pupil: '#118A1E', specialist: '#008F86', expert: '#2A4FE0', cm: '#9A1FB0' },
  },
};

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => Number(n).toLocaleString('en-US');
// Monospace advance is ~0.6em across SF Mono, Menlo, DejaVu; Consolas is a bit narrower.
const monoW = (str, size, ls = 0) => str.length * (size * 0.6 + ls);
const EASE = 'cubic-bezier(.16,1,.3,1)';
const enter = (name, dur, delay) => `animation:${name} ${dur}s ${EASE} ${delay}s backwards`;

function baseCss(t) {
  return `
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}
.sans{font-family:Arial,Helvetica,'Liberation Sans',sans-serif}
.serif{font-family:Georgia,'Times New Roman',serif;font-style:italic}
.fb{transform-box:fill-box;transform-origin:center}
.fl{transform-box:fill-box;transform-origin:0 50%}
.fbt{transform-box:fill-box;transform-origin:50% 100%}
@keyframes rise{from{opacity:0;transform:translateY(16px)}}
@keyframes fade{from{opacity:0}}
@keyframes draw{from{stroke-dashoffset:1}}
@keyframes grow{from{transform:scaleX(0)}}
@keyframes growy{from{transform:scaleY(0)}}
@keyframes pop{from{opacity:0;transform:scale(.4)}}
@keyframes roll{from{transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes spinr{to{transform:rotate(-360deg)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
@keyframes ping{0%{transform:scale(.5);opacity:.9}80%,100%{transform:scale(2.8);opacity:0}}
@keyframes breathe{0%,100%{opacity:.75;transform:scale(1)}50%{opacity:1;transform:scale(1.08)}}
@keyframes dash{to{stroke-dashoffset:-28}}
@keyframes travel{from{stroke-dashoffset:1000}to{stroke-dashoffset:-200}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.motion{display:none}}`;
}

function svg(t, { w, h, title, desc, css = '', defs = '', body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" role="img" aria-labelledby="title desc">
<title id="title">${esc(title)}</title>
<desc id="desc">${esc(desc)}</desc>
<style>${baseCss(t)}${css}</style>
<defs>
<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" stroke="${t.line}" stroke-opacity="${t.gridO}"/></pattern>
<clipPath id="frame"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="26"/></clipPath>
${defs}
</defs>
<g clip-path="url(#frame)">
<rect width="${w}" height="${h}" fill="${t.bg}"/>
<rect width="${w}" height="${h}" fill="url(#grid)"/>
${body}
</g>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="26" stroke="${t.line}" stroke-opacity="${t.lineO + 0.02}" stroke-width="2"/>
</svg>
`;
}

// A rolling, slot-machine number. Each digit spins through two full cycles
// and lands on its value; the resting style is the final digit.
let odSeq = 0;
function odometer({ x, y, value, size, fill, delay = 0, weight = 800, cls = 'sans' }) {
  const id = `od${odSeq++}`;
  const adv = size * 0.6;
  const lh = size * 1.2;
  let cx = x;
  let digitIndex = 0;
  const parts = [];
  for (const ch of String(value)) {
    const isDigit = /\d/.test(ch);
    const w = isDigit ? adv : adv * 0.45;
    const mid = r1(cx + w / 2);
    if (isDigit) {
      const target = (10 + Number(ch)) * lh;
      const col = Array.from({ length: 20 }, (_, k) => `<text x="${mid}" y="${r1(y + k * lh)}" text-anchor="middle">${k % 10}</text>`).join('');
      const dur = 1.4 + digitIndex * 0.18;
      parts.push(`<g style="transform:translateY(-${r1(target)}px);animation:roll ${r1(dur)}s cubic-bezier(.12,.9,.25,1) ${delay}s backwards">${col}</g>`);
      digitIndex++;
    } else {
      parts.push(`<text x="${mid}" y="${y}" text-anchor="middle">${esc(ch)}</text>`);
    }
    cx += w;
  }
  return {
    width: cx - x,
    svg: `<clipPath id="${id}"><rect x="${r1(x - 4)}" y="${r1(y - size * 0.92)}" width="${r1(cx - x + 8)}" height="${r1(size * 1.18)}"/></clipPath>
<g clip-path="url(#${id})" class="${cls}" fill="${fill}" font-size="${size}" font-weight="${weight}">${parts.join('')}</g>`,
  };
}

// Pill row in monospace, wrapping inside maxW. Returns markup and height used.
function chips(t, items, { x, y, maxW, size = 12, h = 28, gap = 8, delay = 0, accentFirst = false }) {
  let cx = x;
  let cy = y;
  const out = [];
  items.forEach((label, i) => {
    const w = monoW(label, size) + 24;
    if (cx + w > x + maxW) {
      cx = x;
      cy += h + gap;
    }
    const strong = accentFirst && i === 0;
    out.push(`<g style="${enter('rise', 0.7, r1(delay + i * 0.06))}">
<rect x="${r1(cx)}" y="${cy}" width="${r1(w)}" height="${h}" rx="${h / 2}" fill="${strong ? t.accentFill : t.panel2}" stroke="${t.line}" stroke-opacity="${strong ? 0 : t.lineO}"/>
<text x="${r1(cx + 12)}" y="${cy + h / 2 + size * 0.36}" class="mono" font-size="${size}" fill="${strong ? t.onAccent : t.ink}" fill-opacity="${strong ? 1 : 0.86}">${esc(label)}</text>
</g>`);
    cx += w + gap;
  });
  return { svg: out.join('\n'), height: cy - y + h };
}

const label = (t, x, y, text, { size = 11, fill = t.accent, anchor = 'start', ls = 1.8, opacity = 1, style = '' } = {}) =>
  `<text x="${x}" y="${y}" class="mono" font-size="${size}" letter-spacing="${ls}" fill="${fill}" fill-opacity="${opacity}" text-anchor="${anchor}" style="${style}">${esc(text)}</text>`;

const pingDot = (t, x, y, r = 4, delay = 0, period = 2.4) => `
<circle cx="${x}" cy="${y}" r="${r}" fill="${t.accent}" class="fb" style="animation:ping ${period}s ${EASE} ${delay}s infinite"/>
<circle cx="${x}" cy="${y}" r="${r}" fill="${t.accent}"/>`;

const arrowBadge = (t, cx, cy) => `
<g style="${enter('pop', 0.6, 0.5)}" class="fb">
<circle cx="${cx}" cy="${cy}" r="19" fill="${t.panel2}" stroke="${t.line}" stroke-opacity="${t.lineO}"/>
<path d="M${cx - 5} ${cy + 5}L${cx + 5} ${cy - 5}M${cx - 3} ${cy - 5}H${cx + 5}V${cy + 3}" stroke="${t.ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</g>`;

// ---------------------------------------------------------------- derived facts

const cf = live.codeforces;
const lc = live.leetcode;
const firstExpert = cf.history.find((c) => c.r >= 1600);
const daysToExpert = firstExpert ? Math.round((firstExpert.t - cf.history[0].t) / 86400) : null;
const contestsToExpert = firstExpert ? cf.history.indexOf(firstExpert) + 1 : null;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- hero

function hero(t) {
  odSeq = 0;
  const W = 1200, H = 600;
  const C = { x: 1000, y: 268 };
  const R = 150;
  const nodes = [
    { a: -90, name: 'INTERFACE', dx: 0, dy: -16, anchor: 'middle' },
    { a: -30, name: 'API', dx: 14, dy: 4, anchor: 'start' },
    { a: 30, name: 'DATA', dx: 14, dy: 4, anchor: 'start' },
    { a: 90, name: 'AUTH', dx: 0, dy: 26, anchor: 'middle' },
    { a: 150, name: 'AI', dx: -14, dy: 4, anchor: 'end' },
    { a: 210, name: 'SHIP', dx: -14, dy: 4, anchor: 'end' },
  ].map((n) => ({ ...n, x: r1(C.x + R * Math.cos((n.a * Math.PI) / 180)), y: r1(C.y + R * Math.sin((n.a * Math.PI) / 180)) }));

  const spokes = nodes.map((n) => `M${C.x} ${C.y}L${n.x} ${n.y}`).join('');
  const packets = nodes.map((n, i) => {
    const out = i % 2 === 0;
    const path = out ? `M${C.x} ${C.y}L${n.x} ${n.y}` : `M${n.x} ${n.y}L${C.x} ${C.y}`;
    return `<circle r="3.2" fill="${t.accent}"><animateMotion dur="2.4s" begin="${r1(i * 0.4)}s" repeatCount="indefinite" path="${path}" keyTimes="0;1" keySplines=".5 0 .5 1" calcMode="spline"/></circle>`;
  }).join('');
  const nodeMarks = nodes.map((n, i) => `
${pingDot(t, n.x, n.y, 4.5, r1(i * 0.4 + (i % 2 === 0 ? 2.2 : 0)), 2.4)}
${label(t, n.x + n.dx, n.y + n.dy, n.name, { size: 10, fill: t.ink, anchor: n.anchor, ls: 1.6, opacity: 0.72 })}`).join('');

  const words = ['AI verification tooling.', 'member-commerce platforms.', 'real-time operations software.', 'media on web, mobile & TV.'];
  const lh = 34;
  const wordRows = [...words, words[0]].map((w, i) => `<text x="60" y="${404 + i * lh}">${esc(w)}</text>`).join('');
  const wordSteps = words.map((_, i) => {
    const a = i * 25;
    return `${a}%,${a + 20}%{transform:translateY(-${i * lh}px)}`;
  }).join('') + `100%{transform:translateY(-${words.length * lh}px)}`;

  const cfOd = odometer({ x: 18, y: 0, value: cf.rating, size: 22, fill: t.ink, delay: 1.3 });
  const lcOd = odometer({ x: 18, y: 0, value: fmt(lc.total), size: 22, fill: t.ink, delay: 1.45 });
  const cards = [
    { x: 60, w: 242, label: 'EXPERIENCE', value: `<text x="18" y="57" class="sans" font-size="20" font-weight="700" fill="${t.ink}">3+ years shipping</text>` },
    {
      x: 318, w: 242, label: `CODEFORCES · ${cf.rank.toUpperCase()}`,
      value: `<g transform="translate(0 57)">${cfOd.svg}</g><text x="${r1(18 + cfOd.width + 8)}" y="57" class="sans" font-size="20" font-weight="700" fill="${t.ink}">rating</text>`,
    },
    {
      x: 576, w: 242, label: 'LEETCODE',
      value: `<g transform="translate(0 57)">${lcOd.svg}</g><text x="${r1(18 + lcOd.width + 8)}" y="57" class="sans" font-size="20" font-weight="700" fill="${t.ink}">solved</text>`,
    },
    { x: 834, w: 306, label: 'SPECIALTY', lime: true, value: `<text x="18" y="57" class="sans" font-size="19" font-weight="800" fill="${t.onAccent}">Systems-minded products</text>` },
  ].map((c, i) => `
<g transform="translate(${c.x} 488)"><g style="${enter('rise', 0.9, r1(1 + i * 0.1))}">
<rect width="${c.w}" height="78" rx="14" fill="${c.lime ? t.accentFill : t.panel}" stroke="${t.line}" stroke-opacity="${c.lime ? 0 : t.lineO}"/>
${label(t, 18, 27, c.label, { size: 10, fill: c.lime ? t.onAccent : t.accent, ls: 1.5, opacity: c.lime ? 0.68 : 1 })}
${c.value}
</g></g>`).join('');

  const css = `
@keyframes lineup{from{transform:translateY(100px)}}
@keyframes words{${wordSteps}}
.words{animation:words 12s cubic-bezier(.7,0,.2,1) 2s infinite}
.sweep{transform-origin:${C.x}px ${C.y}px;animation:spin 7s linear infinite}
.ring{transform-origin:${C.x}px ${C.y}px;animation:spin 48s linear infinite}
.ringr{transform-origin:${C.x}px ${C.y}px;animation:spinr 80s linear infinite}
.glow{transform-origin:${C.x}px ${C.y}px;animation:breathe 6s ease-in-out infinite}
.trail{stroke-dasharray:140 1000;animation:travel 7s cubic-bezier(.5,0,.5,1) 1s infinite}`;

  const defs = `
<linearGradient id="edge" x1="0" y1="0" x2="1200" y2="600" gradientUnits="userSpaceOnUse"><stop stop-color="${t.accent}" stop-opacity=".6"/><stop offset=".45" stop-color="${t.accent}" stop-opacity=".07"/><stop offset="1" stop-color="${t.line}" stop-opacity=".12"/></linearGradient>
<radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${C.x} ${C.y}) scale(280)"><stop stop-color="${t.glow}" stop-opacity="${t.glowO}"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
<linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${t.accent}" stop-opacity="0"/><stop offset="1" stop-color="${t.accent}" stop-opacity=".22"/></linearGradient>
<clipPath id="l1"><rect x="40" y="128" width="760" height="100"/></clipPath>
<clipPath id="l2"><rect x="40" y="226" width="760" height="86"/></clipPath>
<clipPath id="win"><rect x="50" y="378" width="760" height="36"/></clipPath>`;

  const sweepEnd = { x: r1(C.x + (R + 20) * Math.cos(-Math.PI / 4.5)), y: r1(C.y + (R + 20) * Math.sin(-Math.PI / 4.5)) };

  const body = `
<rect width="${W}" height="${H}" fill="url(#glow)" class="glow"/>
<path d="M-20 520C220 462 349 531 566 484C804 432 929 298 1228 333" stroke="url(#edge)" stroke-width="1.5"/>
<path d="M-20 520C220 462 349 531 566 484C804 432 929 298 1228 333" stroke="${t.accent}" stroke-width="2.5" stroke-linecap="round" pathLength="1000" class="trail"/>

<g style="${enter('fade', 1.6, 0.2)}">
<circle cx="${C.x}" cy="${C.y}" r="${R + 20}" stroke="${t.line}" stroke-opacity="${t.lineO + 0.02}"/>
<circle cx="${C.x}" cy="${C.y}" r="${R - 42}" stroke="${t.accent}" stroke-opacity=".45" stroke-dasharray="3 9" class="ring"/>
<circle cx="${C.x}" cy="${C.y}" r="${R + 20}" stroke="${t.accent}" stroke-opacity=".5" stroke-dasharray="1 15" stroke-width="3" stroke-linecap="round" class="ringr"/>
<path d="M${C.x} ${C.y}L${C.x + R + 20} ${C.y}A${R + 20} ${R + 20} 0 0 0 ${sweepEnd.x} ${sweepEnd.y}Z" fill="url(#sweepGrad)" class="sweep"/>
<path d="${spokes}" stroke="${t.line}" stroke-opacity="${t.lineO}"/>
<g class="motion">${packets}</g>
<circle r="5" fill="${t.ink}" class="motion"><animateMotion dur="14s" repeatCount="indefinite" path="M${C.x - R - 20} ${C.y}a${R + 20} ${R + 20} 0 1 1 ${2 * (R + 20)} 0a${R + 20} ${R + 20} 0 1 1 -${2 * (R + 20)} 0"/></circle>
${nodeMarks}
<circle cx="${C.x}" cy="${C.y}" r="64" fill="${t.accent}" fill-opacity=".06" stroke="${t.accent}" stroke-opacity=".55"/>
<rect x="${C.x - 60}" y="${C.y - 31}" width="120" height="62" rx="10" fill="${t.panel}" stroke="${t.line}" stroke-opacity="${t.lineO + 0.06}"/>
${label(t, C.x, C.y - 6, 'SYSTEM', { size: 10, anchor: 'middle', ls: 2 })}
<text x="${C.x}" y="${C.y + 14}" class="sans" font-size="12" font-weight="700" fill="${t.ink}" text-anchor="middle">END TO END</text>
</g>

<g class="mono" font-size="11" letter-spacing="1.8" style="${enter('fade', 1, 0)}">
<text x="60" y="54" fill="${t.ink}">KIDUS / MESFIN</text>
<text x="1140" y="54" fill="${t.muted}" text-anchor="end">ADDIS ABABA · UTC+3</text>
</g>
${pingDot(t, 64, 87, 4, 0.4)}
${label(t, 80, 91, 'AVAILABLE FOR AMBITIOUS PRODUCT WORK', { style: enter('fade', 1, 0.3) })}

<g clip-path="url(#l1)"><text x="58" y="215" class="sans" font-size="78" font-weight="800" letter-spacing="-3.6" fill="${t.ink}" style="${enter('lineup', 1.1, 0.15)}">BUILDING THE</text></g>
<g clip-path="url(#l2)"><text x="58" y="296" class="serif" font-size="84" letter-spacing="-3" fill="${t.ink}" style="${enter('lineup', 1.1, 0.3)}">whole system.</text></g>
<rect x="60" y="322" width="480" height="2" fill="${t.accent}" class="fl" style="${enter('grow', 1.2, 0.7)}"/>

${label(t, 60, 360, '> NOW SHIPPING', { size: 11, fill: t.muted, style: enter('fade', 0.8, 0.9) })}
<g clip-path="url(#win)" style="${enter('fade', 0.8, 1)}"><g class="words sans" font-size="26" font-weight="700" fill="${t.ink}">${wordRows}</g></g>
<text x="60" y="446" class="sans" font-size="17" fill="${t.muted}" style="${enter('rise', 0.9, 1.1)}">Interfaces, services, data, and delivery — designed as one system.</text>

${cards}`;

  return svg(t, {
    w: W, h: H, css, defs, body,
    title: 'Kidus Mesfin — building the whole system',
    desc: `Animated banner: Kidus Mesfin, software engineer in Addis Ababa. Builds interfaces, services, data and delivery as one system. 3+ years shipping, Codeforces ${cap(cf.rank)} rated ${cf.rating}, ${fmt(lc.total)} LeetCode problems solved.`,
  });
}

// ---------------------------------------------------------------- flagship: MaruCheck

function marucheck(t) {
  odSeq = 0;
  const W = 1200, H = 440;
  const term = { x: 612, y: 44, w: 548, h: 352 };
  const fs = 13;
  const lh = 24;
  const cycle = 14;
  // Mirrors the real `maru verify --diff` demo in the MaruCheck repo.
  const lines = [
    { text: '$ npm test', type: true, at: 4 },
    { text: '      Tests  4 passed (4)', at: 13, fill: t.accent },
    { text: '# Green. The suite agrees with the code the agent wrote.', at: 17, fill: t.faint },
    { text: '$ maru verify --diff', type: true, at: 24 },
    { text: 'Risk: MODERATE (30/100) · contract: usage-quota', at: 38, fill: t.muted },
    { text: 'Verification gate: BLOCKED', at: 43, fill: t.danger, bold: true },
    { text: '[HIGH] BLOCKING  QUOTA-001 verification failed', at: 49, fill: t.ink },
    { text: '  Expected: at most 10 generations per month', at: 53, fill: t.muted },
    { text: '  Actual:   Received: "pro"', at: 57, fill: t.danger },
    { text: '# The tests moved. The contract did not.', at: 64, fill: t.faint },
  ];
  const x0 = term.x + 24;
  const y0 = term.y + 74;
  const keyframes = [];
  const rows = lines.map((ln, i) => {
    const y = y0 + i * lh;
    const k = `l${i}`;
    keyframes.push(`@keyframes ${k}{0%,${ln.at}%{opacity:0}${ln.at + 0.5}%,94%{opacity:1}97%,100%{opacity:0}}`);
    let typing = '';
    if (ln.type) {
      const w = r1(monoW(ln.text, fs) + 4);
      const end = ln.at + 8;
      const n = ln.text.length;
      keyframes.push(`@keyframes c${i}{0%,${ln.at + 0.5}%{transform:translateX(${w}px)}${ln.at + 0.6}%{transform:translateX(0);animation-timing-function:steps(${n},end)}${end}%,100%{transform:translateX(${w}px)}}`);
      keyframes.push(`@keyframes k${i}{0%,${ln.at}%{opacity:0}${ln.at + 0.5}%,${end + 3}%{opacity:1}${end + 3.5}%,100%{opacity:0}}`);
      // A panel-colored shutter slides right in steps, revealing one character at a time.
      typing = `<g style="animation:c${i} ${cycle}s linear infinite;transform:translateX(${w}px)"><rect x="${x0 - 2}" y="${y - 17}" width="${w + 20}" height="${lh}" fill="${t.panel}"/><rect x="${x0}" y="${y - 13}" width="8" height="17" fill="${t.accent}" style="animation:k${i} ${cycle}s linear infinite;opacity:0"/></g>`;
    }
    const isCmd = ln.text.startsWith('$');
    const content = isCmd
      ? `<tspan fill="${t.accent}">$</tspan><tspan fill="${t.ink}">${esc(ln.text.slice(1))}</tspan>`
      : esc(ln.text);
    return `<g style="animation:${k} ${cycle}s linear infinite"><text x="${x0}" y="${y}" class="mono" font-size="${fs}" fill="${ln.fill ?? t.ink}" font-weight="${ln.bold ? 700 : 400}" xml:space="preserve">${content}</text>${typing}</g>`;
  }).join('\n');

  const blocked = `@keyframes stamp{0%,43%{opacity:0;transform:scale(1.6)}44.5%,94%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}`;
  const chipRow = chips(t, ['TypeScript', 'Node 24', 'CLI', 'MCP server', 'Playwright', 'GitHub Actions'], { x: 48, y: 312, maxW: 520, delay: 0.7, accentFirst: false });

  const css = `${keyframes.join('\n')}\n${blocked}\n.stamp{animation:stamp ${cycle}s ${EASE} infinite}`;
  const body = `
<rect x="760" y="-80" width="560" height="560" fill="url(#mglow)"/>
<g style="${enter('fade', 0.8, 0)}">
${label(t, 48, 58, `00 / FLAGSHIP · OPEN SOURCE · NPM v${live.marucheck.version}`)}
</g>
<g style="${enter('rise', 1, 0.1)}"><text x="46" y="128" class="sans" font-size="60" font-weight="800" letter-spacing="-2.4" fill="${t.ink}">MaruCheck</text></g>
<g style="${enter('rise', 1, 0.2)}"><text x="48" y="174" class="serif" font-size="32" letter-spacing="-.6" fill="${t.accent}">Test what your AI didn’t.</text></g>
<g class="sans" font-size="16" fill="${t.muted}" style="${enter('rise', 1, 0.35)}">
<text x="48" y="220">Independent QA for AI-generated software. Verifies agent</text>
<text x="48" y="244">changes against a human-owned Quality Contract the agent</text>
<text x="48" y="268">can’t edit. Local-first: no account, no API key, no upload.</text>
</g>
${chipRow.svg}
<g style="${enter('fade', 1, 0.9)}">${label(t, 48, 404, 'RUNS AS A CLI, A CI GATE, AND A CLAUDE CODE STOP HOOK', { size: 10, fill: t.faint, ls: 1.4 })}</g>

<g style="${enter('rise', 1.1, 0.25)}">
<rect x="${term.x}" y="${term.y}" width="${term.w}" height="${term.h}" rx="16" fill="${t.panel}" stroke="${t.line}" stroke-opacity="${t.lineO + 0.04}"/>
<path d="M${term.x} ${term.y + 40}H${term.x + term.w}" stroke="${t.line}" stroke-opacity="${t.lineO}"/>
<circle cx="${term.x + 22}" cy="${term.y + 20}" r="5" fill="${t.danger}" fill-opacity=".85"/>
<circle cx="${term.x + 40}" cy="${term.y + 20}" r="5" fill="${t.medium}" fill-opacity=".85"/>
<circle cx="${term.x + 58}" cy="${term.y + 20}" r="5" fill="${t.accent}" fill-opacity=".85"/>
${label(t, term.x + term.w / 2, term.y + 24, 'examples/quota-app — maru', { size: 11, fill: t.faint, anchor: 'middle', ls: 0.6 })}
${rows}
<g class="stamp fb"><g transform="translate(${term.x + term.w - 132} ${term.y + 186})">
<rect width="108" height="30" rx="6" fill="${t.danger}" transform="rotate(-6 54 15)"/>
<text x="54" y="20" class="mono" font-size="13" font-weight="700" letter-spacing="2" fill="#FFFFFF" text-anchor="middle" transform="rotate(-6 54 15)">BLOCKED</text>
</g></g>
</g>`;
  const defs = `<radialGradient id="mglow" cx=".5" cy=".5" r=".5"><stop stop-color="${t.glow}" stop-opacity="${t.glowO * 0.8}"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>`;
  return svg(t, {
    w: W, h: H, css, defs, body,
    title: 'MaruCheck — test what your AI didn’t',
    desc: 'Flagship open-source project. A terminal replays MaruCheck blocking an AI-written change: the test suite is green, but maru verify --diff finds the change violates the approved Quality Contract and blocks it.',
  });
}

// ---------------------------------------------------------------- project cards

function card(t, { index, kind, title, tagline, stack, art, artCss = '', artDefs = '', desc }) {
  odSeq = 0;
  const W = 600, H = 440;
  const chipRow = chips(t, stack, { x: 32, y: 380, maxW: 536, size: 11, h: 26, gap: 6, delay: 0.5 });
  const body = `
<g style="${enter('fade', 0.8, 0)}">${label(t, 32, 48, `${index} / ${kind}`, { size: 11 })}</g>
${arrowBadge(t, 548, 44)}
<g style="${enter('fade', 1.2, 0.15)}">
<rect x="24" y="72" width="552" height="200" rx="16" fill="${t.panel}" stroke="${t.line}" stroke-opacity="${t.lineO}"/>
${art}
</g>
<g style="${enter('rise', 0.9, 0.2)}"><text x="30" y="322" class="sans" font-size="34" font-weight="800" letter-spacing="-1.2" fill="${t.ink}">${esc(title)}</text></g>
<g style="${enter('rise', 0.9, 0.3)}"><text x="32" y="354" class="sans" font-size="16" fill="${t.muted}">${esc(tagline)}</text></g>
${chipRow.svg}`;
  return svg(t, { w: W, h: H, css: artCss, defs: artDefs, body, title: `${title} — ${tagline}`, desc });
}

function qrModules(seed, n) {
  // Deterministic pseudo-random pattern with the three finder squares.
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const cells = [];
  const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!finder(r, c) && rand() > 0.52) cells.push([r, c]);
  return cells;
}

function oritTej(t) {
  const px = 64, py = 90, pw = 112, ph = 168;
  const n = 21, cell = 3.6;
  const qx = px + (pw - n * cell) / 2, qy = py + 44;
  const finder = (r, c) => {
    const x = qx + c * cell, y = qy + r * cell;
    return `<rect x="${r1(x + cell / 2)}" y="${r1(y + cell / 2)}" width="${r1(cell * 6)}" height="${r1(cell * 6)}" stroke="${t.ink}" stroke-width="${cell}"/><rect x="${r1(x + cell * 2)}" y="${r1(y + cell * 2)}" width="${r1(cell * 3)}" height="${r1(cell * 3)}" fill="${t.ink}"/>`;
  };
  const qr = qrModules(7, n).map(([r, c]) => `<rect x="${r1(qx + c * cell)}" y="${r1(qy + r * cell)}" width="${cell}" height="${cell}"/>`).join('');
  const qSize = n * cell;
  const cycle = 9;
  const events = [
    { title: 'Membership renewed', meta: 'STRIPE · RECURRING', at: 6 },
    { title: 'Inventory broadcast', meta: 'PUSH · ALL MEMBERS', at: 30 },
    { title: 'Pickup verified', meta: 'QR · SINGLE USE', at: 58, done: true },
  ];
  const kf = events.map((e, i) => `@keyframes ev${i}{0%,${e.at}%{opacity:0;transform:translateX(24px)}${e.at + 6}%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}`).join('');
  const rows = events.map((e, i) => {
    const y = 92 + i * 58;
    const icon = e.done
      ? `<circle cx="248" cy="${y + 23}" r="12" fill="${t.accentFill}"/><path d="M242.5 ${y + 23}l3.8 3.8 7-7.6" stroke="${t.onAccent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<circle cx="248" cy="${y + 23}" r="12" stroke="${t.accent}" stroke-opacity=".7"/><circle cx="248" cy="${y + 23}" r="4" fill="${t.accent}"/>`;
    return `<g style="animation:ev${i} ${cycle}s ${EASE} infinite">
<rect x="222" y="${y}" width="330" height="46" rx="12" fill="${t.panel2}" stroke="${t.line}" stroke-opacity="${t.lineO}"/>
${icon}
<text x="272" y="${y + 20}" class="sans" font-size="14" font-weight="700" fill="${t.ink}">${e.title}</text>
<text x="272" y="${y + 36}" class="mono" font-size="10" letter-spacing="1.2" fill="${t.muted}">${e.meta}</text>
</g>`;
  }).join('');
  const art = `
<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="20" fill="${t.panel2}" stroke="${t.ink}" stroke-opacity=".5" stroke-width="1.5"/>
<rect x="${px + pw / 2 - 16}" y="${py + 10}" width="32" height="6" rx="3" fill="${t.ink}" fill-opacity=".35"/>
${label(t, px + pw / 2, py + 34, 'ORIT TEJ', { size: 9, fill: t.ink, anchor: 'middle', ls: 1.6, opacity: 0.7 })}
<rect x="${r1(qx - 6)}" y="${r1(qy - 6)}" width="${r1(qSize + 12)}" height="${r1(qSize + 12)}" rx="6" fill="${t.panel}"/>
<g fill="${t.ink}">${qr}${finder(0, 0)}${finder(0, n - 7)}${finder(n - 7, 0)}</g>
<g class="scan"><rect x="${r1(qx - 8)}" y="${r1(qy - 2)}" width="${r1(qSize + 16)}" height="18" fill="url(#beam)"/><rect x="${r1(qx - 8)}" y="${r1(qy + 15)}" width="${r1(qSize + 16)}" height="2" rx="1" fill="${t.accent}"/></g>
${label(t, px + pw / 2, py + ph - 14, 'TAP TO PICK UP', { size: 8, fill: t.accent, anchor: 'middle', ls: 1.4 })}
<path d="M186 174H214" stroke="${t.accent}" stroke-opacity=".6" stroke-dasharray="4 10" style="animation:dash 1.2s linear infinite"/>
${rows}`;
  const artCss = `${kf}
@keyframes scan{0%,100%{transform:translateY(0)}50%{transform:translateY(${r1(qSize - 14)}px)}}
.scan{animation:scan 2.6s ease-in-out infinite}`;
  const artDefs = `<linearGradient id="beam" x1="0" y1="1" x2="0" y2="0"><stop stop-color="${t.accent}" stop-opacity=".45"/><stop offset="1" stop-color="${t.accent}" stop-opacity="0"/></linearGradient>`;
  return card(t, {
    index: '01', kind: 'MEMBER COMMERCE', title: 'Orit Tej',
    tagline: 'Mobile membership & pickup ecosystem, end to end.',
    stack: ['Flutter', 'Next.js', 'TypeScript', 'Neon Postgres', 'Drizzle', 'Stripe'],
    art, artCss, artDefs,
    desc: 'Orit Tej: a phone scans a one-time pickup QR code while events stream in: membership renewed via recurring Stripe billing, inventory broadcast to all members, pickup verified.',
  });
}

function prospectAI(t) {
  const sources = ['WEBSITE', 'GITHUB', 'NOTES', 'SCREENSHOT'];
  const hub = { x: 316, y: 172 };
  const cycle = 6;
  const src = sources.map((s, i) => {
    const y = 96 + i * 44;
    const path = `M168 ${y + 14}C230 ${y + 14} 250 ${hub.y} ${hub.x - 36} ${hub.y}`;
    return `
<rect x="44" y="${y}" width="124" height="28" rx="14" fill="${t.panel2}" stroke="${t.line}" stroke-opacity="${t.lineO}"/>
<circle cx="60" cy="${y + 14}" r="3.5" fill="${t.accent}" style="animation:blink 1.8s ease-in-out ${r1(i * 0.45)}s infinite"/>
<text x="72" y="${y + 18}" class="mono" font-size="10" letter-spacing="1.2" fill="${t.ink}" fill-opacity=".85">${s}</text>
<path d="${path}" stroke="${t.line}" stroke-opacity="${t.lineO + 0.04}"/>
<circle r="3" fill="${t.accent}" class="motion"><animateMotion dur="1.8s" begin="${r1(i * 0.45)}s" repeatCount="indefinite" path="${path}" keyTimes="0;1" keySplines=".4 0 .6 1" calcMode="spline"/></circle>`;
  }).join('');
  const lines = [180, 160, 172, 120, 150].map((w, i) => {
    const at = 20 + i * 11;
    return { w, y: 132 + i * 18, at, kf: `@keyframes ln${i}{0%,${at}%{transform:scaleX(0)}${at + 9}%,90%{transform:scaleX(1)}96%,100%{transform:scaleX(0)}}` };
  });
  const art = `
${src}
<circle cx="${hub.x}" cy="${hub.y}" r="46" stroke="${t.accent}" stroke-opacity=".5" stroke-dasharray="3 7" class="hubring"/>
<circle cx="${hub.x}" cy="${hub.y}" r="34" fill="${t.panel2}" stroke="${t.accent}" stroke-opacity=".8" class="fb" style="animation:breathe 1.8s ease-in-out infinite"/>
<text x="${hub.x}" y="${hub.y + 7}" class="sans" font-size="20" font-weight="800" fill="${t.accent}" text-anchor="middle">AI</text>
${label(t, hub.x, hub.y + 70, 'SYNTHESIZE', { size: 9, fill: t.muted, anchor: 'middle', ls: 1.6 })}
<path id="out" d="M${hub.x + 46} ${hub.y}H378" stroke="${t.line}" stroke-opacity="${t.lineO + 0.04}"/>
<circle r="3" fill="${t.accent}" class="motion"><animateMotion dur="1.2s" repeatCount="indefinite" path="M${hub.x + 46} ${hub.y}H378"/></circle>
<rect x="380" y="90" width="176" height="164" rx="12" fill="${t.panel2}" stroke="${t.line}" stroke-opacity="${t.lineO}"/>
${label(t, 396, 114, 'TAILORED MESSAGE', { size: 9, ls: 1.4 })}
${lines.map((l, i) => `<rect x="396" y="${l.y}" width="${l.w - 52}" height="7" rx="3.5" fill="${t.ink}" fill-opacity="${i === 0 ? 0.55 : 0.28}" class="fl" style="animation:ln${i} ${cycle}s ${EASE} infinite"/>`).join('')}
<g style="animation:sent ${cycle}s ${EASE} infinite" class="fb"><rect x="396" y="222" width="72" height="20" rx="10" fill="${t.accentFill}"/><text x="432" y="236" class="mono" font-size="9" font-weight="700" letter-spacing="1.2" fill="${t.onAccent}" text-anchor="middle">READY</text></g>
${label(t, 540, 236, '4 SOURCES', { size: 8, fill: t.faint, anchor: 'end', ls: 1 })}`;
  const artCss = `${lines.map((l) => l.kf).join('')}
@keyframes sent{0%,76%{opacity:0;transform:scale(.6)}80%,90%{opacity:1;transform:scale(1)}96%,100%{opacity:0}}
.hubring{transform-origin:${hub.x}px ${hub.y}px;animation:spin 10s linear infinite}`;
  return card(t, {
    index: '02', kind: 'APPLIED AI', title: 'ProspectAI',
    tagline: 'Research-to-outreach workspace with explainable context.',
    stack: ['Next.js 15', 'React', 'TypeScript', 'Postgres', 'Better Auth', 'OpenRouter'],
    art, artCss,
    desc: 'ProspectAI: websites, GitHub signals, notes and screenshots flow into an AI synthesis step that writes a tailored, explainable outreach message.',
  });
}

function streamSynx(t) {
  const cycle = 8;
  const screen = (x, y, w, h, id) => `
<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/></clipPath>
<g clip-path="url(#${id})">
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${t.panel2}"/>
<g class="film"><rect x="${x - 60}" y="${y}" width="${w + 120}" height="${h}" fill="url(#film)"/></g>
<rect x="${x + 6}" y="${y + h - 9}" width="${w - 12}" height="3" rx="1.5" fill="${t.ink}" fill-opacity=".2"/>
<rect x="${x + 6}" y="${y + h - 9}" width="${w - 12}" height="3" rx="1.5" fill="${t.accent}" class="fl play"/>
</g>`;
  const room = { x: 300, y: 98 };
  const devices = [
    { name: 'WEB', cx: 128, top: 140 },
    { name: 'MOBILE', cx: 300, top: 140 },
    { name: 'ANDROID TV', cx: 456, top: 140 },
  ];
  const links = devices.map((d, i) => `<path d="M${room.x} ${room.y + 12}C${room.x} ${room.y + 34} ${d.cx} ${d.top - 22} ${d.cx} ${d.top - 4}" stroke="${t.accent}" stroke-opacity=".5" stroke-dasharray="4 10" style="animation:dash 1.4s linear ${r1(i * 0.2)}s infinite"/>`).join('');
  const bubbles = [
    { x: 168, y: 104, text: 'this scene!', at: 15 },
    { x: 380, y: 104, text: 'synced', at: 50 },
  ];
  const art = `
${links}
<rect x="${room.x - 74}" y="${room.y - 14}" width="148" height="28" rx="14" fill="${t.accentFill}"/>
<circle cx="${room.x - 58}" cy="${room.y}" r="4" fill="${t.onAccent}" style="animation:blink 1.4s ease-in-out infinite"/>
<text x="${room.x + 6}" y="${room.y + 4}" class="mono" font-size="10" font-weight="700" letter-spacing="1.4" fill="${t.onAccent}" text-anchor="middle">PARTY ROOM</text>
<rect x="48" y="142" width="160" height="96" rx="8" stroke="${t.ink}" stroke-opacity=".5" stroke-width="1.5"/>
${screen(54, 148, 148, 84, 's1')}
<path d="M36 244H220l-8 8H44z" fill="${t.ink}" fill-opacity=".35"/>
<rect x="268" y="138" width="64" height="112" rx="12" stroke="${t.ink}" stroke-opacity=".5" stroke-width="1.5"/>
${screen(274, 150, 52, 88, 's2')}
<rect x="370" y="142" width="172" height="98" rx="6" stroke="${t.ink}" stroke-opacity=".5" stroke-width="1.5"/>
${screen(376, 148, 160, 86, 's3')}
<path d="M436 246H476" stroke="${t.ink}" stroke-opacity=".4" stroke-width="3" stroke-linecap="round"/>
${devices.map((d) => label(t, d.cx, 266, d.name, { size: 9, fill: t.muted, anchor: 'middle', ls: 1.4 })).join('')}
${bubbles.map((b, i) => `<g style="animation:bub${i} ${cycle}s ${EASE} infinite" class="fbt"><rect x="${b.x - monoW(b.text, 10) / 2 - 10}" y="${b.y - 12}" width="${r1(monoW(b.text, 10) + 20)}" height="22" rx="11" fill="${t.panel2}" stroke="${t.line}" stroke-opacity="${t.lineO + 0.06}"/><text x="${b.x}" y="${b.y + 3}" class="mono" font-size="10" fill="${t.ink}" text-anchor="middle">${b.text}</text></g>`).join('')}`;
  const artCss = `
@keyframes play{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes film{from{transform:translateX(0)}to{transform:translateX(60px)}}
.play{animation:play ${cycle}s linear infinite}
.film{animation:film ${cycle / 2}s linear infinite}
${bubbles.map((b, i) => `@keyframes bub${i}{0%,${b.at}%{opacity:0;transform:scale(.5)}${b.at + 5}%,${b.at + 30}%{opacity:1;transform:scale(1)}${b.at + 36}%,100%{opacity:0;transform:scale(1)}}`).join('')}`;
  const artDefs = `<linearGradient id="film" x1="0" y1="0" x2="60" y2="0" gradientUnits="userSpaceOnUse" spreadMethod="repeat"><stop stop-color="${t.accent}" stop-opacity=".02"/><stop offset=".5" stop-color="${t.accent}" stop-opacity=".2"/><stop offset="1" stop-color="${t.accent}" stop-opacity=".02"/></linearGradient>`;
  return card(t, {
    index: '03', kind: 'MULTI-SURFACE PRODUCT', title: 'StreamSynx',
    tagline: 'Social viewing across web, mobile, and Android TV.',
    stack: ['Next.js', 'Flutter', 'Android TV', 'Firebase', 'TMDB'],
    art, artCss, artDefs,
    desc: 'StreamSynx: a web browser, a phone and an Android TV play the same title with progress bars moving in perfect sync, connected to a real-time watch-party room with chat.',
  });
}

function ozKitchen(t) {
  const y = 176;
  const stations = ['ORDER', 'KITCHEN', 'DISPATCH', 'DELIVERED'].map((name, i) => ({ name, x: 80 + i * 146 }));
  const x0 = stations[0].x, x1 = stations[3].x;
  const cycle = 8;
  // Tokens dwell at each station: keyPoints hold while keyTimes advance.
  const keyPoints = '0;0;0.333;0.333;0.667;0.667;1;1';
  const keyTimes = '0;0.08;0.25;0.33;0.5;0.58;0.75;1';
  const tokens = [0, 1, 2].map((i) => `
<g class="motion"><g>
<animateMotion dur="${cycle}s" begin="-${r1((i * cycle) / 3)}s" repeatCount="indefinite" path="M${x0} ${y}H${x1}" keyPoints="${keyPoints}" keyTimes="${keyTimes}" calcMode="linear"/>
<rect x="-17" y="-34" width="34" height="22" rx="6" fill="${t.accentFill}"/>
<path d="M-8 -26h16M-8 -20h10" stroke="${t.onAccent}" stroke-width="2" stroke-linecap="round"/>
<path d="M0 -12v6" stroke="${t.accent}" stroke-width="1.5"/>
</g></g>`).join('');
  const st = stations.map((s, i) => `
<circle cx="${s.x}" cy="${y}" r="16" fill="${t.panel2}" stroke="${t.accent}" stroke-opacity=".7"/>
<circle cx="${s.x}" cy="${y}" r="16" stroke="${t.accent}" class="fb" style="animation:ping ${r1(cycle / 3)}s ${EASE} ${r1((i * 0.25 * cycle) % (cycle / 3))}s infinite"/>
<text x="${s.x}" y="${y + 4}" class="mono" font-size="10" font-weight="700" fill="${t.accent}" text-anchor="middle">0${i + 1}</text>
${label(t, s.x, y + 40, s.name, { size: 9, fill: t.muted, anchor: 'middle', ls: 1.4 })}`).join('');
  const toasts = [
    { text: 'TELEGRAM · rider assigned', at: 10 },
    { text: 'REALTIME · queue updated', at: 55 },
  ];
  const art = `
${label(t, 44, 104, 'LIVE OPERATIONS', { size: 9, fill: t.muted, ls: 1.6 })}
${pingDot(t, 160, 101, 3, 0)}
<path d="M${x0} ${y}H${x1}" stroke="${t.line}" stroke-opacity="${t.lineO + 0.06}" stroke-width="4" stroke-linecap="round"/>
<path d="M${x0} ${y}H${x1}" stroke="${t.accent}" stroke-opacity=".7" stroke-width="2" stroke-dasharray="4 10" style="animation:dash 1s linear infinite"/>
${st}
${tokens}
${toasts.map((b, i) => {
    const w = r1(monoW(b.text, 10) + 24);
    return `<g style="animation:toast${i} ${cycle}s ${EASE} infinite"><rect x="${556 - w}" y="88" width="${w}" height="26" rx="13" fill="${t.panel2}" stroke="${t.accent}" stroke-opacity=".5"/><text x="${556 - w / 2}" y="105" class="mono" font-size="10" fill="${t.ink}" text-anchor="middle">${esc(b.text)}</text></g>`;
  }).join('')}
${label(t, 300, 258, 'POSTGRES · ROW-LEVEL SECURITY · ONE SOURCE OF TRUTH', { size: 9, fill: t.faint, anchor: 'middle', ls: 1.3 })}`;
  const artCss = toasts.map((b, i) => `@keyframes toast${i}{0%,${b.at}%{opacity:0;transform:translateY(-10px)}${b.at + 5}%,${b.at + 30}%{opacity:1;transform:translateY(0)}${b.at + 36}%,100%{opacity:0;transform:translateY(0)}}`).join('');
  return card(t, {
    index: '04', kind: 'OPERATIONS PLATFORM', title: 'Oz Kitchen',
    tagline: 'One operational system, from order to delivery.',
    stack: ['React', 'TypeScript', 'Supabase', 'PostgreSQL', 'RLS', 'Telegram bots'],
    art, artCss,
    desc: 'Oz Kitchen: orders travel along a live pipeline from order to kitchen to dispatch to delivered, while Telegram and real-time notifications pop in.',
  });
}

// ---------------------------------------------------------------- operating range

function range(t) {
  const W = 1200, H = 380;
  const cycle = 8;
  const stages = [
    { n: '01 / DISCOVER', h: 'Find the real job.', a: 'Domain · people · constraints', b: 'Risks · success criteria' },
    { n: '02 / DESIGN', h: 'Make it coherent.', a: 'Experience · architecture', b: 'Data · states · boundaries' },
    { n: '03 / BUILD', h: 'Connect the layers.', a: 'Web · mobile · APIs', b: 'Auth · data · integrations' },
    { n: '04 / SHIP', h: 'Own the outcome.', a: 'Test · deploy · observe', b: 'Learn · refine · maintain' },
  ];
  const xs = [48, 330, 612, 894];
  const kf = stages.map((_, i) => {
    const a = i * 22;
    return `@keyframes lit${i}{0%,${a}%{opacity:0}${a + 4}%,${a + 22}%{opacity:1}${a + 30}%,100%{opacity:0}}`;
  }).join('');
  const cards = stages.map((s, i) => {
    const last = i === 3;
    const w = last ? 258 : 244;
    return `<g transform="translate(${xs[i]} 128)"><g style="${enter('rise', 0.9, r1(0.2 + i * 0.12))}">
<rect width="${w}" height="150" rx="16" fill="${last ? t.accentFill : t.panel}" stroke="${t.line}" stroke-opacity="${last ? 0 : t.lineO}"/>
<rect x="-1" y="-1" width="${w + 2}" height="152" rx="17" stroke="${last ? t.ink : t.accent}" stroke-width="2" style="animation:lit${i} ${cycle}s ease-in-out infinite;opacity:0"/>
<text x="20" y="31" class="mono" font-size="10" letter-spacing="1.5" fill="${last ? t.onAccent : t.accent}" fill-opacity="${last ? 0.66 : 1}">${s.n}</text>
<text x="20" y="66" class="sans" font-size="21" font-weight="${last ? 800 : 700}" fill="${last ? t.onAccent : t.ink}">${s.h}</text>
<text x="20" y="96" class="sans" font-size="13" fill="${last ? t.onAccent : t.muted}" fill-opacity="${last ? 0.7 : 1}">${s.a}</text>
<text x="20" y="119" class="sans" font-size="13" fill="${last ? t.onAccent : t.muted}" fill-opacity="${last ? 0.7 : 1}">${s.b}</text>
</g></g>`;
  }).join('');
  const loop = 'M1023 278C1023 330 990 334 940 334H220C170 334 170 330 170 278';
  const body = `
${label(t, 48, 50, 'OPERATING RANGE / 01—04', { size: 11, ls: 2 })}
<text x="48" y="88" class="sans" font-size="27" font-weight="700" fill="${t.ink}" style="${enter('rise', 0.9, 0)}">From an unclear workflow to a system in production.</text>
<path d="M292 203H330M574 203H612M856 203H894" stroke="${t.accent}" stroke-width="1.5" stroke-dasharray="4 10" style="animation:dash 1s linear infinite"/>
${cards}
<path d="${loop}" stroke="${t.accent}" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="4 10" style="animation:dash 1.4s linear infinite"/>
<path d="M164 290L170 278L176 290" stroke="${t.accent}" stroke-opacity=".8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<circle r="4" fill="${t.accent}" class="motion"><animateMotion dur="${cycle}s" repeatCount="indefinite" path="M170 203H1023" keyPoints="0;0;0.33;0.33;0.67;0.67;1;1" keyTimes="0;0.12;0.22;0.34;0.44;0.56;0.66;1" calcMode="linear"/></circle>
<rect x="470" y="322" width="260" height="24" rx="12" fill="${t.bg}" stroke="${t.line}" stroke-opacity="${t.lineO}"/>
${label(t, 600, 338, 'LEARN · REFINE · REPEAT', { size: 10, anchor: 'middle', ls: 1.6 })}
${label(t, 1152, 50, 'A CONTINUUM, NOT A HANDOFF', { size: 10, fill: t.faint, anchor: 'end', ls: 1.4 })}`;
  return svg(t, {
    w: W, h: H, css: kf, body,
    title: 'Operating range: discover, design, build, ship',
    desc: 'A four-stage engineering loop — discover, design, build, ship — with a signal travelling through each stage and looping back to discovery.',
  });
}

// ---------------------------------------------------------------- experience timeline

function timeline(t) {
  odSeq = 0;
  const W = 1200, H = 460;
  const nowYear = (() => {
    const d = new Date(`${live.updatedAt}T00:00:00Z`);
    return d.getUTCFullYear() + d.getUTCMonth() / 12;
  })();
  const X0 = 316, X1 = 1140, Y0 = 2022, Y1 = 2027;
  const x = (yr) => r1(X0 + ((yr - Y0) / (Y1 - Y0)) * (X1 - X0));
  const roles = [
    { org: 'The Idea Vault', role: 'Junior Software Developer', from: 2022, to: 2025, note: '2022 — 2024 · ETHIOPIA & KENYA' },
    { org: 'Temaribet', role: 'Full-Stack Developer', from: 2025, to: 2026, note: '2025 · EDTECH' },
    { org: 'Andro Solutions', role: 'Senior Software Developer', from: 2025, to: nowYear, note: '2025 — NOW · −40% DEPLOY TIME', now: true },
    { org: 'A2SV', role: 'Head of Education', from: 2026, to: Math.min(nowYear, 2027), note: '2026 · DSA' },
    { org: 'Oz Kitchen', role: 'Lead Systems & Platform Eng.', from: 2026, to: Math.min(nowYear, 2027), note: '2026 · SOLE OWNER' },
  ];
  const top = 128, rowH = 52;
  const years = Array.from({ length: Y1 - Y0 + 1 }, (_, i) => Y0 + i);
  const grid = years.map((yr) => `<path d="M${x(yr)} ${top - 14}V${top + roles.length * rowH}" stroke="${t.line}" stroke-opacity="${t.lineO * 0.7}"/>${label(t, x(yr), top + roles.length * rowH + 24, String(yr), { size: 10, fill: t.muted, anchor: yr === Y0 ? 'start' : yr === Y1 ? 'end' : 'middle', ls: 1.2 })}`).join('');
  const rows = roles.map((r, i) => {
    const y = top + i * rowH;
    const bx = x(r.from), bw = r1(x(r.to) - bx);
    const strong = r.now;
    return `
<g style="${enter('rise', 0.8, r1(0.2 + i * 0.12))}">
<text x="48" y="${y + 17}" class="sans" font-size="16" font-weight="700" fill="${t.ink}">${esc(r.org)}</text>
<text x="48" y="${y + 35}" class="sans" font-size="13" fill="${t.muted}">${esc(r.role)}</text>
</g>
<g class="fl" style="${enter('grow', 1.1, r1(0.45 + i * 0.12))}">
<rect x="${bx + 2}" y="${y + 4}" width="${bw - 4}" height="34" rx="9" fill="${strong ? t.accentFill : t.panel2}" stroke="${t.line}" stroke-opacity="${strong ? 0 : t.lineO + 0.04}"/>
</g>
<text x="${bx + 14}" y="${y + 25}" class="mono" font-size="10" letter-spacing="1.1" fill="${strong ? t.onAccent : t.ink}" fill-opacity="${strong ? 0.85 : 0.8}" style="${enter('fade', 0.8, r1(1 + i * 0.12))}">${esc(r.note)}</text>`;
  }).join('');
  const nx = x(nowYear);
  const body = `
${label(t, 48, 50, 'EXPERIENCE / 2022 — NOW', { size: 11, ls: 2 })}
<text x="48" y="88" class="sans" font-size="27" font-weight="700" fill="${t.ink}" style="${enter('rise', 0.9, 0)}">From shipping websites to owning whole platforms.</text>
${grid}
${rows}
<path d="M${nx} ${top - 22}V${top + roles.length * rowH + 4}" stroke="${t.accent}" stroke-width="1.5" stroke-dasharray="3 5" style="${enter('fade', 1, 1.4)}"/>
<g style="${enter('pop', 0.8, 1.5)}" class="fb"><rect x="${nx - 26}" y="${top - 40}" width="52" height="20" rx="10" fill="${t.accentFill}"/><text x="${nx}" y="${top - 26}" class="mono" font-size="10" font-weight="700" letter-spacing="1.4" fill="${t.onAccent}" text-anchor="middle">NOW</text></g>
${pingDot(t, nx, top + 2 * rowH + 21, 5, 1.8)}`;
  return svg(t, {
    w: W, h: H, body,
    title: 'Experience timeline, 2022 to now',
    desc: 'Timeline: The Idea Vault (junior developer, 2022–2024), Temaribet (full-stack, 2025), Andro Solutions (senior developer, 2025–now, cut deployment time 40%), A2SV (Head of Education, 2026), Oz Kitchen (lead systems & platform engineer, 2026).',
  });
}

// ---------------------------------------------------------------- stack ticker

function stack(t) {
  const W = 1200, H = 420;
  const lanes = [
    { name: 'Product surfaces', items: ['TypeScript', 'React', 'Next.js', 'Flutter', 'Dart', 'React Native', 'Tailwind CSS', 'Motion design', 'Figma'], key: ['Next.js', 'Flutter'] },
    { name: 'Services & integrations', items: ['Node.js', 'Express', 'FastAPI', 'Go / Gin', 'REST APIs', 'Stripe', 'Webhooks', 'Background jobs', 'Telegram bots'], key: ['Node.js', 'FastAPI'] },
    { name: 'Data & real time', items: ['PostgreSQL', 'Supabase', 'Neon', 'Drizzle', 'MongoDB', 'Firebase', 'Redis', 'RabbitMQ'], key: ['PostgreSQL'] },
    { name: 'Engineering practice', items: ['System design', 'API design', 'Auth', 'CI/CD', 'Testing', 'Observability', 'Performance', 'Git'], key: ['System design'] },
  ];
  const trackX = 330, trackW = 822;
  const fs = 13, ph = 36, gap = 10;
  let css = '';
  const rows = lanes.map((lane, li) => {
    const y = 130 + li * 66;
    let cx = 0;
    const set = lane.items.map((it) => {
      const w = monoW(it, fs) + 28;
      const strong = lane.key.includes(it);
      const s = `<rect x="${r1(cx)}" y="${y}" width="${r1(w)}" height="${ph}" rx="${ph / 2}" fill="${strong ? t.accentFill : t.panel}" stroke="${t.line}" stroke-opacity="${strong ? 0 : t.lineO + 0.03}"/><text x="${r1(cx + 14)}" y="${y + 23}" class="mono" font-size="${fs}" fill="${strong ? t.onAccent : t.ink}" fill-opacity="${strong ? 1 : 0.85}">${esc(it)}</text>`;
      cx += w + gap;
      return s;
    }).join('');
    const setW = r1(cx);
    const copies = Math.ceil(trackW / setW) + 1;
    const all = Array.from({ length: copies }, (_, k) => `<g transform="translate(${r1(k * setW)} 0)">${set}</g>`).join('');
    const reverse = li % 2 === 1;
    const dur = r1(setW / (22 + li * 4));
    css += `@keyframes m${li}{from{transform:translateX(${reverse ? -setW : 0}px)}to{transform:translateX(${reverse ? 0 : -setW}px)}}`;
    return `
<g style="${enter('rise', 0.8, r1(0.15 + li * 0.1))}">
<text x="48" y="${y + 14}" class="mono" font-size="10" letter-spacing="1.6" fill="${t.accent}">0${li + 1}</text>
<text x="48" y="${y + 33}" class="sans" font-size="17" font-weight="700" fill="${t.ink}">${esc(lane.name)}</text>
</g>
<g mask="url(#fade)"><g transform="translate(${trackX} 0)"><g style="animation:m${li} ${dur}s linear infinite;transform:translateX(${reverse ? -setW : 0}px)">${all}</g></g></g>`;
  }).join('');
  const defs = `
<linearGradient id="fadeGrad" x1="${trackX}" y1="0" x2="${trackX + trackW}" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".07" stop-color="#fff"/><stop offset=".93" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<mask id="fade" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="${trackX}" y="0" width="${trackW}" height="${H}" fill="url(#fadeGrad)"/></mask>`;
  const body = `
${label(t, 48, 50, 'TOOLS / GROUPED BY RESPONSIBILITY', { size: 11, ls: 2 })}
<text x="48" y="88" class="sans" font-size="27" font-weight="700" fill="${t.ink}" style="${enter('rise', 0.9, 0)}">The stack follows the problem — not the other way around.</text>
<path d="M${trackX - 16} 120V${130 + 3 * 66 + 46}" stroke="${t.line}" stroke-opacity="${t.lineO}"/>
${rows}`;
  return svg(t, {
    w: W, h: H, css, defs, body,
    title: 'Tools grouped by responsibility',
    desc: `Four scrolling lanes of tools. ${lanes.map((l) => `${l.name}: ${l.items.join(', ')}.`).join(' ')}`,
  });
}

// ---------------------------------------------------------------- arena: live competitive programming

function arena(t) {
  odSeq = 0;
  const W = 1200, H = 480;
  // Codeforces panel
  const P = { x: 48, y: 116, w: 668, h: 320 };
  const ch = { x: P.x + 24, y: P.y + 150, w: P.w - 48, h: 150 };
  const lo = 400, hi = 2000;
  const yOf = (r) => r1(ch.y + ch.h - ((Math.min(Math.max(r, lo), hi) - lo) / (hi - lo)) * ch.h);
  const pts = cf.history.map((c, i) => ({ x: r1(ch.x + 16 + (i / Math.max(cf.history.length - 1, 1)) * (ch.w - 72)), y: yOf(c.r), r: c.r }));
  const bands = [
    { from: lo, to: 1200, name: 'NEWBIE', c: t.cf.newbie },
    { from: 1200, to: 1400, name: 'PUPIL', c: t.cf.pupil },
    { from: 1400, to: 1600, name: 'SPECIALIST', c: t.cf.specialist },
    { from: 1600, to: 1900, name: 'EXPERT', c: t.cf.expert },
    { from: 1900, to: hi, name: 'CANDIDATE MASTER', c: t.cf.cm },
  ];
  const bandSvg = bands.map((b) => `<rect x="${ch.x}" y="${yOf(b.to)}" width="${ch.w}" height="${r1(yOf(b.from) - yOf(b.to))}" fill="${b.c}" fill-opacity="${t.name === 'dark' ? 0.09 : 0.08}"/>
${label(t, ch.x + ch.w - 8, yOf(b.to) + 12, b.name, { size: 8, fill: b.c, anchor: 'end', ls: 1.2, opacity: 0.9 })}`).join('');
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('');
  const area = `${line}L${pts.at(-1).x} ${ch.y + ch.h}L${pts[0].x} ${ch.y + ch.h}Z`;
  const dots = pts.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="${i === pts.length - 1 ? 5 : 3.5}" fill="${t.bg}" stroke="${t.accent}" stroke-width="2" class="fb" style="${enter('pop', 0.5, r1(0.8 + (i / pts.length) * 1.8))}"/>`).join('');
  const last = pts.at(-1);
  const date = (s) => new Date(s * 1000).toISOString().slice(0, 7).replace('-', ' · ');
  const rankColor = t.cf[cf.rank === 'candidate master' ? 'cm' : cf.rank] ?? t.accent;

  const cfOd = odometer({ x: P.x + 24, y: P.y + 104, value: cf.rating, size: 64, fill: t.ink, delay: 0.3 });
  const climb = daysToExpert != null
    ? `Newbie → Expert in ${contestsToExpert} rated contests (${daysToExpert} days)`
    : `${cf.contests} rated contests`;

  // LeetCode panel
  const Q = { x: 740, y: 116, w: 412, h: 320 };
  const lcOd = odometer({ x: Q.x + 24, y: Q.y + 104, value: fmt(lc.total), size: 64, fill: t.ink, delay: 0.5 });
  const diffs = [
    { k: 'EASY', v: lc.easy, c: t.easy },
    { k: 'MEDIUM', v: lc.medium, c: t.medium },
    { k: 'HARD', v: lc.hard, c: t.hard },
  ];
  const max = Math.max(...diffs.map((d) => d.v));
  const barW = Q.w - 48 - 70 - 56;
  const bars = diffs.map((d, i) => {
    const y = Q.y + 168 + i * 42;
    return `
${label(t, Q.x + 24, y + 12, d.k, { size: 10, fill: t.muted, ls: 1.4 })}
<rect x="${Q.x + 94}" y="${y + 2}" width="${barW}" height="12" rx="6" fill="${t.line}" fill-opacity="${t.lineO * 0.7}"/>
<rect x="${Q.x + 94}" y="${y + 2}" width="${r1((d.v / max) * barW)}" height="12" rx="6" fill="${d.c}" class="fl" style="${enter('grow', 1.4, r1(0.7 + i * 0.15))}"/>
<text x="${Q.x + Q.w - 24}" y="${y + 13}" class="mono" font-size="14" font-weight="700" fill="${t.ink}" text-anchor="end">${fmt(d.v)}</text>`;
  }).join('');
  const hardShare = Math.round(((lc.medium + lc.hard) / lc.total) * 100);

  const body = `
${pingDot(t, 52, 46, 4, 0)}
${label(t, 66, 50, 'ARENA / LIVE STATS', { size: 11, ls: 2 })}
${label(t, 1152, 50, `SYNCED ${live.updatedAt}`, { size: 10, fill: t.faint, anchor: 'end', ls: 1.4 })}
<text x="48" y="88" class="sans" font-size="27" font-weight="700" fill="${t.ink}" style="${enter('rise', 0.9, 0)}">Algorithms are part of the craft.</text>

<g style="${enter('rise', 0.9, 0.1)}">
<rect x="${P.x}" y="${P.y}" width="${P.w}" height="${P.h}" rx="18" fill="${t.panel}" stroke="${t.line}" stroke-opacity="${t.lineO}"/>
${label(t, P.x + 24, P.y + 32, 'CODEFORCES · RATING', { size: 10, ls: 1.6 })}
</g>
${cfOd.svg}
<g style="${enter('fade', 0.8, 0.9)}">
<rect x="${r1(P.x + 24 + cfOd.width + 16)}" y="${P.y + 64}" width="${r1(monoW(cf.rank.toUpperCase(), 11, 1.6) + 24)}" height="24" rx="12" fill="${rankColor}" fill-opacity=".16" stroke="${rankColor}" stroke-opacity=".6"/>
<text x="${r1(P.x + 24 + cfOd.width + 28)}" y="${P.y + 80}" class="mono" font-size="11" font-weight="700" letter-spacing="1.6" fill="${rankColor}">${cf.rank.toUpperCase()}</text>
<text x="${r1(P.x + 24 + cfOd.width + 16)}" y="${P.y + 104}" class="sans" font-size="14" fill="${t.muted}">peak ${cf.maxRating} · ${cf.contests} rated contests</text>
</g>
<text x="${P.x + P.w - 24}" y="${P.y + 32}" class="sans" font-size="13" fill="${t.muted}" text-anchor="end" style="${enter('fade', 0.8, 1.2)}">${esc(climb)}</text>
<g style="${enter('fade', 1, 0.4)}">${bandSvg}</g>
<path d="${area}" fill="url(#areaGrad)" style="${enter('fade', 1.4, 1.6)}"/>
<path d="${line}" stroke="${t.accent}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" pathLength="1" stroke-dasharray="1" style="${enter('draw', 2.4, 0.7)}"/>
${dots}
<g style="${enter('pop', 0.6, 2.6)}" class="fb">
<rect x="${last.x - 64}" y="${last.y - 14}" width="50" height="22" rx="11" fill="${t.accentFill}"/>
<text x="${last.x - 39}" y="${last.y + 1}" class="mono" font-size="11" font-weight="700" fill="${t.onAccent}" text-anchor="middle">${last.r}</text>
</g>
<circle cx="${last.x}" cy="${last.y}" r="5" stroke="${t.accent}" stroke-width="2" class="fb" style="animation:ping 2.2s ${EASE} 3s infinite"/>
${label(t, pts[0].x, ch.y + ch.h + 18, date(cf.history[0].t), { size: 9, fill: t.faint, ls: 1 })}
${label(t, last.x, ch.y + ch.h + 18, date(cf.history.at(-1).t), { size: 9, fill: t.faint, anchor: 'end', ls: 1 })}

<g style="${enter('rise', 0.9, 0.2)}">
<rect x="${Q.x}" y="${Q.y}" width="${Q.w}" height="${Q.h}" rx="18" fill="${t.panel}" stroke="${t.line}" stroke-opacity="${t.lineO}"/>
${label(t, Q.x + 24, Q.y + 32, 'LEETCODE · SOLVED', { size: 10, ls: 1.6 })}
</g>
${lcOd.svg}
<text x="${Q.x + 24}" y="${Q.y + 136}" class="sans" font-size="14" fill="${t.muted}" style="${enter('fade', 0.8, 1)}">${hardShare}% medium or hard${lc.contestRating ? ` · contest rating ${lc.contestRating}` : ''}</text>
${bars}

${label(t, 48, 462, 'PULLED FROM THE CODEFORCES + LEETCODE APIS AND REDRAWN BY A GITHUB ACTION', { size: 9, fill: t.faint, ls: 1.3 })}
${label(t, 1152, 462, 'A2SV · FORMER HEAD OF EDUCATION', { size: 9, fill: t.faint, anchor: 'end', ls: 1.3 })}`;
  const defs = `<linearGradient id="areaGrad" x1="0" y1="${ch.y}" x2="0" y2="${ch.y + ch.h}" gradientUnits="userSpaceOnUse"><stop stop-color="${t.accent}" stop-opacity=".22"/><stop offset="1" stop-color="${t.accent}" stop-opacity="0"/></linearGradient>`;
  return svg(t, {
    w: W, h: H, defs, body,
    title: 'Competitive programming — live stats',
    desc: `Codeforces rating ${cf.rating} (${cf.rank}, peak ${cf.maxRating}) over ${cf.contests} rated contests, charted against rank bands; ${climb}. LeetCode: ${fmt(lc.total)} solved — ${lc.easy} easy, ${lc.medium} medium, ${lc.hard} hard.`,
  });
}

// ---------------------------------------------------------------- write

const outputs = {
  hero, marucheck, 'project-orit-tej': oritTej, 'project-prospectai': prospectAI,
  'project-streamsynx': streamSynx, 'project-oz-kitchen': ozKitchen,
  'operating-range': range, experience: timeline, stack, arena,
};

await mkdir(new URL('assets/', ROOT), { recursive: true });
for (const [name, render] of Object.entries(outputs)) {
  for (const t of Object.values(THEMES)) {
    const out = render(t);
    // A single stray `&` makes the whole SVG fail to render as an image.
    if (/&(?!amp;|lt;|gt;|quot;|#\d+;)/.test(out)) throw new Error(`unescaped & in ${name}-${t.name}.svg`);
    await writeFile(new URL(`assets/${name}-${t.name}.svg`, ROOT), out);
  }
}
console.log(`rendered ${Object.keys(outputs).length * 2} SVGs`);
