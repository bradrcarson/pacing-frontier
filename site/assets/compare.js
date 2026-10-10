/* Pacing Frontier AI: the comparison matrix (compare.html).
   Progressive enhancement over the static table#matrix: a filter panel with live
   counts, sortable columns, an empty state, a stacked view on narrow screens and a
   highlighted #hash row. Without this script the full table still reads and scrolls. */
(function () {
  'use strict';

  var table = document.getElementById('matrix');
  if (!table || !table.tHead || !table.tBodies.length || !table.tHead.rows.length) return;
  var tbody = table.tBodies[0];
  var wrap = table.parentElement;
  var section = wrap.parentElement;
  var headCells = Array.prototype.slice.call(table.tHead.rows[0].cells);
  var headText = headCells.map(function (th) { return th.textContent.replace(/\s+/g, ' ').trim(); });
  var STORE_KEY = 'pfai-compare-v1';

  // ---------------------------------------------------------------- helpers
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  // case and quote folding that keeps string length, so match offsets stay valid
  function fold(s) { return String(s).toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"'); }
  function squash(s) { return fold(s).replace(/\s+/g, ' ').trim(); }
  function findCol(re, fallback) {
    for (var i = 0; i < headText.length; i++) if (re.test(headText[i])) return i;
    return fallback;
  }
  // word-by-word order ("A Narrow Path" before "AI 2040 Plan"); leading quotes are skipped
  var collator = (window.Intl && Intl.Collator) ? new Intl.Collator('en', { sensitivity: 'base', numeric: true }) : null;
  function sortText(s) { return s.replace(/^[^0-9A-Za-z\u00c0-\u024f]+/, ''); }
  function cmpText(a, b) { return collator ? collator.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0); }

  // ---------------------------------------------------------------- facets
  // Option order doubles as sort order: ascending means more of the column's quantity
  // (more development, more need for China); the deployment column sorts by its text.
  var COL = { family: 0, name: 1, china: findCol(/china/i, 3), dev: findCol(/development/i, 4), deploy: findCol(/deployment/i, 5) };
  var FACETS = [
    { key: 'family', col: COL.family, label: 'Family', order: ['stop', 'pace', 'contain', 'continue'], names: {} },
    { key: 'china', col: COL.china, label: 'Needs China', order: ['no', 'partly', 'yes', 'not'],
      names: { yes: 'Yes', partly: 'Partly', no: 'No', not: 'Not specified' } },
    { key: 'dev', col: COL.dev, label: 'U.S. frontier development', order: ['stops', 'slows', 'continues'],
      names: { stops: 'Stops', slows: 'Slows', continues: 'Continues' } },
    { key: 'deploy', col: COL.deploy, label: 'Public deployment', order: ['continues', 'unaffected', 'unrestricted', 'gated', 'not'],
      names: { continues: 'Continues', unaffected: 'Unaffected', unrestricted: 'Unrestricted', gated: 'Gated', not: 'Not addressed' } },
  ];
  var FAM = FACETS[0];

  // ---------------------------------------------------------------- row model
  var rows = Array.prototype.slice.call(tbody.rows).map(function (tr, index) {
    var cells = Array.prototype.slice.call(tr.cells);
    var raw = {};
    FACETS.forEach(function (f) { raw[f.key] = (tr.getAttribute('data-' + f.key) || '').trim(); });
    return {
      el: tr, index: index, cells: cells, raw: raw, g: {},
      cellText: cells.map(function (c) { return c.textContent.replace(/\s+/g, ' ').trim(); }),
      text: squash(cells.map(function (c) { return c.textContent; }).join(' ')),
    };
  });
  if (!rows.length) return;
  var total = rows.length;

  // family names come from the chips the build wrote; unknown families keep their own group
  rows.forEach(function (r) {
    var v = r.raw.family || 'other';
    var chip = r.el.querySelector('.fam-chip');
    if (!FAM.names[v]) FAM.names[v] = chip ? chip.textContent.trim() : v;
    if (FAM.order.indexOf(v) < 0) FAM.order.push(v);
    r.g.family = v;
  });
  // the other facets group known first words; rare ones fall under "Other"
  FACETS.slice(1).forEach(function (f) {
    rows.forEach(function (r) { r.g[f.key] = f.order.indexOf(r.raw[f.key]) >= 0 ? r.raw[f.key] : 'other'; });
    // a group whose cells all read the same uses that wording as its label
    f.order.forEach(function (v) {
      var texts = rows.filter(function (r) { return r.g[f.key] === v; }).map(function (r) { return r.cellText[f.col]; });
      if (texts.length && texts.every(function (t) { return t === texts[0]; }) && texts[0].length <= 24) f.names[v] = texts[0];
    });
    f.names.other = 'Other';
  });
  FACETS.forEach(function (f) {
    f.options = f.order.concat(['other']).filter(function (v, i, a) {
      return a.indexOf(v) === i && rows.some(function (r) { return r.g[f.key] === v; });
    });
  });

  // sort keys: categorical columns sort by their order above, the rest by text
  function rankIn(order, v) { var i = order.indexOf(v); return i < 0 ? order.length : i; }
  rows.forEach(function (r) {
    r.keys = r.cellText.map(function (t, col) {
      for (var k = 0; k < FACETS.length; k++) {
        var f = FACETS[k];
        if (f.col === col && f.key !== 'deploy') return rankIn(f.options, r.g[f.key]);
      }
      return sortText(t);
    });
  });

  // ---------------------------------------------------------------- state
  var sel = {};
  FACETS.forEach(function (f) { sel[f.key] = []; });
  var query = '';
  var terms = [];
  var sort = { col: -1, dir: 1 };

  function isOn(key, v) { return sel[key].indexOf(v) >= 0; }
  function anyFilter() { return !!terms.length || FACETS.some(function (f) { return sel[f.key].length > 0; }); }
  function rowMatches(r, skipKey) {
    for (var k = 0; k < FACETS.length; k++) {
      var f = FACETS[k];
      if (f.key === skipKey || !sel[f.key].length) continue;
      if (sel[f.key].indexOf(r.g[f.key]) < 0) return false;
    }
    for (var t = 0; t < terms.length; t++) if (r.text.indexOf(terms[t]) < 0) return false;
    return true;
  }

  // ---------------------------------------------------------------- build the panel
  var uid = 'm-' + Math.random().toString(36).slice(2, 7);
  var input = h('input', {
    id: uid + '-q', class: 'm-search-input', type: 'search', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'For example: liability', 'aria-describedby': uid + '-count',
  });
  var chipInputs = [];
  var chipEls = {};

  // On narrow screens the facet rows fold behind this button; wide screens never show it.
  var moreN = h('span', { class: 'm-more-n' });
  var moreBtn = h('button', { type: 'button', class: 'm-more', 'aria-expanded': 'false', 'aria-controls': uid + '-facets' }, [
    h('span', { class: 'm-more-icon', 'aria-hidden': 'true' }),
    h('span', { text: 'Filters' }),
    moreN,
  ]);
  var facetsEl = h('div', { class: 'm-facets', id: uid + '-facets' });

  var rowsEls = [h('div', { class: 'm-row m-row-search' }, [
    h('label', { class: 'm-label', for: uid + '-q', text: 'Filter by text' }),
    h('div', { class: 'm-search-line' }, [input, moreBtn]),
  ]), facetsEl];

  FACETS.forEach(function (f) {
    var labelId = uid + '-' + f.key;
    var chips = h('div', { class: 'm-chips' });
    chipEls[f.key] = {};
    f.options.forEach(function (v) {
      var cb = h('input', { type: 'checkbox', value: v, 'data-facet': f.key });
      var n = h('span', { class: 'm-n', text: '0' });
      // family toggles show the site's signal mark for their family; the rest are plain
      var label = h('label', { class: 'm-chip' }, [
        cb,
        h('span', { class: 'm-face' }, [
          f.key === 'family' ? h('span', { class: 'm-mark', 'aria-hidden': 'true' }) : null,
          h('span', { class: 'm-chip-text', text: f.names[v] || v }),
          n,
        ]),
      ]);
      if (f.key === 'family') label.setAttribute('data-family', v);
      chipInputs.push(cb);
      chipEls[f.key][v] = { label: label, input: cb, n: n };
      chips.appendChild(label);
    });
    facetsEl.appendChild(h('div', { class: 'm-row', role: 'group', 'aria-labelledby': labelId }, [
      h('span', { class: 'm-label', id: labelId, text: f.label }),
      chips,
    ]));
  });

  var countEl = h('p', { class: 'm-count', id: uid + '-count' });
  var clearBtn = h('button', { type: 'button', class: 'm-clear', text: 'Clear filters' });
  var live = h('p', { class: 'm-sr', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  rowsEls.push(h('div', { class: 'm-bar' }, [countEl, clearBtn]));
  rowsEls.push(live);

  var form = h('form', { class: 'm-tools', 'aria-label': 'Filter the matrix', novalidate: '' }, rowsEls);
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  var emptyClear = h('button', { type: 'button', class: 'm-clear', text: 'Clear filters' });
  var empty = h('div', { class: 'm-empty', hidden: '' }, [
    h('p', { class: 'm-empty-title', text: 'No proposals match these filters.' }),
    h('p', { class: 'm-empty-hint', text: 'Remove a filter or clear them all.' }),
    emptyClear,
  ]);

  section.insertBefore(form, wrap);
  wrap.parentNode.insertBefore(empty, wrap.nextSibling);
  section.classList.add('m-enhanced');

  // ---------------------------------------------------------------- table semantics and labels
  // Explicit roles keep the table readable to screen readers when the narrow view restyles it.
  var title = document.querySelector('.page-title');
  if (title && !table.hasAttribute('aria-label')) table.setAttribute('aria-label', title.textContent.trim());
  table.setAttribute('role', 'table');
  table.tHead.setAttribute('role', 'rowgroup');
  tbody.setAttribute('role', 'rowgroup');
  table.tHead.rows[0].setAttribute('role', 'row');
  rows.forEach(function (r) {
    r.el.setAttribute('role', 'row');
    r.cells.forEach(function (c, i) {
      c.setAttribute('role', c.tagName === 'TH' ? 'rowheader' : 'cell');
      if (c.tagName === 'TD' && i > 0) {
        c.setAttribute('data-label', headText[i] || '');
        // wrap the cell content so the narrow view can lay label and value side by side
        var v = h('span', { class: 'm-v' });
        while (c.firstChild) v.appendChild(c.firstChild);
        c.appendChild(v);
      }
    });
  });

  // ---------------------------------------------------------------- sort buttons
  var SVGNS = 'http://www.w3.org/2000/svg';
  function sortIcon() {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'm-sort-icon');
    svg.setAttribute('viewBox', '0 0 9 13');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    [['m-up', 'M4.5 0 9 5.2H0Z'], ['m-down', 'M4.5 13 0 7.8h9Z']].forEach(function (p) {
      var path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('class', p[0]);
      path.setAttribute('d', p[1]);
      path.setAttribute('fill', 'currentColor');
      svg.appendChild(path);
    });
    return svg;
  }
  headCells.forEach(function (th, i) {
    th.setAttribute('role', 'columnheader');
    var label = h('span', { class: 'm-sort-label' });
    while (th.firstChild) label.appendChild(th.firstChild);
    var btn = h('button', { type: 'button', class: 'm-sort' }, [label]);
    btn.appendChild(sortIcon());
    th.appendChild(btn);
    btn.addEventListener('click', function () { cycleSort(i); });
  });

  function cycleSort(i) {
    if (sort.col !== i) sort = { col: i, dir: 1 };
    else if (sort.dir === 1) sort = { col: i, dir: -1 };
    else sort = { col: -1, dir: 1 };
    applySort();
    save();
    var how = sort.col < 0 ? 'Sorted in document order.' : 'Sorted by ' + headText[i] + ', ' + (sort.dir > 0 ? 'ascending.' : 'descending.');
    say(countText() + ' ' + how, 60);
  }

  function applySort() {
    var order = rows.slice();
    if (sort.col >= 0) {
      var c = sort.col, d = sort.dir;
      order.sort(function (a, b) {
        var ka = a.keys[c], kb = b.keys[c];
        var v = typeof ka === 'number' ? ka - kb : cmpText(ka, kb);
        return v ? v * d : a.index - b.index;
      });
    }
    var frag = document.createDocumentFragment();
    order.forEach(function (r) { frag.appendChild(r.el); });
    tbody.appendChild(frag);
    headCells.forEach(function (th, i) {
      if (i === sort.col) th.setAttribute('aria-sort', sort.dir > 0 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
    markGroups();
  }

  // a heavier rule where one family gives way to the next, when families sit together;
  // the last visible row drops its bottom rule so it never doubles the frame
  function markGroups() {
    var grouped = sort.col < 0 || sort.col === COL.family;
    var prev = null;
    var last = null;
    Array.prototype.forEach.call(tbody.rows, function (tr) {
      var start = false;
      if (!tr.hidden) {
        var fam = tr.getAttribute('data-family');
        start = grouped && prev !== null && fam !== prev;
        prev = fam;
        last = tr;
      }
      tr.classList.toggle('m-famstart', start);
      tr.classList.remove('m-lastvis');
    });
    if (last) last.classList.add('m-lastvis');
  }

  // ---------------------------------------------------------------- render
  var shown = total;
  function countText() {
    return shown === total ? 'Showing all ' + total + ' proposals.' : 'Showing ' + shown + ' of ' + total + ' proposals.';
  }
  function renderCount() {
    countEl.textContent = '';
    if (shown === total) {
      countEl.appendChild(document.createTextNode('Showing all '));
      countEl.appendChild(h('span', { class: 'm-num', text: String(total) }));
      countEl.appendChild(document.createTextNode(' proposals'));
    } else {
      countEl.appendChild(document.createTextNode('Showing '));
      countEl.appendChild(h('span', { class: 'm-num', text: String(shown) }));
      countEl.appendChild(document.createTextNode(' of '));
      countEl.appendChild(h('span', { class: 'm-num', text: String(total) }));
      countEl.appendChild(document.createTextNode(' proposals'));
    }
  }
  var sayTimer = 0;
  function say(text, delay) {
    clearTimeout(sayTimer);
    sayTimer = setTimeout(function () { live.textContent = text; }, delay);
  }

  function update(announceDelay) {
    shown = 0;
    rows.forEach(function (r) {
      var ok = rowMatches(r, null);
      r.el.hidden = !ok;
      if (ok) shown++;
    });
    // each option counts the rows it would show, given every other filter
    FACETS.forEach(function (f) {
      f.options.forEach(function (v) {
        var n = 0;
        rows.forEach(function (r) { if (r.g[f.key] === v && rowMatches(r, f.key)) n++; });
        var c = chipEls[f.key][v];
        c.n.textContent = String(n);
        c.label.classList.toggle('is-zero', n === 0);
        c.input.checked = isOn(f.key, v);
      });
    });
    renderCount();
    var picked = FACETS.reduce(function (n, f) { return n + sel[f.key].length; }, 0);
    moreN.textContent = picked ? picked + ' selected' : '';
    clearBtn.setAttribute('aria-disabled', anyFilter() ? 'false' : 'true');
    wrap.hidden = shown === 0;
    empty.hidden = shown !== 0;
    markGroups();
    paintMatches();
    measureFit();
    if (announceDelay !== false) say(countText(), announceDelay || 60);
  }

  // ---------------------------------------------------------------- match highlighting (where supported)
  var canPaint = typeof window.Highlight === 'function' && window.CSS && CSS.highlights;
  function paintMatches() {
    if (!canPaint) return;
    CSS.highlights.delete('m-match');
    if (!terms.length) return;
    var ranges = [];
    rows.forEach(function (r) {
      if (r.el.hidden) return;
      var walker = document.createTreeWalker(r.el, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        var raw = node.nodeValue;
        var low = fold(raw);
        if (low.length !== raw.length) continue;
        terms.forEach(function (t) {
          var at = low.indexOf(t);
          while (at >= 0) {
            var range = new Range();
            range.setStart(node, at);
            range.setEnd(node, at + t.length);
            ranges.push(range);
            at = low.indexOf(t, at + t.length);
          }
        });
      }
    });
    if (ranges.length) {
      var hl = new Highlight();
      ranges.forEach(function (rg) { hl.add(rg); });
      CSS.highlights.set('m-match', hl);
    }
  }

  // ---------------------------------------------------------------- sticky header support
  var siteHeader = document.querySelector('.site-header');
  function measureTop() {
    var top = 0;
    if (siteHeader) {
      var pos = getComputedStyle(siteHeader).position;
      if (pos === 'sticky' || pos === 'fixed') top = Math.ceil(siteHeader.getBoundingClientRect().height);
    }
    section.style.setProperty('--m-top', top + 'px');
    measureJump();
  }
  // the header row may stick only when the table needs no sideways scroll
  function measureFit() {
    if (wrap.hidden) return;
    wrap.classList.remove('is-fit');
    var fits = wrap.scrollWidth <= wrap.clientWidth + 1;
    wrap.classList.toggle('is-fit', fits);
    measureJump();
  }
  // A #hash row should land below the site header and any sticky header row.
  // The page's own scroll padding already covers part of that; add only the rest.
  function measureJump() {
    var pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    var top = parseFloat(section.style.getPropertyValue('--m-top')) || 0;
    var th = headCells[0];
    var stuck = wrap.classList.contains('is-fit') && getComputedStyle(th).position === 'sticky';
    var need = top + (stuck ? table.tHead.getBoundingClientRect().height : 0) + 12;
    section.style.setProperty('--m-jump', Math.max(0, Math.round(need - pad)) + 'px');
  }
  // Watch the filter panel: it tracks the section's width, and its height never depends on the fit.
  var lastWidth = -1;
  if (window.ResizeObserver) {
    new ResizeObserver(function (entries) {
      var w = Math.round(entries[0].contentRect.width);
      if (w === lastWidth) return;
      lastWidth = w;
      measureFit();
    }).observe(form);
    if (siteHeader) new ResizeObserver(measureTop).observe(siteHeader);
  } else {
    window.addEventListener('resize', function () { measureTop(); measureFit(); });
  }

  // ---------------------------------------------------------------- events
  form.addEventListener('change', function (e) {
    var cb = e.target;
    if (!cb || cb.type !== 'checkbox') return;
    var key = cb.getAttribute('data-facet');
    var list = sel[key];
    var at = list.indexOf(cb.value);
    if (cb.checked && at < 0) list.push(cb.value);
    if (!cb.checked && at >= 0) list.splice(at, 1);
    update(60);
    save();
  });
  input.addEventListener('input', function () {
    query = input.value.slice(0, 200);
    terms = squash(query).split(' ').filter(Boolean);
    update(700);
    save();
  });
  function clearFilters() {
    FACETS.forEach(function (f) { sel[f.key] = []; });
    query = '';
    terms = [];
    input.value = '';
  }
  clearBtn.addEventListener('click', function () {
    if (clearBtn.getAttribute('aria-disabled') === 'true') return;
    clearFilters();
    update(60);
    save();
  });
  emptyClear.addEventListener('click', function () {
    clearFilters();
    update(60);
    save();
    input.focus();
  });
  var facetsOpen = false;
  function setOpen(open) {
    facetsOpen = open;
    form.classList.toggle('is-open', open);
    moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  moreBtn.addEventListener('click', function () { setOpen(!facetsOpen); save(); });

  // ---------------------------------------------------------------- remembered state (this tab only)
  function save() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ sel: sel, q: query, sort: sort, open: facetsOpen }));
    } catch (e) { /* storage unavailable: the page works without it */ }
  }
  function restore() {
    var data = null;
    try { data = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null'); } catch (e) { data = null; }
    if (!data || typeof data !== 'object') return;
    FACETS.forEach(function (f) {
      var list = data.sel && Array.isArray(data.sel[f.key]) ? data.sel[f.key] : [];
      sel[f.key] = list.filter(function (v) { return f.options.indexOf(v) >= 0; });
    });
    if (typeof data.q === 'string') {
      query = data.q.slice(0, 200);
      input.value = query;
      terms = squash(query).split(' ').filter(Boolean);
    }
    var s = data.sort;
    if (s && typeof s.col === 'number' && s.col >= -1 && s.col < headCells.length && (s.dir === 1 || s.dir === -1)) sort = { col: s.col, dir: s.dir };
    if (data.open === true) setOpen(true);
  }

  // ---------------------------------------------------------------- #hash rows
  function targetRow() {
    var id = '';
    try { id = decodeURIComponent((location.hash || '').slice(1)); } catch (e) { return null; }
    var tr = id ? document.getElementById(id) : null;
    return tr && tr.parentNode === tbody ? tr : null;
  }
  function revealTarget() {
    var tr = targetRow();
    if (!tr) return;
    if (tr.hidden) { clearFilters(); update(60); save(); }
    tr.scrollIntoView({ block: 'start' });
  }
  window.addEventListener('hashchange', revealTarget);

  // ---------------------------------------------------------------- start
  restore();
  measureTop();
  applySort();
  update(false);
  if (targetRow()) revealTarget();
})();
