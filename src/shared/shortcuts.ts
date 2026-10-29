export function extractAltShortcutDigit(
  ev: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key'>
): 1 | 2 | 3 | 4 | null {
  if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return null;
  const rawDigit = /^Digit([1-4])$/.exec(ev.code ?? '')?.[1] ?? ev.key;
  if (rawDigit === '1') return 1;
  if (rawDigit === '2') return 2;
  if (rawDigit === '3') return 3;
  if (rawDigit === '4') return 4;
  return null;
}
