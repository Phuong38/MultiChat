import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readJson = (relPath: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), relPath), 'utf8'));

describe('Manifest V3 & DNR Rulesets', () => {
  it('configures required MV3 permissions, 4 chat host permissions, and dual-world sub_frame scripts', () => {
    const manifest = readJson('public/manifest.json');
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(
      expect.arrayContaining([
        'declarativeNetRequest',
        'cookies',
        'notifications',
        'storage',
        'tabs'
      ])
    );
    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining([
        '*://*.zalo.me/*',
        '*://*.messenger.com/*',
        '*://*.facebook.com/*',
        '*://*.telegram.org/*',
        '*://*.discord.com/*'
      ])
    );
    expect(manifest.content_scripts).toHaveLength(2);
    const worlds = manifest.content_scripts.map((c: { world?: string }) => c.world ?? 'ISOLATED');
    expect(worlds).toEqual(expect.arrayContaining(['MAIN', 'ISOLATED']));
    for (const cs of manifest.content_scripts) {
      expect(cs.all_frames).toBe(true);
      expect(cs.run_at).toBe('document_start');
    }
  });

  it('strips X-Frame-Options and CSP headers on sub_frame across all chat domains', () => {
    const framing = readJson('public/rules/framing.json');
    expect(framing.length).toBeGreaterThanOrEqual(1);
    const rule = framing[0];
    expect(rule.action.type).toBe('modifyHeaders');
    expect(rule.condition.resourceTypes).toContain('sub_frame');
    expect(rule.condition.requestDomains).toEqual(
      expect.arrayContaining([
        'zalo.me',
        'messenger.com',
        'facebook.com',
        'telegram.org',
        'discord.com'
      ])
    );
    const removed = rule.action.responseHeaders.map((h: { header: string }) =>
      h.header.toLowerCase()
    );
    expect(removed).toEqual(
      expect.arrayContaining(['x-frame-options', 'content-security-policy'])
    );
  });

  it('defines valid block rules in diet.json and lite-media.json with unique IDs', () => {
    const diet = readJson('public/rules/diet.json');
    const lite = readJson('public/rules/lite-media.json');
    expect(diet.length).toBeGreaterThan(0);
    expect(lite.length).toBeGreaterThan(0);
    expect(diet.every((r: { action: { type: string } }) => r.action.type === 'block')).toBe(true);
    expect(lite.every((r: { action: { type: string } }) => r.action.type === 'block')).toBe(true);
    const ids = [...diet, ...lite].map((r: { id: number }) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
