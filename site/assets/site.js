/* Pacing Frontier AI: shared page behaviour.
   1. Site menus: drop-down groups on wide screens, a drawer behind the Menu button on narrow ones.
   2. "On this page": sub-entries for the current section, scrollspy, and a bar on narrow screens.
   3. Linked targets inside folded sections: open the fold, then scroll to the target. */
(function () {
  'use strict';
  var doc = document;
  doc.documentElement.classList.add('js');

  var narrowMQ = window.matchMedia ? window.matchMedia('(max-width: 959.98px)') : null;
  function isNarrow() { return !!narrowMQ && narrowMQ.matches; }
  function all(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function idFromHref(a) {
    var h = (a.getAttribute('href') || '');
    var i = h.indexOf('#');
    if (i < 0) return '';
    try { return decodeURIComponent(h.slice(i + 1)); } catch (err) { return h.slice(i + 1); }
  }

  /* ---------------------------------------------------------------- site menus */
  var header = doc.querySelector('.site-header');
  var toggle = doc.querySelector('.nav-toggle');
  var nav = doc.getElementById('site-nav');
  var groups = [];

  // A backdrop under the phone drawer and the outline panel; a tap on it closes them.
  var scrim = doc.createElement('div');
  scrim.className = 'scrim';
  scrim.setAttribute('aria-hidden', 'true');
  (doc.querySelector('.site') || doc.body).appendChild(scrim);
  function syncScrim() {
    scrim.classList.toggle('is-on', isNarrow() && (drawerOpen() || tocOpen()));
  }

  function drawerOpen() { return !!nav && nav.classList.contains('is-open'); }
  function setDrawer(open) {
    if (!nav || !toggle) return;
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (header) header.classList.toggle('is-nav-open', open);
    syncScrim();
  }
  function setGroup(g, open) {
    g.li.classList.toggle('is-open', open);
    g.btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function closeGroups(except) {
    groups.forEach(function (g) { if (g !== except && g.li.classList.contains('is-open')) setGroup(g, false); });
  }
  function openGroup() {
    for (var i = 0; i < groups.length; i++) if (groups[i].li.classList.contains('is-open')) return groups[i];
    return null;
  }

  if (nav) {
    var navList = nav.querySelector('.nav-list');

    // Gather the two About pages under one menu.
    var aboutItems = all('.nav-single', nav).filter(function (li) {
      var a = li.querySelector('a');
      return !!a && /^(about|notes)\.html$/.test(a.getAttribute('href') || '');
    });
    if (navList && aboutItems.length === 2) {
      var aboutLi = doc.createElement('li');
      aboutLi.className = 'nav-group nav-group-about';
      var aboutLabel = doc.createElement('span');
      aboutLabel.className = 'nav-group-label';
      aboutLabel.textContent = 'About';
      var aboutUl = doc.createElement('ul');
      aboutItems.forEach(function (li) { li.className = ''; aboutUl.appendChild(li); });
      aboutLi.appendChild(aboutLabel);
      aboutLi.appendChild(aboutUl);
      navList.appendChild(aboutLi);
    }

    // In the drawer, a plain heading names the reference pages.
    var firstSingle = nav.querySelector('.nav-single');
    if (navList && firstSingle) {
      var head = doc.createElement('li');
      head.className = 'nav-heading';
      head.textContent = 'Reference';
      navList.insertBefore(head, firstSingle);
    }

    // Each group label becomes a disclosure button (wide screens) beside a plain label (drawer).
    all('.nav-group', nav).forEach(function (li, n) {
      var label = li.querySelector('.nav-group-label');
      var menu = li.querySelector('ul');
      if (!label || !menu) return;
      var text = label.textContent.replace(/\s+/g, ' ').trim();
      if (!menu.id) menu.id = 'site-menu-' + (n + 1);
      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-group-btn';
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-controls', menu.id);
      btn.textContent = text;
      var plain = doc.createElement('span');
      plain.className = 'nav-group-text';
      plain.textContent = text;
      label.textContent = '';
      label.appendChild(btn);
      label.appendChild(plain);
      if (menu.querySelector('[aria-current="page"]')) li.classList.add('is-current');

      var g = { li: li, btn: btn, menu: menu };
      groups.push(g);

      btn.addEventListener('click', function () {
        var open = !li.classList.contains('is-open');
        closeGroups(g);
        setGroup(g, open);
      });
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'Down') {
          e.preventDefault();
          closeGroups(g);
          setGroup(g, true);
          var first = menu.querySelector('a');
          if (first) first.focus();
        }
      });
      menu.addEventListener('keydown', function (e) {
        if (isNarrow()) return;
        var links = all('a', menu);
        var i = links.indexOf(doc.activeElement);
        if (i < 0) return;
        var next = null;
        if (e.key === 'ArrowDown' || e.key === 'Down') next = links[(i + 1) % links.length];
        else if (e.key === 'ArrowUp' || e.key === 'Up') next = links[(i - 1 + links.length) % links.length];
        else if (e.key === 'Home') next = links[0];
        else if (e.key === 'End') next = links[links.length - 1];
        if (next) { e.preventDefault(); next.focus(); }
      });
      // Close when keyboard focus moves on to something outside the group.
      li.addEventListener('focusout', function (e) {
        var to = e.relatedTarget;
        if (!to || li.contains(to) || isNarrow()) return;
        setGroup(g, false);
      });
    });
  }

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      closeGroups();
      setDrawer(!drawerOpen());
    });
  }

  /* ---------------------------------------------------------------- on this page */
  var toc = doc.querySelector('.toc');
  var tocList = toc ? toc.querySelector('.toc-list') : null;
  var tocBtn = toc ? toc.querySelector('.toc-toggle') : null;
  var tocCurrent = toc ? toc.querySelector('.toc-current') : null;

  function tocOpen() { return !!toc && toc.classList.contains('is-open'); }
  function setToc(open) {
    if (!toc || !tocBtn) return;
    toc.classList.toggle('is-open', open);
    tocBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    syncScrim();
  }

  if (toc && !tocList) toc.classList.add('is-empty');
  if (tocList && tocBtn) {
    tocBtn.addEventListener('click', function () { setToc(!tocOpen()); });
    tocList.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) setToc(false);
    });
  }

  function childHeadings(sec) {
    var out = [];
    for (var el = sec.firstElementChild; el; el = el.nextElementSibling) {
      if (el.tagName === 'H3' && el.id) out.push(el);
    }
    return out;
  }

  if (tocList) {
    // Long pages list only the H2 sections; add each section's sub-entries,
    // shown while that section is being read.
    if (!tocList.querySelector('.toc-l3')) {
      all('.toc-l2', tocList).forEach(function (li) {
        var a = li.querySelector('a');
        var h = a && doc.getElementById(idFromHref(a));
        var sec = h && h.parentElement;
        if (!sec || sec.tagName !== 'SECTION') return;
        var subs = childHeadings(sec);
        if (subs.length < 2) return;
        var ol = doc.createElement('ol');
        ol.className = 'toc-sub';
        subs.forEach(function (h3) {
          var li3 = doc.createElement('li');
          li3.className = 'toc-l3';
          var a3 = doc.createElement('a');
          a3.href = '#' + h3.id;
          a3.textContent = h3.textContent.replace(/\s+/g, ' ').trim();
          li3.appendChild(a3);
          ol.appendChild(li3);
        });
        li.appendChild(ol);
        li.classList.add('has-sub');
      });
    }
    scrollspy();
  }

  function scrollspy() {
    var items = [];
    all('a[href^="#"]', tocList).forEach(function (a) {
      var h = doc.getElementById(idFromHref(a));
      if (h) items.push({ a: a, h: h, l2: a.parentElement && a.parentElement.classList.contains('toc-l2') ? a.parentElement : (a.closest ? a.closest('.toc-l2') : null) });
    });
    if (!items.length) return;

    var current = -2;
    var atEnd = false;
    var line = 0;
    var io = null;

    function setActive(i) {
      if (i === current) return;
      var prev = items[current];
      if (prev) {
        prev.a.classList.remove('is-active');
        prev.a.removeAttribute('aria-current');
        if (prev.l2) prev.l2.classList.remove('is-current');
      }
      current = i;
      var it = items[i];
      if (it) {
        it.a.classList.add('is-active');
        it.a.setAttribute('aria-current', 'location');
        if (it.l2) it.l2.classList.add('is-current');
      }
      if (tocCurrent) {
        var top = it ? (it.l2 ? it.l2.querySelector('a') : it.a) : null;
        tocCurrent.textContent = top ? top.textContent : '';
      }
      keepInView(it ? it.a : null);
    }

    // Where a heading sits relative to the viewport. Headings inside sections that the browser
    // skips rendering (content-visibility) have empty boxes; their section keeps its size and,
    // being far from view, lies wholly above or below the reading line, so its top stands in.
    // Hidden headings (filtered out) return null and are never chosen.
    function topOf(h) {
      if (h.closest && h.closest('details:not([open])')) return null;   // inside a closed fold
      if (h.offsetParent === null) return null;                           // hidden, for example by a filter
      var r = h.getBoundingClientRect();
      if (r.width || r.height) return r.top;
      var sec = h.closest ? h.closest('section') : null;
      if (!sec) return null;
      var sr = sec.getBoundingClientRect();
      return sr.width || sr.height ? sr.top : null;
    }

    function pick() {
      var i = -1, k, t;
      for (k = 0; k < items.length; k++) {
        t = topOf(items[k].h);
        if (t === null) continue;
        if (atEnd) i = k;                 // at the foot of the page the last visible entry wins
        else if (t < line) i = k;
      }
      setActive(i);
    }

    // Keep the active entry visible inside the outline's own scroll box.
    function keepInView(a) {
      if (!a || isNarrow() || toc.scrollHeight <= toc.clientHeight) return;
      var t = a.offsetTop, b = t + a.offsetHeight, pad = 40;
      if (t < toc.scrollTop + pad) toc.scrollTop = Math.max(0, t - pad);
      else if (b > toc.scrollTop + toc.clientHeight - pad) toc.scrollTop = b - toc.clientHeight + pad;
    }

    var queued = false;
    function schedule() {
      if (queued) return;
      queued = true;
      (window.requestAnimationFrame || setTimeout)(function () { queued = false; pick(); });
    }

    function measure() {
      var hh = header ? header.getBoundingClientRect().height : 52;
      var bar = isNarrow() && tocBtn ? tocBtn.getBoundingClientRect().height : 0;
      line = Math.round(hh + bar + Math.min(window.innerHeight * 0.2, 170));
      // Pages with their own sticky bars (timeline, sources) set scroll-padding-top; never read above it.
      var sp = parseFloat(getComputedStyle(doc.documentElement).scrollPaddingTop) || 0;
      line = Math.max(line, Math.round(sp + 8));
      if ('IntersectionObserver' in window) {
        if (io) io.disconnect();
        // Headings crossing the reading line trigger a new pick.
        var opts = { rootMargin: (-line) + 'px 0px 100000px 0px', threshold: 0 };
        try { opts.root = doc; io = new IntersectionObserver(schedule, opts); }
        catch (err) { delete opts.root; io = new IntersectionObserver(schedule, opts); }
        items.forEach(function (it) { io.observe(it.h); });
      }
      schedule();
    }
    measure();
    // Page scripts (timeline, sources) add sticky bars and set scroll-padding-top after this file runs.
    if (doc.readyState !== 'complete') {
      doc.addEventListener('DOMContentLoaded', measure);
      window.addEventListener('load', measure);
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('hashchange', schedule);

    // At the foot of the page the last sections can never reach the line.
    var foot = doc.querySelector('.site-footer');
    if (foot && 'IntersectionObserver' in window) {
      var endOpts = { threshold: 0.5 };
      var endIO;
      var onEnd = function (es) { atEnd = es[es.length - 1].isIntersecting; schedule(); };
      try { endOpts.root = doc; endIO = new IntersectionObserver(onEnd, endOpts); }
      catch (err) { delete endOpts.root; endIO = new IntersectionObserver(onEnd, endOpts); }
      endIO.observe(foot);
    }

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(measure, 200);
    });
  }

  /* ---------------------------------------------------------------- closing menus */
  doc.addEventListener('click', function (e) {
    var t = e.target;
    if (groups.length && !(nav && nav.contains(t))) closeGroups();
    if (drawerOpen() && (!(header && header.contains(t)) || (t.closest && t.closest('.search-open')))) setDrawer(false);
    if (tocOpen() && !toc.contains(t)) setToc(false);
  });
  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    var g = openGroup();
    if (g) { setGroup(g, false); g.btn.focus(); return; }
    if (drawerOpen()) { setDrawer(false); if (toggle) toggle.focus(); return; }
    if (tocOpen()) { setToc(false); if (tocBtn) tocBtn.focus(); }
  });
  if (narrowMQ) {
    var onChange = function () { closeGroups(); setDrawer(false); setToc(false); };
    if (narrowMQ.addEventListener) narrowMQ.addEventListener('change', onChange);
    else if (narrowMQ.addListener) narrowMQ.addListener(onChange);
  }

  /* ---------------------------------------------------------------- linked targets in folded sections */
  function revealHash() {
    var id = '';
    try { id = decodeURIComponent((location.hash || '').slice(1)); } catch (err) { id = (location.hash || '').slice(1); }
    if (!id) return;
    var el = doc.getElementById(id);
    if (!el) return;
    for (var p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
    el.scrollIntoView();
  }
  window.addEventListener('hashchange', revealHash);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', revealHash); else revealHash();

  // Web fonts can arrive after the first jump and move the target; jump again unless the reader has moved.
  var moved = false;
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (type) {
    window.addEventListener(type, function () { moved = true; }, { passive: true, once: true });
  });
  function rejump() { if (!moved && location.hash) revealHash(); }
  if (doc.fonts) {
    if (doc.fonts.ready) doc.fonts.ready.then(rejump);
    if (doc.fonts.addEventListener) doc.fonts.addEventListener('loadingdone', rejump);
  }
})();
