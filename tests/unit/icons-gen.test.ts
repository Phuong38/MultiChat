import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
// @ts-expect-error ESM build helper module
import { generateAllIcons, renderIconPng } from '../../scripts/icons-gen.mjs';

function decodePngRgba(buf: Buffer): { width: number; height: number; pixels: Uint8Array } {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(buf.subarray(0, 8).equals(sig)).toBe(true);

  let offset = 8;
  let width = 0;
  let height = 0;
  const idatParts: Buffer[] = [];

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      expect(data[9]).toBe(6);
    } else if (type === 'IDAT') {
      idatParts.push(data);
    }
    offset += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = 1 + width * 4;
  expect(raw.length).toBe(height * stride);
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = y * stride + 1 + x * 4;
      const dst = (y * width + x) * 4;
      pixels[dst] = raw[src]!;
      pixels[dst + 1] = raw[src + 1]!;
      pixels[dst + 2] = raw[src + 2]!;
      pixels[dst + 3] = raw[src + 3]!;
    }
  }
  return { width, height, pixels };
}

function pixelAt(
  img: { width: number; pixels: Uint8Array },
  x: number,
  y: number
): [number, number, number, number] {
  const idx = (y * img.width + x) * 4;
  return [
    img.pixels[idx]!,
    img.pixels[idx + 1]!,
    img.pixels[idx + 2]!,
    img.pixels[idx + 3]!
  ];
}

describe('Retina 4x4 SSAA Icon Generator', () => {
  it('renders transparent-corner squircles with distinct multi-color Bento quadrants and brand glyphs', () => {
    const bento = decodePngRgba(renderIconPng('bento', 128));
    expect(bento.width).toBe(128);
    expect(bento.height).toBe(128);

    // Outer corner (0, 0) is transparent outside squircle mask
    expect(pixelAt(bento, 0, 0)[3]).toBe(0);
    // Left Bento pane (x=42, y=64) is Zalo blue (B > R + 120)
    const [zr, , zb, za] = pixelAt(bento, 42, 64);
    expect(za).toBe(255);
    expect(zb - zr).toBeGreaterThan(120);

    // Each provider 128px icon has distinct brand color and crisp white foreground glyph pixels
    const kinds = ['zalo', 'messenger', 'telegram', 'discord'] as const;
    const signatures = new Set<string>();
    for (const kind of kinds) {
      const png = renderIconPng(kind, 128);
      const decoded = decodePngRgba(png);
      expect(decoded.width).toBe(128);
      expect(pixelAt(decoded, 0, 0)[3]).toBe(0);

      let whitePixels = 0;
      for (let i = 0; i < decoded.pixels.length; i += 4) {
        if (
          decoded.pixels[i]! > 235 &&
          decoded.pixels[i + 1]! > 235 &&
          decoded.pixels[i + 2]! > 235 &&
          decoded.pixels[i + 3]! > 235
        ) {
          whitePixels += 1;
        }
      }
      expect(whitePixels).toBeGreaterThan(300);

      const bgSample = pixelAt(decoded, 24, 64).join(',');
      signatures.add(bgSample);
    }
    expect(signatures.size).toBe(4);
  });

  it('writes all 8 required app and provider PNG files to target directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dia-icons-test-'));
    try {
      const written = generateAllIcons(dir);
      expect(written).toHaveLength(8);
      for (const name of [
        'icon-16.png',
        'icon-32.png',
        'icon-48.png',
        'icon-128.png',
        'provider-zalo-128.png',
        'provider-messenger-128.png',
        'provider-telegram-128.png',
        'provider-discord-128.png'
      ]) {
        const buf = readFileSync(join(dir, name));
        expect(buf.length).toBeGreaterThan(150);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws on unknown icon kind', () => {
    expect(() => renderIconPng('unknown', 32)).toThrow('Unknown icon kind: unknown');
  });
});
