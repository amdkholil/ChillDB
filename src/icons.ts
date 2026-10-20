const svg = (path: string, extra = ""): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${path}</svg>`;

export const icons = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>', 'class="chev-icon"'),
  database: svg(
    '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  ),
  terminal: svg('<path d="M5 7l4 5-4 5"/><path d="M12 17h7"/>'),
  table: svg(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
  ),
  columns: svg(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  ),
  eraser: svg(
    '<path d="M4 16L13 5l7 5-6 8H8z"/><path d="M3 20h18"/>',
  ),
  play: svg('<path d="M7 4.5v15l12-7.5z"/>'),
  refresh: svg(
    '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  ),
  plug: svg(
    '<path d="M9 3v6M15 3v6"/><path d="M6 9h12v2a6 6 0 0 1-6 6 6 6 0 0 1-6-6z"/><path d="M12 17v4"/>',
  ),
  unplug: svg(
    '<path d="M9 3v6M15 3v6"/><path d="M6 9h12v1a6 6 0 0 1-3 5.2"/><path d="M4 4l16 16"/>',
  ),
  edit: svg(
    '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  ),
  trash: svg(
    '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>',
  ),
  history: svg(
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>',
  ),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  key: svg(
    '<circle cx="8" cy="14" r="3"/><path d="M10.5 12.5L19 4M15 8l2 2M17 6l2 2"/>',
  ),
  view: svg(
    '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/>',
  ),
  folder: svg('<path d="M3 6h6l2 2h10v10H3z"/>'),
  bolt: svg('<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>'),
};
