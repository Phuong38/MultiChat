import { describe, expect, it } from 'vitest';
import { createHash, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readJson = (relPath: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), relPath), 'utf8'));

function deriveExtensionIdFromManifestKey(keyBase64: string): string {
  const der = Buffer.from(keyBase64, 'base64');
  const pubKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
  expect(pubKey.asymmetricKeyType).toBe('rsa');
  const digest = createHash('sha256').update(der).digest();
  let extId = '';
  for (let i = 0; i < 16; i += 1) {
    const byte = digest[i]!;
    extId += String.fromCharCode(97 + (byte >> 4));
    extId += String.fromCharCode(97 + (byte & 0x0f));
  }
  return extId;
}

describe('Manifest V3 & DNR Rulesets', () => {
  it('configures required MV3 permissions, deterministic manifest key, rule_resources, and dual-world sub_frame scripts', () => {
    const manifest = readJson('public/manifest.json');
    expect(manifest.manifest_version).toBe(3);
    expect(typeof manifest.key).toBe('string');
    const derivedExtId = deriveExtensionIdFromManifestKey(manifest.key);
    expect(derivedExtId).toMatch(/^[a-p]{32}$/);
    expect(derivedExtId).toBe('ndcplbpbnmkeikikgmpgkaaiefmecmjh');
    expect(manifest.icons).toEqual({
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png'
    });
    expect(manifest.action?.default_icon).toEqual({
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png'
    });

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
    expect(manifest.declarative_net_request?.rule_resources).toEqual([
      { id: 'framing', enabled: true, path: 'rules/framing.json' },
      { id: 'diet', enabled: true, path: 'rules/diet.json' },
      { id: 'lite_media', enabled: false, path: 'rules/lite-media.json' }
    ]);
    for (const resource of manifest.declarative_net_request.rule_resources) {
      expect(existsSync(resolve(process.cwd(), 'public', resource.path))).toBe(true);
    }

    expect(manifest.content_scripts).toHaveLength(2);
    const worlds = manifest.content_scripts.map((c: { world?: string }) => c.world ?? 'ISOLATED');
    expect(worlds).toEqual(expect.arrayContaining(['MAIN', 'ISOLATED']));
    for (const cs of manifest.content_scripts) {
      expect(cs.all_frames).toBe(true);
      expect(cs.run_at).toBe('document_start');
    }
  });

  it('scopes X-Frame-Options and CSP stripping on sub_frame strictly to extension and chat initiatorDomains', () => {
    const manifest = readJson('public/manifest.json');
    const derivedExtId = deriveExtensionIdFromManifestKey(manifest.key);
    const framing = readJson('public/rules/framing.json');
    expect(framing.length).toBeGreaterThanOrEqual(1);
    const rule = framing[0];
    expect(rule.action.type).toBe('modifyHeaders');
    expect(rule.condition.resourceTypes).toContain('sub_frame');
    expect(rule.condition.initiatorDomains).toEqual([
      derivedExtId,
      'zalo.me',
      'messenger.com',
      'facebook.com',
      'telegram.org',
      'discord.com'
    ]);
    expect(rule.condition.initiatorDomains).not.toContain('127.0.0.1');
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
