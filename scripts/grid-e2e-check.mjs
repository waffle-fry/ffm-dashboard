// Ad-hoc end-to-end check for the dashboard widget grid, driven through a REAL
// Google Chrome via puppeteer-core. It verifies the things the user keeps
// hitting: (1) the grid uses the full width as multiple columns (not one) at a
// range of screen sizes, and (2) dragging a card actually moves it, other cards
// get out of the way, cards stay on-screen, and no two cards ever overlap.
//
// Not part of the unit suite — run manually against a port-forwarded UI:
//   node scripts/grid-e2e-check.mjs http://127.0.0.1:18090

import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'http://127.0.0.1:18090';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Exercise a narrow, a typical, and a wide viewport — the "single column /
// doesn't use the whole width" complaint was width-dependent.
const VIEWPORTS = [
    { width: 1280, height: 800 },
    { width: 1600, height: 900 },
    { width: 2560, height: 1080 },
];

/** Rectangles overlap if they intersect on both axes (with a 2px tolerance). */
function overlaps(a, b) {
    const t = 2;
    return (
        a.left + t < b.left + b.width &&
        b.left + t < a.left + a.width &&
        a.top + t < b.top + b.height &&
        b.top + t < a.top + a.height
    );
}

function findOverlaps(rects) {
    const bad = [];
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            if (overlaps(rects[i], rects[j])) bad.push([i, j]);
        }
    }
    return bad;
}

function readItems(page) {
    return page.$$eval('.react-grid-item', (els) =>
        els.map((e) => {
            const r = e.getBoundingClientRect();
            return {
                left: Math.round(r.left),
                top: Math.round(r.top),
                width: Math.round(r.width),
                height: Math.round(r.height),
            };
        }),
    );
}

function inBounds(rects, container) {
    for (const r of rects) {
        if (
            r.left < container.left - 3 ||
            r.left + r.width > container.left + container.width + 3
        ) {
            return r;
        }
    }
    return null;
}

async function checkViewport(browser, viewport) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    const problems = [];
    const label = `${viewport.width}x${viewport.height}`;

    // Start from the canonical default layout (clear any stale/corrupt config).
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
        try {
            localStorage.clear();
        } catch { }
    });
    await page.reload({ waitUntil: 'networkidle2' });

    await page.waitForSelector('.react-grid-layout', { timeout: 15000 });
    await page.waitForSelector('.react-grid-item', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 800));

    const container = await page.$eval('.react-grid-layout', (e) => {
        const r = e.getBoundingClientRect();
        return {
            left: Math.round(r.left),
            top: Math.round(r.top),
            width: Math.round(r.width),
        };
    });

    const before = await readItems(page);
    const distinctLefts = [...new Set(before.map((r) => r.left))].sort(
        (a, b) => a - b,
    );
    const maxWidth = Math.max(...before.map((r) => r.width));
    const widthRatio = maxWidth / container.width;
    const rightExtent = Math.max(...before.map((r) => r.left + r.width));
    const rightRatio = (rightExtent - container.left) / container.width;

    console.log(`\n[${label}] container=${container.width} items=${before.length}`);
    console.log(`[${label}] distinct column x-edges: ${distinctLefts}`);
    console.log(
        `[${label}] widest/container=${widthRatio.toFixed(2)} rightExtent/container=${rightRatio.toFixed(2)}`,
    );

    if (distinctLefts.length < 3) {
        problems.push(
            `[${label}] Expected >=3 columns, got ${distinctLefts.length}: ${distinctLefts}`,
        );
    }
    if (widthRatio > 0.9) {
        problems.push(
            `[${label}] Widest card is ${(widthRatio * 100).toFixed(0)}% of container — single full-width column.`,
        );
    }
    if (rightRatio < 0.9) {
        problems.push(
            `[${label}] Cards only reach ${(rightRatio * 100).toFixed(0)}% across — right side unused.`,
        );
    }

    const oob = inBounds(before, container);
    if (oob) {
        problems.push(`[${label}] A card is off-screen at rest: ${JSON.stringify(oob)}`);
    }

    const overlapsBefore = findOverlaps(before);
    if (overlapsBefore.length > 0) {
        problems.push(`[${label}] Cards overlap at rest: ${JSON.stringify(overlapsBefore)}`);
    }

    const handle = await page.$('.widget-drag-handle');
    if (!handle) {
        problems.push(`[${label}] No .widget-drag-handle found — cannot drag.`);
    } else {
        // Free-placement model: the dragged card must (a) stay where it is
        // dropped (follow the cursor on both axes, not snap back), (b) leave no
        // overlaps, and (c) NOT let the grid balloon far past the viewport.
        const beforeBottom = Math.max(...before.map((r) => r.top + r.height));

        const items = await page.$$('.react-grid-item');
        const dragged = items[0];
        const dragHandle = await dragged.$('.widget-drag-handle');
        const startRect = await dragged.boundingBox();
        const box = await dragHandle.boundingBox();
        const startX = box.x + box.width / 2;
        const startY = box.y + box.height / 2;
        const DX = Math.min(400, container.width * 0.3);
        const DY = 250;

        await page.mouse.move(startX, startY);
        await page.mouse.down();
        const steps = 25;
        for (let i = 1; i <= steps; i++) {
            await page.mouse.move(
                startX + (DX * i) / steps,
                startY + (DY * i) / steps,
            );
            await new Promise((r) => setTimeout(r, 8));
        }
        await page.mouse.up();
        await new Promise((r) => setTimeout(r, 600));

        const after = await readItems(page);

        // (a) Dragged card stayed where dropped (followed both axes).
        const endRect = await dragged.boundingBox();
        const dx = Math.round(endRect.x - startRect.x);
        const dy = Math.round(endRect.y - startRect.y);
        console.log(`[${label}] dragged card delta: dx=${dx} dy=${dy}`);
        if (dx <= 150 || dy <= 120) {
            problems.push(
                `[${label}] Dragged card did NOT stay where dropped (dx=${dx}, dy=${dy}) — it snapped back.`,
            );
        } else {
            console.log(`[${label}] dragged card stayed where dropped: OK`);
        }

        // No overlaps.
        const overlapsAfter = findOverlaps(after);
        if (overlapsAfter.length > 0) {
            problems.push(`[${label}] Cards overlap AFTER dragging: ${JSON.stringify(overlapsAfter)}`);
        } else {
            console.log(`[${label}] no overlaps after drag: OK`);
        }

        // Bounded: a single drop may make the grid a bit taller than the
        // viewport (it scrolls), but it must not fly off unbounded.
        const afterBottom = Math.max(...after.map((r) => r.top + r.height));
        const grewBy = afterBottom - beforeBottom;
        const capacity = 1.8 * viewport.height;
        console.log(
            `[${label}] grid bottom before=${Math.round(beforeBottom)} after=${Math.round(afterBottom)} (grewBy=${Math.round(grewBy)})`,
        );
        if (afterBottom - container.top > capacity) {
            problems.push(
                `[${label}] Grid grew past ${Math.round(capacity)}px (bottom at ${Math.round(afterBottom - container.top)}px) — cards ballooned down the page.`,
            );
        } else {
            console.log(`[${label}] grid height stayed bounded: OK`);
        }

        // Non-cumulative: drag the same card back toward the top-left; the grid
        // must shrink back to ~its original height, proving vacated space is
        // reclaimed and growth can't accumulate over repeated moves.
        const beforeBackRect = await dragged.boundingBox();
        const bh = await (await dragged.$('.widget-drag-handle')).boundingBox();
        const backDX = -(beforeBackRect.x - startRect.x);
        const backDY = -(beforeBackRect.y - startRect.y);
        await page.mouse.move(bh.x + bh.width / 2, bh.y + bh.height / 2);
        await page.mouse.down();
        for (let i = 1; i <= 25; i++) {
            await page.mouse.move(
                bh.x + bh.width / 2 + (backDX * i) / 25,
                bh.y + bh.height / 2 + (backDY * i) / 25,
            );
            await new Promise((r) => setTimeout(r, 8));
        }
        await page.mouse.up();
        await new Promise((r) => setTimeout(r, 600));
        const reclaimed = await readItems(page);
        const reclaimedBottom = Math.max(...reclaimed.map((r) => r.top + r.height));
        console.log(
            `[${label}] grid bottom after moving card back=${Math.round(reclaimedBottom)} (original=${Math.round(beforeBottom)})`,
        );
        if (reclaimedBottom > beforeBottom + 80) {
            problems.push(
                `[${label}] Space not reclaimed after moving the card back (bottom ${Math.round(reclaimedBottom)} vs original ${Math.round(beforeBottom)}) — growth is cumulative.`,
            );
        } else {
            console.log(`[${label}] space reclaimed (non-cumulative): OK`);
        }
        if (findOverlaps(reclaimed).length > 0) {
            problems.push(`[${label}] Overlaps after moving the card back.`);
        }
    }

    // Resize check: grow the first card via its south-east resize handle and
    // confirm it actually grows and nothing overlaps afterwards.
    const items2 = await page.$$('.react-grid-item');
    const resizeTarget = items2[0];
    const resizeHandle = await resizeTarget.$('.react-resizable-handle');
    if (!resizeHandle) {
        problems.push(`[${label}] No resize handle found — cannot resize.`);
    } else {
        const beforeR = await resizeTarget.boundingBox();
        const rb = await resizeHandle.boundingBox();
        const sx = rb.x + rb.width / 2;
        const sy = rb.y + rb.height / 2;
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        for (let i = 1; i <= 20; i++) {
            await page.mouse.move(sx + (150 * i) / 20, sy + (150 * i) / 20);
            await new Promise((r) => setTimeout(r, 8));
        }
        await page.mouse.up();
        await new Promise((r) => setTimeout(r, 500));

        const afterR = await resizeTarget.boundingBox();
        const grew = afterR.width > beforeR.width + 40 || afterR.height > beforeR.height + 40;
        console.log(
            `[${label}] resize delta: dw=${Math.round(afterR.width - beforeR.width)} dh=${Math.round(afterR.height - beforeR.height)}`,
        );
        if (!grew) {
            problems.push(`[${label}] Resizing did not grow the card.`);
        } else {
            console.log(`[${label}] resize grew the card: OK`);
        }

        const afterResizeItems = await readItems(page);
        const overlapsResize = findOverlaps(afterResizeItems);
        if (overlapsResize.length > 0) {
            problems.push(`[${label}] Cards overlap AFTER resizing: ${JSON.stringify(overlapsResize)}`);
        } else {
            console.log(`[${label}] no overlaps after resize: OK`);
        }
    }

    await page.close();
    return problems;
}

async function main() {
    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--no-sandbox'],
    });

    let problems = [];
    for (const vp of VIEWPORTS) {
        problems = problems.concat(await checkViewport(browser, vp));
    }

    await browser.close();

    console.log('\n=== RESULT ===');
    if (problems.length === 0) {
        console.log('ALL GRID CHECKS PASSED (across all viewports)');
        process.exit(0);
    }
    console.log('FAILURES:');
    for (const p of problems) console.log(' - ' + p);
    process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(2);
});
