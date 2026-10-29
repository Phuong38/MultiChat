export function updateWorkspaceFavicon(doc: Document, totalUnread: number): void {
  const count = Number.isFinite(totalUnread) && totalUnread > 0 ? Math.floor(totalUnread) : 0;
  let link = doc.querySelector<HTMLLinkElement>('link#workspace-favicon');
  if (!link) {
    link = doc.createElement('link');
    link.id = 'workspace-favicon';
    link.rel = 'icon';
    link.type = 'image/png';
    (doc.head ?? doc.documentElement)?.appendChild(link);
  }

  if (count <= 0) {
    link.href = 'icons/icon-32.png';
    link.dataset.unreadCount = '0';
    return;
  }

  if (link.dataset.unreadCount === String(count) && link.getAttribute('href')) {
    return;
  }

  try {
    const canvas = doc.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      link.href = 'icons/icon-32.png';
      delete link.dataset.unreadCount;
      return;
    }

    // Dark squircle base
    ctx.fillStyle = '#0F131D';
    ctx.beginPath();
    ctx.roundRect(4, 4, 56, 56, 14);
    ctx.fill();

    // Bento 4-color quadrants
    ctx.fillStyle = '#0068FF';
    ctx.beginPath();
    ctx.roundRect(11, 11, 22, 42, 5);
    ctx.fill();

    ctx.fillStyle = '#A033FF';
    ctx.beginPath();
    ctx.roundRect(37, 11, 16, 12, 3.5);
    ctx.fill();

    ctx.fillStyle = '#2AABEE';
    ctx.beginPath();
    ctx.roundRect(37, 26, 16, 12, 3.5);
    ctx.fill();

    ctx.fillStyle = '#5865F2';
    ctx.beginPath();
    ctx.roundRect(37, 41, 16, 12, 3.5);
    ctx.fill();

    // Red unread counter badge
    const label = count > 9 ? '9+' : String(count);
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(48, 16, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0A0D14';
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 17px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 48, 17);

    link.href = canvas.toDataURL('image/png');
    link.dataset.unreadCount = String(count);
  } catch {
    link.href = 'icons/icon-32.png';
    delete link.dataset.unreadCount;
  }
}
