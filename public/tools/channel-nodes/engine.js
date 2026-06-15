// Channel Nodes — node editor for remapping image channels.
// Loaded with defer, so the DOM is already parsed.

(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const inputCanvas = document.getElementById('cn-input-canvas');
  const outputCanvas = document.getElementById('cn-output-canvas');
  const inputPlaceholder = document.getElementById('cn-input-placeholder');
  const fileInput = document.getElementById('cn-upload');
  const svg = document.getElementById('cn-svg');
  const panels = document.getElementById('cn-panels');
  const workspace = document.querySelector('.channel-nodes');
  const statusEl = document.getElementById('cn-status');
  const resetBtn = document.getElementById('cn-reset');
  const strengthResetBtn = document.getElementById('cn-reset-strength');

  const ctxIn = inputCanvas.getContext('2d');
  const ctxOut = outputCanvas.getContext('2d');

  // Strength sliders (0..2, default 1) — multiply each output channel.
  const strength = {
    r: document.getElementById('cn-str-r'),
    g: document.getElementById('cn-str-g'),
    b: document.getElementById('cn-str-b'),
  };
  const strengthOut = {
    r: document.getElementById('cn-str-r-out'),
    g: document.getElementById('cn-str-g-out'),
    b: document.getElementById('cn-str-b-out'),
  };

  let originalData = null;
  let connections = [];
  let dragging = null;
  let tempLine = null;

  const CH_NAMES = { r: 'Red', g: 'Green', b: 'Blue' };
  const CH_COLORS = { r: '#cc0000', g: '#27ae60', b: '#2980b9' };

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function setStatus(html) {
    statusEl.innerHTML = html;
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
      const sourceCh = conn.from.dataset.channel;

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
        updateMappedDots();
        updateStatus();
      });
      svg.appendChild(hit);

      const line = document.createElementNS(SVG_NS, 'path');
      line.setAttribute('d', d);
      line.setAttribute('stroke', CH_COLORS[sourceCh]);
      line.setAttribute('stroke-width', '3');
      line.setAttribute('fill', 'none');
      line.setAttribute('class', 'cn-line');
      svg.appendChild(line);
    });
  }

  function updateMappedDots() {
    document.querySelectorAll('.cn-dot[data-side="out"]').forEach((dot) => {
      dot.classList.remove('mapped-r', 'mapped-g', 'mapped-b', 'mapped-mix');
    });
    for (const conn of connections) {
      if (conn.to.dataset.side === 'out') {
        conn.to.classList.add('mapped-' + conn.from.dataset.channel);
      }
    }
    // If an output has multiple sources, show a mix indicator instead.
    document.querySelectorAll('.cn-dot[data-side="out"]').forEach((dot) => {
      const mapped = ['r', 'g', 'b'].filter((c) => dot.classList.contains('mapped-' + c));
      if (mapped.length > 1) {
        mapped.forEach((c) => dot.classList.remove('mapped-' + c));
        dot.classList.add('mapped-mix');
      }
    });
  }

  function loadImage(file) {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
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
      updateStatus();
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setStatus('Could not load image. Please try a different file.');
    };
    img.src = objectUrl;
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

    // Each output channel is sourced from all input channels routed to
    // it. Multiple inputs to the same output are averaged (mixed), then
    // multiplied by the output channel's strength slider (0..2).
    const chIndex = { r: 0, g: 1, b: 2 };
    const outSources = { r: [], g: [], b: [] };
    const mul = {
      r: parseFloat(strength.r.value),
      g: parseFloat(strength.g.value),
      b: parseFloat(strength.b.value),
    };

    for (const conn of connections) {
      if (conn.from.dataset.side === 'in' && conn.to.dataset.side === 'out') {
        outSources[conn.to.dataset.channel].push(conn.from.dataset.channel);
      }
    }

    for (let i = 0; i < src.length; i += 4) {
      const rVal = outSources.r.length
        ? outSources.r.reduce((sum, ch) => sum + src[i + chIndex[ch]], 0) / outSources.r.length
        : 0;
      const gVal = outSources.g.length
        ? outSources.g.reduce((sum, ch) => sum + src[i + chIndex[ch]], 0) / outSources.g.length
        : 0;
      const bVal = outSources.b.length
        ? outSources.b.reduce((sum, ch) => sum + src[i + chIndex[ch]], 0) / outSources.b.length
        : 0;
      dst[i] = Math.min(255, rVal * mul.r);
      dst[i + 1] = Math.min(255, gVal * mul.g);
      dst[i + 2] = Math.min(255, bVal * mul.b);
      dst[i + 3] = src[i + 3];
    }

    ctxOut.putImageData(out, 0, 0);
  }

  function updateStatus() {
    if (!originalData) {
      setStatus('Click the <b>Source Image</b> box to load an image.');
      return;
    }
    if (connections.length === 0) {
      setStatus('Drag a dot from <b>Input</b> to <b>Output</b> to route a channel. Press <b>Esc</b> to cancel a drag.');
      return;
    }
    const pills = connections
      .map(
        (c) =>
          `<span class="conn-pill ${c.from.dataset.channel}">${escapeHtml(CH_NAMES[c.from.dataset.channel])}</span>` +
          ` &rarr; ` +
          `<span class="conn-pill ${c.to.dataset.channel}">${escapeHtml(CH_NAMES[c.to.dataset.channel])}</span>`
      )
      .join(' &nbsp; ');
    const n = connections.length;
    setStatus(`${n} connection${n === 1 ? '' : 's'}: ${pills} &nbsp; <i>click a line to remove</i>`);
  }

  // File input handling.
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) loadImage(file);
  });

  function clearDragStates() {
    workspace.classList.remove('dragging');
    document.querySelectorAll('.cn-dot').forEach((d) => {
      d.classList.remove('drag-source', 'drag-target', 'drag-dimmed');
    });
  }

  // Drag from a dot.
  document.querySelectorAll('.cn-dot').forEach((dot) => {
    dot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragging = { dot };
      syncSvg();

      workspace.classList.add('dragging');
      const sourceSide = dot.dataset.side;
      document.querySelectorAll('.cn-dot').forEach((d) => {
        if (d === dot) d.classList.add('drag-source');
        else if (d.dataset.side !== sourceSide) d.classList.add('drag-target');
        else d.classList.add('drag-dimmed');
      });

      tempLine = document.createElementNS(SVG_NS, 'path');
      tempLine.setAttribute('stroke', CH_COLORS[dot.dataset.channel]);
      tempLine.setAttribute('stroke-width', '2');
      tempLine.setAttribute('stroke-dasharray', '5 3');
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
    const sourceDot = dragging.dot;
    dragging = null;
    clearDragStates();

    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (
      target &&
      target.classList.contains('cn-dot') &&
      target !== sourceDot &&
      target.dataset.side !== sourceDot.dataset.side
    ) {
      const fromSide = sourceDot.dataset.side;
      const fromKey = dotKey(sourceDot);
      const toKey = dotKey(target);

      if (fromSide === 'out') {
        // Dragged out -> in: flip so connections always go in -> out.
        connections = connections.filter(
          (c) => !(dotKey(c.from) === toKey && dotKey(c.to) === fromKey)
        );
        connections.push({ from: target, to: sourceDot });
      } else {
        connections = connections.filter(
          (c) => !(dotKey(c.from) === fromKey && dotKey(c.to) === toKey)
        );
        connections.push({ from: sourceDot, to: target });
      }
      renderConnections();
      applyChannels();
      updateMappedDots();
      updateStatus();
    }
  });

  // Escape cancels an in-progress drag.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dragging && tempLine) {
      tempLine.remove();
      tempLine = null;
      dragging = null;
      clearDragStates();
    }
  });

  function resetStrengths() {
    for (const ch of ['r', 'g', 'b']) {
      strength[ch].value = '1';
      strengthOut[ch].textContent = '1.00';
    }
  }

  // Main reset — connections + strengths.
  resetBtn.addEventListener('click', () => {
    connections = [];
    resetStrengths();
    renderConnections();
    applyChannels();
    updateMappedDots();
    updateStatus();
  });

  // Strength-only reset.
  strengthResetBtn.addEventListener('click', () => {
    resetStrengths();
    applyChannels();
  });

  // Strength sliders — use event delegation on the strength container
  // so the listeners are robust against any binding timing issues.
  const strengthEl = document.querySelector('.channel-nodes .strength');
  function handleStrengthEvent(e) {
    const t = e.target;
    if (!(t && t.tagName === 'INPUT' && t.type === 'range' && t.id.startsWith('cn-str-') && !t.id.endsWith('-out'))) return;
    const ch = t.id.slice(-1);
    const out = strengthOut[ch];
    if (out) out.textContent = parseFloat(t.value).toFixed(2);
    applyChannels();
  }
  if (strengthEl) {
    strengthEl.addEventListener('input', handleStrengthEvent);
    strengthEl.addEventListener('change', handleStrengthEvent);
  } else {
    // Fallback: bind directly to each slider.
    for (const ch of ['r', 'g', 'b']) {
      const el = strength[ch];
      if (!el) continue;
      el.addEventListener('input', handleStrengthEvent);
      el.addEventListener('change', handleStrengthEvent);
    }
  }

  // Re-render lines on resize.
  window.addEventListener('resize', renderConnections);

  // Explicitly set sliders to 1 on load so the thumb position and
  // labels are guaranteed to match the default.
  resetStrengths();

  // Initial sync once the layout settles.
  requestAnimationFrame(() => {
    syncSvg();
    updateStatus();
  });
})();
