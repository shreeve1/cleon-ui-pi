# Message Formatting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add CSS prose styling for AI assistant messages — tables, headings, paragraphs, lists, blockquotes, and horizontal rules.

**Architecture:** CSS-only patch scoped to `.message.assistant`. No JS changes. All new rules are inserted after the existing `.message pre code` block (line 1541) in `public/style.css`. marked.js already generates the correct HTML; we just need styles.

**Tech Stack:** CSS custom properties (`var(--neon-cyan)`, `var(--bg)`, `var(--border)`, etc. already defined in `public/style.css`)

---

### Background: CSS variable reference

These are already defined in `public/style.css` and used throughout:
- `var(--neon-cyan)` — bright cyan accent
- `var(--neon-purple)` — purple accent
- `var(--bg)` — darkest background
- `var(--bg-light)` — slightly lighter background
- `var(--border)` — subtle border color
- `var(--text)` — primary text
- `var(--text-dim)` — dimmed text

---

### Task 1: Add table styles

**Files:**
- Modify: `public/style.css` after line 1541 (after `.message pre code` block, before `/* File Links */`)

**Step 1: Insert table CSS**

Add the following block at line 1542 (before `/* File Links */`):

```css
/* Prose content styles for assistant messages */
.message.assistant table {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 14px;
  max-width: 100%;
}

.message.assistant th,
.message.assistant td {
  padding: 8px 12px;
  border: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.message.assistant th {
  background: var(--bg);
  color: var(--neon-cyan);
  font-weight: 600;
  white-space: nowrap;
}

.message.assistant tr:nth-child(even) td {
  background: var(--bg);
}

.message.assistant tr:nth-child(odd) td {
  background: var(--bg-light);
}
```

**Step 2: Visual verification**

Open the app in a browser. Send a message that produces a table (e.g., ask the AI "show a markdown table comparing A and B"). Verify:
- Grid lines are visible around every cell
- Header row has cyan text on dark background
- Alternating rows have slightly different shades
- Table scrolls horizontally if it's wide (no overflow)

**Step 3: Commit**

```bash
git add public/style.css
git commit -m "style: add table prose styles for assistant messages"
```

---

### Task 2: Add heading styles

**Files:**
- Modify: `public/style.css` — append after the table block added in Task 1

**Step 1: Insert heading CSS**

Append after the table block:

```css
.message.assistant h1,
.message.assistant h2 {
  color: var(--neon-cyan);
  border-bottom: 1px solid var(--border);
  padding-bottom: 4px;
  margin: 20px 0 10px;
  font-weight: 700;
}

.message.assistant h1 { font-size: 1.4em; }
.message.assistant h2 { font-size: 1.25em; }

.message.assistant h3 {
  font-size: 1.1em;
  color: var(--text);
  margin: 16px 0 8px;
  font-weight: 600;
}

.message.assistant h4,
.message.assistant h5,
.message.assistant h6 {
  font-size: 1.05em;
  color: var(--text);
  margin: 14px 0 6px;
  letter-spacing: 0.3px;
  font-weight: 600;
}

/* Remove top margin when heading is first child */
.message.assistant h1:first-child,
.message.assistant h2:first-child,
.message.assistant h3:first-child {
  margin-top: 0;
}
```

**Step 2: Visual verification**

Ask the AI a question that produces headings (e.g., "explain X with sections"). Verify:
- h1/h2 show in cyan with a thin bottom border separator
- h3+ show in normal text color
- Size hierarchy is visible
- No excess top margin on the first heading

**Step 3: Commit**

```bash
git add public/style.css
git commit -m "style: add heading prose styles for assistant messages"
```

---

### Task 3: Add paragraph and list styles

**Files:**
- Modify: `public/style.css` — append after the headings block

**Step 1: Insert paragraph and list CSS**

Append after the headings block:

```css
.message.assistant p {
  margin: 0 0 12px;
}

.message.assistant p:last-child {
  margin-bottom: 0;
}

.message.assistant ul,
.message.assistant ol {
  padding-left: 1.5em;
  margin: 0 0 12px;
}

.message.assistant li {
  margin-bottom: 4px;
  line-height: 1.6;
}

/* Nested lists: no extra bottom margin, tighter indent */
.message.assistant li > ul,
.message.assistant li > ol {
  margin-bottom: 0;
  padding-left: 1.25em;
  margin-top: 4px;
}
```

**Step 2: Visual verification**

Send or find a message with multiple paragraphs and a bulleted/numbered list. Verify:
- Paragraphs have visible breathing room between them
- Lists are indented with consistent bullet/number alignment
- Nested list items indent further
- No excess space after the last paragraph in a message

**Step 3: Commit**

```bash
git add public/style.css
git commit -m "style: add paragraph and list prose styles for assistant messages"
```

---

### Task 4: Add blockquote and horizontal rule styles

**Files:**
- Modify: `public/style.css` — append after the lists block

**Step 1: Insert blockquote and hr CSS**

Append after the lists block:

```css
.message.assistant blockquote {
  border-left: 3px solid var(--neon-purple);
  padding: 4px 0 4px 12px;
  margin: 12px 0;
  color: var(--text-dim);
  font-style: italic;
}

.message.assistant blockquote p:last-child {
  margin-bottom: 0;
}

.message.assistant hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 16px 0;
}
```

**Step 2: Visual verification**

Test a message with a blockquote (markdown: `> quoted text`) and a horizontal rule (`---`). Verify:
- Blockquote has a purple left border, italic dimmed text
- HR renders as a thin border line with vertical spacing
- No broken layout around either element

**Step 3: Commit**

```bash
git add public/style.css
git commit -m "style: add blockquote and hr prose styles for assistant messages"
```

---

### Task 5: Full regression check

**Step 1: Check user message bubbles are unchanged**

Send a user message. Verify the purple gradient bubble still renders normally — no new styles should apply to `.message.user`.

**Step 2: Check code blocks are unchanged**

Send a message that returns a code block. Verify:
- Code block header (language label + copy button) still renders
- Syntax highlighting still works
- Copy button still works
- No extra margins or border conflicts

**Step 3: Check the original screenshot scenario**

Ask the AI: "Show me a settings comparison table for Sonarr and Radarr with columns for Setting, Sonarr, and Radarr values." Verify the table looks correct — grid borders visible, header row cyan, rows alternating.

**Step 4: Final commit (if any cleanup needed)**

```bash
git add public/style.css
git commit -m "style: message prose formatting complete"
```

---

## Success Criteria

- [ ] Tables render with visible grid borders, styled header row, alternating row shading
- [ ] Tables scroll horizontally on narrow viewports instead of overflowing
- [ ] h1/h2 show cyan color with bottom border; h3/h4 show hierarchy in standard text color
- [ ] Paragraphs have 12px gap between them
- [ ] Lists have consistent 1.5em indent and 4px item spacing
- [ ] Blockquotes show purple left border with dimmed italic text
- [ ] Horizontal rules render as a thin border line
- [ ] User message bubble styling unchanged
- [ ] Code block styling unchanged
