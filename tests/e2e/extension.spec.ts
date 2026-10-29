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
    // Simulate Meta's real server-side Sec-Fetch-Dest: iframe anti-framing rejection on /messenger
    if (provider === 'messenger' && req.headers['sec-fetch-dest'] === 'iframe') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<div class="uiInterstitial"><h2>Không thể xử lý yêu cầu của bạn</h2><a href="/">Trở về trang chủ</a></div>'
      );
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
          <input id="chat-input" type="text" aria-label="Chat input" />
          <div id="chat-scroll" style="height: 160px; overflow-y: auto;">
            <div style="height: 900px;">Scrollable messages</div>
          </div>
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

test('MV3 extension verifies Auto-Hide UI geometry, Maximize 100% scroll preservation, splitter reset, action badge, Telegram muted-chat silence, and rAF throttling', async () => {
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
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
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

    // 1b. Verify pixel-clean Bento geometry at 1440x900 with default unpinned Auto-Hide Top Drawer
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
    expect(topbarBox.x).toBe(0);
    expect(topbarBox.width).toBe(1440);
    expect(topbarBox.height).toBe(34);
    expect(topbarBox.y + topbarBox.height).toBeLessThanOrEqual(0);

    // Top-edge sensor has zero text and <= 3px height so it never overlaps any .pane-header controls
    await expect(page.locator('#topbar-pill')).toHaveCount(0);
    expect((await page.locator('#topbar-sensor').textContent())?.trim()).toBe('');
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/\bdia\b/i);
    const sensorBox = (await page.locator('#topbar-sensor').boundingBox())!;
    expect(sensorBox.y).toBe(0);
    expect(sensorBox.height).toBeLessThanOrEqual(3);
    const handleBox = (await page.locator('#topbar-handle').boundingBox())!;
    expect(handleBox.y).toBe(0);
    expect(handleBox.height).toBeLessThanOrEqual(2);
    expect(Math.abs(handleBox.x + handleBox.width / 2 - 720)).toBeLessThanOrEqual(2);

    const mainBox = (await page.locator('.pane[data-slot="main"]').boundingBox())!;
    const resizerBox = (await page.locator('#grid-resizer').boundingBox())!;
    const sub1Box = (await page.locator('.pane[data-slot="sub-1"]').boundingBox())!;
    const sub2Box = (await page.locator('.pane[data-slot="sub-2"]').boundingBox())!;
    const sub3Box = (await page.locator('.pane[data-slot="sub-3"]').boundingBox())!;

    expect(mainBox.x).toBe(0);
    expect(mainBox.y).toBe(0);
    expect(mainBox.height).toBe(900);
    expect(Math.abs(mainBox.width - 1440 * 0.66)).toBeLessThanOrEqual(2);

    expect(Math.abs(resizerBox.x - mainBox.width)).toBeLessThanOrEqual(1);
    expect(resizerBox.y).toBe(0);
    expect(resizerBox.width).toBe(6);
    expect(resizerBox.height).toBe(900);

    for (const subBox of [sub1Box, sub2Box, sub3Box]) {
      expect(Math.abs(subBox.x - (resizerBox.x + resizerBox.width))).toBeLessThanOrEqual(1);
      expect(Math.round(subBox.x + subBox.width)).toBe(1440);
    }
    expect(sub1Box.y).toBe(0);
    expect(sub2Box.y).toBeGreaterThanOrEqual(sub1Box.y + sub1Box.height - 0.5);
    expect(sub3Box.y).toBeGreaterThanOrEqual(sub2Box.y + sub2Box.height - 0.5);
    expect(Math.round(sub3Box.y + sub3Box.height)).toBe(900);

    // 1c. Hover #topbar-sensor to reveal #topbar, pin to 34px + 866px grid, then unpin back to 900px
    await page.locator('#topbar-sensor').hover();
    await expect
      .poll(async () => (await page.locator('#topbar').boundingBox())?.y)
      .toBe(0);
    const revealedTopbarBox = (await page.locator('#topbar').boundingBox())!;
    expect(revealedTopbarBox).toEqual({ x: 0, y: 0, width: 1440, height: 34 });

    const topbarOverflow = await page.evaluate(() => {
      const bar = document.getElementById('topbar')!;
      return bar.scrollWidth - bar.clientWidth;
    });
    expect(topbarOverflow).toBeLessThanOrEqual(1);

    const pinBtnBox = (await page.locator('#btn-pin-topbar').boundingBox())!;
    expect(pinBtnBox.width).toBe(24);
    expect(pinBtnBox.height).toBe(24);

    await page.locator('#btn-pin-topbar').click();
    await expect(page.locator('body')).toHaveClass(/topbar-pinned/);
    await page.mouse.move(400, 400);
    const pinnedTopbarBox = (await page.locator('#topbar').boundingBox())!;
    expect(pinnedTopbarBox).toEqual({ x: 0, y: 0, width: 1440, height: 34 });
    const pinnedMainBox = (await page.locator('.pane[data-slot="main"]').boundingBox())!;
    expect(pinnedMainBox.y).toBe(34);
    expect(pinnedMainBox.height).toBeCloseTo(866, 1);

    await page.locator('#btn-pin-topbar').click();
    await expect(page.locator('body')).not.toHaveClass(/topbar-pinned/);
    const unpinnedMainBox = (await page.locator('.pane[data-slot="main"]').boundingBox())!;
    expect(unpinnedMainBox.y).toBe(0);
    expect(unpinnedMainBox.height).toBe(900);

    await page.mouse.move(400, 400);
    await expect
      .poll(async () => {
        const b = await page.locator('#topbar').boundingBox();
        return b ? b.y + b.height : 999;
      })
      .toBeLessThanOrEqual(0);

    // 1d. Verify crisp 28px .pane-header visuals, SVG sizes & alignment, zero overflow, and dark matte iframe
    for (const id of ['zalo', 'messenger', 'telegram', 'discord']) {
      const paneLoc = page.locator(`section[data-provider="${id}"]`);
      const headerLoc = paneLoc.locator('.pane-header');
      const headerBox = (await headerLoc.boundingBox())!;
      expect(headerBox.height).toBe(28);

      const headerMetrics = await paneLoc.evaluate((section) => {
        const header = section.querySelector<HTMLElement>('.pane-header')!;
        const iframe = section.querySelector<HTMLElement>('.pane-iframe')!;
        return {
          scrollWidth: header.scrollWidth,
          clientWidth: header.clientWidth,
          iframeBg: window.getComputedStyle(iframe).backgroundColor
        };
      });
      expect(headerMetrics.scrollWidth).toBeLessThanOrEqual(headerMetrics.clientWidth + 1);
      expect(headerMetrics.iframeBg).toBe('rgb(14, 18, 27)');

      const brandSvgLoc = headerLoc.locator('svg.brand-icon');
      await expect(brandSvgLoc).toBeVisible();
      const brandBox = (await brandSvgLoc.boundingBox())!;
      expect(brandBox.width).toBe(15);
      expect(brandBox.height).toBe(15);
      expect(
        Math.abs(brandBox.y + brandBox.height / 2 - (headerBox.y + headerBox.height / 2))
      ).toBeLessThanOrEqual(1.5);

      const iconBtns = headerLoc.locator('button.icon-btn');
      await expect(iconBtns).toHaveCount(4);
      for (let i = 0; i < 4; i += 1) {
        const btn = iconBtns.nth(i);
        await expect(btn).toBeVisible();
        const btnBox = (await btn.boundingBox())!;
        expect(btnBox.width).toBe(22);
        expect(btnBox.height).toBe(22);
        expect(
          Math.abs(btnBox.y + btnBox.height / 2 - (headerBox.y + headerBox.height / 2))
        ).toBeLessThanOrEqual(1.5);

        const actionSvg = btn.locator('svg.action-icon');
        await expect(actionSvg).toBeVisible();
        const svgBox = (await actionSvg.boundingBox())!;
        expect(svgBox.width).toBe(13);
        expect(svgBox.height).toBe(13);
        expect(Math.abs(svgBox.x + svgBox.width / 2 - (btnBox.x + btnBox.width / 2))).toBeLessThanOrEqual(1);
        expect(Math.abs(svgBox.y + svgBox.height / 2 - (btnBox.y + btnBox.height / 2))).toBeLessThanOrEqual(1);
      }
    }

    // 1e. Verify Splitter Drag + #resize-indicator + Double-Click 66% Reset
    const dragStartX = resizerBox.x + resizerBox.width / 2;
    const dragY = 450;
    await page.mouse.move(dragStartX, dragY);
    await page.mouse.down();
    await page.mouse.move(760, dragY, { steps: 8 });
    await expect(page.locator('#resize-indicator')).toBeVisible();
    await expect(page.locator('#resize-indicator')).toHaveText('Chính 53% • Phụ 47%');
    const draggedMainBox = (await page.locator('.pane[data-slot="main"]').boundingBox())!;
    expect(Math.abs(draggedMainBox.width - 760)).toBeLessThanOrEqual(6);
    await page.mouse.up();
    await expect(page.locator('#resize-indicator')).toBeHidden();

    // At 53% main width (50vw = 720px lands directly over main .pane-controls), verify zero hit-test or visual overlap
    const mainCtrlBtns = page.locator('.pane[data-slot="main"] .pane-controls button.icon-btn');
    for (let i = 0; i < 4; i += 1) {
      const bBox = (await mainCtrlBtns.nth(i).boundingBox())!;
      expect(bBox.y).toBeGreaterThanOrEqual(sensorBox.y + sensorBox.height);
      const hitInsideControls = await page.evaluate(
        ({ cx, cy }) =>
          Boolean(document.elementFromPoint(cx, cy)?.closest('.pane[data-slot="main"] .pane-controls')),
        { cx: bBox.x + bBox.width / 2, cy: bBox.y + bBox.height / 2 }
      );
      expect(hitInsideControls).toBe(true);
    }

    await page.locator('#grid-resizer').dblclick();
    const resetMainBox = (await page.locator('.pane[data-slot="main"]').boundingBox())!;
    expect(Math.abs(resetMainBox.width - 1440 * 0.66)).toBeLessThanOrEqual(2);

    // 2. Capture all 4 iframe boot nonces, press Alt+2 to swap Messenger to Main, verify ZERO reload
    const getFrame = (provider: string) => {
      const frame = page.frames().find((f) => f.url().endsWith(`/${provider}`));
      expect(frame).toBeTruthy();
      return frame!;
    };
    const getNonce = async (provider: string) =>
      getFrame(provider).evaluate(
        () => (window as unknown as { __bootNonce: number }).__bootNonce
      );

    const zaloNonceBefore = await getNonce('zalo');
    const msgrNonceBefore = await getNonce('messenger');
    const tgNonceBefore = await getNonce('telegram');
    const discordNonceBefore = await getNonce('discord');
    for (const nonce of [zaloNonceBefore, msgrNonceBefore, tgNonceBefore, discordNonceBefore]) {
      expect(typeof nonce).toBe('number');
    }

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
    expect(swappedMsgrBox.y).toBe(0);
    expect(swappedMsgrBox.height).toBe(900);

    // 2b. Focus chat input inside cross-origin Messenger iframe, then press Alt+3 and verify Telegram swaps to Main without reload
    const msgrInput = page
      .frameLocator('section[data-provider="messenger"] iframe')
      .locator('#chat-input');
    await msgrInput.click();
    await expect(msgrInput).toBeFocused();
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
    expect(await getNonce('discord')).toBe(discordNonceBefore);

    // 2c. Verify Zero-Scroll-Loss Maximize 100% (button click + Escape AND cross-frame Alt+M)
    const setScrollTop = async (provider: string, top: number) =>
      getFrame(provider).evaluate((targetTop) => {
        const el = document.getElementById('chat-scroll')!;
        el.scrollTop = targetTop;
        return el.scrollTop;
      }, top);
    const getScrollTop = async (provider: string) =>
      getFrame(provider).evaluate(() => document.getElementById('chat-scroll')!.scrollTop);

    expect(await setScrollTop('zalo', 240)).toBe(240);
    expect(await setScrollTop('discord', 180)).toBe(180);
    expect(await setScrollTop('messenger', 140)).toBe(140);
    expect(await setScrollTop('telegram', 200)).toBe(200);

    await page
      .locator('section[data-provider="telegram"] button[data-action="maximize"]')
      .click();
    await expect(page.locator('section[data-provider="telegram"]')).toHaveAttribute(
      'data-maximized',
      'true'
    );
    const maxTgBox = (await page.locator('section[data-provider="telegram"]').boundingBox())!;
    expect(maxTgBox).toEqual({ x: 0, y: 0, width: 1440, height: 900 });

    // Immediate Escape works because maximize button click preserves keyboard focus in workspace.html
    await page.keyboard.press('Escape');
    await expect(page.locator('section[data-provider="telegram"]')).not.toHaveAttribute(
      'data-maximized',
      'true'
    );
    const restoredTgBox = (await page.locator('section[data-provider="telegram"]').boundingBox())!;
    expect(restoredTgBox.x).toBe(0);
    expect(restoredTgBox.y).toBe(0);
    expect(restoredTgBox.height).toBe(900);
    expect(Math.abs(restoredTgBox.width - 1440 * 0.66)).toBeLessThanOrEqual(2);

    expect(await getNonce('zalo')).toBe(zaloNonceBefore);
    expect(await getNonce('messenger')).toBe(msgrNonceBefore);
    expect(await getNonce('telegram')).toBe(tgNonceBefore);
    expect(await getNonce('discord')).toBe(discordNonceBefore);
    expect(await getScrollTop('zalo')).toBe(240);
    expect(await getScrollTop('discord')).toBe(180);
    expect(await getScrollTop('messenger')).toBe(140);
    expect(await getScrollTop('telegram')).toBe(200);

    // Verify sub-pane (Discord in sub-3) also maximizes to full 1440x900 via grid-area: auto and restores cleanly on Escape
    await page
      .locator('section[data-provider="discord"] button[data-action="maximize"]')
      .click();
    await expect(page.locator('section[data-provider="discord"]')).toHaveAttribute(
      'data-maximized',
      'true'
    );
    const maxDiscordBox = (await page.locator('section[data-provider="discord"]').boundingBox())!;
    expect(maxDiscordBox).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
    await page.keyboard.press('Escape');
    await expect(page.locator('section[data-provider="discord"]')).not.toHaveAttribute(
      'data-maximized',
      'true'
    );

    // Also verify cross-origin Alt+M (Alt+m) toggle from inside Telegram iframe composer without typing into input
    const tgInput = page
      .frameLocator('section[data-provider="telegram"] iframe')
      .locator('#chat-input');
    await tgInput.click();
    await expect(tgInput).toBeFocused();
    await page.keyboard.press('Alt+m');
    await expect(page.locator('section[data-provider="telegram"]')).toHaveAttribute(
      'data-maximized',
      'true'
    );
    await expect(tgInput).toHaveValue('');
    const crossMaxTgBox = (await page.locator('section[data-provider="telegram"]').boundingBox())!;
    expect(crossMaxTgBox).toEqual({ x: 0, y: 0, width: 1440, height: 900 });

    await expect(tgInput).toBeFocused();
    await page.keyboard.press('Alt+m');
    await expect(page.locator('section[data-provider="telegram"]')).not.toHaveAttribute(
      'data-maximized',
      'true'
    );
    await expect(tgInput).toHaveValue('');
    expect(await getNonce('zalo')).toBe(zaloNonceBefore);
    expect(await getNonce('messenger')).toBe(msgrNonceBefore);
    expect(await getNonce('telegram')).toBe(tgNonceBefore);
    expect(await getNonce('discord')).toBe(discordNonceBefore);
    expect(await getScrollTop('zalo')).toBe(240);
    expect(await getScrollTop('discord')).toBe(180);

    // 3. Verify unread title parsing updates Pane Header, Workspace title, dynamic favicon, Action Badge + MAIN Notification proxy
    const discordFrame = getFrame('discord');
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
    await expect(page).toHaveTitle('(4) MultiChat Hub');
    await expect(page.locator('link#workspace-favicon')).toHaveAttribute(
      'href',
      /^data:image\/png;base64,/
    );
    await expect
      .poll(async () => sw.evaluate(() => chrome.action.getBadgeText({})))
      .toBe('4');

    // 4. Deterministically wait for cross-frame DIA_SLOT_MODE sync before measuring rAF ticks
    await page.mouse.move(250, 450);
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
    const telegramFrame = getFrame('telegram');
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

    // 5. Verify Telegram Muted-Chat Exclusion & Dia Toolbar Action Badge sync
    await discordFrame.evaluate(() => {
      document.title = 'Discord';
    });
    await expect(
      page.locator('section[data-provider="discord"] .pane-title-btn .badge')
    ).toBeHidden();
    await expect(page.locator('#total-unread')).toBeHidden();
    await expect(page.locator('link#workspace-favicon')).toHaveAttribute(
      'href',
      'icons/icon-32.png'
    );
    await expect
      .poll(async () => sw.evaluate(() => chrome.action.getBadgeText({})))
      .toBe('');

    await telegramFrame.evaluate(() => {
      let root = document.getElementById('column-left');
      if (!root) {
        root = document.createElement('div');
        root.id = 'column-left';
        root.className = 'tabs-tab chatlist-container';
        document.body.appendChild(root);
      }
      root.innerHTML =
        '<div class="sidebar-slider"><div class="tabs-tab sidebar-slider-item item-main active"><div id="folders-tabs" class="menu-horizontal-div"><div class="menu-horizontal-div-item"><span class="badge badge-primary">19</span></div></div><div id="chatlist-container" class="transition-item active"><div id="folders-container"><div class="tabs-tab chatlist-parts active"><ul class="chatlist" id="tg-list"><a class="chatlist-chat is-muted" data-peer-id="-1001"><span class="peer-title">Muted Group</span><div class="dialog-subtitle-badge-unread badge-gray is-visible">19</div></a></ul></div></div></div></div></div>';
      document.title = '(19) Telegram';
    });

    await page.waitForTimeout(400);
    await expect(
      page.locator('section[data-provider="telegram"] .pane-title-btn .badge')
    ).toBeHidden();
    await expect(
      page.locator('section[data-provider="telegram"] .pane-title-btn .badge')
    ).toHaveText('0');
    await expect(page.locator('#total-unread')).toBeHidden();
    expect(await sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('');

    await telegramFrame.evaluate(() => {
      const list = document.getElementById('tg-list')!;
      list.insertAdjacentHTML(
        'beforeend',
        '<a class="chatlist-chat" data-peer-id="3001"><span class="peer-title">Nguyễn Minh Tuấn</span><span class="dialog-subtitle-span">Chốt bản release nhé</span><div class="dialog-subtitle-badge-unread badge-primary is-visible" style="background-color: rgb(51, 144, 236);">2</div></a>'
      );
    });

    await expect(
      page.locator('section[data-provider="telegram"] .pane-title-btn .badge')
    ).toBeVisible();
    await expect(
      page.locator('section[data-provider="telegram"] .pane-title-btn .badge')
    ).toHaveText('2');
    await expect(page.locator('#total-unread')).toBeVisible();
    await expect(page.locator('#total-unread')).toHaveText('2');
    await expect(page).toHaveTitle('(2) MultiChat Hub');
    await expect
      .poll(async () => sw.evaluate(() => chrome.action.getBadgeText({})))
      .toBe('2');

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    try {
      await context?.close();
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
});
