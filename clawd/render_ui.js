// Screenshots the HTML interface and renders every comp frame from the canvas.
// usage: node render_ui.js [--frames a-b]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BUILD = path.resolve(__dirname, '..', 'build');
const layout = JSON.parse(fs.readFileSync(path.join(BUILD, 'layout.json'), 'utf8'));

function savePng(dataUrl, file) {
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

(async () => {
  const arg = process.argv.indexOf('--frames');
  const [f0, f1] = arg > 0 ? process.argv[arg + 1].split('-').map(Number) : [1, layout.FRAMES];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: layout.UI_SCALE });
  const page = await ctx.newPage();

  await page.goto('file://' + path.join(BUILD, 'ui.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(BUILD, 'ui.png') });
  console.log('ui.png');

  await page.setViewportSize({ width: 240, height: 64 });
  await page.goto('file://' + path.join(BUILD, 'chip.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(BUILD, 'chip.png') });
  console.log('chip.png');

  await page.addInitScript(l => { window.LAYOUT = l; }, layout);
  await page.goto('file://' + path.join(__dirname, 'comp.html'));
  await page.evaluate(() => document.fonts.load('italic 900 40px Inter').then(() => document.fonts.load('800 40px Inter')));
  savePng(await page.evaluate(() => drawFlat()), path.join(BUILD, 'clawd_flat.png'));
  fs.mkdirSync(path.join(BUILD, 'comp'), { recursive: true });
  for (let f = f0; f <= f1; f++) {
    const url = await page.evaluate(t => drawFrame(t), (f - 1) / layout.FPS);
    savePng(url, path.join(BUILD, 'comp', `comp_${String(f).padStart(4, '0')}.png`));
  }
  console.log(`comp frames ${f0}-${f1}`);
  await browser.close();
})();
