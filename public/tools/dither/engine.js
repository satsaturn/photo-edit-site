// Dither tool engine — ordered and error-diffusion dithering with a
// reduced palette generated from the source image.

document.addEventListener('DOMContentLoaded', () => {
  let srcImage = null;
  let outputBlob = null;

  const upload = document.getElementById('dither-upload');
  const inputZone = document.getElementById('dither-input-zone');
  const inputPlaceholder = document.getElementById('dither-input-placeholder');
  const inputPreview = document.getElementById('dither-input-preview');
  const outputPreview = document.getElementById('dither-output-preview');
  const workCanvas = document.getElementById('dither-work-canvas');
  const ctx = workCanvas.getContext('2d');

  const controls = {
    algorithm: document.getElementById('dither-algorithm'),
    targetWidth: document.getElementById('dither-target-width'),
    targetWidthNum: document.getElementById('dither-target-width-n'),
    originalRes: document.getElementById('dither-original-res'),
    paletteSize: document.getElementById('dither-palette-size'),
    paletteSizeNum: document.getElementById('dither-palette-size-n'),
    pixelScale: document.getElementById('dither-pixel-scale'),
    pixelScaleNum: document.getElementById('dither-pixel-scale-n'),
    bayerSize: document.getElementById('dither-bayer-size'),
  };

  const convertBtn = document.getElementById('dither-convert');
  const resetBtn = document.getElementById('dither-reset');
  const headerDownloadBtn = document.getElementById('dither-header-download');
  const clearInputBtn = document.getElementById('dither-clear-input');
  const statusEl = document.getElementById('dither-status');

  const inputFullscreenBtn = document.querySelector('[data-target="dither-input-preview"]');
  const outputFullscreenBtn = document.querySelector('[data-target="dither-output-preview"]');

  const fullscreenOverlay = document.getElementById('dither-fullscreen-overlay');
  const fullscreenImg = document.getElementById('dither-fullscreen-img');
  const fullscreenClose = document.getElementById('dither-fullscreen-close');

  // Generate Bayer threshold matrices of any power-of-two size.
  function generateBayer(size) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error('Bayer size must be a power of 2');
    let m = [[0, 2], [3, 1]];
    while (m.length < size) {
      const n = m.length;
      const next = Array.from({ length: n * 2 }, () => new Array(n * 2).fill(0));
      for (let y = 0; y < n * 2; y++) {
        for (let x = 0; x < n * 2; x++) {
          const quadrant = (y >= n ? 2 : 0) + (x >= n ? 1 : 0);
          next[y][x] = m[y % n][x % n] * 4 + [0, 2, 3, 1][quadrant];
        }
      }
      m = next;
    }
    const max = size * size;
    return m.map(row => row.map(v => v / max));
  }

  const BAYER_MATRICES = {
    4: generateBayer(4),
    8: generateBayer(8),
    16: generateBayer(16),
  };

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function updateHeaderButtons() {
    const hasInput = !!srcImage;
    const hasOutput = outputPreview.style.display === 'block';
    clearInputBtn.disabled = !hasInput;
    headerDownloadBtn.disabled = !hasOutput;
    inputFullscreenBtn.disabled = !hasInput;
    outputFullscreenBtn.disabled = !hasOutput;
  }

  function clearInput() {
    srcImage = null;
    outputBlob = null;
    inputPreview.src = '';
    inputPreview.style.display = 'none';
    inputPlaceholder.style.display = 'block';
    outputPreview.src = '';
    outputPreview.style.display = 'none';
    document.getElementById('dither-output-placeholder').style.display = 'block';
    convertBtn.disabled = true;
    setStatus('Load an image to get started.');
    updateHeaderButtons();
  }

  function doDownload() {
    if (!outputBlob) return;
    const url = URL.createObjectURL(outputBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dithered.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openFullscreen(imgElement) {
    if (!imgElement || imgElement.style.display === 'none' || !imgElement.src) return;
    fullscreenImg.src = imgElement.src;
    fullscreenOverlay.classList.add('active');
  }

  function closeFullscreen() {
    fullscreenOverlay.classList.remove('active');
    fullscreenImg.src = '';
  }

  // --- Slider / number sync ---
  [
    ['dither-target-width', 'dither-target-width-n', false],
    ['dither-palette-size', 'dither-palette-size-n', false],
    ['dither-pixel-scale', 'dither-pixel-scale-n', false],
  ].forEach(([sliderId, numId, isFloat]) => {
    const slider = document.getElementById(sliderId);
    const num = document.getElementById(numId);
    const fmt = v => isFloat ? parseFloat(v).toFixed(2) : String(parseInt(v));
    slider.addEventListener('input', () => { num.value = fmt(slider.value); });
    function apply() {
      let v = parseFloat(num.value);
      const mn = parseFloat(slider.min), mx = parseFloat(slider.max);
      if (isNaN(v)) { num.value = fmt(slider.value); return; }
      v = Math.min(mx, Math.max(mn, v));
      slider.value = v; num.value = fmt(v);
    }
    num.addEventListener('blur', apply);
    num.addEventListener('keydown', e => { if (e.key === 'Enter') { apply(); num.blur(); } });
  });

  controls.originalRes.addEventListener('change', () => {
    controls.targetWidth.disabled = controls.originalRes.checked;
    controls.targetWidthNum.disabled = controls.originalRes.checked;
  });

  controls.algorithm.addEventListener('change', () => {
    const isBayer = controls.algorithm.value === 'bayer';
    controls.bayerSize.disabled = !isBayer;
  });

  // --- Image upload ---
  function handleFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      srcImage = img;
      inputPreview.src = img.src;
      inputPreview.style.display = 'block';
      inputPlaceholder.style.display = 'none';
      convertBtn.disabled = false;
      setStatus('Image loaded. Hit Dither!');
      updateHeaderButtons();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus('Could not load image.');
    };
    img.src = url;
  }

  upload.addEventListener('change', () => {
    if (upload.files[0]) handleFile(upload.files[0]);
    upload.value = '';
  });

  inputZone.addEventListener('dragover', e => { e.preventDefault(); inputZone.classList.add('drag-active'); });
  inputZone.addEventListener('dragleave', () => inputZone.classList.remove('drag-active'));
  inputZone.addEventListener('drop', e => {
    e.preventDefault();
    inputZone.classList.remove('drag-active');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  // Click an image to fullscreen it; prevent browser context menu on images.
  [inputPreview, outputPreview].forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      openFullscreen(img);
    });
    img.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // Header buttons.
  document.querySelectorAll('.fullscreen-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      openFullscreen(target);
    });
  });

  clearInputBtn.addEventListener('click', clearInput);
  resetBtn.addEventListener('click', clearInput);
  headerDownloadBtn.addEventListener('click', doDownload);

  fullscreenClose.addEventListener('click', closeFullscreen);
  fullscreenOverlay.addEventListener('click', (e) => {
    if (e.target === fullscreenOverlay || e.target === fullscreenImg) closeFullscreen();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFullscreen();
  });

  // --- Palette generation (median cut) ---
  function medianCut(pixels, n) {
    function cut(bucket) {
      if (!bucket.length) return [[128, 128, 128]];
      let mn = [255, 255, 255], mx = [0, 0, 0];
      for (const p of bucket) {
        for (let c = 0; c < 3; c++) {
          if (p[c] < mn[c]) mn[c] = p[c];
          if (p[c] > mx[c]) mx[c] = p[c];
        }
      }
      const ranges = mx.map((v, i) => v - mn[i]);
      const ch = ranges.indexOf(Math.max(...ranges));
      bucket.sort((a, b) => a[ch] - b[ch]);
      const mid = bucket.length >> 1;
      return [bucket.slice(0, mid), bucket.slice(mid)];
    }
    let buckets = [pixels];
    while (buckets.length < n) {
      buckets.sort((a, b) => b.length - a.length);
      const [a, b] = cut(buckets.shift());
      if (a.length) buckets.push(a);
      if (b.length) buckets.push(b);
    }
    return buckets.map(bucket => {
      const avg = bucket.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
      return avg.map(v => Math.round(v / bucket.length));
    });
  }

  function buildPalette(data, size) {
    const samples = [];
    // Sample every 4th pixel to keep it fast on large images.
    for (let i = 0; i < data.length; i += 16) {
      samples.push([data[i], data[i + 1], data[i + 2]]);
    }
    return medianCut(samples, size);
  }

  function nearestColour(r, g, b, palette) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const dr = r - palette[i][0], dg = g - palette[i][1], db = b - palette[i][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    return palette[best];
  }

  function nearestTwoColours(r, g, b, palette) {
    let best = 0, bestD = Infinity;
    let second = 1, secondD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const dr = r - palette[i][0], dg = g - palette[i][1], db = b - palette[i][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        second = best; secondD = bestD;
        best = i; bestD = d;
      } else if (d < secondD) {
        second = i; secondD = d;
      }
    }
    return [palette[best], palette[second], bestD, secondD];
  }

  // --- Dithering algorithms ---
  function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

  function getLum(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function applyThreshold(data, width, height) {
    for (let i = 0; i < data.length; i += 4) {
      const lum = getLum(data[i], data[i + 1], data[i + 2]);
      const val = lum < 128 ? 0 : 255;
      data[i] = val; data[i + 1] = val; data[i + 2] = val;
    }
  }

  function applyBayer(data, width, height, palette) {
    const matrix = BAYER_MATRICES[controls.bayerSize.value];
    const size = matrix.length;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const threshold = matrix[y % size][x % size];
        const [c1, c2, d1, d2] = nearestTwoColours(r, g, b, palette);
        // Pixels closer to c1 use c1 more often; pixels closer to c2 use c2 more often.
        const chooseC1 = threshold < (d2 / (d1 + d2));
        const [nr, ng, nb] = chooseC1 ? c1 : c2;
        data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
      }
    }
  }

  function applyFloydSteinberg(data, width, height, palette) {
    // Work in floating-point to accumulate error.
    const buf = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) buf[i] = data[i];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const oldR = buf[i], oldG = buf[i + 1], oldB = buf[i + 2];
        const [nr, ng, nb] = nearestColour(oldR, oldG, oldB, palette);
        data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;

        const er = oldR - nr, eg = oldG - ng, eb = oldB - nb;
        const distribute = (dx, dy, factor) => {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
          const ni = (ny * width + nx) * 4;
          buf[ni] += er * factor;
          buf[ni + 1] += eg * factor;
          buf[ni + 2] += eb * factor;
        };
        distribute(1, 0, 7 / 16);
        distribute(-1, 1, 3 / 16);
        distribute(0, 1, 5 / 16);
        distribute(1, 1, 1 / 16);
      }
    }
  }

  function applyAtkinson(data, width, height, palette) {
    const buf = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) buf[i] = data[i];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const oldR = buf[i], oldG = buf[i + 1], oldB = buf[i + 2];
        const [nr, ng, nb] = nearestColour(oldR, oldG, oldB, palette);
        data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;

        const er = (oldR - nr) / 8;
        const eg = (oldG - ng) / 8;
        const eb = (oldB - nb) / 8;
        const distribute = (dx, dy) => {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
          const ni = (ny * width + nx) * 4;
          buf[ni] += er;
          buf[ni + 1] += eg;
          buf[ni + 2] += eb;
        };
        distribute(1, 0);
        distribute(2, 0);
        distribute(-1, 1);
        distribute(0, 1);
        distribute(1, 1);
        distribute(0, 2);
      }
    }
  }

  // --- Main convert ---
  function convert() {
    if (!srcImage) return;
    convertBtn.disabled = true;
    setStatus('Dithering...');

    setTimeout(() => {
      try {
        const algorithm = controls.algorithm.value;
        const paletteSize = parseInt(controls.paletteSize.value);
        const pixelScale = parseInt(controls.pixelScale.value);
        const useOriginal = controls.originalRes.checked;

        let tW = useOriginal ? srcImage.width : parseInt(controls.targetWidth.value);
        let tH = Math.round(tW * srcImage.height / srcImage.width);
        tW = Math.max(1, tW); tH = Math.max(1, tH);

        workCanvas.width = tW;
        workCanvas.height = tH;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(srcImage, 0, 0, tW, tH);

        const imgData = ctx.getImageData(0, 0, tW, tH);
        const data = imgData.data;

        if (algorithm === 'threshold') {
          applyThreshold(data, tW, tH);
        } else {
          const palette = buildPalette(data, paletteSize);
          if (algorithm === 'bayer') applyBayer(data, tW, tH, palette);
          else if (algorithm === 'floyd-steinberg') applyFloydSteinberg(data, tW, tH, palette);
          else if (algorithm === 'atkinson') applyAtkinson(data, tW, tH, palette);
        }

        ctx.putImageData(imgData, 0, 0);

        // Scale up for display.
        const outW = tW * pixelScale;
        const outH = tH * pixelScale;
        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW;
        outCanvas.height = outH;
        const outCtx = outCanvas.getContext('2d');
        outCtx.imageSmoothingEnabled = false;
        outCtx.drawImage(workCanvas, 0, 0, outW, outH);

        outputPreview.src = outCanvas.toDataURL('image/png');
        outputPreview.style.display = 'block';
        document.getElementById('dither-output-placeholder').style.display = 'none';

        outCanvas.toBlob(blob => {
          outputBlob = blob;
          updateHeaderButtons();
        }, 'image/png');

        setStatus(`Done! ${outW}x${outH}px · ${algorithm}`);
      } catch (err) {
        setStatus('Error: ' + err.message);
        console.error(err);
      }
      convertBtn.disabled = false;
    }, 20);
  }

  convertBtn.addEventListener('click', convert);

  updateHeaderButtons();
});

