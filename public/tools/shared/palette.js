// Shared colour-quantization helpers for the Photo Edit Site tools.
// Works in CIE Lab space for perceptually better palette extraction and
// nearest-colour lookups than plain RGB averaging.

(function () {
  'use strict';

  // ----- CONFIGURATION -----
  // D65 reference white point.
  const XN = 0.95047;
  const YN = 1.00000;
  const ZN = 1.08883;

  // K-means tuning.
  const K_MEANS_MAX_ITERATIONS = 20;
  const K_MEANS_CONVERGENCE_EPSILON = 0.5; // total centroid movement in Lab units

  // ----- RGB <-> LINEAR RGB -----
  function toLinear(channel) {
    // channel in [0, 1]
    return channel > 0.04045 ? Math.pow((channel + 0.055) / 1.055, 2.4) : channel / 12.92;
  }

  function fromLinear(linear) {
    return linear > 0.0031308 ? 1.055 * Math.pow(linear, 1 / 2.4) - 0.055 : 12.92 * linear;
  }

  // ----- RGB <-> XYZ -----
  function rgbToXyz([r, g, b]) {
    const lr = toLinear(r / 255);
    const lg = toLinear(g / 255);
    const lb = toLinear(b / 255);

    return [
      0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb,
      0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb,
      0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb
    ];
  }

  function xyzToRgb([x, y, z]) {
    const lr =  3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
    const lg = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
    const lb =  0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

    return [
      Math.round(Math.max(0, Math.min(255, fromLinear(lr) * 255))),
      Math.round(Math.max(0, Math.min(255, fromLinear(lg) * 255))),
      Math.round(Math.max(0, Math.min(255, fromLinear(lb) * 255)))
    ];
  }

  // ----- XYZ <-> Lab -----
  function labF(t) {
    return t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
  }

  function labFInv(t) {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  }

  function rgbToLab(rgb) {
    const [x, y, z] = rgbToXyz(rgb);
    return [
      116 * labF(y / YN) - 16,
      500 * (labF(x / XN) - labF(y / YN)),
      200 * (labF(y / YN) - labF(z / ZN))
    ];
  }

  function labToRgb(lab) {
    const [l, a, b] = lab;
    const fy = (l + 16) / 116;
    const fx = a / 500 + fy;
    const fz = fy - b / 200;

    const x = XN * labFInv(fx);
    const y = YN * labFInv(fy);
    const z = ZN * labFInv(fz);

    return xyzToRgb([x, y, z]);
  }

  // ----- DISTANCE -----
  function labDistance(a, b) {
    const dl = a[0] - b[0];
    const da = a[1] - b[1];
    const db = a[2] - b[2];
    return dl * dl + da * da + db * db;
  }

  // ----- MEDIAN CUT (in Lab space) -----
  // Splits the colour space by median along the widest Lab channel and returns
  // the average Lab colour of each bucket. Used only to seed k-means.
  function medianCutLab(pixels, n) {
    if (n <= 1) {
      const avg = pixels.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0])
        .map(v => v / pixels.length);
      return [avg];
    }

    function cut(bucket) {
      if (!bucket.length) return [];
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
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
      const largest = buckets.shift();
      const [a, b] = cut(largest);
      if (a.length) buckets.push(a);
      if (b.length) buckets.push(b);
      // Stop if we cannot split any further.
      if (buckets.length === 0 || (buckets.length === 1 && buckets[0].length <= 1)) break;
    }

    return buckets.map(bucket => {
      const avg = bucket.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0])
        .map(v => v / bucket.length);
      return avg;
    });
  }

  // ----- K-MEANS (in Lab space) -----
  function kMeansLab(pixels, n) {
    if (n >= pixels.length) {
      // Each pixel becomes its own centroid; pad with duplicates if needed.
      const centroids = pixels.slice(0, n);
      while (centroids.length < n) centroids.push(pixels[pixels.length - 1] || [0, 0, 0]);
      return centroids;
    }

    let centroids = medianCutLab(pixels, n);
    // Pad if median cut produced fewer colours than requested.
    while (centroids.length < n) {
      centroids.push(pixels[Math.floor(Math.random() * pixels.length)]);
    }

    const assignments = new Uint16Array(pixels.length);

    for (let iter = 0; iter < K_MEANS_MAX_ITERATIONS; iter++) {
      // Assignment step.
      for (let i = 0; i < pixels.length; i++) {
        let best = 0;
        let bestD = labDistance(pixels[i], centroids[0]);
        for (let j = 1; j < n; j++) {
          const d = labDistance(pixels[i], centroids[j]);
          if (d < bestD) { bestD = d; best = j; }
        }
        assignments[i] = best;
      }

      // Update step.
      const sums = Array.from({ length: n }, () => [0, 0, 0]);
      const counts = new Uint32Array(n);

      for (let i = 0; i < pixels.length; i++) {
        const idx = assignments[i];
        const p = pixels[i];
        sums[idx][0] += p[0];
        sums[idx][1] += p[1];
        sums[idx][2] += p[2];
        counts[idx]++;
      }

      let moved = 0;
      for (let j = 0; j < n; j++) {
        if (counts[j] === 0) {
          // Empty cluster: reseed to the pixel farthest from its current centroid.
          let worstD = -1, worstPixel = pixels[0];
          for (let i = 0; i < pixels.length; i++) {
            const d = labDistance(pixels[i], centroids[assignments[i]]);
            if (d > worstD) { worstD = d; worstPixel = pixels[i]; }
          }
          const old = centroids[j];
          centroids[j] = worstPixel.slice();
          moved += labDistance(old, centroids[j]);
          continue;
        }
        const newCentroid = [
          sums[j][0] / counts[j],
          sums[j][1] / counts[j],
          sums[j][2] / counts[j]
        ];
        moved += labDistance(centroids[j], newCentroid);
        centroids[j] = newCentroid;
      }

      if (moved < K_MEANS_CONVERGENCE_EPSILON) break;
    }

    return centroids;
  }

  // ----- PUBLIC API -----
  window.PhotoEditPalette = {
    /**
     * Build a palette of n RGB colours from an array of [r,g,b] pixels using
     * k-means clustering in CIE Lab space.
     */
    buildPalette(rgbPixels, n) {
      if (!rgbPixels.length) return [[128, 128, 128]];
      n = Math.max(1, Math.min(n, rgbPixels.length));
      const labPixels = rgbPixels.map(rgbToLab);
      const centroids = kMeansLab(labPixels, n);
      return centroids.map(labToRgb);
    },

    /**
     * Convert an RGB palette into a Lab palette for fast nearest-colour lookups.
     * Returns an array of { rgb: [r,g,b], lab: [l,a,b] } objects.
     */
    makeLabPalette(rgbPalette) {
      return rgbPalette.map(rgb => ({ rgb, lab: rgbToLab(rgb) }));
    },

    /**
     * Return the nearest RGB palette colour to (r,g,b), using Lab distance.
     */
    nearestColorLab(r, g, b, labPalette) {
      const pixelLab = rgbToLab([r, g, b]);
      let best = 0;
      let bestD = labDistance(pixelLab, labPalette[0].lab);
      for (let i = 1; i < labPalette.length; i++) {
        const d = labDistance(pixelLab, labPalette[i].lab);
        if (d < bestD) { bestD = d; best = i; }
      }
      return labPalette[best].rgb;
    },

    /**
     * Return the two nearest RGB palette colours and their Lab distances.
     * Result: [c1, c2, d1, d2]
     */
    nearestTwoColoursLab(r, g, b, labPalette) {
      const pixelLab = rgbToLab([r, g, b]);
      let best = 0, bestD = Infinity;
      let second = 1, secondD = Infinity;
      for (let i = 0; i < labPalette.length; i++) {
        const d = labDistance(pixelLab, labPalette[i].lab);
        if (d < bestD) {
          second = best; secondD = bestD;
          best = i; bestD = d;
        } else if (d < secondD) {
          second = i; secondD = d;
        }
      }
      return [labPalette[best].rgb, labPalette[second].rgb, bestD, secondD];
    }
  };
})();
