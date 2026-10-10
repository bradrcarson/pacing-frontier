/* Pacing Frontier AI: timeline filter (timeline.html).
   The static page already lists every event. This script adds a sticky bar
   that filters the events by year and by text, keeps a live count, hides
   periods with no matching events and offers a jump list of periods.
   Nothing is stored and nothing goes into the URL. */
(function () {
  'use strict';

  var doc = document;
  var prose = doc.querySelector('.prose');
  if (!prose) return;
  // timeline.css holds the bar's place until this class is set
  function ready() { prose.classList.add('tlf-ready'); }
  if (!prose.querySelector('li.tl-event')) return ready();

  var YEARS = ['2023', '2024', '2025', '2026'];
  var TYPE_DELAY = 140;   // ms after the last keystroke before the list updates
  var SAY_DELAY = 700;    // ms before a new count is announced
  var canMark = !!(window.CSS && CSS.highlights && window.Highlight);

  /* ---------------------------------------------------------- text matching */
  // Case, accents and curly quotes are ignored; "quoted words" match as a phrase.
  function fold(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
      .replace(/[\u201c\u201d\u201f\u2033]/g, '"')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .toLowerCase();
  }
  function parse(q) {
    var out = [], m, re = /"([^"]*)"|(\S+)/g, s = fold(q);
    while ((m = re.exec(s))) {
      var t = (m[1] != null ? m[1] : m[2].replace(/"/g, '')).replace(/\s+/g, ' ').trim();
      if (t && out.indexOf(t) < 0) out.push(t);
    }
    return out;
  }
  function hits(text, terms) {
    for (var i = 0; i < terms.length; i++) if (text.indexOf(terms[i]) < 0) return false;
    return true;
  }
  // text of a line without its "Why it matters" or "Source" label
  function lineText(p) {
    if (!p) return '';
    var s = '';
    for (var n = p.firstChild; n; n = n.nextSibling) {
      if (!(n.nodeType === 1 && n.classList.contains('tl-label'))) s += n.textContent;
    }
    return s;
  }
  function hosts(el) {
    var s = '';
    el.querySelectorAll('a[href^="http"]').forEach(function (a) { s += ' ' + a.hostname.replace(/^www\./, ''); });
    return s;
  }

  /* ---------------------------------------------------------- read the page */
  var events = [];
  var byEl = new Map();
  prose.querySelectorAll('li.tl-event').forEach(function (li) {
    var date = li.querySelector('.tl-date');
    var text = [
      date ? date.textContent : '',
      lineText(li.querySelector('.tl-what')),
      lineText(li.querySelector('.tl-why')),
      lineText(li.querySelector('.tl-src')),
      hosts(li)
    ].join(' ');
    var ev = { el: li, year: li.getAttribute('data-year') || '', text: fold(text).replace(/\s+/g, ' '), on: true };
    events.push(ev);
    byEl.set(li, ev);
  });
  var TOTAL = events.length;

  // Periods: each H2 (years) and H3 (month ranges) heads a run of siblings:
  // event lists, and notes such as intros and "Not in the Table".
  var sections = [];
  var groups = [];
  prose.querySelectorAll('section.sec').forEach(function (sec) {
    if (!sec.querySelector(':scope > ol.tl')) return;
    var S = { el: sec, groups: [], total: 0 };
    var g = null;
    Array.prototype.forEach.call(sec.children, function (ch) {
      if (ch.tagName === 'H2' || ch.tagName === 'H3') {
        g = { head: ch, level: ch.tagName === 'H2' ? 2 : 3, label: ch.textContent.trim(), notes: [], lists: [], total: 0, shown: 0, section: S };
        ch.classList.add(g.level === 2 ? 'tl-year' : 'tl-range');
        S.groups.push(g);
        groups.push(g);
      } else if (g) {
        if (ch.matches('ol.tl')) {
          var list = { el: ch, events: [] };
          Array.prototype.forEach.call(ch.children, function (li) { var ev = byEl.get(li); if (ev) list.events.push(ev); });
          g.lists.push(list);
          g.total += list.events.length;
          S.total += list.events.length;
        } else g.notes.push(ch);
      }
    });
    if (S.groups.length) sections.push(S);
  });
  if (!sections.length) return ready();
  groups.forEach(function (g) {
    if (g.level === 2) g.total = g.section.total;
    var n = doc.createElement('span');
    n.className = 'tl-n';
    n.setAttribute('aria-hidden', 'true');
    g.head.appendChild(n);
    g.countEl = n;
  });

  // the outline beside the page, so hidden periods drop out of it too
  var tocItems = new Map();
  doc.querySelectorAll('.toc a[href^="#"]').forEach(function (a) {
    tocItems.set(decodeURIComponent(a.getAttribute('href').slice(1)), a.closest('li') || a);
  });

  /* ---------------------------------------------------------- build the bar */
  var ICON = '<svg class="tlf-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">'
    + '<circle cx="6.75" cy="6.75" r="4.75" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    + '<path d="M10.25 10.25 14.25 14.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  var sentinel = doc.createElement('div');
  sentinel.className = 'tlf-sentinel';
  sentinel.setAttribute('aria-hidden', 'true');

  var bar = doc.createElement('div');
  bar.className = 'tlf';
  bar.setAttribute('role', 'search');
  bar.setAttribute('aria-label', 'Filter the timeline');
  bar.innerHTML =
    '<div class="tlf-main">'
    + '<div class="tlf-field">'
    + '<label class="tlf-vh" for="tlf-q">Filter events by text</label>' + ICON
    + '<input id="tlf-q" class="tlf-input" type="search" placeholder="Filter events" autocomplete="off" spellcheck="false" enterkeyhint="search">'
    + '</div>'
    + '<button type="button" class="tlf-btn tlf-more" aria-expanded="false" aria-controls="tlf-panel">Filters <span class="tlf-more-n" aria-hidden="true" hidden></span></button>'
    + '<div class="tlf-panel" id="tlf-panel">'
    + '<div class="tlf-years" role="group" aria-labelledby="tlf-years-label">'
    + '<span id="tlf-years-label" class="tlf-label">Years</span>'
    + YEARS.map(function (y) {
      return '<button type="button" class="tlf-chip" aria-pressed="false" data-year="' + y + '">'
        + '<span class="tlf-chip-name">' + y + '</span><span class="tlf-chip-n" aria-hidden="true"></span></button>';
    }).join('')
    + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="tlf-meta">'
    + '<p class="tlf-count" aria-hidden="true"></p>'
    + '<button type="button" class="tlf-btn tlf-clear" hidden>Clear filters</button>'
    + '<div class="tlf-jump">'
    + '<button type="button" class="tlf-btn tlf-jump-btn" aria-expanded="false" aria-controls="tlf-periods">Periods</button>'
    + '<div class="tlf-jump-panel" id="tlf-periods" hidden><ul class="tlf-jump-list"></ul></div>'
    + '</div>'
    + '</div>';

  // The live region starts with text so nothing is announced on load.
  var status = doc.createElement('p');
  status.className = 'tlf-vh';
  status.setAttribute('role', 'status');
  status.textContent = countText(TOTAL);
  bar.appendChild(status);

  var empty = doc.createElement('div');
  empty.className = 'tlf-empty';
  empty.hidden = true;
  empty.innerHTML = '<p class="tlf-empty-title">No events match these filters.</p>'
    + '<p class="tlf-empty-hint">Try fewer words or a different year.</p>'
    + '<button type="button" class="tlf-btn tlf-clear">Clear filters</button>';

  var anchor = sections[0].el;
  prose.insertBefore(sentinel, anchor);
  prose.insertBefore(bar, anchor);
  prose.insertBefore(empty, anchor);
  ready();

  var input = bar.querySelector('.tlf-input');
  var chips = Array.prototype.slice.call(bar.querySelectorAll('.tlf-chip'));
  var countEl = bar.querySelector('.tlf-count');
  var clearBtn = bar.querySelector('.tlf-meta .tlf-clear');
  var moreBtn = bar.querySelector('.tlf-more');
  var moreN = bar.querySelector('.tlf-more-n');
  var panel = bar.querySelector('.tlf-panel');
  var jumpWrap = bar.querySelector('.tlf-jump');
  var jumpBtn = bar.querySelector('.tlf-jump-btn');
  var jumpPanel = bar.querySelector('.tlf-jump-panel');
  var jumpList = bar.querySelector('.tlf-jump-list');

  groups.forEach(function (g) {
    var li = doc.createElement('li');
    li.className = 'lvl-' + g.level;
    var a = doc.createElement('a');
    a.href = '#' + g.head.id;
    var label = doc.createElement('span');
    label.textContent = g.label;
    var n = doc.createElement('span');
    n.className = 'tlf-jn';
    n.setAttribute('aria-hidden', 'true');
    a.appendChild(label);
    a.appendChild(n);
    li.appendChild(a);
    jumpList.appendChild(li);
    g.jumpItem = li;
    g.jumpCount = n;
  });

  /* ---------------------------------------------------------- filtering */
  var picked = new Set();
  var typeTimer = 0, sayTimer = 0;

  function countText(n) { return 'Showing ' + n + ' of ' + TOTAL + ' events'; }
  function eventsWord(n) { return n === 1 ? 'event' : 'events'; }
  function setHidden(el, hide) { if (el.hidden !== hide) el.hidden = hide; }

  function apply(fromUser) {
    var terms = parse(input.value);
    var active = terms.length > 0 || picked.size > 0;
    var yearHits = {};
    YEARS.forEach(function (y) { yearHits[y] = 0; });
    var shown = 0;

    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var textOk = !terms.length || hits(ev.text, terms);
      if (textOk && ev.year in yearHits) yearHits[ev.year]++;
      var on = textOk && (!picked.size || picked.has(ev.year));
      if (on !== ev.on) { ev.on = on; ev.el.hidden = !on; }
      if (on) shown++;
    }

    sections.forEach(function (S) {
      var sShown = 0;
      S.groups.forEach(function (g) {
        g.shown = 0;
        g.lists.forEach(function (list) {
          var n = 0;
          for (var k = 0; k < list.events.length; k++) if (list.events[k].on) n++;
          setHidden(list.el, n === 0);
          g.shown += n;
        });
        sShown += g.shown;
      });
      S.groups.forEach(function (g) {
        var own = g.level === 2 ? sShown : g.shown;
        var gone = active && own === 0;
        setHidden(g.head, gone);
        // intros and notes return when the filters are cleared
        for (var k = 0; k < g.notes.length; k++) setHidden(g.notes[k], active);
        g.countEl.textContent = own === g.total ? g.total + ' ' + eventsWord(g.total)
          : own + ' of ' + g.total + ' ' + eventsWord(g.total);
        g.jumpCount.textContent = own === g.total ? String(g.total) : own + ' of ' + g.total;
        setHidden(g.jumpItem, gone);
        var t = tocItems.get(g.head.id);
        if (t) setHidden(t, gone);
      });
      setHidden(S.el, active && sShown === 0);
    });

    var first = null;
    sections.forEach(function (S) {
      if (!first && !S.el.hidden) first = S;
      S.el.classList.toggle('tl-first', first === S && S !== sections[0]);
    });

    chips.forEach(function (b) {
      var y = b.getAttribute('data-year');
      var n = yearHits[y];
      b.querySelector('.tlf-chip-n').textContent = n;
      b.setAttribute('aria-label', y + ', ' + n + ' ' + eventsWord(n));
      b.classList.toggle('is-zero', n === 0);
    });

    moreN.textContent = picked.size ? String(picked.size) : '';
    setHidden(moreN, !picked.size);
    moreBtn.setAttribute('aria-label', picked.size ? 'Filters, ' + picked.size + ' on' : 'Filters');

    countEl.innerHTML = 'Showing <span class="n">' + shown + '</span> of <span class="n">' + TOTAL + '</span> events';
    setHidden(clearBtn, !active);
    setHidden(empty, shown !== 0);
    mark(terms);

    if (fromUser) {
      settle();
      clearTimeout(sayTimer);
      sayTimer = setTimeout(function () { status.textContent = countText(shown); }, SAY_DELAY);
    }
  }

  // Highlight the matched words in the visible events.
  function mark(terms) {
    if (!canMark) return;
    if (!terms.length) { CSS.highlights.delete('tl-match'); return; }
    var hl = new Highlight();
    events.forEach(function (ev) {
      if (!ev.on) return;
      var walker = doc.createTreeWalker(ev.el, NodeFilter.SHOW_TEXT);
      for (var node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentNode.closest('.tl-label')) continue;
        var raw = node.data, low = fold(raw);
        if (low.length !== raw.length) low = raw.toLowerCase();
        if (low.length !== raw.length) continue;
        for (var t = 0; t < terms.length; t++) {
          var term = terms[t];
          for (var at = low.indexOf(term); at > -1; at = low.indexOf(term, at + term.length)) {
            var r = new Range();
            r.setStart(node, at);
            r.setEnd(node, at + term.length);
            hl.add(r);
          }
        }
      }
    });
    CSS.highlights.set('tl-match', hl);
  }

  /* ---------------------------------------------------------- sticking */
  // The bar sticks below whatever already sticks above the reading column
  // (the site header, and on phones the outline bar). Once stuck it may fold
  // to a compact form; its footprint in the page stays the same, so the
  // content never jumps.
  var header = doc.querySelector('.site-header');
  var outline = doc.querySelector('.toc');
  var stackH = 0, restH = 0, compactH = 0, stuck = false, panelOpen = false;

  function stackHeight() {
    var r = bar.getBoundingClientRect(), h = 0;
    [header, outline].forEach(function (el) {
      if (!el) return;
      var cs = getComputedStyle(el);
      if ((cs.position !== 'sticky' && cs.position !== 'fixed') || cs.display === 'none') return;
      var er = el.getBoundingClientRect();
      if (er.right <= r.left || er.left >= r.right) return;     // beside the bar, not above it
      if (er.height > window.innerHeight * 0.4) return;           // a side outline or an open drawer
      var top = parseFloat(cs.top);
      h = Math.max(h, Math.round((isNaN(top) ? 0 : top) + er.height));
    });
    return h;
  }
  function setClasses() {
    bar.classList.toggle('is-stuck', stuck);
    panel.classList.toggle('is-open', panelOpen);
    moreBtn.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
  }
  function compensate() {
    bar.style.marginBottom = '';
    if (!stuck) return;
    var base = parseFloat(getComputedStyle(bar).marginBottom) || 0;
    var diff = restH - bar.offsetHeight;
    if (diff) bar.style.marginBottom = (base + diff) + 'px';
  }
  function measure() {
    stackH = stackHeight();
    bar.style.setProperty('--tlf-top', stackH + 'px');
    var s = stuck, o = panelOpen;
    stuck = false; panelOpen = false; setClasses();
    restH = bar.offsetHeight;
    stuck = true; setClasses();
    compactH = bar.offsetHeight;
    stuck = s; panelOpen = o; setClasses();
    compensate();
    // anchors and focus land below the header and the folded bar
    doc.documentElement.style.setProperty('scroll-padding-top',
      'calc(env(safe-area-inset-top, 0px) + ' + (stackH + compactH + 12) + 'px)');
    checkStuck();
  }
  function checkStuck() {
    var s = sentinel.getBoundingClientRect().top < stackH + 1;
    if (s === stuck) return;
    stuck = s;
    // keep the folded controls open while focus is inside them
    panelOpen = s && panel.contains(doc.activeElement);
    setClasses();
    compensate();
  }
  // After a change, start the results just under the bar if the reader had scrolled past it.
  function settle() {
    var y = Math.round(sentinel.getBoundingClientRect().top + window.pageYOffset - stackH);
    if (window.pageYOffset > y + 1) {
      try { window.scrollTo({ top: y, behavior: 'instant' }); } catch (e) { window.scrollTo(0, y); }
    }
  }

  /* ---------------------------------------------------------- wiring */
  input.addEventListener('input', function () {
    clearTimeout(typeTimer);
    typeTimer = setTimeout(function () { apply(true); }, TYPE_DELAY);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { clearTimeout(typeTimer); apply(true); }
    else if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      input.value = '';
      clearTimeout(typeTimer);
      apply(true);
    }
  });
  chips.forEach(function (b) {
    b.addEventListener('click', function () {
      var y = b.getAttribute('data-year');
      if (picked.has(y)) picked.delete(y); else picked.add(y);
      b.setAttribute('aria-pressed', picked.has(y) ? 'true' : 'false');
      apply(true);
    });
  });
  moreBtn.addEventListener('click', function () {
    panelOpen = !panelOpen;
    setClasses();
    compensate();
  });
  // Escape folds the panel again and returns to its button
  panel.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panelOpen && moreBtn.offsetParent !== null) {
      e.preventDefault();
      panelOpen = false;
      setClasses();
      compensate();
      moreBtn.focus();
    }
  });
  function clearAll(focusInput) {
    clearTimeout(typeTimer);
    input.value = '';
    picked.clear();
    chips.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    apply(true);
    if (focusInput) input.focus();
  }
  clearBtn.addEventListener('click', function () { clearAll(true); });
  empty.querySelector('.tlf-clear').addEventListener('click', function () { clearAll(true); });

  function setJump(open) {
    jumpPanel.hidden = !open;
    jumpBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  jumpBtn.addEventListener('click', function () { setJump(jumpPanel.hidden); });
  jumpPanel.addEventListener('click', function (e) { if (e.target.closest('a')) setJump(false); });
  jumpWrap.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !jumpPanel.hidden) { e.preventDefault(); setJump(false); jumpBtn.focus(); }
  });
  jumpWrap.addEventListener('focusout', function (e) {
    if (!jumpPanel.hidden && e.relatedTarget && !jumpWrap.contains(e.relatedTarget)) setJump(false);
  });
  doc.addEventListener('click', function (e) {
    if (!jumpPanel.hidden && !jumpWrap.contains(e.target)) setJump(false);
  });

  // A link to an event or period that the filters hide clears the filters first.
  window.addEventListener('hashchange', function () {
    var id = decodeURIComponent((location.hash || '').slice(1));
    var el = id && doc.getElementById(id);
    if (el && prose.contains(el) && el.closest('[hidden]')) { clearAll(false); el.scrollIntoView(); }
  });

  // run fn at most once per frame
  function perFrame(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; fn(); });
    };
  }
  var onScroll = perFrame(checkStuck);
  var onResize = perFrame(measure);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(onResize);
    if (header) ro.observe(header);
    if (outline) ro.observe(outline);
    // the bar's own size changes with its counts; keep its footprint steady
    new ResizeObserver(function () {
      if (!stuck) restH = bar.offsetHeight;
      compensate();
    }).observe(bar);
  }

  apply(false);
  measure();
  // The bar now sits above the content; bring a linked event back into view.
  var start = decodeURIComponent((location.hash || '').slice(1));
  var target = start && doc.getElementById(start);
  if (target && prose.contains(target)) target.scrollIntoView();
})();
