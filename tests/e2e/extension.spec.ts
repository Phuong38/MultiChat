import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let server: Server;
let baseUrl = '';

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const provider = (req.url ?? '/zalo').split('?')[0]?.replace(/^\//, '') || 'zalo';
    if (provider === 'attacker') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
        <html>
          <head><title>ATTACKER</title></head>
          <body>
            <h1 id="attacker-heading">attacker</h1>
            <iframe id="victim" src="/zalo"></iframe>
          </body>
        </html>`);
      return;
    }
    // Deliberately return strict framing blockers to verify DNR framing.json strips them only for extension initiatorDomains!
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'"
    });
    res.end(`<!doctype html>
      <html>
        <head><title>${provider.toUpperCase()}</title></head>
        <body>
          <h1 id="provider-heading">${provider}</h1>
          <script>
            window.__bootNonce = Math.random();
            window.__measureRafTicks = (ms) => new Promise((resolveTicks) => {
              let ticks = 0;
              let active = true;
              const loop = () => {
                if (!active) return;
                ticks += 1;
                requestAnimationFrame(loop);
              };
              requestAnimationFrame(loop);
              setTimeout(() => {
                active = false;
                resolveTicks(ticks);
              }, ms);
            });
          </script>
        </body>
      </html>`);
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const addr = server.address();
  if (addr && typeof addr === 'object') {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }
});

test.afterAll(async () => {
  if (server?.listening) {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});

test('MV3 extension strips X-Frame-Options/CSP, swaps Bento in 0ms without reload, bridges notifications/unread, and throttles sub-panes', async () => {
  const distPath = resolve(process.cwd(), 'dist');
  const userDataDir = mkdtempSync(join(tmpdir(), 'dia-bento-e2e-'));
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      viewport: { width: 1440, height: 900 },
      args: [
        `--disable-extensions-except=${distPath}`,
        `--load-extension=${distPath}`
      ]
    });

    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent('serviceworker');
    }
    const extId = new URL(sw.url()).host;
    expect(extId).toBe('ndcplbpbnmkeikikgmpgkaaiefmecmjh');

    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    await page.goto(
      `chrome-extension://${extId}/workspace.html?testOrigin=${encodeURIComponent(baseUrl)}`
    );

    // 1. Verify DNR stripped X-Frame-Options & CSP so all 4 iframes rendered and settled slot diet CSS
    for (const id of ['zalo', 'messenger', 'telegram', 'discord']) {
      const frameLoc = page.frameLocator(`section[data-provider="${id}"] iframe`);
      await expect(frameLoc.locator('#provider-heading')).toHaveText(id);
      await expect(frameLoc.locator('#dia-sub-diet')).toHaveCount(id === 'zalo' ? 0 : 1);
    }

    // 1a. Verify clickjacking protection: non-extension page /attacker on 127.0.0.1 CANNOT frame /zalo
    const attackerPage = await context.newPage();
    const victimRespPromise = attackerPage.waitForResponse((r) => r.url().endsWith('/zalo'));
    await attackerPage.goto(`${baseUrl}/attacker`, { waitUntil: 'load' });
    const victimResp = await victimRespPromise;
    expect(victimResp.status()).toBe(200);
    await expect(attackerPage.locator('#attacker-heading')).toHaveText('attacker');
    await expect(attackerPage.frameLocator('#victim').locator('#provider-heading')).toHaveCount(0);
    await attackerPage.close();
    await page.bringToFront();

    // 1b. Verify pixel-clean Bento geometry at 1440x900 without overflow or overlap
    const docMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      paneBodyOverflows: Array.from(document.querySelectorAll<HTMLElement>('.pane-body')).map(
        (el) => el.scrollHeight - el.clientHeight
      )
    }));
    expect(docMetrics.clientWidth).toBe(1440);
    expect(docMetrics.clientHeight).toBe(900);
    expect(docMetrics.scrollWidth).toBe(1440);
    expect(docMetrics.scrollHeight).toBe(900);
    expect(docMetrics.paneBodyOverflows).toEqual([0, 0, 0, 0]);

    const topbarBox = (await page.locator('#topbar').boundingBox())!;
    expect(topbarBox).toEqual({ x: 0, y: 0, width: 1440, height: 32 });

    const mainBox = (await page.locator('.pane[data-slot="main"]').boundingBox())!;
    const resizerBox = (await page.locator('#grid-resizer').boundingBox())!;
    const sub1Box = (await page.locator('.pane[data-slot="sub-1"]').boundingBox())!;
    const sub2Box = (await page.locator('.pane[data-slot="sub-2"]').boundingBox())!;
    const sub3Box = (await page.locator('.pane[data-slot="sub-3"]').boundingBox())!;

    expect(mainBox.x).toBe(0);
    expect(mainBox.y).toBe(32);
    expect(mainBox.height).toBe(868);
    expect(Math.abs(mainBox.width - 1440 * 0.66)).toBeLessThanOrEqual(2);

    expect(Math.abs(resizerBox.x - mainBox.width)).toBeLessThanOrEqual(1);
    expect(resizerBox.y).toBe(32);
    expect(resizerBox.width).toBe(5);
    expect(resizerBox.height).toBe(868);

    for (const subBox of [sub1Box, sub2Box, sub3Box]) {
      expect(Math.abs(subBox.x - (resizerBox.x + resizerBox.width))).toBeLessThanOrEqual(1);
      expect(Math.round(subBox.x + subBox.width)).toBe(1440);
    }
    expect(sub1Box.y).toBe(32);
    expect(sub2Box.y).toBeGreaterThanOrEqual(sub1Box.y + sub1Box.height - 0.5);
    expect(sub3Box.y).toBeGreaterThanOrEqual(sub2Box.y + sub2Box.height - 0.5);
    expect(Math.round(sub3Box.y + sub3Box.height)).toBe(900);

    // 2. Capture iframe boot nonces, press Alt+2 to swap Messenger to Main, verify ZERO reload
    const getNonce = async (provider: string) => {
      const frame = page.frames().find((f) => f.url().endsWith(`/${provider}`));
      expect(frame).toBeTruthy();
      return frame!.evaluate(() => (window as unknown as { __bootNonce: number }).__bootNonce);
    };

    const zaloNonceBefore = await getNonce('zalo');
    const msgrNonceBefore = await getNonce('messenger');
    expect(typeof zaloNonceBefore).toBe('number');
    expect(typeof msgrNonceBefore).toBe('number');

    await page.keyboard.press('Alt+2');
    await expect(page.locator('section[data-provider="messenger"]')).toHaveAttribute(
      'data-slot',
      'main'
    );
    await expect(page.locator('section[data-provider="zalo"]')).toHaveAttribute(
      'data-slot',
      'sub-1'
    );

    expect(await getNonce('zalo')).toBe(zaloNonceBefore);
    expect(await getNonce('messenger')).toBe(msgrNonceBefore);

    const swappedMsgrBox = (await page.locator('section[data-provider="messenger"]').boundingBox())!;
    expect(swappedMsgrBox.x).toBe(0);
    expect(swappedMsgrBox.y).toBe(32);
    expect(swappedMsgrBox.height).toBe(868);

    // 2b. Click/focus inside cross-origin Messenger iframe, then press Alt+3 and verify Telegram swaps to Main without reload
    const tgNonceBefore = await getNonce('telegram');
    await page.frameLocator('section[data-provider="messenger"] iframe').locator('#provider-heading').click();
    await page.keyboard.press('Alt+3');
    await expect(page.locator('section[data-provider="telegram"]')).toHaveAttribute(
      'data-slot',
      'main'
    );
    await expect(page.locator('section[data-provider="messenger"]')).toHaveAttribute(
      'data-slot',
      'sub-2'
    );
    expect(await getNonce('telegram')).toBe(tgNonceBefore);
    expect(await getNonce('messenger')).toBe(msgrNonceBefore);
    expect(await getNonce('zalo')).toBe(zaloNonceBefore);

    // 3. Verify unread title parsing updates Pane Header & Workspace title + MAIN Notification proxy
    const discordFrame = page.frames().find((f) => f.url().endsWith('/discord'))!;
    const perm = await discordFrame.evaluate(() => Notification.permission);
    expect(perm).toBe('granted');

    await discordFrame.evaluate(() => {
      document.title = '(4) Discord';
      new Notification('Channel Ping', { body: 'Deploy xong roi' });
    });

    await expect(
      page.locator('section[data-provider="discord"] .pane-title-btn .badge')
    ).toHaveText('4');
    await expect(page.locator('#total-unread')).toHaveText('4');
    await expect(page).toHaveTitle('(4) Dia Bento Chat Hub');

    // 4. Deterministically wait for cross-frame DIA_SLOT_MODE sync before measuring rAF ticks
    await expect(
      page.frameLocator('section[data-provider="telegram"] iframe').locator('#dia-sub-diet')
    ).toHaveCount(0);
    await expect(
      page.frameLocator('section[data-provider="messenger"] iframe').locator('#dia-sub-diet')
    ).toHaveCount(1);
    await expect(
      page.frameLocator('section[data-provider="zalo"] iframe').locator('#dia-sub-diet')
    ).toHaveCount(1);
    await expect(
      page.frameLocator('section[data-provider="discord"] iframe').locator('#dia-sub-diet')
    ).toHaveCount(1);

    // Verify rAF Governor: Main pane (Telegram) ticks fast (>10 ticks/650ms), Sub pane (Discord) ticks <=3
    const telegramFrame = page.frames().find((f) => f.url().endsWith('/telegram'))!;
    const [mainTicks, subTicks] = await Promise.all([
      telegramFrame.evaluate(() =>
        (
          window as unknown as { __measureRafTicks: (ms: number) => Promise<number> }
        ).__measureRafTicks(650)
      ),
      discordFrame.evaluate(() =>
        (
          window as unknown as { __measureRafTicks: (ms: number) => Promise<number> }
        ).__measureRafTicks(650)
      )
    ]);

    expect(mainTicks).toBeGreaterThan(10);
    expect(subTicks).toBeLessThanOrEqual(3);
    expect(pageErrors).toEqual([]);
  } finally {
    try {
      await context?.close();
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
});
