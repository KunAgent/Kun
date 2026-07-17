/**
 * Lightweight icon set inspired by Lucide / shadcn — square, 2px stroke,
 * butt caps, miter joins. Use <i data-icon="name"></i> and call Icons.render().
 */
(function (global) {
  const ATTRS = 'xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter"';

  const PATHS = {
    // navigation
    'globe':       '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20"/><path d="M12 2a15.3 15.3 0 0 0 0 20"/>',
    'dashboard':   '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
    'mouse':       '<rect x="6" y="2" width="12" height="20" rx="6"/><line x1="12" y1="6" x2="12" y2="11"/>',
    'search':      '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    'square':      '<rect x="3" y="3" width="18" height="18"/>',
    'circle':      '<circle cx="12" cy="12" r="9"/>',
    'list':        '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    'palette':     '<rect x="3"  y="3"  width="8" height="8"/><rect x="13" y="3"  width="8" height="8"/><rect x="3"  y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/>',
    'type':        '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
    'ruler':       '<rect x="3" y="9" width="18" height="6" transform="rotate(-45 12 12)"/><line x1="7.5" y1="12.5" x2="9" y2="14"/><line x1="11" y1="9" x2="12.5" y2="10.5"/><line x1="14.5" y1="5.5" x2="16" y2="7"/>',
    'sparkles':    '<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z"/><path d="M19 14l1 2.2 2.2 1-2.2 1L19 20.4l-1-2.2-2.2-1 2.2-1L19 14z"/>',
    // actions
    'copy':        '<rect x="8" y="8" width="13" height="13"/><path d="M16 8V4H4v13h4"/>',
    'download':    '<path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><line x1="3" y1="21" x2="21" y2="21"/>',
    'refresh':     '<polyline points="21 4 21 10 15 10"/><polyline points="3 20 3 14 9 14"/><path d="M20.5 9A9 9 0 0 0 5 5.5L3 7M3.5 15A9 9 0 0 0 19 18.5L21 17"/>',
    'external':    '<polyline points="14 4 20 4 20 10"/><line x1="20" y1="4" x2="11" y2="13"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/>',
    'settings':    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    'sliders':     '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    'plus':        '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    'minus':       '<line x1="5" y1="12" x2="19" y2="12"/>',
    'x':           '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    'github':      '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
    'message-circle':'<path d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12z"/>',
    // SOLO chat title-bar glyphs (Figma 2510_18334) — round bubble + plus,
    // 4-tooth gear with center circle, and person-in-circle account avatar.
    'message-plus':'<path d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12z"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/>',
    'gear':        '<path d="M9.3 5.7 6.375 5.025 5.025 6.375 5.7 9.3 3 11.1 3 12.9 5.7 14.7 5.025 17.625 6.375 18.975 9.3 18.3 11.1 21 12.9 21 14.7 18.3 17.625 18.975 18.975 17.625 18.3 14.7 21 12.9 21 11.1 18.3 9.3 18.975 6.375 17.625 5.025 14.7 5.7 12.9 3 11.1 3 9.3 5.7Z"/><circle cx="12" cy="12" r="3"/>',
    'user-circle': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="2.5"/><path d="M7 17.5a5 5 0 0 1 10 0"/>',
    'shield':      '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    'check':       '<polyline points="4 12 10 18 20 6"/>',
    'arrow-right': '<line x1="4" y1="12" x2="20" y2="12"/><polyline points="14 6 20 12 14 18"/>',
    'arrow-up-right': '<line x1="6" y1="18" x2="18" y2="6"/><polyline points="9 6 18 6 18 15"/>',
    'chevron-right':'<polyline points="9 6 15 12 9 18"/>',
    'chevron-down':'<polyline points="6 9 12 15 18 9"/>',
    // status — strict outline, 24x24, 2px stroke (no filled bowls)
    'check-circle':'<circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/>',
    'alert-circle':'<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12" y2="16.01"/>',
    'alert-triangle':'<path d="M12 3 22 20 2 20 Z"/><line x1="12" y1="10" x2="12" y2="15"/><line x1="12" y1="18" x2="12" y2="18.01"/>',
    'info-circle': '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8.01"/>',
    'x-circle':    '<circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>',
    // legacy aliases — kept outline, square frame
    'alert':       '<path d="M12 3 22 20 2 20 Z"/><line x1="12" y1="10" x2="12" y2="15"/><line x1="12" y1="18" x2="12" y2="18.01"/>',
    'info':        '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8.01"/>',
    // misc
    'mail':        '<rect x="3" y="5" width="18" height="14"/><polyline points="3 6 12 13 21 6"/>',
    'user':        '<path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/><circle cx="12" cy="8" r="4"/>',
    'users':       '<path d="M2 21v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1"/><circle cx="8.5" cy="8" r="3.5"/><path d="M22 21v-1a5 5 0 0 0-4-4.9"/><path d="M16 3.1A4 4 0 0 1 16 11"/>',
    'box':         '<polyline points="3 7 12 2 21 7 21 17 12 22 3 17 3 7"/><line x1="3" y1="7" x2="12" y2="12"/><line x1="21" y1="7" x2="12" y2="12"/><line x1="12" y1="22" x2="12" y2="12"/>',
    'zap':         '<polygon points="13 2 4 14 12 14 11 22 20 10 12 10 13 2"/>',
    'moon':        '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    'sun':         '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.6" y1="4.6" x2="6.7" y2="6.7"/><line x1="17.3" y1="17.3" x2="19.4" y2="19.4"/><line x1="4.6" y1="19.4" x2="6.7" y2="17.3"/><line x1="17.3" y1="6.7" x2="19.4" y2="4.6"/>',
    'cmd':         '<path d="M9 6h6v12H9z"/><rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><rect x="15" y="15" width="6" height="6"/>',
    'key':         '<circle cx="7.5" cy="14.5" r="3.5"/><line x1="10" y1="12" x2="22" y2="12"/><line x1="22" y1="12" x2="22" y2="16"/><line x1="18" y1="12" x2="18" y2="15"/>',
    'bell':        '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    'arrow-up':    '<line x1="12" y1="20" x2="12" y2="4"/><polyline points="6 10 12 4 18 10"/>',
    'chevron-up':  '<polyline points="6 15 12 9 18 15"/>',
    'arrow-left':  '<line x1="20" y1="12" x2="4" y2="12"/><polyline points="10 6 4 12 10 18"/>',
    'mic':         '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="22"/>',
    'at':          '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    'hash':        '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    'sidebar-left':  '<rect x="3" y="3" width="18" height="18"/><line x1="9" y1="3" x2="9" y2="21"/>',
    'sidebar-right': '<rect x="3" y="3" width="18" height="18"/><line x1="15" y1="3" x2="15" y2="21"/>',
    'panel-bottom':  '<rect x="3" y="3" width="18" height="18"/><line x1="3" y1="15" x2="21" y2="15"/>',
    /* ===== Activity-bar icon set =====================================
     * Lucide / shadcn-ui (MIT) — squared outline, 2px stroke. Every glyph
     * draws into the same standard 24-grid bbox (≈3..21) so they read at
     * identical optical size when sized via `data-size` alone, just like
     * every other glyph in this file. See skill.md §13.4. */
    'git':         '<circle cx="6" cy="5" r="3"/><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><line x1="6" y1="8" x2="6" y2="16"/><path d="M18 8v3a4 4 0 0 1-4 4h-4"/>',
    'bug':         '<rect x="8" y="6" width="8" height="14" rx="4"/><line x1="12" y1="11" x2="12" y2="20"/><line x1="3" y1="9" x2="8" y2="9"/><line x1="3" y1="14" x2="8" y2="14"/><line x1="3" y1="19" x2="8" y2="19"/><line x1="16" y1="9" x2="21" y2="9"/><line x1="16" y1="14" x2="21" y2="14"/><line x1="16" y1="19" x2="21" y2="19"/><line x1="9" y1="6" x2="9" y2="3"/><line x1="15" y1="6" x2="15" y2="3"/>',
    'search-menu': '<circle cx="11" cy="11" r="6"/><line x1="20" y1="20" x2="16" y2="16"/><line x1="3" y1="20" x2="13" y2="20"/>',
    'extensions':  '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M17.5 14v3.5H21a2 2 0 0 1 0 4h-3.5V21a2 2 0 0 1-4 0v-3.5H14a2 2 0 0 1 0-4h3.5z"/>',
    // settings sidebar — squared, hard-edged outline (Lucide-ish), 2px stroke
    'wrench':              '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 12.5l-7.5 7.5a3 3 0 0 1-4.2-4.2L16.7 8 14.7 6.3z"/><path d="M14.7 6.3 12 9l-3-3 2.7-2.7a4 4 0 0 1 3 3z"/>',
    'message-square':      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    'file-text':           '<path d="M14 3H6v18h12V8z"/><polyline points="14 3 14 8 18 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>',
    'scroll-text':         '<path d="M5 4h11a3 3 0 0 1 3 3v10H8v3a1 1 0 0 1-1 1 3 3 0 0 1-3-3V7a3 3 0 0 1 1-3z"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/>',
    'atom':                '<circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>',
    'arrow-right-to-line': '<line x1="20" y1="4" x2="20" y2="20"/><line x1="3" y1="12" x2="17" y2="12"/><polyline points="11 6 17 12 11 18"/>',
    'info-square':         '<rect x="3" y="3" width="18" height="18"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8.01"/>',
    /* Window-control glyphs for SOLO top bar (Figma 2510_20754):
     *   .arrow-minimize → diagonal-in arrows (collapse to corners)
     *   .icon-expand    → diagonal-out arrows (expand to corners) */
    'arrow-minimize':      '<polyline points="20 4 14 10 20 10"/><line x1="14" y1="10" x2="14" y2="4"/><polyline points="4 20 10 14 4 14"/><line x1="10" y1="14" x2="10" y2="20"/>',
    'arrow-expand':        '<polyline points="14 4 20 4 20 10"/><line x1="14" y1="10" x2="20" y2="4"/><polyline points="10 20 4 20 4 14"/><line x1="10" y1="14" x2="4" y2="20"/>',
    'arrow-down':  '<line x1="12" y1="4" x2="12" y2="20"/><polyline points="6 14 12 20 18 14"/>',
    'logo':        '<rect x="3" y="3" width="18" height="18"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
    // additional UI
    'more-h':      '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
    'edit':        '<path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/>',
    'trash':       '<polyline points="4 6 20 6"/><path d="M6 6v14h12V6"/><path d="M9 6V4h6v2"/><line x1="10" y1="10" x2="10" y2="17"/><line x1="14" y1="10" x2="14" y2="17"/>',
    'file':        '<path d="M14 3H6v18h12V7z"/><polyline points="14 3 14 7 18 7"/>',
    // Stacked documents — Lucide "files" (3..21).
    'files':       '<path d="M21 8v13H8V3h8z"/><polyline points="16 3 16 8 21 8"/><path d="M8 7H3v14h13v-3"/>',
    // Pure 2×2 grid — Lucide "layout-grid" (3..21).
    'grid-2x2':    '<rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/>',
    'folder':      '<path d="M3 6h6l2 3h10v10H3z"/>',
    'layers':      '<polygon points="12 3 22 8 12 13 2 8 12 3"/><polyline points="2 13 12 18 22 13"/>',
    'layout':      '<rect x="3" y="3" width="18" height="18"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
    'terminal':    '<polyline points="4 7 9 12 4 17"/><line x1="12" y1="17" x2="20" y2="17"/>',
    'image':       '<rect x="3" y="3" width="18" height="18"/><circle cx="9" cy="9" r="1.5" fill="currentColor"/><polyline points="3 18 9 12 13 16 17 12 21 16"/>',
    'play':        '<polygon points="6 4 20 12 6 20 6 4"/>',
    'pause':       '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    'help':        '<rect x="3" y="3" width="18" height="18"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4"/><line x1="12" y1="17" x2="12" y2="17.01"/>',
    'lock':        '<rect x="4" y="11" width="16" height="10"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    // Lucide "eye" (2..22 horizontal, naturally short — eye shape).
    'eye':         '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    'star':        '<polygon points="12 3 15 9 22 10 17 14 18 21 12 18 6 21 7 14 2 10 9 9 12 3"/>',
    'heart':       '<path d="M12 21s-7-5-7-11a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 6-7 11-7 11z"/>',
    'home':        '<polygon points="3 11 12 3 21 11 21 21 14 21 14 14 10 14 10 21 3 21 3 11"/>',
    'calendar':    '<rect x="3" y="5" width="18" height="16"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
    'clock':       '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
    'filter':      '<polygon points="3 4 21 4 14 12 14 20 10 18 10 12 3 4"/>',
    'send':        '<polygon points="3 12 21 4 17 21 12 13 3 12"/>',
    'link':        '<path d="M10 14a4 4 0 0 1 0-6l3-3a4 4 0 0 1 6 6l-1.5 1.5"/><path d="M14 10a4 4 0 0 1 0 6l-3 3a4 4 0 0 1-6-6l1.5-1.5"/>',
    'upload':      '<path d="M12 21V9"/><polyline points="7 14 12 9 17 14"/><line x1="3" y1="3" x2="21" y2="3"/>',
    'log-out':     '<path d="M14 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/><polyline points="16 16 21 12 16 8"/><line x1="9" y1="12" x2="21" y2="12"/>',
    'menu':        '<line x1="4" y1="6"  x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
    // data / charts
    'dollar':         '<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    'bar':            '<line x1="3" y1="21" x2="21" y2="21"/><rect x="5"  y="11" width="3" height="8"/><rect x="10.5" y="6"  width="3" height="13"/><rect x="16" y="14" width="3" height="5"/>',
    'trending-up':    '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
    'trending-down':  '<polyline points="3 7 9 13 13 9 21 17"/><polyline points="15 17 21 17 21 11"/>',
    'columns':        '<rect x="3" y="3" width="18" height="18"/><line x1="9"  y1="3" x2="9"  y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
    // settings — framework rules
    'plug':           '<path d="M9 2v6"/><path d="M15 2v6"/><path d="M7 8h10v4a5 5 0 0 1-10 0V8z"/><path d="M12 17v5"/>',
    'cpu':            '<rect x="6" y="6" width="12" height="12"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="6"/><line x1="15" y1="2" x2="15" y2="6"/><line x1="9" y1="18" x2="9" y2="22"/><line x1="15" y1="18" x2="15" y2="22"/><line x1="2" y1="9" x2="6" y2="9"/><line x1="2" y1="15" x2="6" y2="15"/><line x1="18" y1="9" x2="22" y2="9"/><line x1="18" y1="15" x2="22" y2="15"/>',
    'code':           '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    // brand — filled Apple glyph for download CTA
    'apple':          '<path fill="currentColor" stroke="none" d="M17.05 12.04c-.03-3.04 2.49-4.5 2.6-4.57-1.42-2.07-3.62-2.36-4.4-2.39-1.87-.19-3.65 1.1-4.6 1.1-.96 0-2.42-1.08-3.98-1.05-2.05.03-3.94 1.19-4.99 3.02-2.13 3.69-.54 9.13 1.53 12.12 1.01 1.46 2.21 3.1 3.78 3.04 1.52-.06 2.09-.98 3.93-.98 1.83 0 2.36.98 3.97.95 1.64-.03 2.68-1.49 3.68-2.96 1.16-1.7 1.64-3.35 1.66-3.43-.04-.02-3.18-1.22-3.21-4.85zM14.06 4.34c.83-1.01 1.39-2.41 1.24-3.81-1.2.05-2.65.8-3.51 1.8-.77.89-1.45 2.31-1.27 3.68 1.34.1 2.71-.68 3.54-1.67z"/>',
  };

  function svg(name, size = 16, viewBox = '0 0 24 24') {
    const path = PATHS[name];
    if (!path) return '';
    const attrs = ATTRS
      .replace('width="16"', `width="${size}"`)
      .replace('height="16"', `height="${size}"`)
      .replace('viewBox="0 0 24 24"', `viewBox="${viewBox}"`);
    return `<svg ${attrs}>${path}</svg>`;
  }

  function render(root = document) {
    root.querySelectorAll('[data-icon]').forEach(el => {
      const name = el.getAttribute('data-icon');
      const size = +el.getAttribute('data-size') || 16;
      const vb   = el.getAttribute('data-viewbox') || '0 0 24 24';
      el.innerHTML = svg(name, size, vb);
      el.classList.add('icon');
    });
  }

  global.Icons = { svg, render, PATHS };
  if (document.readyState !== 'loading') render();
  else document.addEventListener('DOMContentLoaded', () => render());
})(typeof window !== 'undefined' ? window : globalThis);
