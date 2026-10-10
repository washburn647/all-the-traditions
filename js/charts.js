// Single-series column charts: SVG sized to its container, per-column hover
// tooltip, and a visually hidden table for screen readers.
import { esc, fmt } from './util.js';

const specs = new Map();
let nextId = 0;

// Returns placeholder HTML; call mountCharts() once it is in the DOM.
// data: [{ label, value, tip? }]
export function columnChart(data, { title, unit = 'plays', height = 180, onClick } = {}) {
  const id = `c${nextId++}`;
  specs.set(id, { data, unit, height, onClick });
  const table = `<table class="sr-only"><caption>${esc(title || '')}</caption>
    <tr><th>Label</th><th>${esc(unit)}</th></tr>
    ${data.map(d => `<tr><td>${esc(d.label)}</td><td>${d.value}</td></tr>`).join('')}</table>`;
  return `<figure class="chart">${title ? `<figcaption>${esc(title)}</figcaption>` : ''}
    <div class="chart-plot" data-chart="${id}" style="height:${height}px" role="img" aria-label="${esc(title || 'chart')}"></div>${table}</figure>`;
}

function niceMax(v) {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

function draw(el) {
  const spec = specs.get(el.dataset.chart);
  if (!spec) return;
  const { data, unit, height, onClick } = spec;
  const W = el.clientWidth, H = height;
  if (!W) return;
  const pad = { l: 36, r: 6, t: 10, b: 22 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...data.map(d => d.value)));
  const band = pw / data.length;
  const bw = Math.min(24, Math.max(3, band - 2));
  const y = v => pad.t + ph - (v / max) * ph;
  const ticks = [0, max / 2, max];
  // Thin out x labels so they never collide.
  const every = Math.ceil(data.length / Math.max(1, Math.floor(pw / 34)));

  let svg = `<svg width="${W}" height="${H}" aria-hidden="true">`;
  for (const t of ticks) {
    svg += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text class="tick" x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(Math.round(t))}</text>`;
  }
  data.forEach((d, i) => {
    const cx = pad.l + band * i + band / 2;
    const h = (d.value / max) * ph;
    if (h > 0) {
      const r = Math.min(4, h, bw / 2), x = cx - bw / 2, top = y(d.value), base = pad.t + ph;
      // rounded data-end, square baseline
      svg += `<path class="bar" d="M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${base}Z"/>`;
    }
    if (i % every === 0) svg += `<text class="tick" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${pad.l + band * i}" y="${pad.t}" width="${band}" height="${ph}"/>`;
  });
  svg += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ph}" y2="${pad.t + ph}"/></svg>`;
  el.innerHTML = svg + '<div class="tip" hidden></div>';

  const tip = el.querySelector('.tip');
  el.querySelectorAll('.hit').forEach(r => {
    const d = data[+r.dataset.i];
    r.addEventListener('mouseenter', () => {
      tip.innerHTML = `<strong>${esc(d.label)}</strong> ${fmt(d.value)} ${esc(unit)}${d.tip ? `<br>${esc(d.tip)}` : ''}`;
      tip.hidden = false;
      const x = +r.getAttribute('x') + band / 2;
      tip.style.left = `${Math.min(Math.max(x, 60), W - 60)}px`;
      tip.style.top = `${Math.max(0, y(d.value) - 8)}px`;
      r.classList.add('on');
    });
    r.addEventListener('mouseleave', () => { tip.hidden = true; r.classList.remove('on'); });
    if (onClick) { r.style.cursor = 'pointer'; r.addEventListener('click', () => onClick(d)); }
  });
}

export function resetCharts() {
  specs.clear();
}

export function mountCharts(root) {
  root.querySelectorAll('[data-chart]').forEach(draw);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => mountCharts(document), 150);
});
