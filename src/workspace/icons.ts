import type { ProviderId } from '../shared/types';

export type ActionIconName =
  | 'maximize'
  | 'restore'
  | 'pause'
  | 'play'
  | 'reload'
  | 'reauth'
  | 'pin';

const SVG_NS = 'http://www.w3.org/2000/svg';
let messengerGradSeq = 0;

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {}
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

export function createBrandIconSvg(providerId: ProviderId, size = 15): SVGSVGElement {
  const svg = svgEl('svg', {
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
    class: `brand-icon brand-icon-${providerId}`
  });

  if (providerId === 'zalo') {
    svg.append(
      svgEl('rect', { width: '24', height: '24', rx: '6', fill: '#0068FF' }),
      svgEl('path', {
        d: 'M7.2 7.5h9.6L7.2 16.5h9.6',
        stroke: '#FFFFFF',
        'stroke-width': '2.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      })
    );
  } else if (providerId === 'messenger') {
    messengerGradSeq += 1;
    const gradId = `dia-msgr-grad-${messengerGradSeq}`;
    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: gradId, x1: '0', y1: '1', x2: '1', y2: '0' });
    grad.append(
      svgEl('stop', { offset: '0%', 'stop-color': '#0099FF' }),
      svgEl('stop', { offset: '55%', 'stop-color': '#A033FF' }),
      svgEl('stop', { offset: '100%', 'stop-color': '#FF5280' })
    );
    defs.appendChild(grad);
    svg.append(
      defs,
      svgEl('rect', { width: '24', height: '24', rx: '6', fill: `url(#${gradId})` }),
      svgEl('path', {
        d: 'M5.5 14.6l4.4-4.7 2.5 2.4 4.4-4.7-4.4 6.8-2.5-2.4-4.4 2.6z',
        fill: '#FFFFFF'
      })
    );
  } else if (providerId === 'telegram') {
    svg.append(
      svgEl('rect', { width: '24', height: '24', rx: '6', fill: '#2AABEE' }),
      svgEl('path', {
        d: 'M18.4 6.4L5.3 11.5c-.8.3-.8.8-.1 1l3.3 1 7.7-4.8c.4-.2.7-.1.4.2l-6.2 5.6-.2 3.3c.3 0 .5-.1.7-.3l1.7-1.6 3.4 2.5c.6.3 1.1.2 1.2-.6l2.2-10.5c.2-.8-.3-1.2-1-.9z',
        fill: '#FFFFFF'
      })
    );
  } else {
    svg.append(
      svgEl('rect', { width: '24', height: '24', rx: '6', fill: '#5865F2' }),
      svgEl('path', {
        d: 'M17.5 8.2A11 11 0 0014.7 7.3l-.4.8a10 10 0 00-4.6 0l-.4-.8a11 11 0 00-2.8.9C4.7 10.9 4.2 13.5 4.5 16a11 11 0 003.4 1.7l.7-1.1c-.4-.2-.8-.4-1.1-.7l.3-.2a8 8 0 008.4 0l.3.2c-.3.3-.7.5-1.1.7l.7 1.1a11 11 0 003.4-1.7c.3-2.9-.5-5.5-2-7.8zM9.5 14.1c-.7 0-1.2-.6-1.2-1.3 0-.7.5-1.3 1.2-1.3s1.2.6 1.2 1.3c0 .7-.5 1.3-1.2 1.3zm5 0c-.7 0-1.2-.6-1.2-1.3 0-.7.5-1.3 1.2-1.3s1.2.6 1.2 1.3c0 .7-.5 1.3-1.2 1.3z',
        fill: '#FFFFFF'
      })
    );
  }

  return svg;
}

const ACTION_PATHS: Record<ActionIconName, string> = {
  maximize: 'M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6',
  restore: 'M4 14h6v6M20 10h-6V4M14 10l6-6M10 14l-6 6',
  pause: 'M9 6v12M15 6v12',
  play: 'M8 6l10 6-10 6V6z',
  reload: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  reauth: 'M15 7a4 4 0 11-7.5 2L3 13.5V17h3.5v-2h2v-2l1.6-1.6A4 4 0 0115 7z',
  pin: 'M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 15v5'
};

export function createActionIconSvg(kind: ActionIconName, size = 13): SVGSVGElement {
  const svg = svgEl('svg', {
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
    class: `action-icon action-icon-${kind}`
  });
  svg.appendChild(
    svgEl('path', {
      d: ACTION_PATHS[kind],
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    })
  );
  return svg;
}
