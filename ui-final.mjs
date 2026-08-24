import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 1500, height: 1100 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
const st = () => p.evaluate(() => {
  const r = window.__getResult();
  const area = r.holes.reduce((a, h) => a + Math.PI * h.r * h.r, 0);
  return { gen: window.__state.generatorId, src: window.__state.sourceKind, dither: r.stipple.dither,
           holes: r.holes.length, open: +((area/(r.W*r.H))*100).toFixed(2), minWeb: +r.minWeb.toFixed(3) };
});
console.log('buttons:', await Promise.all((await p.$$('#generatorSeg button')).map((x) => x.textContent())));
console.log('start           ', JSON.stringify(await st()));

// auto-switch on photo load
await p.setInputFiles('#photoFile', '/tmp/testimg.png');
await p.waitForTimeout(1800);
console.log('after photo load', JSON.stringify(await st()), '<- should be detail');

// an explicit choice must survive a second load
await p.click('#generatorSeg button[data-gen="classic"]');
await p.waitForTimeout(700);
await p.setInputFiles('#photoFile', '/tmp/testimg.png');
await p.waitForTimeout(1800);
console.log('explicit + reload', JSON.stringify(await st()), '<- should stay classic');

// back to presets, cycle all three
const btns = await p.$$('#sourceSeg button');
await btns[0].click(); await p.waitForTimeout(600);
await p.selectOption('#preset', 'escarcha'); await p.waitForTimeout(600);
for (const g of ['classic','smooth','detail']) {
  await p.click(`#generatorSeg button[data-gen="${g}"]`);
  await p.waitForTimeout(650);
  console.log(g.padEnd(16), JSON.stringify(await st()));
}
// export still produces a valid SVG
const svg = await p.evaluate(() => {
  const r = window.__getResult();
  return { holes: r.holes.length, w: +r.W.toFixed(1), h: r.H };
});
console.log('export payload  ', JSON.stringify(svg));
console.log('errors:', errs.length ? errs : 'none');
await p.screenshot({ path: '/tmp/ui-final.png' });
await b.close();
