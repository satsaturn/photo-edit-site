// Pixless Camera Emulator — pixelation engine.
// Wrapped in DOMContentLoaded to ensure elements exist before binding.

document.addEventListener('DOMContentLoaded', () => {
  let srcImage = null, palette = null, outputBlob = null;

  // --- Slider <-> number sync ---
  [
    ['target-width', false],
    ['pixel-scale', false],
    ['palette-size', false],
    ['brightness', true],
    ['contrast', true],
  ].forEach(([id, isFloat]) => {
    const slider = document.getElementById(id);
    const num = document.getElementById(id + '-n');
    if (!slider || !num) return;
    const fmt = v => isFloat ? parseFloat(v).toFixed(2) : String(parseInt(v));
    slider.addEventListener('input', () => { num.value = fmt(slider.value); });
    function applyNum() {
      let v = parseFloat(num.value);
      const mn = parseFloat(slider.min), mx = parseFloat(slider.max);
      if (isNaN(v)) { num.value = fmt(slider.value); return; }
      v = Math.min(mx, Math.max(mn, v));
      slider.value = v; num.value = fmt(v);
    }
    num.addEventListener('blur', applyNum);
    num.addEventListener('keydown', e => { if (e.key === 'Enter') { applyNum(); num.blur(); } });
    num.value = fmt(slider.value);
  });

  // --- Drop zone setup ---
  function setupDrop(zoneId, inputId, onFile) {
    const zone = document.getElementById(zoneId);
    const inp = document.getElementById(inputId);
    if (!zone || !inp) return;
    inp.addEventListener('change', () => { if (inp.files[0]) onFile(inp.files[0]); inp.value = ''; });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
    });
  }

  // --- Status helper ---
  function setStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
  }

  // --- Image upload ---
  setupDrop('input-zone', 'img-input', file => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        srcImage = img;
        const prev = document.getElementById('input-preview');
        prev.src = e.target.result; prev.style.display = 'block';
        document.getElementById('input-placeholder').style.display = 'none';
        document.getElementById('convert-btn').disabled = false;
        setStatus('> Image loaded. Hit Convert!');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  // --- Palette upload ---
  function loadPaletteFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const lines = e.target.result.split('\n');
      const parsed = [];
      lines.forEach(line => {
        const hex = line.trim().replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(hex))
          parsed.push([parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]);
      });
      if (!parsed.length) { setStatus('> No valid colours found in palette file.'); return; }
      palette = parsed;
      const nameEl = document.getElementById('palette-name');
      nameEl.textContent = file.name.replace(/\.(txt|hex)$/i, '') + ' · ' + palette.length + ' colours';
      nameEl.style.display = 'block';
      const prev = document.getElementById('palette-preview');
      prev.innerHTML = '';
      palette.forEach(([r, g, b]) => {
        const sw = document.createElement('div');
        sw.className = 'swatch'; sw.style.background = `rgb(${r},${g},${b})`; prev.appendChild(sw);
      });
      prev.style.display = 'flex';
      document.getElementById('palette-placeholder').style.display = 'none';
      document.getElementById('clear-palette-btn').style.display = 'block';
      setStatus('> Palette loaded: ' + palette.length + ' colours.');
    };
    reader.readAsText(file);
  }
  setupDrop('palette-zone', 'palette-input', loadPaletteFile);

  // --- Clear palette ---
  const clearBtn = document.getElementById('clear-palette-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      palette = null;
      document.getElementById('palette-name').style.display = 'none';
      document.getElementById('palette-preview').style.display = 'none';
      document.getElementById('palette-preview').innerHTML = '';
      document.getElementById('palette-placeholder').style.display = 'flex';
      document.getElementById('clear-palette-btn').style.display = 'none';
      setStatus('> Palette cleared. Using auto-colour.');
    });
  }

  // --- Pixelation helpers ---
  function adjustBrightness(data, f) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, data[i] * f);
      data[i + 1] = Math.min(255, data[i + 1] * f);
      data[i + 2] = Math.min(255, data[i + 2] * f);
    }
  }

  function adjustContrast(data, f) {
    let sum = 0, n = data.length / 4;
    for (let i = 0; i < data.length; i += 4)
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const mean = sum / n;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.max(0, mean + (data[i] - mean) * f));
      data[i + 1] = Math.min(255, Math.max(0, mean + (data[i + 1] - mean) * f));
      data[i + 2] = Math.min(255, Math.max(0, mean + (data[i + 2] - mean) * f));
    }
  }

  // --- Convert ---
  function convert() {
    if (!srcImage) return;
    const btn = document.getElementById('convert-btn');
    btn.disabled = true; setStatus('> Processing...');
    setTimeout(() => {
      try {
        const tW = parseInt(document.getElementById('target-width').value);
        const pxScl = parseInt(document.getElementById('pixel-scale').value);
        const pSize = parseInt(document.getElementById('palette-size').value);
        const bright = parseFloat(document.getElementById('brightness').value);
        const cont = parseFloat(document.getElementById('contrast').value);
        const tH = Math.round(tW * srcImage.height / srcImage.width);
        const offscreen = document.getElementById('offscreen');
        offscreen.width = tW; offscreen.height = tH;
        const ctx = offscreen.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(srcImage, 0, 0, tW, tH);
        const imgData = ctx.getImageData(0, 0, tW, tH); const data = imgData.data;
        if (bright !== 1.0) adjustBrightness(data, bright);
        if (cont !== 1.0) adjustContrast(data, cont);
        let pal = palette;
        if (!pal) {
          const samples = [];
          // Sample every 4th pixel for palette generation; fast and still representative.
          for (let i = 0; i < data.length; i += 16) samples.push([data[i], data[i + 1], data[i + 2]]);
          pal = window.PhotoEditPalette.buildPalette(samples, pSize);
        }
        const labPal = window.PhotoEditPalette.makeLabPalette(pal);
        for (let i = 0; i < data.length; i += 4) {
          const [r, g, b] = window.PhotoEditPalette.nearestColorLab(data[i], data[i + 1], data[i + 2], labPal);
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
        ctx.putImageData(imgData, 0, 0);
        const outW = tW * pxScl, outH = tH * pxScl;
        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW; outCanvas.height = outH;
        const outCtx = outCanvas.getContext('2d');
        outCtx.imageSmoothingEnabled = false;
        outCtx.drawImage(offscreen, 0, 0, outW, outH);
        const outPrev = document.getElementById('output-preview');
        outPrev.src = outCanvas.toDataURL('image/png'); outPrev.style.display = 'block';
        document.getElementById('output-placeholder').style.display = 'none';
        outCanvas.toBlob(blob => {
          outputBlob = blob;
          document.getElementById('download-btn').style.display = 'inline-block';
        }, 'image/png');
        setStatus('> Done! ' + outW + 'x' + outH + 'px · ' + pal.length + ' colours');
      } catch (err) {
        setStatus('> Error: ' + err.message);
        console.error(err);
      }
      btn.disabled = false;
    }, 20);
  }

  // --- Button bindings ---
  const convertBtn = document.getElementById('convert-btn');
  const downloadBtn = document.getElementById('download-btn');
  if (convertBtn) convertBtn.addEventListener('click', convert);
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      if (!outputBlob) return;
      const url = URL.createObjectURL(outputBlob);
      const a = document.createElement('a'); a.href = url; a.download = 'pixelated.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
});
