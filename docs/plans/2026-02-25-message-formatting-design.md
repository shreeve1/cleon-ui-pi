# Message Formatting Design

**Date:** 2026-02-25
**Scope:** CSS-only prose styling for assistant messages
**Files changed:** `public/style.css` only

## Problem

AI assistant messages render unstyled prose. marked.js generates correct HTML (tables with `<th>`/`<td>`, headings `<h1>`-`<h4>`, paragraphs, lists, blockquotes) but there are no CSS rules for these elements inside `.message.assistant`. The browser applies bare defaults, causing:

- Tables with no borders — cells run together visually
- Headings that look like bold text with no visual hierarchy
- No paragraph spacing — blocks of text run into each other
- Lists with no consistent indent or spacing
- No blockquote styling

## Approach

CSS-only patch. All rules scoped to `.message.assistant` to avoid affecting user bubble styles. No JS changes, no risk to the rendering pipeline.

## Design

### Tables

```css
.message.assistant table {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 14px;
}
.message.assistant th,
.message.assistant td {
  padding: 8px 12px;
  border: 1px solid var(--border);
  text-align: left;
}
.message.assistant th {
  background: var(--bg);
  color: var(--neon-cyan);
  font-weight: 600;
}
.message.assistant tr:nth-child(even) {
  background: var(--bg);
}
.message.assistant tr:nth-child(odd) {
  background: var(--bg-light);
}
```

- `display: block` + `overflow-x: auto` handles narrow viewport overflow without JS
- Header row: `var(--neon-cyan)` text on `var(--bg)` background
- Alternating row shading using existing bg variables

### Headings

```css
.message.assistant h1,
.message.assistant h2 {
  color: var(--neon-cyan);
  border-bottom: 1px solid var(--border);
  padding-bottom: 4px;
  margin: 20px 0 10px;
}
.message.assistant h1 { font-size: 1.4em; }
.message.assistant h2 { font-size: 1.25em; }
.message.assistant h3 { font-size: 1.1em; color: var(--text); margin: 16px 0 8px; }
.message.assistant h4 { font-size: 1.05em; color: var(--text); margin: 14px 0 6px; letter-spacing: 0.3px; }
```

- h1/h2 get neon-cyan color + bottom border separator
- h3/h4 use standard text color with reduced margins

### Paragraphs

```css
.message.assistant p {
  margin: 0 0 12px;
}
.message.assistant p:last-child {
  margin-bottom: 0;
}
```

- 12px gap between paragraphs
- Last child trim to avoid excess padding at message bottom

### Lists

```css
.message.assistant ul,
.message.assistant ol {
  padding-left: 1.5em;
  margin: 0 0 12px;
}
.message.assistant li {
  margin-bottom: 4px;
}
.message.assistant li > ul,
.message.assistant li > ol {
  margin-bottom: 0;
  padding-left: 1.25em;
}
```

- Consistent left indent and item spacing
- Nested lists get reduced padding and no bottom margin

### Blockquotes

```css
.message.assistant blockquote {
  border-left: 3px solid var(--neon-purple);
  padding-left: 12px;
  margin: 12px 0;
  color: var(--text-dim);
  font-style: italic;
}
```

- Purple left border accent (distinct from cyan message border)
- Dimmed italic text

### Horizontal Rules

```css
.message.assistant hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 16px 0;
}
```

## Success Criteria

- [ ] Tables render with visible grid borders, styled header row, alternating row shading
- [ ] Tables scroll horizontally on narrow viewports instead of overflowing
- [ ] h1/h2 show cyan color with bottom border; h3/h4 show hierarchy without cyan
- [ ] Paragraphs have 12px gap between them
- [ ] Lists have consistent indent and 4px item spacing
- [ ] Blockquotes show purple left border with dimmed italic text
- [ ] Horizontal rules render as a thin border line
- [ ] No regression on user message bubble styling
- [ ] No regression on code block styling
