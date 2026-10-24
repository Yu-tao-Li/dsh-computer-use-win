// Shared helpers for the README diagrams. A page calls Diagram.render(strings, draw):
// the query string picks the language and theme, [data-t] elements take their
// text from strings[lang], and draw() adds wires measured from the laid-out
// boxes, so every arrow ends on the edge it points at. Layout problems (text
// overflowing a box, a label on top of a box) are reported in data-error, which
// render.mjs refuses to publish.
(() => {
  const query = new URLSearchParams(location.search);
  const lang = query.get('lang') === 'en' ? 'en' : 'zh';
  const theme = query.get('theme') === 'dark' ? 'dark' : 'light';
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.dataset.theme = theme;
  const NS = 'http://www.w3.org/2000/svg';
  let canvas, svg, origin;
  const labels = [];

  function box(target) {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    if (!element) throw new Error(`No element ${target}`);
    const r = element.getBoundingClientRect();
    const left = r.left - origin.left, top = r.top - origin.top;
    return { left, top, right: left + r.width, bottom: top + r.height, width: r.width, height: r.height, cx: left + r.width / 2, cy: top + r.height / 2 };
  }

  // Orthogonal polyline with rounded corners.
  function pathData(points, radius) {
    let d = `M${points[0][0]},${points[0][1]}`;
    for (let i = 1; i < points.length - 1; i++) {
      const [px, py] = points[i - 1], [x, y] = points[i], [nx, ny] = points[i + 1];
      const r = Math.min(radius, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
      d += ` L${x - Math.sign(x - px) * r},${y - Math.sign(y - py) * r} Q${x},${y} ${x + Math.sign(nx - x) * r},${y + Math.sign(ny - y) * r}`;
    }
    const [x, y] = points[points.length - 1];
    return `${d} L${x},${y}`;
  }

  function add(name, attributes) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    svg.append(node);
    return node;
  }

  // Filled arrowhead whose tip sits exactly on (x, y).
  function head([x, y], [fromX, fromY], color) {
    const dx = Math.sign(x - fromX), dy = Math.sign(y - fromY), length = 7, half = 4;
    const bx = x - dx * length, by = y - dy * length;
    add('path', { d: `M${x},${y} L${bx - dy * half},${by + dx * half} L${bx + dy * half},${by - dx * half} Z`, fill: color });
  }

  function wire(points, { stop = false, dashed = false, heads = 'end', radius = 8 } = {}) {
    const color = stop ? 'var(--stop)' : 'var(--wire)';
    const line = points.map(point => [...point]);
    const trim = (end, before) => {
      const dx = Math.sign(end[0] - before[0]), dy = Math.sign(end[1] - before[1]);
      end[0] -= dx * 6; end[1] -= dy * 6;
    };
    if (heads === 'end' || heads === 'both') trim(line[line.length - 1], line[line.length - 2]);
    if (heads === 'both') trim(line[0], line[1]);
    add('path', { d: pathData(line, radius), fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...(dashed ? { 'stroke-dasharray': '5 4' } : {}) });
    if (heads === 'end' || heads === 'both') head(points[points.length - 1], points[points.length - 2], color);
    if (heads === 'both') head(points[0], points[1], color);
  }

  // anchor: 'left' puts the label's left edge on x, 'right' its right edge,
  // 'center' its centre; y is the label's vertical centre.
  function label(html, x, y, { anchor = 'left', className = '' } = {}) {
    const element = document.createElement('div');
    element.className = `label ${className}`.trim();
    element.innerHTML = html;
    canvas.append(element);
    const width = element.offsetWidth, height = element.offsetHeight;
    element.style.left = `${anchor === 'left' ? x : anchor === 'right' ? x - width : x - width / 2}px`;
    element.style.top = `${y - height / 2}px`;
    labels.push(element);
    return element;
  }

  // Centre an absolutely positioned element horizontally on x (canvas units).
  function centerOn(target, x) {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    const parent = element.offsetParent.getBoundingClientRect();
    element.style.left = `${x + origin.left - parent.left - element.offsetWidth / 2}px`;
  }

  function overlaps(a, b) {
    return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  }

  function check() {
    const issues = [];
    for (const element of document.querySelectorAll('[data-fit]')) {
      if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) issues.push(`overflow: ${element.id || element.className}`);
    }
    const boxes = [...document.querySelectorAll('[data-solid]')].map(element => [element, box(element)]);
    for (const element of labels) {
      const own = box(element);
      for (const [other, rect] of boxes) if (overlaps(own, rect)) issues.push(`label "${element.textContent}" overlaps ${other.id || other.className}`);
      for (const other of labels) if (other !== element && overlaps(own, box(other))) issues.push(`label "${element.textContent}" overlaps "${other.textContent}"`);
      if (own.left < 0 || own.right > canvas.offsetWidth) issues.push(`label "${element.textContent}" leaves the canvas`);
    }
    return [...new Set(issues)];
  }

  window.Diagram = {
    lang,
    render(strings, draw) {
      const text = strings[lang];
      for (const element of document.querySelectorAll('[data-t]')) {
        const value = text[element.dataset.t];
        if (value === undefined) throw new Error(`Missing ${lang} text ${element.dataset.t}`);
        element.innerHTML = value;
      }
      document.fonts.ready.then(() => {
        canvas = document.querySelector('.canvas');
        origin = canvas.getBoundingClientRect();
        svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'wires');
        canvas.prepend(svg);
        draw({ box, wire, label, centerOn, text });
        const issues = check();
        if (issues.length) { document.body.dataset.error = issues.join('; '); console.error(issues.join('\n')); }
        document.body.dataset.height = String(Math.ceil(canvas.getBoundingClientRect().height));
      });
    }
  };
})();
