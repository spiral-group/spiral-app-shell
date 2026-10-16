const strokePath = (outline) => {
  if (outline.length === 0) return "";
  const d = ["M", outline[0][0], outline[0][1], "Q"];
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    d.push(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  d.push("Z");
  return d.join(" ");
};
const fitCanvas = (canvas) => {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
};
export {
  fitCanvas,
  strokePath
};
//# sourceMappingURL=runtime-v1-play.js.map
