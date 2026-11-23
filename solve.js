// makefun-site 1.0.0, fast drop-in.
//
// run(input) returns exactly the answer makefun-site 1.0.0's build returns for
// the case's input: the output tree as a JSON object of path -> text, byte for
// byte. Written from the README.md spec in the bounty kit (the code is the
// reference where the two differ); no part of the reference implementation is
// copied in. The speed comes from doing the same work with less of it: one
// pass over each body instead of lex-then-render, plain text escaped in bulk
// instead of a character at a time, inline closers found with indexOf instead
// of a character scan, and one card built per page instead of two.

export const REPORT_FILE = 'build-report.txt';
export const RESERVED = Object.freeze(['posts', 'tags', 'page']);

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// --------------------------------------------------------------------- text

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;

/** `text` with & < > " and ' escaped. Called on whole runs, never one char. */
function escapeHtml(text) {
  return text.replace(ESC_RE, (c) => ESCAPES[c]);
}

const SLUG_MAX = 64;
const MARK_RE = /\p{M}/gu;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A slug cache, fresh for every case (run() resets it). */
let slugCache = null;

function slugify(text) {
  if (slugCache === null) slugCache = new Map();
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  const plain = text.normalize('NFKD').replace(MARK_RE, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  if (out === '') out = 'untitled';
  slugCache.set(text, out);
  return out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

function longDate(date) {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// --------------------------------------------------------------- front matter

const FM_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function isDigit(c) {
  return c >= '0' && c <= '9';
}

/** A string value: "..." with \" and \\ its only escapes, or bare. */
function stringOf(key, raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: `key "${key}": a quoted string is not closed` };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: `key "${key}": a quoted string holds an escape other than \\" or \\\\` };
        out += n;
        i++;
      } else if (c === '"') return { error: `key "${key}": a quoted string holds a stray quote` };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: `key "${key}": a bare string opens on [` };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary':
      return stringOf(key, raw);
    case 'date': {
      let ok = raw.length === 10 && raw[4] === '-' && raw[7] === '-';
      if (ok) {
        for (let i = 0; i < 10; i++) {
          if (i === 4 || i === 7) continue;
          if (!isDigit(raw[i])) { ok = false; break; }
        }
      }
      const y = ok ? Number(raw.slice(0, 4)) : 0;
      const mo = ok ? Number(raw.slice(5, 7)) : 0;
      const d = ok ? Number(raw.slice(8, 10)) : 0;
      if (!ok || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',');
      for (let k = 0; k < tags.length; k++) {
        const t = tags[k].trim();
        if (t === '') return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        for (let j = 0; j < t.length; j++) {
          const c = t[j];
          if (c === '"' || c === '[' || c === ']') return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
        tags[k] = t;
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout': {
      if (raw.length === 0) return { error: 'key "layout": not a template name' };
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-')) return { error: 'key "layout": not a template name' };
      }
      return { value: raw };
    }
    case 'slug': {
      if (raw.length === 0 || raw.length > 64) return { error: 'key "slug": not a slug' };
      let prevDash = true;
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c === '-') {
          if (prevDash) return { error: 'key "slug": not a slug' };
          prevDash = true;
        } else if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) prevDash = false;
        else return { error: 'key "slug": not a slug' };
      }
      if (prevDash) return { error: 'key "slug": not a slug' };
      return { value: raw };
    }
    default:
      return { error: `unknown key "${key}"` };
  }
}

function isSpaceTab(c) {
  return c === ' ' || c === '\t';
}

/**
 * A source's front matter and body: { data, body }, or { error } with the
 * first reason it is refused. `text` has "\n" line ends. Lines are walked by
 * index, never split into an array.
 */
function parseFrontMatter(text) {
  const len = text.length;
  const nl0 = text.indexOf('\n');
  const firstEnd = nl0 === -1 ? len : nl0;
  if (firstEnd !== 3 || text[0] !== '-' || text[1] !== '-' || text[2] !== '-') return { error: 'no front matter' };
  // Find the closing line, exactly '---'. Lines are 1-based; the opening is 1.
  let pos = nl0 === -1 ? len : nl0 + 1;
  let closeNo = -1;
  let closeStart = -1;
  let closeEnd = -1;
  for (let ln = 2; pos < len; ln++) {
    const e = text.indexOf('\n', pos);
    const end = e === -1 ? len : e;
    if (end - pos === 3 && text[pos] === '-' && text[pos + 1] === '-' && text[pos + 2] === '-') {
      closeNo = ln;
      closeStart = pos;
      closeEnd = end;
      break;
    }
    pos = e === -1 ? len : e + 1;
  }
  if (closeNo === -1) return { error: 'the front matter is not closed' };
  const data = {};
  // Parse the lines between, line 2 .. closeNo - 1.
  let p = nl0 === -1 ? len : nl0 + 1;
  for (let ln = 2; ln < closeNo; ln++) {
    const e = text.indexOf('\n', p);
    const end = e === -1 ? len : e;
    // Blank (spaces/tabs only) or a comment ('#' first) is skipped.
    let q = p;
    while (q < end && isSpaceTab(text[q])) q++;
    if (q === end || text[p] === '#') {
      p = e === -1 ? len : e + 1;
      continue;
    }
    // key: a-z and _ up to ':'.
    let k = p;
    while (k < end) {
      const c = text[k];
      if ((c >= 'a' && c <= 'z') || c === '_') k++;
      else break;
    }
    if (k === p || k >= end || text[k] !== ':') return { error: `line ${ln} is not "key: value"` };
    const key = text.slice(p, k);
    let vStart;
    if (k + 1 === end) vStart = -1;
    else if (text[k + 1] === ' ') vStart = k + 2;
    else return { error: `line ${ln} is not "key: value"` };
    let vEnd = end;
    if (vStart !== -1) {
      while (vEnd > vStart && isSpaceTab(text[vEnd - 1])) vEnd--;
    }
    const raw = vStart === -1 ? '' : text.slice(vStart, vEnd);
    if (!FM_KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
    p = e === -1 ? len : e + 1;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  // The body is everything after the closing line.
  const body = closeEnd === len ? '' : text.slice(closeEnd + 1);
  return { data, body };
}

// ----------------------------------------------------------------- markdown

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const WS_RE = /\s/;

/** Whether `ch` (one code unit) is whitespace, exactly as /\s/ has it. */
function isWS(ch) {
  const c = ch.charCodeAt(0);
  if (c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12) return true;
  if (c < 128) return false;
  return WS_RE.test(ch);
}

/** The words of a body: its runs of characters other than whitespace. */
function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12) { inWord = false; continue; }
    if (c < 128) {
      if (!inWord) { n++; inWord = true; }
      continue;
    }
    // Non-ASCII whitespace, exactly as /\s/ has it (surrogates never are).
    const ws = c === 0xA0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200A) || c === 0x2028 || c === 0x2029 || c === 0x202F || c === 0x205F || c === 0x3000 || c === 0xFEFF;
    if (ws) inWord = false;
    else if (!inWord) { n++; inWord = true; }
  }
  return n;
}

/**
 * Whether the `what` at `j` is escaped: the run of backslashes right before
 * it, counted only from `from`, has odd length. The scan that finds `what`
 * consumes `\X` pairs left to right from `from`, so exactly those backslashes
 * pair up before `j`.
 */
function isEscapedAt(s, j, from) {
  let n = 0;
  for (let k = j - 1; k >= from && s[k] === '\\'; k--) n++;
  return (n & 1) === 1;
}

function findDoubleStar(s, from) {
  let pos = from;
  for (;;) {
    const j = s.indexOf('**', pos);
    if (j === -1) return -1;
    if (!isEscapedAt(s, j, from)) return j;
    pos = j + 1;
  }
}

function findSingleStar(s, from) {
  let pos = from;
  for (;;) {
    const j = s.indexOf('*', pos);
    if (j === -1) return -1;
    if (isEscapedAt(s, j, from)) { pos = j + 1; continue; }
    if (s[j + 1] === '*') { pos = j + 2; continue; }
    return j;
  }
}

function findBracket(s, from) {
  let pos = from;
  for (;;) {
    const j = s.indexOf(']', pos);
    if (j === -1) return -1;
    if (!isEscapedAt(s, j, from)) return j;
    pos = j + 1;
  }
}

/**
 * `s` rendered inline; `env.link(target)` is a link's href. Plain runs are
 * escaped in bulk; a regex finds the next construct, so plain text is never
 * walked a character at a time.
 */
const SPECIAL_RE = /[\\`*\[]/g;

function inline(s, env) {
  const parts = [];
  const n = s.length;
  let i = 0;
  let run = 0;
  const flush = (to) => {
    if (to > run) parts.push(escapeHtml(s.slice(run, to)));
  };
  while (i < n) {
    SPECIAL_RE.lastIndex = i;
    const m = SPECIAL_RE.exec(s);
    if (m === null) break;
    const j = m.index;
    const c = s[j];
    if (c === '\\') {
      if (j + 1 < n && ESCAPABLE.has(s[j + 1])) {
        flush(j);
        parts.push(escapeHtml(s[j + 1]));
        i = j + 2;
        run = i;
      } else {
        // A backslash before anything else is itself, and stays in the run.
        i = j + 1;
      }
      continue;
    }
    if (c === '`') {
      const k = s.indexOf('`', j + 1);
      if (k > j + 1) {
        flush(j);
        parts.push('<code>', escapeHtml(s.slice(j + 1, k)), '</code>');
        i = k + 1;
        run = i;
      } else {
        // A lone backtick stays in the plain run.
        i = j + 1;
      }
      continue;
    }
    if (c === '*') {
      if (s[j + 1] === '*') {
        const k = findDoubleStar(s, j + 2);
        if (k > j + 2) {
          flush(j);
          parts.push('<strong>', inline(s.slice(j + 2, k), env), '</strong>');
          i = k + 2;
          run = i;
        } else i = j + 2;
        continue;
      }
      const k = findSingleStar(s, j + 1);
      if (k > j + 1) {
        flush(j);
        parts.push('<em>', inline(s.slice(j + 1, k), env), '</em>');
        i = k + 1;
        run = i;
      } else i = j + 1;
      continue;
    }
    if (c === '[') {
      const k = findBracket(s, j + 1);
      const mm = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = mm === -1 ? '' : s.slice(k + 2, mm);
      if (target !== '' && !WS_RE.test(target)) {
        flush(j);
        parts.push('<a href="', escapeHtml(env.link(target)), '">', inline(s.slice(j + 1, k), env), '</a>');
        i = mm + 1;
        run = i;
        continue;
      }
      i = j + 1;
      continue;
    }
  }
  flush(n);
  return parts.join('');
}

function isLangChar(c) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_' || c === '+' || c === '-';
}

/** Trim spaces and tabs at both ends of src[start..end). */
function trimRange(src, start, end) {
  let a = start;
  let b = end;
  while (a < b && isSpaceTab(src[a])) a++;
  while (b > a && isSpaceTab(src[b - 1])) b--;
  return [a, b];
}

/**
 * `src` rendered: its HTML, its table of contents and its excerpt. One pass
 * over the lines, no token array: each block is rendered as it is found.
 */
function renderMarkdown(src, env) {
  const parts = [];
  const toc = [];
  const ids = new Set();
  let excerpt = null;
  const n = src.length;
  let i = 0;

  // Classify the line [s, e): returns 0 other, 1 blank, 2 fence-open, 3 heading, 4 hr.
  const lineKind = (s, e) => {
    if (s === e) return 1;
    const c0 = src[s];
    if (c0 === ' ' || c0 === '\t') {
      let p = s;
      while (p < e && isSpaceTab(src[p])) p++;
      if (p === e) return 1;
      return 0;
    }
    if (c0 === '`' && src[s + 1] === '`' && src[s + 2] === '`') {
      let p = s + 3;
      while (p < e && isLangChar(src[p])) p++;
      while (p < e && isSpaceTab(src[p])) p++;
      return p === e ? 2 : 0;
    }
    if (c0 === '#') {
      let p = s;
      while (p < e && src[p] === '#') p++;
      const depth = p - s;
      if (depth > 6) return 0;
      if (p >= e || !isSpaceTab(src[p])) return 0;
      // Text after the #'s and their spaces must be non-empty.
      let t = p;
      while (t < e && isSpaceTab(src[t])) t++;
      if (t === e) return 0;
      return 3;
    }
    if ((c0 === '-' || c0 === '*') && src[s + 1] === c0 && src[s + 2] === c0) {
      let p = s + 3;
      while (p < e && isSpaceTab(src[p])) p++;
      return p === e ? 4 : 0;
    }
    return 0;
  };

  const headingInfo = (s, e) => {
    let p = s;
    while (src[p] === '#') p++;
    const depth = p - s;
    let t = p;
    while (t < e && isSpaceTab(src[t])) t++;
    let b = e;
    while (b > t && isSpaceTab(src[b - 1])) b--;
    return { depth, ts: t, te: b };
  };

  while (i < n) {
    let e = src.indexOf('\n', i);
    if (e === -1) e = n;
    const kind = lineKind(i, e);
    if (kind === 1) {
      i = e === n ? n : e + 1;
      continue;
    }
    if (kind === 2) {
      // Fence: lang, then body lines to a close fence or the end.
      let p = i + 3;
      const langStart = p;
      while (p < e && isLangChar(src[p])) p++;
      const lang = src.slice(langStart, p);
      const bodyParts = [];
      let j = e === n ? n : e + 1;
      let closed = false;
      while (j < n) {
        let je = src.indexOf('\n', j);
        if (je === -1) je = n;
        // Close fence: ``` then spaces/tabs only.
        if (je - j >= 3 && src[j] === '`' && src[j + 1] === '`' && src[j + 2] === '`') {
          let q = j + 3;
          while (q < je && isSpaceTab(src[q])) q++;
          if (q === je) {
            j = je === n ? n : je + 1;
            closed = true;
            break;
          }
        }
        bodyParts.push(escapeHtml(src.slice(j, je)), '\n');
        j = je === n ? n : je + 1;
      }
      // An unclosed fence also swallows the line a trailing newline leaves
      // behind: the lexer's split('\n') ends in an empty line, which the
      // fence collects like any other line.
      if (!closed && n > 0 && src[n - 1] === '\n') bodyParts.push('\n');
      i = j;
      parts.push('<pre><code', lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`, '>', bodyParts.join(''), '</code></pre>\n');
      continue;
    }
    if (kind === 3) {
      const { depth, ts, te } = headingInfo(i, e);
      const text = src.slice(ts, te);
      const id = uniqueSlug(slugify(text), ids);
      const html = inline(text, env);
      parts.push(`<h${depth} id="${id}">${html}</h${depth}>\n`);
      if (depth === 2 || depth === 3) toc.push({ level: depth, id, html });
      i = e === n ? n : e + 1;
      continue;
    }
    if (kind === 4) {
      parts.push('<hr>\n');
      i = e === n ? n : e + 1;
      continue;
    }
    if (src[i] === '>') {
      // Blockquote: consecutive '>' lines, '>' and one space dropped, trimmed, empties dropped.
      const qParts = [];
      while (i < n) {
        let je = src.indexOf('\n', i);
        if (je === -1) je = n;
        if (src[i] !== '>') break;
        let ls = i + 1;
        if (src[ls] === ' ') ls++;
        const [a, b] = trimRange(src, ls, je);
        if (b > a) qParts.push(src.slice(a, b));
        i = je === n ? n : je + 1;
      }
      if (qParts.length === 0) parts.push('<blockquote>\n</blockquote>\n');
      else parts.push('<blockquote>\n<p>', inline(qParts.join('\n'), env), '</p>\n</blockquote>\n');
      continue;
    }
    // List: bullet '- '/'* ' or ordered digits '. '.
    const c0 = src[i];
    let ordered = false;
    let startNum = 1;
    let itemStart = -1;
    if ((c0 === '-' || c0 === '*') && src[i + 1] === ' ') {
      itemStart = i + 2;
    } else if (c0 >= '0' && c0 <= '9') {
      let p = i;
      while (p < e && src[p] >= '0' && src[p] <= '9' && p - i < 9) p++;
      if (p - i >= 1 && p - i <= 9 && src[p] === '.' && src[p + 1] === ' ') {
        ordered = true;
        startNum = Number(src.slice(i, p));
        itemStart = p + 2;
      }
    }
    if (itemStart !== -1) {
      const items = [];
      let cur = null;
      let j = i;
      while (j < n) {
        let je = src.indexOf('\n', j);
        if (je === -1) je = n;
        let matched = false;
        let isOrd = false;
        let iStart = -1;
        let num = 0;
        if (!ordered && (src[j] === '-' || src[j] === '*') && src[j + 1] === ' ') {
          matched = true;
          iStart = j + 2;
        } else if (ordered && src[j] >= '0' && src[j] <= '9') {
          let p = j;
          while (p < je && src[p] >= '0' && src[p] <= '9' && p - j < 9) p++;
          if (p - j >= 1 && p - j <= 9 && src[p] === '.' && src[p + 1] === ' ') {
            matched = true;
            isOrd = true;
            num = Number(src.slice(j, p));
            iStart = p + 2;
          }
        }
        if (matched) {
          const [a, b] = trimRange(src, iStart, je);
          cur = [src.slice(a, b)];
          items.push(cur);
          j = je === n ? n : je + 1;
          continue;
        }
        // Continuation: two or more spaces, then a non-space.
        if (cur !== null && je - j >= 3 && src[j] === ' ' && src[j + 1] === ' ') {
          let p = j;
          while (p < je && src[p] === ' ') p++;
          if (p < je && !isWS(src[p])) {
            const [a, b] = trimRange(src, j, je);
            cur.push(src.slice(a, b));
            j = je === n ? n : je + 1;
            continue;
          }
        }
        break;
      }
      i = j;
      const tag = ordered ? 'ol' : 'ul';
      const open = ordered && startNum !== 1 ? `<ol start="${startNum}">` : `<${tag}>`;
      parts.push(open, '\n');
      for (const it of items) parts.push('<li>', inline(it.join('\n'), env), '</li>\n');
      parts.push(`</${tag}>\n`);
      continue;
    }
    // Paragraph: lines up to a blank line, a fence, a heading or a break.
    {
      const pParts = [];
      let j = i;
      for (;;) {
        let je = src.indexOf('\n', j);
        if (je === -1) je = n;
        const [a, b] = trimRange(src, j, je);
        pParts.push(src.slice(a, b));
        j = je === n ? n : je + 1;
        if (j >= n) break;
        let ne = src.indexOf('\n', j);
        if (ne === -1) ne = n;
        const k = lineKind(j, ne);
        if (k !== 0) break;
      }
      i = j;
      const text = pParts.join('\n');
      const html = inline(text, env);
      if (excerpt === null) excerpt = html;
      parts.push('<p>', html, '</p>\n');
    }
  }
  return { html: parts.join(''), toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

const INCLUDE_DEPTH = 8;
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

function lookup(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function renderNodes(nodes, scope, ctx, depth, parts) {
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        parts.push(n.text);
        break;
      case 'var':
        parts.push(escapeHtml(textOf(lookup(scope, n.path))));
        break;
      case 'raw':
        parts.push(textOf(lookup(scope, n.path)));
        break;
      case 'if': {
        const v = truthy(lookup(scope, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) renderNodes(branch, scope, ctx, depth, parts);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (Array.isArray(xs)) {
          for (let k = 0; k < xs.length; k++) {
            const vars = { [n.name]: xs[k], loop: { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length } };
            renderNodes(n.body, { vars, parent: scope }, ctx, depth, parts);
          }
        }
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) renderNodes(t, scope, ctx, depth + 1, parts);
        break;
      }
    }
  }
}

// -------------------------------------------------------------------- build

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });

export function run(input) {
  slugCache = new Map();
  const templates = new Map();
  const report = [];
  const names = Object.keys(input.templates).sort();
  for (const name of names) {
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const base = input.site.base_url.replace(/\/+$/, '');

  // 1. Sources, in code-unit order of path; .md is a source, the rest static.
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      const text = f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n');
      sources.push({ path: f.path, text });
    } else statics.push({ path: f.path, content: f.content });
  }

  // 2. Front matter and the checks, in order.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own = undefined;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  // 3. Permalinks: slugs unique in their directory, in source order.
  const taken = new Map();
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    s.slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.outDir = dir === '' ? s.slug : `${dir}/${s.slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. Markdown, links resolved.
  const staticPaths = new Set();
  for (const f of statics) staticPaths.add(f.path);
  const broken = new Set();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
        if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
        broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.words = wordsOf(s.body);
  }

  // 5. Collections: posts newest first, then by slug.
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // 6. Tags.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name);
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugify(name);
      return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
    });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. Layouts.
  const output = {};
  const cards = new Map();
  const cardOf = (s) => {
    let card = cards.get(s);
    if (card !== undefined) return card;
    card = {
      title: s.data.title,
      url: s.url,
      date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDate(s.data.date),
      summary: s.data.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(s.words / 200)),
      tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    };
    cards.set(s, card);
    return card;
  };
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cardOf(p));
  const ctx = { templates, escape: escapeHtml };
  const render = (name, vars) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const parts = [];
    renderNodes(nodes, { vars: { site, tags: allTags, recent, ...vars }, parent: null }, ctx, 0, parts);
    return parts.join('');
  };
  for (const s of kept) {
    const page = {
      ...cardOf(s),
      slug: s.slug,
      content: s.html,
      toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
    output[`${s.outDir}/index.html`] = render(s.layout, { page });
  }
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cardOf(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', {
      tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cardOf(p)) },
    });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. The report.
  const lines = [...report, ...broken].sort();
  const nPages = kept.filter((s) => !s.post).length;
  lines.push(`built ${nPages} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join('\n')}\n`;
  return output;
}
