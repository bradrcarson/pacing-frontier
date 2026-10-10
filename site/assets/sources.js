/* Pacing Frontier AI: bibliography filter (sources.html).
   The static page already lists every source. This script adds a sticky bar
   with a text filter, reading-tag filters with counts, a topic selector built
   from the H2 sections and a live count. Headings with no matching entries
   hide, and section notes return when the filters are cleared.
   Nothing is stored and nothing goes into the URL. */
(function () {
  'use strict';

  var doc = document;
  var prose = doc.querySelector('.prose');
  if (!prose) return;
  // sources.css holds the bar's place until this class is set
  function ready() { prose.classList.add('srcf-ready'); }
  if (!prose.querySelector('li.src')) return ready();

  var TAGS = [
    ['opened', 'Opened'], ['listed', 'Listed'], ['paper-ref', 'Paper ref'],
    ['not-opened', 'Not opened'], ['blocked', 'Blocked'], ['failed', 'Failed']
  ];
  var TYPE_DELAY = 160;   // ms after the last keystroke before the list updates
  var SAY_DELAY = 700;    // ms before a new count is announced
  var MARK_LIMIT = 800;   // highlight matched words only when fewer entries show
  var canMark = !!(window.CSS && CSS.highlights && window.Highlight);
  function fmt(n) { return n.toLocaleString('en-US'); }

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
  function hosts(el) {
    var s = '';
    el.querySelectorAll('a[href^="http"]').forEach(function (a) { s += ' ' + a.hostname.replace(/^www\./, ''); });
    return s;
  }
  function leadsWithLink(li) {
    for (var n = li.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { if (n.data.trim()) return false; continue; }
      return n.nodeType === 1 && n.tagName === 'A';
    }
    return false;
  }

  /* ---------------------------------------------------------- read the page */
  // Sections are "other" (the reading guide), "core" (the Core Reading List)
  // or "topic" (each section that holds tagged entries). Each H2 and H3 heads
  // a run of siblings: entry lists, and notes (paragraphs, tables, checklists).
  var sections = [], topics = [], entries = [], groups = [];
  var TOTAL = 0;
  Array.prototype.forEach.call(prose.children, function (sec) {
    if (!sec.matches('section.sec')) return;
    var h2 = sec.querySelector(':scope > h2');
    if (!h2) return;
    var kind = h2.id === 'core-reading-list' ? 'core' : sec.querySelector('li.src') ? 'topic' : 'other';
    var S = { el: sec, h2: h2, kind: kind, label: h2.textContent.trim(), groups: [], topic: -1, total: 0 };
    if (kind === 'topic') { S.topic = topics.length; topics.push(S); }
    sections.push(S);
    if (kind === 'other') return;
    var g = null;
    Array.prototype.forEach.call(sec.children, function (ch) {
      if (ch.tagName === 'H2' || ch.tagName === 'H3') {
        g = { head: ch, level: ch.tagName === 'H2' ? 2 : 3, notes: [], lists: [], total: 0, shown: 0, section: S };
        S.groups.push(g);
        groups.push(g);
        return;
      }
      if (!g) return;
      if (ch.tagName === 'UL' && ch.querySelector(':scope > li')) {
        var list = { el: ch, entries: [] };
        Array.prototype.forEach.call(ch.children, function (li) {
          if (li.tagName !== 'LI') return;
          var e = {
            el: li,
            tag: li.getAttribute('data-tag') || '',
            src: li.classList.contains('src'),
            topic: S.topic,
            text: fold(li.textContent + hosts(li)).replace(/\s+/g, ' '),
            on: true
          };
          if (e.src) TOTAL++;
          if (!leadsWithLink(li)) li.classList.add('src-plain');
          list.entries.push(e);
          entries.push(e);
        });
        g.lists.push(list);
        g.total += list.entries.length;
        S.total += list.entries.length;
      } else g.notes.push(ch);
    });
  });
  if (!entries.length || !topics.length) return ready();
  sections.forEach(function (S) {
    S.notesCount = S.groups.reduce(function (n, g) { return n + g.notes.length; }, 0);
  });

  // counts beside headings that hold entries, shown while a filter is on
  groups.forEach(function (g) {
    if (g.level === 2) g.total = g.section.total;
    if (!g.total) return;
    var n = doc.createElement('span');
    n.className = 'srcf-n';
    n.setAttribute('aria-hidden', 'true');
    n.hidden = true;
    g.head.appendChild(n);
    g.countEl = n;
  });

  // the outline beside the page, so hidden sections drop out of it too
  var tocItems = new Map();
  doc.querySelectorAll('.toc a[href^="#"]').forEach(function (a) {
    tocItems.set(decodeURIComponent(a.getAttribute('href').slice(1)), a.closest('li') || a);
  });

  /* ---------------------------------------------------------- build the bar */
  var ICON = '<svg class="srcf-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">'
    + '<circle cx="6.75" cy="6.75" r="4.75" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    + '<path d="M10.25 10.25 14.25 14.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  var sentinel = doc.createElement('div');
  sentinel.className = 'srcf-sentinel';
  sentinel.setAttribute('aria-hidden', 'true');

  var bar = doc.createElement('div');
  bar.className = 'srcf';
  bar.setAttribute('role', 'search');
  bar.setAttribute('aria-label', 'Filter the bibliography');
  bar.innerHTML =
    '<div class="srcf-main">'
    + '<div class="srcf-field">'
    + '<label class="srcf-vh" for="srcf-q">Filter sources by text</label>' + ICON
    + '<input id="srcf-q" class="srcf-input" type="search" placeholder="Filter by title, author or site" autocomplete="off" spellcheck="false" enterkeyhint="search">'
    + '</div>'
    + '<button type="button" class="srcf-btn srcf-more" aria-expanded="false" aria-controls="srcf-panel">Filters <span class="srcf-more-n" aria-hidden="true" hidden></span></button>'
    + '<div class="srcf-panel" id="srcf-panel">'
    + '<div class="srcf-topic">'
    + '<label class="srcf-label" for="srcf-topic">Topic</label>'
    + '<span class="srcf-selectwrap"><select id="srcf-topic" class="srcf-select"><option value="">All topics</option></select></span>'
    + '</div>'
    + '<div class="srcf-tags" role="group" aria-labelledby="srcf-tags-label">'
    + '<span class="srcf-label" id="srcf-tags-label">Reading tag</span>'
    + TAGS.map(function (t) {
      return '<button type="button" class="srcf-chip" aria-pressed="false" data-tag="' + t[0] + '">'
        + '<span class="srcf-mk" data-tag="' + t[0] + '" aria-hidden="true"></span>'
        + '<span class="srcf-chip-name">' + t[1] + '</span><span class="srcf-chip-n" aria-hidden="true"></span></button>';
    }).join('')
    + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="srcf-meta">'
    + '<p class="srcf-count" aria-hidden="true"></p>'
    + '<button type="button" class="srcf-btn srcf-clear" hidden>Clear filters</button>'
    + '</div>';

  // The live region starts with text so nothing is announced on load.
  var status = doc.createElement('p');
  status.className = 'srcf-vh';
  status.setAttribute('role', 'status');
  status.textContent = countText(TOTAL);
  bar.appendChild(status);

  var empty = doc.createElement('div');
  empty.className = 'srcf-empty';
  empty.hidden = true;
  empty.innerHTML = '<p class="srcf-empty-title">No sources match these filters.</p>'
    + '<p class="srcf-empty-hint">Try fewer words, another topic or more reading tags.</p>'
    + '<button type="button" class="srcf-btn srcf-clear">Clear filters</button>';

  var anchor = sections[0].el;
  prose.insertBefore(sentinel, anchor);
  prose.insertBefore(bar, anchor);
  prose.insertBefore(empty, anchor);
  ready();

  var input = bar.querySelector('.srcf-input');
  var select = bar.querySelector('.srcf-select');
  var chips = Array.prototype.slice.call(bar.querySelectorAll('.srcf-chip'));
  var countEl = bar.querySelector('.srcf-count');
  var clearBtn = bar.querySelector('.srcf-meta .srcf-clear');
  var moreBtn = bar.querySelector('.srcf-more');
  var moreN = bar.querySelector('.srcf-more-n');
  var panel = bar.querySelector('.srcf-panel');

  topics.forEach(function (S, i) {
    var o = doc.createElement('option');
    o.value = String(i);
    o.textContent = S.label;
    select.appendChild(o);
    S.option = o;
  });

  /* ---------------------------------------------------------- filtering */
  var picked = new Set();
  var typeTimer = 0, sayTimer = 0;

  function countText(n) { return 'Showing ' + fmt(n) + ' of ' + fmt(TOTAL) + ' entries'; }
  function setHidden(el, hide) { if (el.hidden !== hide) el.hidden = hide; }

  function apply(fromUser) {
    var terms = parse(input.value);
    var tagOn = picked.size > 0;
    var topic = select.value === '' ? -1 : +select.value;
    var active = terms.length > 0 || tagOn || topic > -1;
    var tagHits = {};
    TAGS.forEach(function (t) { tagHits[t[0]] = 0; });
    var topicHits = topics.map(function () { return 0; });
    var shown = 0, any = 0;

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var textOk = !terms.length || hits(e.text, terms);
      var topicOk = topic < 0 || e.topic === topic;
      var tagOk = !tagOn || picked.has(e.tag);
      if (textOk) {
        if (e.src && topicOk && e.tag in tagHits) tagHits[e.tag]++;
        if (tagOk && e.topic > -1) topicHits[e.topic]++;
      }
      var on = textOk && topicOk && tagOk;
      if (on !== e.on) { e.on = on; e.el.hidden = !on; }
      if (on) { any++; if (e.src) shown++; }
    }

    sections.forEach(function (S) {
      if (S.kind === 'other') {
        setHidden(S.el, active);
      } else {
        var sShown = 0;
        S.groups.forEach(function (g) {
          g.shown = 0;
          g.lists.forEach(function (list) {
            var n = 0;
            for (var k = 0; k < list.entries.length; k++) if (list.entries[k].on) n++;
            setHidden(list.el, n === 0);
            g.shown += n;
          });
          sShown += g.shown;
        });
        var heads = 0;
        S.groups.forEach(function (g) {
          var own = g.level === 2 ? sShown : g.shown;
          setHidden(g.head, active && own === 0);
          if (g.level === 3) {
            if (!g.head.hidden) heads++;
            var sub = tocItems.get(g.head.id);
            if (sub) setHidden(sub, g.head.hidden);
          }
          // notes, tables and checklists return when the filters are cleared
          for (var k = 0; k < g.notes.length; k++) setHidden(g.notes[k], active);
          if (g.countEl) {
            setHidden(g.countEl, !active);
            if (active) g.countEl.textContent = own === g.total ? 'all ' + fmt(g.total) : fmt(own) + ' of ' + fmt(g.total);
          }
        });
        setHidden(S.el, active && sShown === 0);
        S.shown = sShown;
        S.heads = heads;
        S.notesOn = !active;
        sizeSection(S);
      }
      var t = tocItems.get(S.h2.id);
      if (t) setHidden(t, S.el.hidden);
    });

    var first = null;
    sections.forEach(function (S) {
      if (!first && !S.el.hidden) first = S;
      S.el.classList.toggle('src-first', first === S && S !== sections[0]);
    });

    chips.forEach(function (b) {
      var n = tagHits[b.getAttribute('data-tag')];
      var name = b.querySelector('.srcf-chip-name').textContent;
      b.querySelector('.srcf-chip-n').textContent = fmt(n);
      b.setAttribute('aria-label', name + ', ' + fmt(n) + (n === 1 ? ' entry' : ' entries'));
      b.classList.toggle('is-zero', n === 0);
    });
    topics.forEach(function (S, i) { S.option.textContent = S.label + ' (' + fmt(topicHits[i]) + ')'; });

    var on = picked.size + (topic > -1 ? 1 : 0);
    moreN.textContent = on ? String(on) : '';
    setHidden(moreN, !on);
    moreBtn.setAttribute('aria-label', on ? 'Filters, ' + on + ' on' : 'Filters');

    countEl.innerHTML = 'Showing <span class="n">' + fmt(shown) + '</span> of <span class="n">' + fmt(TOTAL) + '</span> entries';
    setHidden(clearBtn, !active);
    setHidden(empty, any !== 0);
    mark(terms, any);
    prose.classList.toggle('srcf-exact', active && any <= EXACT_LIMIT);

    if (fromUser) {
      settle();
      clearTimeout(sayTimer);
      sayTimer = setTimeout(function () { status.textContent = countText(shown); }, SAY_DELAY);
    }
  }

  /* ---------------------------------------------------------- layout cost */
  // With no filter, or a filter that still shows many entries, sections far
  // from view skip layout (content-visibility in sources.css) and hold an
  // estimated height, which keeps loading and clearing quick. A narrower
  // filter lays every section out exactly ("srcf-exact"); that is cheap with
  // few entries, keeps the page height true, and drops heights the browser
  // remembered for the old content.
  var EXACT_LIMIT = 600;
  var phone = window.innerWidth <= 640;
  function sizeSection(S) {
    var entryH = S.kind === 'core' ? (phone ? 190 : 120) : (phone ? 74 : 50);
    var est = Math.round(150 + S.shown * entryH + S.heads * (phone ? 96 : 84) + (S.notesOn ? S.notesCount * 70 : 0));
    if (S.est === est) return;
    S.est = est;
    S.el.style.setProperty('--src-est', est + 'px');
  }

  // Highlight the matched words in the visible entries.
  function mark(terms, visible) {
    if (!canMark) return;
    if (!terms.length || visible > MARK_LIMIT) { CSS.highlights.delete('src-match'); return; }
    var hl = new Highlight();
    entries.forEach(function (e) {
      if (!e.on) return;
      var walker = doc.createTreeWalker(e.el, NodeFilter.SHOW_TEXT);
      for (var node = walker.nextNode(); node; node = walker.nextNode()) {
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
    CSS.highlights.set('src-match', hl);
  }

  /* ---------------------------------------------------------- sticking */
  // The bar sticks below whatever already sticks above the reading column
  // (the site header, and on phones the outline bar). Once stuck it folds to
  // the search, a Filters button and the count; its footprint in the page
  // stays the same, so the content never jumps.
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
    var wasPhone = phone;
    phone = window.innerWidth <= 640;
    if (phone !== wasPhone) sections.forEach(function (S) { if (S.kind !== 'other') sizeSection(S); });
    stackH = stackHeight();
    bar.style.setProperty('--srcf-top', stackH + 'px');
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
  select.addEventListener('change', function () { apply(true); });
  chips.forEach(function (b) {
    b.addEventListener('click', function () {
      var tag = b.getAttribute('data-tag');
      if (picked.has(tag)) picked.delete(tag); else picked.add(tag);
      b.setAttribute('aria-pressed', picked.has(tag) ? 'true' : 'false');
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
    select.value = '';
    picked.clear();
    chips.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    apply(true);
    if (focusInput) input.focus();
  }
  clearBtn.addEventListener('click', function () { clearAll(true); });
  empty.querySelector('.srcf-clear').addEventListener('click', function () { clearAll(true); });

  // A link to an entry or heading that the filters hide clears the filters first.
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
  // The bar now sits above the content; bring a linked heading back into view.
  var start = decodeURIComponent((location.hash || '').slice(1));
  var target = start && doc.getElementById(start);
  if (target && prose.contains(target)) target.scrollIntoView();
})();
