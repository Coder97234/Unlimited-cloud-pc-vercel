export const ART_STYLES = ['Aurora', 'Orbit', 'Terrain'] as const;
export type ArtStyle = typeof ART_STYLES[number];

const palettes = [
  ['#0d0929', '#25105d', '#8b54ff', '#ef87e7', '#e3d7ff'],
  ['#071b24', '#083846', '#22beaa', '#9bffd7', '#e0fff5'],
  ['#151025', '#58305a', '#ef755a', '#ffc093', '#fff2d8'],
  ['#061220', '#101f55', '#4783ff', '#80e0ff', '#dfedff'],
] as const;

export async function renderLocalArt(prompt: string, style: ArtStyle, caption: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 3840;
  canvas.height = 2160;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('This browser cannot create a canvas.');
  const w = 1920, h = 1080;
  ctx.scale(2, 2);
  let seed = 2166136261;
  for (const char of `${prompt}|${style}`.toLowerCase()) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const theme = /mint|jade|forest|green/i.test(prompt) ? 1 : /sunset|warm|orange|peach/i.test(prompt) ? 2 : /ocean|sky|blue/i.test(prompt) ? 3 : (seed >>> 0) % palettes.length;
  const [dark, mid, bright, soft, white] = palettes[theme];
  const base = ctx.createLinearGradient(0, h, w, 0);
  base.addColorStop(0, dark); base.addColorStop(.62, mid); base.addColorStop(1, dark);
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  const x = w * (.44 + .16 * random()), y = h * (.3 + .13 * random());
  const light = ctx.createRadialGradient(x, y, 15, x, y, 650);
  light.addColorStop(0, `${bright}b0`); light.addColorStop(.55, `${bright}40`); light.addColorStop(1, `${mid}00`);
  ctx.fillStyle = light; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 220; i++) {
    const sx = random() * w, sy = random() * h, r = .45 + random() ** 3 * 2.2;
    ctx.fillStyle = i % 7 ? `${soft}6a` : `${white}d0`;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
  }
  if (style === 'Terrain') {
    const sun = ctx.createLinearGradient(0, y - 175, 0, y + 175);
    sun.addColorStop(0, white); sun.addColorStop(.7, soft); sun.addColorStop(1, bright);
    ctx.beginPath(); ctx.arc(x, y + 10, 164, 0, Math.PI * 2); ctx.fillStyle = sun; ctx.fill();
    for (let layer = 0; layer < 5; layer++) {
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let i = 0; i <= 12; i++) ctx.lineTo(i * w / 12, (580 + layer * 100) - random() * (240 - layer * 21));
      ctx.lineTo(w, h); ctx.closePath();
      ctx.fillStyle = [`${bright}b0`, `${soft}8e`, `${mid}ee`, dark, '#080916'][layer]; ctx.fill();
    }
  } else if (style === 'Orbit') {
    const globe = ctx.createRadialGradient(x - 45, y - 68, 12, x, y, 185);
    globe.addColorStop(0, white); globe.addColorStop(.3, soft); globe.addColorStop(.83, bright); globe.addColorStop(1, `${bright}09`);
    ctx.fillStyle = globe; ctx.beginPath(); ctx.arc(x, y, 185, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 14; i++) {
      ctx.beginPath(); ctx.ellipse(x, y, 238 + i * 30, 86 + i * 16, -.57 + i * .075, 0, Math.PI * 2);
      ctx.strokeStyle = i % 3 === 0 ? `${white}99` : `${soft}44`; ctx.lineWidth = i % 3 === 0 ? 2 : 1; ctx.stroke();
    }
  } else {
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 38; i++) {
      ctx.beginPath(); ctx.moveTo(-100, y + 70 + i * 8);
      ctx.bezierCurveTo(w * .32, y + 420 - i * 12, w * .44, y - 490 + i * 9, w + 100, y + 90 + i * 12);
      ctx.strokeStyle = i % 4 ? `${bright}25` : `${soft}50`;
      ctx.lineWidth = i % 4 ? 4 : 9; ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.strokeStyle = `${white}53`; ctx.lineWidth = 1.5; ctx.strokeRect(44, 44, w - 88, h - 88);
  const label = caption.trim().replace(/\s+/g, ' ').slice(0, 88);
  if (label) {
    ctx.save();
    const veil = ctx.createLinearGradient(0, h - 390, 0, h);
    veil.addColorStop(0, `${dark}00`); veil.addColorStop(1, `${dark}da`);
    ctx.fillStyle = veil; ctx.fillRect(45, h - 390, w - 90, 345);
    ctx.font = '650 88px system-ui, sans-serif'; ctx.fillStyle = white;
    ctx.textBaseline = 'alphabetic'; ctx.fillText(label, 112, h - 140, w - 224);
    ctx.restore();
  }
  ctx.font = '600 21px system-ui, sans-serif'; ctx.fillStyle = `${white}c0`;
  ctx.fillText(`${style.toUpperCase()}  /  XYVORA STUDIO`, 112, h - 86);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = canvas.height = 1;
  if (!blob) throw new Error('Could not export the graphic.');
  return blob;
}
