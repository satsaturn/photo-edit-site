// Channel Nodes — off-thread pixel processor.
// Receives source pixels, connections, and per-channel strengths,
// fills a destination buffer, and transfers it back.

(function () {
  const CH_INDEX = { r: 0, g: 1, b: 2 };

  self.onmessage = function (e) {
    const { src, dst, width, height, connections, strengths } = e.data;

    // Build list of source channel indices for each output channel.
    const outSources = { r: [], g: [], b: [] };
    for (const conn of connections) {
      if (conn.from.side === 'in' && conn.to.side === 'out') {
        outSources[conn.to.channel].push(CH_INDEX[conn.from.channel]);
      }
    }

    const rSrc = outSources.r;
    const gSrc = outSources.g;
    const bSrc = outSources.b;

    const rMul = strengths.r;
    const gMul = strengths.g;
    const bMul = strengths.b;

    const rCount = rSrc.length;
    const gCount = gSrc.length;
    const bCount = bSrc.length;

    for (let i = 0; i < src.length; i += 4) {
      let rVal = 0;
      let gVal = 0;
      let bVal = 0;

      if (rCount) {
        for (let s = 0; s < rCount; s++) rVal += src[i + rSrc[s]];
        rVal = rVal / rCount;
      }
      if (gCount) {
        for (let s = 0; s < gCount; s++) gVal += src[i + gSrc[s]];
        gVal = gVal / gCount;
      }
      if (bCount) {
        for (let s = 0; s < bCount; s++) bVal += src[i + bSrc[s]];
        bVal = bVal / bCount;
      }

      dst[i] = rCount ? Math.min(255, rVal * rMul) : 0;
      dst[i + 1] = gCount ? Math.min(255, gVal * gMul) : 0;
      dst[i + 2] = bCount ? Math.min(255, bVal * bMul) : 0;
      dst[i + 3] = src[i + 3];
    }

    self.postMessage({ dst, width, height }, [dst.buffer]);
  };
})();
