/* Pacing Frontier AI: site-wide search.
 *
 * A modal dialog that searches every page. It opens from the header button (button.search-open),
 * from "/" when focus is outside a text field, and from Ctrl+K or Cmd+K. The index
 * (assets/search-index.json) is fetched by relative URL the first time the dialog opens; the
 * lookup structures are built once and kept for the life of the page. Plain JS, no libraries.
 *
 * Index formats accepted:
 *   v1 (current build): [{p, n, a, s, t, h?}, ...]
 *   v2 (compact):       {v: 2, pages: [[p, n], ...],
 *                        runs: [[pageIndex, anchor, sectionTitle, headingFlag, text, text, ...], ...]}
 *       A run is a stretch of consecutive v1 entries with the same p, a and s. headingFlag 1 means
 *       the run opens with the heading entry itself ({t: s, h: 1}). Decoding is lossless.
 *
 * Matching: case, accents and quote styles are folded away. Every term must match (AND): the last
 * term as the start of a word, the others as whole words. "Quoted phrases" match exactly.
 * One-letter terms are ignored unless they are digits.
 * Ranking: headings, then section-title matches, then body text; whole words before partial words;
 * then page order and document order. Matches are collapsed per link target (page + anchor),
 * grouped by page and capped.
 */
(function () {
  'use strict';

  var doc = document;
  var win = window;
  var root = doc.documentElement;

  var CFG = {
    url: 'assets/search-index.json',
    max: 50,        // results listed
    snip: 180,      // snippet length in characters
    lead: 60,       // characters kept before the first match
    examples: ['FRONTIER Act', 'export controls', 'Leicht']
  };
  var KEY_QUERY = 'pfai-search-query';  // sessionStorage: last query and last opened result
  var KEY_LAND = 'pfai-search-landing'; // sessionStorage: passage to show after a jump to another page

  var openBtn = doc.querySelector('.search-open');
  var siteEl = doc.querySelector('.site');
  var slug = siteEl && siteEl.getAttribute('data-page');
  var HERE = slug ? (slug === 'index' ? 'index.html' : slug + '.html') : guessHere();
  // The home page may appear as "./" (older index) or "index.html".
  function samePage(p) { return (p === './' || p === '' ? 'index.html' : p) === HERE; }
  var IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

  function guessHere() {
    var f = location.pathname.split('/').pop();
    return !f || f === 'index.html' ? 'index.html' : f;
  }
  function now() { return win.performance && performance.now ? performance.now() : Date.now(); }

  // ------------------------------------------------------------------ storage (may throw or be empty)
  function sget(k) { try { return win.sessionStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { win.sessionStorage.setItem(k, v); } catch (e) { /* blocked: carry on */ } }
  function sdel(k) { try { win.sessionStorage.removeItem(k); } catch (e) { /* blocked: carry on */ } }
  function sjson(k) { try { return JSON.parse(sget(k) || 'null'); } catch (e) { return null; } }

  // ------------------------------------------------------------------ text folding
  // fold() lowercases, strips accents and maps curly quotes, dashes and odd spaces to plain ASCII.
  // It keeps the string length, so a match position in folded text is the same in the original.
  var FOLD = {
    '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'", '\u2032': "'", '\u00b4': "'", '\u02bc': "'",
    '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u201f': '"', '\u2033': '"', '\u00ab': '"', '\u00bb': '"',
    '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
    '\u00a0': ' ', '\u2002': ' ', '\u2003': ' ', '\u2007': ' ', '\u2009': ' ', '\u200a': ' ', '\u202f': ' ',
    '\u0130': 'i', '\u0131': 'i', '\u00d8': 'o', '\u00f8': 'o', '\u0141': 'l', '\u0142': 'l',
    '\u0110': 'd', '\u0111': 'd', '\u00d0': 'd', '\u00f0': 'd', '\u0126': 'h', '\u0127': 'h'
  };
  var NON_ASCII = /[^\x00-\x7f]/;
  var NON_ASCII_G = /[^\x00-\x7f]/g;
  var MARKS = /[\u0300-\u036f]/;
  var MARKS_G = /[\u0300-\u036f]/g;

  function foldChar(ch) {
    var f = FOLD[ch];
    if (f !== undefined) return f;
    f = ch;
    try { f = ch.normalize('NFD').replace(MARKS_G, ''); } catch (e) { /* no normalize() */ }
    f = f.toLowerCase();
    if (f.length !== 1) { f = ch.toLowerCase(); if (f.length !== 1) f = ch; }
    FOLD[ch] = f;
    return f;
  }
  function fold(s) {
    if (NON_ASCII.test(s)) s = s.replace(NON_ASCII_G, foldChar);
    return s.toLowerCase();
  }
  function nfc(s) {
    if (MARKS.test(s)) { try { return s.normalize('NFC'); } catch (e) { return s; } }
    return s;
  }
  function foldQuery(s) {
    try { s = s.normalize('NFD').replace(MARKS_G, ''); } catch (e) { /* no normalize() */ }
    return fold(s);
  }

  // Word characters: letters and digits in any script.
  var WORD = new Uint8Array(128);
  (function () {
    var c;
    for (c = 48; c < 58; c++) WORD[c] = 1;
    for (c = 65; c < 91; c++) WORD[c] = 1;
    for (c = 97; c < 123; c++) WORD[c] = 1;
  })();
  var WORD_RE;
  try { WORD_RE = new RegExp('[\\p{L}\\p{N}\\p{M}]', 'u'); } catch (e) { WORD_RE = /[A-Za-z0-9\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff]/; }
  var wordCache = {};
  function isWordAt(s, i) {
    var c = s.charCodeAt(i);
    if (c < 128) return WORD[c] === 1;
    var w = wordCache[c];
    if (w === undefined) w = wordCache[c] = WORD_RE.test(String.fromCharCode(c));
    return w;
  }

  // ------------------------------------------------------------------ query parsing
  // Tokens: {s: folded text, phrase, closed, prefix, sb: needs a word start, eb: needs a word end}
  function trimWord(s) {
    var a = 0, b = s.length;
    while (a < b && !isWordAt(s, a)) a++;
    while (b > a && !isWordAt(s, b - 1)) b--;
    return s.slice(a, b);
  }
  function parseQuery(raw) {
    var q = foldQuery(raw || '');
    var n = q.length, i = 0, j, k, toks = [], seen = {};
    function push(s, phrase, closed) {
      if (!s) return;
      if (s.length === 1 && !(s >= '0' && s <= '9')) return;     // one-letter terms are noise
      var key = (phrase ? '"' : '') + s;
      if (seen[key]) return;
      seen[key] = 1;
      toks.push({ s: s, phrase: phrase, closed: closed, prefix: false, sb: isWordAt(s, 0), eb: isWordAt(s, s.length - 1) });
    }
    while (i < n) {
      var c = q.charCodeAt(i);
      if (c === 34) {                                              // "phrase"
        j = q.indexOf('"', i + 1);
        push(q.slice(i + 1, j === -1 ? n : j).replace(/\s+/g, ' ').trim(), true, j !== -1);
        i = j === -1 ? n : j + 1;
      } else if (c <= 32) {
        i++;
      } else {
        k = i;
        while (k < n && q.charCodeAt(k) > 32 && q.charCodeAt(k) !== 34) k++;
        push(trimWord(q.slice(i, k)), false, false);
        i = k;
      }
    }
    var last = toks[toks.length - 1];
    if (last && !(last.phrase && last.closed)) last.prefix = true;  // still being typed
    return toks;
  }

  // ------------------------------------------------------------------ matching
  // 0: no match; 1: only as the start of a longer word (prefix token); 2: whole word or exact phrase.
  function matchIn(hay, tok) {
    var s = tok.s, len = s.length, from = 0, best = 0, i, j;
    while ((i = hay.indexOf(s, from)) !== -1) {
      if (!tok.sb || i === 0 || !isWordAt(hay, i - 1)) {
        j = i + len;
        if (!tok.eb || j >= hay.length || !isWordAt(hay, j)) return 2;
        if (tok.prefix) best = 1;
      }
      from = i + 1;
    }
    return best;
  }
  // Position of the first occurrence that counts as a match, or -1.
  function firstAt(hay, tok, from) {
    var s = tok.s, len = s.length, i, j;
    while ((i = hay.indexOf(s, from)) !== -1) {
      if (!tok.sb || i === 0 || !isWordAt(hay, i - 1)) {
        j = i + len;
        if (tok.prefix || !tok.eb || j >= hay.length || !isWordAt(hay, j)) return i;
      }
      from = i + 1;
    }
    return -1;
  }

  // ------------------------------------------------------------------ index
  var IDX = null;

  function siteOrder() {
    var order = {}, fam = {}, n = 0, i, h, f;
    var brand = doc.querySelector('.site-header a.brand');
    if (brand) order[brand.getAttribute('href') || './'] = n++;
    var links = doc.querySelectorAll('#site-nav a[href]');
    for (i = 0; i < links.length; i++) {
      h = links[i].getAttribute('href');
      if (!(h in order)) order[h] = n++;
      f = links[i].getAttribute('data-family');
      if (f) fam[h] = f;
    }
    return { order: order, fam: fam };
  }

  function buildIndex(data) {
    var pages = [], pageAt = new Map(), secA = [], secPage = [], secAt = new Map();
    var titles = [], ftitles = [], titleAt = new Map();
    var secOf = [], titleOf = [], head = [], text = [], ftext = [];

    function pageId(p, n) {
      var i = pageAt.get(p);
      if (i === undefined) { i = pages.length; pageAt.set(p, i); pages.push({ p: p, n: n }); }
      return i;
    }
    function add(pi, a, s, t, h) {
      var key = pi + '#' + a, k = secAt.get(key);
      if (k === undefined) { k = secA.length; secAt.set(key, k); secA.push(a); secPage.push(pi); }
      var ti = titleAt.get(s);
      if (ti === undefined) { ti = titles.length; titleAt.set(s, ti); s = nfc(s); titles.push(s); ftitles.push(fold(s)); }
      secOf.push(k);
      titleOf.push(ti);
      head.push(h ? 1 : 0);
      if (h) { text.push(titles[ti]); ftext.push(ftitles[ti]); }
      else { t = nfc(String(t)); text.push(t); ftext.push(fold(t)); }
    }

    var i, j, e, r, pg;
    if (Array.isArray(data)) {
      for (i = 0; i < data.length; i++) {
        e = data[i];
        add(pageId(e.p, e.n), e.a, String(e.s), e.t, e.h);
      }
    } else if (data && data.v === 2 && Array.isArray(data.pages) && Array.isArray(data.runs)) {
      for (i = 0; i < data.runs.length; i++) {
        r = data.runs[i];
        pg = data.pages[r[0]];
        var pi = pageId(pg[0], pg[1]);
        if (r[3]) add(pi, r[1], String(r[2]), r[2], 1);
        for (j = 4; j < r.length; j++) add(pi, r[1], String(r[2]), r[j], 0);
      }
    } else {
      throw new Error('Unknown search index format');
    }

    var so = siteOrder();
    for (i = 0; i < pages.length; i++) {
      pages[i].rank = so.order[pages[i].p] !== undefined ? so.order[pages[i].p] : 1000 + i;
      pages[i].fam = so.fam[pages[i].p] || '';
    }
    var nS = secA.length;
    return {
      n: secOf.length, pages: pages, secA: secA, secPage: secPage,
      titles: titles, ftitles: ftitles, secOf: secOf, titleOf: titleOf, head: head, text: text, ftext: ftext,
      // per-search scratch, reused
      stamp: 0, sSeen: new Int32Array(nS), sBest: new Int8Array(nS), sBestE: new Int32Array(nS),
      sFirst: new Int32Array(nS), sCount: new Int32Array(nS), sTextE: new Int32Array(nS), sTextN: new Int8Array(nS)
    };
  }

  // ------------------------------------------------------------------ search
  function byLengthDesc(a, b) { return b.s.length - a.s.length; }

  function search(raw) {
    var t0 = now();
    var toks = parseQuery(raw);
    var out = { q: raw, toks: toks, total: 0, pages: 0, items: [], ms: 0 };
    if (!toks.length || !IDX) { out.ms = now() - t0; return out; }

    var I = IDX, N = I.n, ft = I.ftext, ftl = I.ftitles, tOf = I.titleOf, sOf = I.secOf, hd = I.head;
    var ev = toks.slice().sort(byLengthDesc), nt = ev.length;     // longest token first: fails fastest
    var tc = new Int8Array(ftl.length * nt);                       // title match cache: match + 1, 0 = unknown
    var stamp = ++I.stamp, seen = I.sSeen, best = I.sBest, bestE = I.sBestE, first = I.sFirst;
    var cnt = I.sCount, txE = I.sTextE, txN = I.sTextN;
    var hits = [], i, j, k, tok, ti, h, mt, ms, ci, allTitle, whole, inText, score;
    // For several plain words, passages that hold them side by side, in order, rank a step higher.
    var adj = null, lastTok = toks[toks.length - 1];
    if (nt > 1 && !toks.some(function (t) { return t.phrase; })) {
      adj = { s: toks.map(function (t) { return t.s; }).join(' '), prefix: lastTok.prefix, sb: toks[0].sb, eb: lastTok.eb };
    }

    for (i = 0; i < N; i++) {
      ti = tOf[i]; h = hd[i];
      allTitle = 1; whole = 1; inText = 0;
      for (j = 0; j < nt; j++) {
        tok = ev[j];
        ci = ti * nt + j;
        ms = tc[ci];
        if (ms === 0) { ms = matchIn(ftl[ti], tok) + 1; tc[ci] = ms; }
        ms -= 1;
        mt = h ? 0 : matchIn(ft[i], tok);
        if (!mt && !ms) break;
        if (!ms) allTitle = 0;
        if (mt) inText++;
        if (tok.prefix && mt < 2 && ms < 2) whole = 0;
      }
      if (j < nt) continue;
      // heading entry 8, section-title match 4, body text 0; +2 when the words match whole;
      // +1 when they stand side by side
      score = (h ? 8 : allTitle ? 4 : 0) + whole * 2;
      if (adj && ((!h && matchIn(ft[i], adj)) || matchIn(ftl[ti], adj))) score += 1;
      k = sOf[i];
      if (seen[k] !== stamp) {
        seen[k] = stamp; hits.push(k);
        best[k] = score; bestE[k] = i; first[k] = i; cnt[k] = 0; txN[k] = 0; txE[k] = -1;
      } else if (score > best[k]) {
        best[k] = score; bestE[k] = i;
      }
      if (inText) {
        cnt[k]++;
        if (inText > txN[k]) { txN[k] = inText; txE[k] = i; }
      }
    }

    var secPage = I.secPage, pages = I.pages;
    hits.sort(function (a, b) {
      return (best[b] - best[a]) || (pages[secPage[a]].rank - pages[secPage[b]].rank) || (first[a] - first[b]);
    });
    var pageSeen = {}, np = 0;
    for (i = 0; i < hits.length; i++) if (!pageSeen[secPage[hits[i]]]) { pageSeen[secPage[hits[i]]] = 1; np++; }
    out.total = hits.length;
    out.pages = np;
    for (i = 0; i < hits.length && i < CFG.max; i++) {
      k = hits[i];
      var be = bestE[k], se = txE[k];
      if (se < 0) se = hd[be] ? nextBody(be) : be;
      var pg = pages[secPage[k]];
      out.items.push({ page: secPage[k], p: pg.p, a: I.secA[k], href: pg.p + '#' + I.secA[k], te: be, se: se, count: cnt[k] });
    }
    out.ms = now() - t0;
    return out;
  }
  function nextBody(i) {
    var I = IDX;
    return i + 1 < I.n && I.secOf[i + 1] === I.secOf[i] && !I.head[i + 1] ? i + 1 : -1;
  }

  // ------------------------------------------------------------------ highlighting
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  // Escaped orig[start, end) with every match wrapped in <mark>.
  function markHTML(orig, folded, toks, start, end) {
    var pairs = [], i, j, p, tok;
    for (j = 0; j < toks.length; j++) {
      tok = toks[j]; p = start;
      while ((i = firstAt(folded, tok, p)) !== -1 && i < end) {
        pairs.push([i, Math.min(i + tok.s.length, end)]);
        p = i + tok.s.length;
      }
    }
    if (!pairs.length) return sup(esc(orig.slice(start, end)));
    pairs.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
    var out = '', pos = start, k = 0, a, b;
    while (k < pairs.length) {
      a = pairs[k][0]; b = pairs[k][1]; k++;
      while (k < pairs.length && pairs[k][0] <= b) { if (pairs[k][1] > b) b = pairs[k][1]; k++; }
      out += esc(orig.slice(pos, a)) + '<mark>' + esc(orig.slice(a, b)) + '</mark>';
      pos = b;
    }
    return sup(out + esc(orig.slice(pos, end)));
  }
  // "10^25" in the index reads as a power on the page; show it the same way here.
  function sup(html) { return html.replace(/(\d(?:<\/mark>)?)\^((?:<mark>)?\d+)/g, '$1<sup>$2</sup>'); }

  // About CFG.snip characters around the first match, cut at spaces.
  function snippetHTML(e, toks) {
    var I = IDX, orig = I.text[e], f = I.ftext[e], len = orig.length;
    var title = I.titles[I.titleOf[e]];
    // Timeline rows repeat their date (the section title) at the start, then a middle dot.
    var base = len > title.length + 3 && orig.lastIndexOf(title + ' \u00b7 ', 0) === 0 ? title.length + 3 : 0;
    var first = -1, flen = 0, j, p;
    for (j = 0; j < toks.length; j++) {
      p = firstAt(f, toks[j], 0);
      if (p !== -1 && (first === -1 || p < first)) { first = p; flen = toks[j].s.length; }
    }
    if (first !== -1 && first < base) base = 0;
    var start = base, end = len;
    if (len - base > CFG.snip) {
      if (first - base > CFG.lead) {
        start = Math.min(first - CFG.lead, len - CFG.snip);
        p = orig.indexOf(' ', start);
        if (p !== -1 && p < first) start = p + 1;
      }
      end = start + CFG.snip;
      if (end < len) {
        p = orig.lastIndexOf(' ', end);
        if (p > start && p >= first + flen) end = p;
        while (end > start && /[\s,;:\u00b7(-]/.test(orig.charAt(end - 1))) end--;
      }
    }
    var head = start > base ? '\u2026' : '';
    var tail = end < len && !/[.!?]["'\u201d\u2019)]?$/.test(orig.slice(Math.max(start, end - 2), end)) ? '\u2026' : '';
    return head + markHTML(orig, f, toks, start, end) + tail;
  }

  // ------------------------------------------------------------------ dialog
  var dlg, panel, input, closeBtn, meta, live, bodyEl, msg, list, cap;
  var state = 'idle';            // idle | loading | ready | error
  var isOpen = false, returnTo = null, timer = 0, liveTimer = 0, lastQ = null, lastCost = 0, ptr = '';
  var opts = [], shown = [], active = -1, current = null, lastOpen = null, restoreHref = null;
  var scrollSaved = null;

  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function plural(n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : many); }
  function kbd(s) { return '<kbd>' + s + '</kbd>'; }
  function shortcutHTML() { return kbd('/') + ' or ' + (IS_MAC ? kbd('\u2318') : kbd('Ctrl')) + ' ' + kbd('K'); }

  function ensureDialog() {
    if (dlg) return;
    dlg = doc.createElement('dialog');
    dlg.className = 'search-dialog';
    dlg.id = 'search-dialog';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'search-title');
    dlg.setAttribute('data-state', state);
    dlg.innerHTML =
      '<div class="search-panel">' +
        '<h2 class="search-sr" id="search-title">Search the Site</h2>' +
        '<div class="search-bar">' +
          '<svg class="search-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
            '<circle cx="8.5" cy="8.5" r="5.6" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
            '<path d="M12.7 12.7 17 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
          '<label class="search-sr" for="search-input">Search all pages</label>' +
          '<input id="search-input" class="search-input" type="text" role="combobox" aria-expanded="false"' +
            ' aria-controls="search-list" aria-autocomplete="list" aria-describedby="search-help"' +
            ' autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search"' +
            ' placeholder="Search all pages">' +
          '<button type="button" class="search-close" aria-label="Close search">Close</button>' +
        '</div>' +
        '<p class="search-meta"></p>' +
        '<p class="search-sr search-live" role="status" aria-live="polite" aria-atomic="true"></p>' +
        '<div class="search-body">' +
          '<div class="search-msg"></div>' +
          '<div id="search-list" class="search-list" role="listbox" aria-label="Results" hidden></div>' +
          '<p class="search-cap" hidden></p>' +
        '</div>' +
        '<p class="search-foot" id="search-help">' +
          '<span>' + kbd('\u2191') + ' ' + kbd('\u2193') + ' to move</span>' +
          '<span>' + kbd('Enter') + ' to open</span>' +
          '<span>' + kbd('Esc') + ' to close</span>' +
        '</p>' +
      '</div>';
    (doc.body || root).appendChild(dlg);

    panel = dlg.querySelector('.search-panel');
    input = dlg.querySelector('.search-input');
    closeBtn = dlg.querySelector('.search-close');
    meta = dlg.querySelector('.search-meta');
    live = dlg.querySelector('.search-live');
    bodyEl = dlg.querySelector('.search-body');
    msg = dlg.querySelector('.search-msg');
    list = dlg.querySelector('.search-list');
    cap = dlg.querySelector('.search-cap');

    input.addEventListener('input', schedule);
    input.addEventListener('keydown', onInputKey);
    closeBtn.addEventListener('click', function () { closeSearch(true); });
    dlg.addEventListener('keydown', onDialogKey);
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); closeSearch(true); });
    dlg.addEventListener('close', function () { if (isOpen) afterClose(true); });
    var downOnScrim = false;
    dlg.addEventListener('pointerdown', function (e) { downOnScrim = e.target === dlg; });
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg && downOnScrim) closeSearch(true);
      downOnScrim = false;
    });
    bodyEl.addEventListener('click', onBodyClick);
    list.addEventListener('mousemove', onListHover);

    var saved = sjson(KEY_QUERY);
    if (saved && typeof saved.q === 'string' && saved.q.trim()) {
      input.value = saved.q;
      lastOpen = restoreHref = typeof saved.open === 'string' ? saved.open : null;
    }
  }

  // ---------------------------------------------------------------- open and close
  function openSearch(opener) {
    ensureDialog();
    if (isOpen) { input.focus(); input.select(); return; }
    returnTo = opener || doc.activeElement;
    lockScroll();
    if (typeof dlg.showModal === 'function') {
      try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
    } else {
      dlg.setAttribute('open', '');
    }
    isOpen = true;
    input.focus();
    input.select();
    if (state === 'idle' || state === 'error') loadIndex();
    else update(false);
  }

  function closeSearch(restoreFocus) {
    if (!isOpen) return;
    isOpen = false;
    if (typeof dlg.close === 'function' && dlg.open) { try { dlg.close(); } catch (e) { dlg.removeAttribute('open'); } }
    else dlg.removeAttribute('open');
    afterClose(restoreFocus);
  }

  function afterClose(restoreFocus) {
    isOpen = false;
    if (timer) update(false);
    unlockScroll();
    if (restoreFocus) {
      var el = returnTo && returnTo !== doc.body && returnTo !== root && returnTo.isConnected ? returnTo : openBtn;
      if (el && el.focus) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
    }
    returnTo = null;
  }

  function lockScroll() {
    var gap = win.innerWidth - root.clientWidth;
    scrollSaved = { o: root.style.overflow, g: root.style.scrollbarGutter, p: root.style.paddingRight };
    if (gap > 0) {
      if (win.CSS && CSS.supports && CSS.supports('scrollbar-gutter', 'stable')) root.style.scrollbarGutter = 'stable';
      else root.style.paddingRight = gap + 'px';
    }
    root.style.overflow = 'hidden';
  }
  function unlockScroll() {
    if (!scrollSaved) return;
    root.style.overflow = scrollSaved.o;
    root.style.scrollbarGutter = scrollSaved.g;
    root.style.paddingRight = scrollSaved.p;
    scrollSaved = null;
  }

  // ---------------------------------------------------------------- index loading
  function loadIndex() {
    setState('loading');
    renderMessage();
    var t0 = now(), t1;
    fetch(CFG.url, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (txt) {
        t1 = now();
        var data = JSON.parse(txt);
        var t2 = now();
        IDX = buildIndex(data);
        var t3 = now();
        dlg.setAttribute('data-fetch-ms', (t1 - t0).toFixed(1));
        dlg.setAttribute('data-parse-ms', (t2 - t1).toFixed(1));
        dlg.setAttribute('data-build-ms', (t3 - t2).toFixed(1));
        dlg.setAttribute('data-load-ms', (t3 - t0).toFixed(1));
        setState('ready');
        lastQ = null;
        update(true);
      })
      .catch(function (err) {
        IDX = null;
        setState('error');
        dlg.setAttribute('data-error', String(err && err.message || err));
        renderMessage();
      });
  }
  function setState(s) {
    state = s;
    if (dlg) dlg.setAttribute('data-state', s);
  }

  // ---------------------------------------------------------------- searching as you type
  function schedule() {
    clearTimeout(timer);
    // Debounce in proportion to the cost of the last search, between 30 and 120 ms.
    timer = setTimeout(function () { update(false); }, Math.min(120, Math.max(30, Math.round(lastCost * 2))));
  }

  function update(force) {
    clearTimeout(timer);
    timer = 0;
    if (!dlg) return;
    if (state !== 'ready') { renderMessage(); return; }
    var q = input.value;
    if (!force && q === lastQ) return;
    lastQ = q;
    var r = search(q);
    var t1 = now();
    render(r);
    var renderMs = now() - t1;
    lastCost = r.ms + renderMs;
    dlg.setAttribute('data-search-ms', r.ms.toFixed(2));
    dlg.setAttribute('data-render-ms', renderMs.toFixed(2));
    dlg.setAttribute('data-total', String(r.total));
    dlg.setAttribute('data-query', q);
    saveQuery();
  }

  function saveQuery() {
    if (input) sset(KEY_QUERY, JSON.stringify({ q: input.value, open: lastOpen }));
  }

  // ---------------------------------------------------------------- rendering
  function showList(on) {
    list.hidden = !on;
    msg.hidden = on;
    input.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (!on) {
      list.innerHTML = '';
      opts = []; shown = []; active = -1;
      input.removeAttribute('aria-activedescendant');
      cap.hidden = true;
    }
  }

  // Screen readers hear the outcome once typing pauses.
  function announce(text) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { if (live.textContent !== text) live.textContent = text; }, 450);
  }

  function renderMessage() {
    if (!dlg) return;
    showList(false);
    meta.textContent = '';
    var q = input.value.trim(), html = '', status = '';
    if (state === 'loading' || state === 'idle') {
      html = '<p class="search-note">The search index loads the first time you search. One moment.</p>' +
        '<div class="search-progress" aria-hidden="true"></div>';
      status = 'Search is almost ready.';
    } else if (state === 'error') {
      html = '<p class="search-note"><strong>The search index did not load.</strong> Check the connection and try again.</p>' +
        '<button type="button" class="search-btn search-retry">Try again</button>';
      status = 'The search index did not load.';
    } else if (!q) {
      html = emptyHTML();
    } else if (!current || !current.toks.length) {
      html = '<p class="search-note">Type at least two letters, or a number.</p>';
    } else {
      html = '<p class="search-note"><strong>No results for \u201c' + esc(q) + '\u201d.</strong> Check the spelling or try fewer words.</p>';
      status = 'No results for \u201c' + q + '\u201d.';
    }
    msg.innerHTML = html;
    announce(status);
  }

  function emptyHTML() {
    var chips = '';
    for (var i = 0; i < CFG.examples.length; i++) {
      chips += '<li><button type="button" class="search-btn search-chip" data-q="' + esc(CFG.examples[i]) + '">' + esc(CFG.examples[i]) + '</button></li>';
    }
    var scope = IDX ? '<p class="search-scope">' + plural(IDX.n, 'passage', 'passages') + ' on ' + plural(IDX.pages.length, 'page', 'pages') + '</p>' : '';
    return '<p class="search-kicker">Try a Search</p>' +
      '<ul class="search-chips">' + chips + '</ul>' +
      '<ul class="search-tips">' +
        '<li>Results contain every word you type.</li>' +
        '<li>Put a phrase in \u201cquotes\u201d to match it exactly.</li>' +
        '<li class="search-tip-keys">Press ' + shortcutHTML() + ' on any page to search.</li>' +
      '</ul>' + scope;
  }

  function render(r) {
    current = r;
    if (!r.items.length) { renderMessage(); bodyEl.scrollTop = 0; return; }
    var I = IDX, items = r.items, groups = [], gAt = {}, x, g, it;
    for (x = 0; x < items.length; x++) {
      it = items[x];
      g = gAt[it.page];
      if (g === undefined) { g = gAt[it.page] = groups.length; groups.push([]); }
      groups[g].push(it);
    }
    var html = '', o = 0;
    shown = [];
    for (g = 0; g < groups.length; g++) {
      var pg = I.pages[groups[g][0].page];
      html += '<div class="sr-group" role="group" aria-labelledby="sr-g' + g + '">' +
        '<div class="sr-group-head" role="presentation" id="sr-g' + g + '">' +
          (pg.fam ? '<span class="sr-fam" aria-hidden="true" data-family="' + esc(pg.fam) + '"></span>' : '') +
          '<span class="sr-page">' + esc(pg.n) + '</span>' +
          (samePage(pg.p) ? '<span class="sr-here"><span class="search-sr">, </span>This page</span>' : '') +
        '</div>';
      for (x = 0; x < groups[g].length; x++) {
        it = groups[g][x];
        var id = 'sr-o' + o, ti = I.titleOf[it.te];
        var title = markHTML(I.titles[ti], I.ftitles[ti], r.toks, 0, I.titles[ti].length);
        var snip = it.se >= 0 ? snippetHTML(it.se, r.toks) : '';
        var count = it.count > 1 ? '<span class="sr-count" id="' + id + '-c">' + plural(it.count, 'match', 'matches') + '</span>' : '';
        var described = (snip ? id + '-s' : '') + (count ? (snip ? ' ' : '') + id + '-c' : '');
        html += '<a class="sr-item" role="option" id="' + id + '" aria-selected="false" tabindex="-1" data-i="' + o + '"' +
          ' href="' + esc(it.href) + '" aria-labelledby="' + id + '-t"' + (described ? ' aria-describedby="' + described + '"' : '') + '>' +
          '<span class="sr-head"><span class="sr-title" id="' + id + '-t">' + title + '</span>' + count + '</span>' +
          (snip ? '<span class="sr-snippet" id="' + id + '-s">' + snip + '</span>' : '') +
          '</a>';
        shown.push(it);
        o++;
      }
      html += '</div>';
    }
    if (bodyEl.scrollTop) bodyEl.scrollTop = 0;                     // before the swap: no forced layout
    list.innerHTML = html;
    opts = Array.prototype.slice.call(list.querySelectorAll('.sr-item'));
    active = -1;
    showList(true);
    var status = plural(r.total, 'result', 'results') + ' on ' + plural(r.pages, 'page', 'pages');
    meta.textContent = status;
    announce(status + '.');
    if (r.total > items.length) {
      cap.innerHTML = 'Showing ' + fmt(items.length) + ' of ' + fmt(r.total) + ' results. Add a word or a \u201cquoted phrase\u201d to narrow the list.';
      cap.hidden = false;
    } else {
      cap.hidden = true;
    }
    var start = 0;
    if (restoreHref) {
      for (x = 0; x < opts.length; x++) if (opts[x].getAttribute('href') === restoreHref) { start = x; break; }
      restoreHref = null;
    }
    setActive(start, start > 0);
  }

  function setActive(i, scroll) {
    if (active >= 0 && opts[active]) opts[active].setAttribute('aria-selected', 'false');
    active = i;
    var o = opts[i];
    if (!o) { input.removeAttribute('aria-activedescendant'); return; }
    o.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', o.id);
    if (scroll) {
      if (i === 0) bodyEl.scrollTop = 0;
      else if (o.scrollIntoView) o.scrollIntoView({ block: 'nearest' });
    }
  }

  // ---------------------------------------------------------------- events inside the dialog
  function onInputKey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    var k = e.key, n;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      if (timer) update(false);
      n = opts.length;
      if (!n) return;
      e.preventDefault();
      if (active < 0) setActive(k === 'ArrowDown' ? 0 : n - 1, true);
      else setActive((active + (k === 'ArrowDown' ? 1 : n - 1)) % n, true);
    } else if (k === 'PageDown' || k === 'PageUp') {
      n = opts.length;
      if (!n) return;
      e.preventDefault();
      setActive(Math.max(0, Math.min(n - 1, (active < 0 ? 0 : active) + (k === 'PageDown' ? 5 : -5))), true);
    } else if (k === 'Enter') {
      if (timer) update(false);
      if (active >= 0 && opts[active]) { e.preventDefault(); opts[active].click(); }
    }
  }

  function focusables() {
    var all = panel.querySelectorAll('input, button, a[href], [tabindex]');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.tabIndex >= 0 && !el.disabled && el.getClientRects().length) out.push(el);
    }
    return out;
  }

  function onDialogKey(e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      closeSearch(true);
    } else if (e.key === 'Tab') {
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1], cur = doc.activeElement;
      if (e.shiftKey && (cur === first || !panel.contains(cur))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || !panel.contains(cur))) { e.preventDefault(); first.focus(); }
    }
  }

  function onBodyClick(e) {
    var t = e.target;
    var chip = t.closest && t.closest('.search-chip');
    if (chip) {
      input.value = chip.getAttribute('data-q');
      input.focus();
      update(false);
      return;
    }
    if (t.closest && t.closest('.search-retry')) { input.focus(); loadIndex(); return; }
    var a = t.closest && t.closest('a.sr-item');
    if (!a || e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;  // new tab or window
    var it = shown[+a.getAttribute('data-i')];
    if (!it) return;
    lastOpen = it.href;
    saveQuery();
    var probes = probesFor(it);
    if (samePage(it.p)) {
      e.preventDefault();
      closeSearch(false);
      jump(it.a, probes);
    } else {
      sset(KEY_LAND, JSON.stringify({ p: it.p, a: it.a, probes: probes, at: Date.now() }));
      // the browser follows the link
    }
  }

  function onListHover(e) {
    var key = e.clientX + ',' + e.clientY;   // ignore the synthetic moves some browsers fire on scroll
    if (key === ptr) return;
    ptr = key;
    var a = e.target.closest && e.target.closest('a.sr-item');
    if (a) {
      var i = +a.getAttribute('data-i');
      if (i !== active) setActive(i, false);
    }
  }

  // ---------------------------------------------------------------- landing on the passage
  // Links point at section anchors. After the jump, find the passage that matched inside the
  // section, open any folded <details> around it, scroll it into view and flash it.
  var BLOCKS = 'p, li, tr, blockquote, dd, dt, figcaption';

  function probesFor(it) {
    if (it.se < 0 || !current) return [];
    var f = IDX.ftext[it.se].replace(/\^/g, '').replace(/\s+/g, ' ');
    if (f.charAt(f.length - 1) === '\u2026') f = f.slice(0, -1);
    var out = [], pos = -1, j, p;
    for (j = 0; j < current.toks.length; j++) {
      p = firstAt(f, current.toks[j], 0);
      if (p !== -1 && (pos === -1 || p < pos)) pos = p;
    }
    function cut(from) { var s = f.slice(from, from + 48).trim(); return s.length >= 12 ? s : ''; }
    if (pos !== -1) out.push(cut(Math.max(0, pos - 20)));
    var dot = f.indexOf('. ');
    if (dot > 0 && dot < 60) out.push(cut(dot + 2));
    out.push(cut(0) || f.trim());
    return out.filter(function (s, i) { return s && out.indexOf(s) === i; });
  }

  function blockText(el) {
    var s;
    if (el.tagName === 'TR') {
      var parts = [];
      for (var i = 0; i < el.cells.length; i++) parts.push(el.cells[i].textContent);
      s = parts.join(' \u00b7 ');
    } else {
      s = el.textContent;
    }
    return fold(s).replace(/\s+/g, ' ');
  }

  function locate(anchor, probes) {
    var scope = doc.getElementById('main') || doc.body;
    var all = scope.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id], ' + BLOCKS);
    var from = 0, i, p, el;
    if (anchor !== scope) {
      from = -1;
      for (i = 0; i < all.length; i++) if (all[i] === anchor) { from = i + 1; break; }
      if (from < 0) return null;
    }
    for (p = 0; p < probes.length; p++) {
      for (i = from; i < all.length; i++) {
        el = all[i];
        if (/^H[1-6]$/.test(el.tagName)) break;                   // the next section starts here
        if (blockText(el).indexOf(probes[p]) !== -1) return deepest(el, probes[p]);
      }
    }
    return null;
  }
  function deepest(el, probe) {
    for (;;) {
      var inner = el.querySelectorAll(BLOCKS), next = null;
      for (var k = 0; k < inner.length; k++) if (blockText(inner[k]).indexOf(probe) !== -1) { next = inner[k]; break; }
      if (!next) return el;
      el = next;
    }
  }

  function openDetails(el) {
    for (var p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS' && !p.open) p.open = true;
  }

  // Height of the sticky bars at the top: the site header and, on narrow screens, the outline bar.
  function topChrome() {
    var y = 0, els = doc.querySelectorAll('.site-header, .toc');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], pos = getComputedStyle(el).position;
      if (pos !== 'sticky' && pos !== 'fixed') continue;
      var r = el.getBoundingClientRect();
      if (r.width < root.clientWidth * 0.6 || r.height > 200) continue;   // a side column, not a bar
      y = Math.max(y, el.classList.contains('toc') ? y + r.height : r.bottom);
    }
    return Math.max(0, y);
  }

  // Keep the section heading in view when the passage sits close below it; otherwise centre the passage.
  function scrollToBlock(el, anchor) {
    var vh = win.innerHeight || root.clientHeight;
    var top = topChrome();
    var room = vh - top;
    var r = el.getBoundingClientRect();
    if (r.top >= top && r.bottom <= vh) return;                     // already in view
    var a = anchor && anchor !== el ? anchor.getBoundingClientRect() : null;
    var y;
    if (a && r.bottom - a.top <= room - 24) y = a.top - top - 12;
    else if (r.height < room * 0.7) y = r.top - top - (room - r.height) / 2;
    else y = r.top - top - 16;
    if (Math.abs(y) > 1) win.scrollBy(0, y);
  }

  function flash(el) {
    el.classList.remove('search-landed');
    void el.offsetWidth;                                           // restart the animation
    el.classList.add('search-landed');
    setTimeout(function () { el.classList.remove('search-landed'); }, 2600);
  }

  function focusQuietly(el) {
    if (!el.hasAttribute('tabindex')) {
      el.setAttribute('tabindex', '-1');
      el.setAttribute('data-search-focus', '');
      el.addEventListener('blur', function off() {
        el.removeEventListener('blur', off);
        el.removeAttribute('data-search-focus');
        el.removeAttribute('tabindex');
      });
    }
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  function land(target, probes) {
    var el = target;
    if (probes && probes.length && /^(H[1-6]|MAIN)$/.test(target.tagName)) el = locate(target, probes) || target;
    openDetails(el);
    if (el !== target) {
      scrollToBlock(el, target);
      holdPlace(el, target);
    }
    flash(el);
    focusQuietly(el);
  }

  // site.js jumps back to the hash target when a late web font loads. Return to the passage after
  // such a jump until the reader scrolls, clicks or types.
  var held = null;
  function holdPlace(el, anchor) {
    var first = !held;
    held = { el: el, anchor: anchor };
    if (!first) return;
    var stop = function () { held = null; };
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (type) {
      win.addEventListener(type, stop, { passive: true, once: true });
    });
    var again = function () { if (held) scrollToBlock(held.el, held.anchor); };   // runs after site.js's listener
    if (doc.fonts && doc.fonts.addEventListener) doc.fonts.addEventListener('loadingdone', again);
    setTimeout(stop, 10000);
  }

  function jump(a, probes) {
    var target = doc.getElementById(a);
    if (!target) { location.hash = a; return; }
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      win.removeEventListener('hashchange', finish);
      land(target, probes);
    }
    if (location.hash !== '#' + a) {
      win.addEventListener('hashchange', finish);                  // runs after site.js reveals the target
      location.hash = a;
      setTimeout(finish, 150);
    } else {
      openDetails(target);
      target.scrollIntoView();
      finish();
    }
  }

  // After a jump from another page: land on the passage once layout has settled.
  function landFromStore() {
    var d = sjson(KEY_LAND);
    if (!d) return;
    sdel(KEY_LAND);
    var hash = '';
    try { hash = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
    if (!d.a || !samePage(d.p) || hash !== d.a || !(Date.now() - d.at < 30000)) return;
    function go() {
      var t = doc.getElementById(d.a);
      if (t) land(t, Array.isArray(d.probes) ? d.probes : []);
    }
    function settle() {
      var fonts = doc.fonts && doc.fonts.ready;
      var next = function () { (win.requestAnimationFrame || setTimeout)(go); };
      if (fonts && fonts.then) fonts.then(next, next); else next();
    }
    if (doc.readyState === 'complete') settle(); else win.addEventListener('load', settle);
  }

  // ---------------------------------------------------------------- global shortcuts
  function isTextField(el) {
    if (!el || el === doc.body || el === root) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !/^(button|checkbox|radio|submit|reset|range|color|file|image|hidden)$/i.test(el.type || '');
    var role = el.getAttribute && el.getAttribute('role');
    return role === 'textbox' || role === 'searchbox' || role === 'combobox';
  }

  doc.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.isComposing) return;
    var k = e.key;
    if ((k === 'k' || k === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      openSearch(isOpen ? null : doc.activeElement);
      return;
    }
    if (k === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var t = e.composedPath ? e.composedPath()[0] : e.target;
      if (isTextField(t) || isTextField(doc.activeElement)) return;
      e.preventDefault();
      openSearch(doc.activeElement);
    }
  });

  if (openBtn) {
    openBtn.setAttribute('aria-controls', 'search-dialog');
    openBtn.setAttribute('aria-keyshortcuts', '/ Control+K Meta+K');
    openBtn.addEventListener('click', function (e) {
      e.preventDefault();
      openSearch(openBtn);
    });
  }

  // A page restored from the back-forward cache can come back with the dialog open.
  win.addEventListener('pageshow', function (e) {
    if (e.persisted && isOpen && input) input.focus();
  });

  landFromStore();
})();
