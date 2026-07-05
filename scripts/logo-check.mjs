// Verify the header renders the real logo IMAGE (not the text fallback):
// an <img> that actually loaded (naturalWidth > 0) pointing at a bundled asset.
//
//   node scripts/logo-check.mjs http://127.0.0.1:18090

import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://127.0.0.1:18090';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle2' });

const info = await page.evaluate(async () => {
    const img = document.querySelector('header img[alt="Fans Fund Me"]');
    if (!img) return { found: false };
    // Ensure it has finished loading.
    if (!img.complete) {
        await new Promise((res) => {
            img.onload = res;
            img.onerror = res;
        });
    }
    return {
        found: true,
        src: img.getAttribute('src'),
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        renderedHeight: Math.round(img.getBoundingClientRect().height),
    };
});

console.log('logo img:', JSON.stringify(info));

const problems = [];
if (!info.found) problems.push('No <img alt="Fans Fund Me"> in header (showing text fallback?)');
else {
    if (!info.naturalWidth || info.naturalWidth === 0)
        problems.push('image did not load (naturalWidth 0)');
    if (!/ffm-logo/.test(info.src ?? ''))
        problems.push(`unexpected src: ${info.src}`);
}

await browser.close();
if (problems.length) {
    console.log('LOGO PROBLEMS:', problems);
    process.exit(1);
}
console.log(`LOGO IMAGE OK — ${info.naturalWidth}x${info.naturalHeight} px, src=${info.src}`);
