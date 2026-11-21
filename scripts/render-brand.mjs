import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// The SVG is the source of truth. Render the public social card, PNG fallback,
// and old download URLs without paying the raster weight at first paint.
const brand = new URL('../public/brand/', import.meta.url);
const [svg, font] = await Promise.all([
  readFile(new URL('xyvora-orbit.svg', brand), 'base64'),
  readFile(new URL('../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2', import.meta.url), 'base64'),
]);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  const assets = await page.evaluate(async ({ svg, font }) => {
    const face = new FontFace('Manrope', `url(data:font/woff2;base64,${font})`, { weight: '200 800' });
    document.fonts.add(await face.load());
    const orbit = new Image();
    orbit.src = `data:image/svg+xml;base64,${svg}`;
    await orbit.decode();
    const output = {};
    function canvas(width, height) {
      const el = document.createElement('canvas');
      el.width = width; el.height = height;
      return [el, el.getContext('2d')];
    }
    function save(el, name, png = false) {
      output[name] = el.toDataURL(png ? 'image/png' : 'image/webp', .92).split(',')[1];
    }
    const [icon, i] = canvas(64, 64);
    i.fillStyle = '#eee7ff'; i.beginPath(); i.roundRect(0, 0, 64, 64, 15); i.fill();
    i.drawImage(orbit, 2, 2, 60, 60);
    save(icon, 'xyvora-icon.png', true);

    for (const dark of [false, true]) {
      for (const [width, suffix] of [[648, ''], [1296, '-hd'], [3840, '-4k']]) {
        const [lockup, ctx] = canvas(width, suffix === '-4k' ? 1284 : Math.round(width * 217 / 648));
        ctx.scale(width / 648, width / 648);
        ctx.drawImage(orbit, 16, 12, 192, 192);
        ctx.font = '800 91px Manrope'; ctx.letterSpacing = '-5px'; ctx.fillStyle = dark ? '#f4eefb' : '#211b33';
        const start = 205;
        ctx.fillText('Xyvora', start, 124);
        ctx.fillStyle = dark ? '#c5aaff' : '#6941d5';
        ctx.fillText(' AI', start + ctx.measureText('Xyvora').width, 124);
        ctx.font = '800 17px Manrope'; ctx.letterSpacing = '3.4px';
        ctx.fillText('THINK BIG. LEAP AHEAD.', start + 4, 157);
        save(lockup, `xyvora-lockup${dark ? '-dark' : ''}${suffix}.webp`);
      }
    }

    const [card, c] = canvas(1200, 630);
    const wash = c.createLinearGradient(0, 630, 1200, 0);
    wash.addColorStop(0, '#181424'); wash.addColorStop(1, '#2c1d4b');
    c.fillStyle = wash; c.fillRect(0, 0, 1200, 630);
    const halo = c.createRadialGradient(928, 303, 20, 928, 303, 341);
    halo.addColorStop(0, '#6841a29c'); halo.addColorStop(1, '#6841a200');
    c.fillStyle = halo; c.fillRect(600, 0, 600, 630);
    c.fillStyle = '#b99af744';
    for (let x = 730; x <= 1120; x += 25) for (let y = 100; y <= 525; y += 25) {
      c.beginPath(); c.arc(x, y, 1.3, 0, 2 * Math.PI); c.fill();
    }
    c.strokeStyle = '#ad8df357'; c.lineWidth = 1.4;
    c.beginPath(); c.ellipse(944, 317, 223, 124, -.64, 0, 2 * Math.PI); c.stroke();
    c.beginPath(); c.ellipse(944, 317, 204, 173, -.64, 0, 2 * Math.PI); c.stroke();
    c.drawImage(orbit, 746, 114, 393, 393);
    c.fillStyle = '#c8adff'; c.font = '800 25px Manrope'; c.letterSpacing = '3px';
    c.fillText('XYVORA AI', 73, 109);
    c.fillStyle = '#faf6ff'; c.font = '800 90px Manrope'; c.letterSpacing = '-5px';
    c.fillText('Think big.', 69, 247); c.fillText('Leap ahead.', 69, 350);
    c.fillStyle = '#cfbedf'; c.font = '650 28px Manrope'; c.letterSpacing = '0px';
    c.fillText('Chat, learn, and make something.', 75, 424);
    c.strokeStyle = '#8d67d36e'; c.beginPath(); c.roundRect(73, 496, 178, 51, 24); c.stroke();
    c.fillStyle = '#e1ceff'; c.font = '800 24px Manrope'; c.fillText('xyvora.net', 99, 530);
    save(card, 'xyvora-social.webp');
    return output;
  }, { svg, font });
  await Promise.all(Object.entries(assets).map(([name, value]) => writeFile(new URL(name, brand), Buffer.from(value, 'base64'))));
  console.log(`Rendered ${Object.keys(assets).length} Orbit brand assets.`);
} finally { await browser.close(); }
