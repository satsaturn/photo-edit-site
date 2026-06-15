// Channel Nodes — node editor for remapping image channels.
// Loaded with defer, so the DOM is already parsed.

(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const inputCanvas = document.getElementById('cn-input-canvas');
  const outputCanvas = document.getElementById('cn-output-canvas');
  const inputPlaceholder = document.getElementById('cn-input-placeholder');
  const inputZone = document.getElementById('cn-input-zone');
  const fileInput = document.getElementById('cn-upload');
  const svg = document.getElementById('cn-svg');
  const panels = document.getElementById('cn-panels');
  const statusEl = document.getElementById('cn-status');
  const resetBtn = document.getElementById('cn-reset');

  const ctxIn = inputCanvas.getContext('2d');
  const ctxOut = outputCanvas.getContext('2d');

  let originalData = null;
  let connections = [];
  let dragging = null;
  let tempLine = null;

  function setStatus(msg) {
    statusEl.textContent = '> ' + msg;
  }

  function syncSvg() {
    const rect = panels.getBoundingClientRect();
    svg.setAttribute('width', String(rect.width));
    svg.setAttribute('height', String(rect.height));
    svg.style.width = rect.width + 'px';
    svg.style.height = rect.height + 'px';
  }

  function getDotCenter(dot) {
    const dotRect = dot.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    return {
      x: dotRect.left + dotRect.width / 2 - svgRect.left,
      y: dotRect.top + dotRect.height / 2 - svgRect.top,
    };
  }

  function linePath(x1, y1, x2, y2) {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  function dotKey(dot) {
    return `${dot.dataset.side}-${dot.dataset.channel}`;
  }

  function renderConnections() {
    syncSvg();
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    connections.forEach((conn) => {
      const a = getDotCenter(conn.from);
      const b = getDotCenter(conn.to);
      const d = linePath(a.x, a.y, b.x, b.y);

      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '16');
      hit.setAttribute('fill', 'none');
      hit.setAttribute('class', 'cn-hit');
      hit.addEventListener('click', (e) => {
        e.stopPropagation();
        connections = connections.filter((c) => c !== conn);
        renderConnections();
        applyChannels();
      });
      svg.appendChild(hit);

      const line = document.createElementNS(SVG_NS, 'path');
      line.setAttribute('d', d);
      line.setAttribute('stroke', '#111');
      line.setAttribute('stroke-width', '3');
      line.setAttribute('fill', 'none');
      line.setAttribute('class', 'cn-line');
      svg.appendChild(line);
    });
  }

  function loadImage(file) {
    const img = new Image();
    img.onload = () => {
      inputCanvas.width = img.width;
      inputCanvas.height = img.height;
      outputCanvas.width = img.width;
      outputCanvas.height = img.height;
      ctxIn.drawImage(img, 0, 0);
      originalData = ctxIn.getImageData(0, 0, inputCanvas.width, inputCanvas.height);
      inputCanvas.style.display = 'block';
      inputPlaceholder.style.display = 'none';
      applyChannels();
      requestAnimationFrame(renderConnections);
      setStatus('Drag a dot from Input to Output to route a channel.');
    };
    img.src = URL.createObjectURL(file);
  }

  function applyChannels() {
    if (!originalData) return;

    const w = originalData.width;
    const h = originalData.height;
    const src = originalData.data;
    const out = ctxOut.createImageData(w, h);
    const dst = out.data;

    if (connections.length === 0) {
      ctxOut.clearRect(0, 0, w, h);
      ctxOut.putImageData(out, 0, 0);
      return;
    }

    // Each output channel is sourced from whichever input channel is
    // routed to it (Blender-style). Unrouted outputs stay at 0.
    const chIndex = { r: 0, g: 1, b: 2 };
    const map = { r: null, g: null, b: null };

    for (const conn of connections) {
      if (conn.from.dataset.side === 'in' && conn.to.dataset.side === 'out') {
        map[conn.to.dataset.channel] = conn.from.dataset.channel;
      }
    }

    for (let i = 0; i < src.length; i += 4) {
      dst[i] = map.r !== null ? src[i + chIndex[map.r]] : 0;
      dst[i + 1] = map.g !== null ? src[i + chIndex[map.g]] : 0;
      dst[i + 2] = map.b !== null ? src[i + chIndex[map.b]] : 0;
      dst[i + 3] = src[i + 3];
    }

    ctxOut.putImageData(out, 0, 0);
  }

  // File input handling.
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) loadImage(file);
  });

  // Drag from a dot.
  document.querySelectorAll('.cn-dot').forEach((dot) => {
    dot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragging = { dot };
      syncSvg();

      tempLine = document.createElementNS(SVG_NS, 'path');
      tempLine.setAttribute('stroke', '#888');
      tempLine.setAttribute('stroke-width', '2');
      tempLine.setAttribute('stroke-dasharray', '4 3');
      tempLine.setAttribute('fill', 'none');
      svg.appendChild(tempLine);
    });
  });

  document.addEventListener('pointermove', (e) => {
    if (!dragging || !tempLine) return;
    const start = getDotCenter(dragging.dot);
    const svgRect = svg.getBoundingClientRect();
    const end = { x: e.clientX - svgRect.left, y: e.clientY - svgRect.top };
    tempLine.setAttribute('d', linePath(start.x, start.y, end.x, end.y));
  });

  document.addEventListener('pointerup', (e) => {
    if (!dragging || !tempLine) return;
    tempLine.remove();
    tempLine = null;

    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (
      target &&
      target.classList.contains('cn-dot') &&
      target !== dragging.dot &&
      target.dataset.side !== dragging.dot.dataset.side
    ) {
      const fromSide = dragging.dot.dataset.side;
      const fromKey = dotKey(dragging.dot);
      const toKey = dotKey(target);

      if (fromSide === 'out') {
        // Dragged out -> in: flip so connections always go in -> out.
        connections = connections.filter(
          (c) => !(dotKey(c.from) === toKey && dotKey(c.to) === fromKey)
        );
        connections.push({ from: target, to: dragging.dot });
      } else {
        connections = connections.filter(
          (c) => !(dotKey(c.from) === fromKey && dotKey(c.to) === toKey)
        );
        connections.push({ from: dragging.dot, to: target });
      }
      renderConnections();
      applyChannels();
    }

    dragging = null;
  });

  // Reset button.
  resetBtn.addEventListener('click', () => {
    connections = [];
    renderConnections();
    applyChannels();
    if (originalData) {
      setStatus('Connections cleared. Output reset.');
    } else {
      setStatus('Load an image to get started.');
    }
  });

  // Re-render lines on resize.
  window.addEventListener('resize', renderConnections);

  // Initial sync once the layout settles.
  requestAnimationFrame(syncSvg);
})();
