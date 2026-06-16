// Channel Nodes — node editor for remapping image channels.
// Loaded with defer, so the DOM is already parsed.
// Heavy pixel work is delegated to a Web Worker so sliders stay responsive.

(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ===== CONFIGURATION =====
  // Maximum long-edge size for the preview buffer used while dragging sliders.
  // Smaller = faster, larger = closer to final look while dragging.
  const PREVIEW_MAX_SIZE = 600;

  const inputCanvas = document.getElementById('cn-input-canvas');
  const outputCanvas = document.getElementById('cn-output-canvas');
  const outputPanel = outputCanvas && outputCanvas.parentElement;
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
  let previewData = null;
  // Connections are stored as plain objects so they can be posted to the worker.
  // Each connection: { from: {side, channel}, to: {side, channel} }
  let connections = [];
  let dragging = null;
  let tempLine = null;

  // Worker scheduling state.
  let worker = null;
  let workerBusy = false;
  let pendingJob = null;
  let requiresFull = false;

  // Slider input throttling state.
  let sliderRafId = null;
  let sliderDirty = false;

  const CH_NAMES = { r: 'Red', g: 'Green', b: 'Blue' };
  const CH_COLORS = { r: '#cc0000', g: '#27ae60', b: '#2980b9' };

  // ===== WORKER SETUP =====
  // The worker URL must respect the site's base path. The Astro template passes
  // the base path via a data attribute on this script tag.
  const scriptBase = (document.currentScript && document.currentScript.dataset.base) || '/';
  try {
    worker = new Worker(`${scriptBase}tools/channel-nodes/worker.js`);
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (err) => {
      console.error('Channel Nodes worker error:', err);
      worker = null;
    };
  } catch (err) {
    console.warn('Channel Nodes: Web Worker not available, falling back to synchronous processing.', err);
    worker = null;
  }

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

  function getDot(side, channel) {
    return document.querySelector(`.cn-dot[data-side="${side}"][data-channel="${channel}"]`);
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
    return `${dot.side}-${dot.channel}`;
  }

  function renderConnections() {
    syncSvg();
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    connections.forEach((conn) => {
      const fromDot = getDot(conn.from.side, conn.from.channel);
      const toDot = getDot(conn.to.side, conn.to.channel);
      if (!fromDot || !toDot) return;

      const a = getDotCenter(fromDot);
      const b = getDotCenter(toDot);
      const d = linePath(a.x, a.y, b.x, b.y);
      const sourceCh = conn.from.channel;

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
        scheduleProcess(false);
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
      if (conn.to.side === 'out') {
        const dot = getDot(conn.to.side, conn.to.channel);
        if (dot) dot.classList.add('mapped-' + conn.from.channel);
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

  function createPreviewData() {
    if (!originalData) return null;
    const max = Math.max(originalData.width, originalData.height);
    const ratio = Math.min(1, PREVIEW_MAX_SIZE / max);
    const pw = Math.max(1, Math.round(originalData.width * ratio));
    const ph = Math.max(1, Math.round(originalData.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    const ctx = canvas.getContext('2d');
    // drawImage from the input canvas uses the browser's fast downscaler.
    ctx.drawImage(inputCanvas, 0, 0, pw, ph);
    return ctx.getImageData(0, 0, pw, ph);
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
      previewData = createPreviewData();
      inputCanvas.style.display = 'block';
      inputPlaceholder.style.display = 'none';
      scheduleProcess(false);
      requestAnimationFrame(renderConnections);
      updateStatus();
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setStatus('Could not load image. Please try a different file.');
    };
    img.src = objectUrl;
  }

  // ===== PROCESSING =====

  function buildJobParams(usePreview) {
    return {
      usePreview,
      strengths: {
        r: parseFloat(strength.r.value),
        g: parseFloat(strength.g.value),
        b: parseFloat(strength.b.value),
      },
    };
  }

  function displayResult(dst, width, height, usePreview) {
    if (outputCanvas.width !== width || outputCanvas.height !== height) {
      outputCanvas.width = width;
      outputCanvas.height = height;
    }
    const out = new ImageData(dst, width, height);
    ctxOut.putImageData(out, 0, 0);
    if (outputPanel) {
      outputPanel.classList.toggle('preview-active', usePreview);
    }
  }

  function clearOutput() {
    if (!originalData) return;
    outputCanvas.width = originalData.width;
    outputCanvas.height = originalData.height;
    ctxOut.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    if (outputPanel) outputPanel.classList.remove('preview-active');
  }

  function runJob(params) {
    workerBusy = true;
    const imageData = params.usePreview ? previewData : originalData;
    const outData = new ImageData(imageData.width, imageData.height);
    worker.postMessage(
      {
        src: imageData.data,
        dst: outData.data,
        width: imageData.width,
        height: imageData.height,
        connections,
        strengths: params.strengths,
        usePreview: params.usePreview,
      },
      [outData.data.buffer]
    );
  }

  function handleWorkerMessage(e) {
    workerBusy = false;

    // If connections were cleared while this job was in flight, discard the result.
    if (connections.length === 0) {
      clearOutput();
      pendingJob = null;
      requiresFull = false;
      return;
    }

    const { dst, width, height, usePreview } = e.data;
    displayResult(dst, width, height, usePreview);

    if (pendingJob) {
      const next = pendingJob;
      pendingJob = null;
      runJob(next);
    } else if (requiresFull && usePreview) {
      runJob(buildJobParams(false));
    } else if (!usePreview) {
      requiresFull = false;
    }
  }

  // Synchronous fallback used when Web Workers are unavailable.
  function applyChannelsSync(usePreview) {
    if (!originalData) return;
    if (connections.length === 0) {
      clearOutput();
      return;
    }

    const srcData = usePreview ? previewData : originalData;
    const w = srcData.width;
    const h = srcData.height;
    const src = srcData.data;

    if (outputCanvas.width !== w || outputCanvas.height !== h) {
      outputCanvas.width = w;
      outputCanvas.height = h;
    }

    const out = ctxOut.createImageData(w, h);
    const dst = out.data;

    const chIndex = { r: 0, g: 1, b: 2 };
    const outSources = { r: [], g: [], b: [] };
    const mul = {
      r: parseFloat(strength.r.value),
      g: parseFloat(strength.g.value),
      b: parseFloat(strength.b.value),
    };

    for (const conn of connections) {
      if (conn.from.side === 'in' && conn.to.side === 'out') {
        outSources[conn.to.channel].push(chIndex[conn.from.channel]);
      }
    }

    const rSrc = outSources.r;
    const gSrc = outSources.g;
    const bSrc = outSources.b;

    for (let i = 0; i < src.length; i += 4) {
      let rVal = 0;
      let gVal = 0;
      let bVal = 0;

      for (let s = 0; s < rSrc.length; s++) rVal += src[i + rSrc[s]];
      for (let s = 0; s < gSrc.length; s++) gVal += src[i + gSrc[s]];
      for (let s = 0; s < bSrc.length; s++) bVal += src[i + bSrc[s]];

      dst[i] = rSrc.length ? Math.min(255, (rVal / rSrc.length) * mul.r) : 0;
      dst[i + 1] = gSrc.length ? Math.min(255, (gVal / gSrc.length) * mul.g) : 0;
      dst[i + 2] = bSrc.length ? Math.min(255, (bVal / bSrc.length) * mul.b) : 0;
      dst[i + 3] = src[i + 3];
    }

    ctxOut.putImageData(out, 0, 0);
    if (outputPanel) outputPanel.classList.toggle('preview-active', usePreview);
  }

  // Public entry point for all channel processing.
  // usePreview=true requests the down-scaled preview; false requests full resolution.
  function scheduleProcess(usePreview) {
    if (!usePreview) requiresFull = true;

    if (connections.length === 0) {
      clearOutput();
      requiresFull = false;
      pendingJob = null;
      return;
    }

    if (!worker) {
      applyChannelsSync(usePreview);
      return;
    }

    const params = buildJobParams(usePreview);
    if (workerBusy) {
      pendingJob = params;
      return;
    }
    runJob(params);
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
          `<span class="conn-pill ${c.from.channel}">${escapeHtml(CH_NAMES[c.from.channel])}</span>` +
          ` &rarr; ` +
          `<span class="conn-pill ${c.to.channel}">${escapeHtml(CH_NAMES[c.to.channel])}</span>`
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
      const fromObj = { side: sourceDot.dataset.side, channel: sourceDot.dataset.channel };
      const toObj = { side: target.dataset.side, channel: target.dataset.channel };

      if (fromSide === 'out') {
        // Dragged out -> in: flip so connections always go in -> out.
        connections = connections.filter(
          (c) => !(dotKey(c.from) === dotKey(toObj) && dotKey(c.to) === dotKey(fromObj))
        );
        connections.push({ from: toObj, to: fromObj });
      } else {
        connections = connections.filter(
          (c) => !(dotKey(c.from) === dotKey(fromObj) && dotKey(c.to) === dotKey(toObj))
        );
        connections.push({ from: fromObj, to: toObj });
      }
      renderConnections();
      scheduleProcess(false);
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
    scheduleProcess(false);
    updateMappedDots();
    updateStatus();
  });

  // Strength-only reset.
  strengthResetBtn.addEventListener('click', () => {
    resetStrengths();
    scheduleProcess(false);
  });

  // ===== SLIDER HANDLING =====
  const strengthEl = document.querySelector('.channel-nodes .strength');

  function updateSliderLabel(input) {
    if (!(input && input.tagName === 'INPUT' && input.type === 'range' && input.id.startsWith('cn-str-') && !input.id.endsWith('-out'))) return;
    const ch = input.id.slice(-1);
    const out = strengthOut[ch];
    if (out) out.textContent = parseFloat(input.value).toFixed(2);
  }

  function onSliderInput(e) {
    updateSliderLabel(e.target);
    sliderDirty = true;
    if (!sliderRafId) {
      sliderRafId = requestAnimationFrame(() => {
        sliderRafId = null;
        if (sliderDirty) {
          sliderDirty = false;
          scheduleProcess(true);
        }
      });
    }
  }

  function onSliderChange(e) {
    if (sliderRafId) {
      cancelAnimationFrame(sliderRafId);
      sliderRafId = null;
      sliderDirty = false;
    }
    updateSliderLabel(e.target);
    scheduleProcess(false);
  }

  if (strengthEl) {
    strengthEl.addEventListener('input', onSliderInput);
    strengthEl.addEventListener('change', onSliderChange);
  } else {
    // Fallback: bind directly to each slider.
    for (const ch of ['r', 'g', 'b']) {
      const el = strength[ch];
      if (!el) continue;
      el.addEventListener('input', onSliderInput);
      el.addEventListener('change', onSliderChange);
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
