/* Pacing Frontier AI: the proposal map on the home page (figure.pmap).
   Light enhancement only: complete table semantics, row and column names on each
   cell for the stacked narrow view, row and column lighting on hover and focus, and
   a key entry that highlights Brad Carson's unpublished proposals. Nothing is hidden. */
(function () {
  'use strict';

  var fig = document.querySelector('figure.pmap');
  var grid = fig && fig.querySelector('.pmap-grid');
  if (!grid) return;
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };
  var uid = 'pmap-' + Math.random().toString(36).slice(2, 7);

  // ---------------------------------------------------------------- table semantics
  // The build marks the grid as a table; rows, column heads and cells get their roles here.
  var colheads = {};
  each(grid.querySelectorAll('.pmap-row'), function (row) { row.setAttribute('role', 'row'); });
  var corner = grid.querySelector('.pmap-corner');
  if (corner) corner.setAttribute('role', 'columnheader');
  each(grid.querySelectorAll('.pmap-colhead[data-col]'), function (c) {
    c.setAttribute('role', 'columnheader');
    colheads[c.getAttribute('data-col')] = c;
  });

  var cells = [];      // { box, row, col, rowhead }
  each(grid.querySelectorAll('.pmap-row:not(.pmap-headrow)'), function (row) {
    var rowhead = row.querySelector('.pmap-rowhead');
    if (rowhead) rowhead.setAttribute('role', 'rowheader');
    each(row.querySelectorAll('ul.pmap-cell'), function (ul) {
      var col = ul.getAttribute('data-col') || '';
      var box = ul.parentElement;
      if (!box.classList.contains('pmap-td')) {
        box = document.createElement('div');
        box.className = 'pmap-td';
        ul.parentNode.insertBefore(box, ul);
        box.appendChild(ul);
      }
      box.setAttribute('role', 'cell');
      box.setAttribute('data-row', ul.getAttribute('data-row') || row.getAttribute('data-row') || '');
      box.setAttribute('data-col', col);

      // row and column names for the stacked view; screen readers get them from the table roles
      if (!box.querySelector('.pmap-cellhead')) {
        var head = document.createElement('div');
        head.className = 'pmap-cellhead';
        head.setAttribute('aria-hidden', 'true');
        var r = document.createElement('span');
        r.className = 'pmap-ch-row';
        r.textContent = rowhead ? rowhead.textContent.trim() : '';
        var c = document.createElement('span');
        c.className = 'pmap-ch-col';
        c.textContent = colheads[col] ? colheads[col].textContent.trim() : '';
        head.appendChild(r);
        head.appendChild(c);
        box.insertBefore(head, ul);
      }
      cells.push({ box: box, col: col, rowhead: rowhead });
    });
  });

  // ---------------------------------------------------------------- key: describe the marked entries
  var keyOwn = fig.querySelector('.pmap-key-own');
  var keyPart = fig.querySelector('.pmap-key-part');
  if (keyOwn) keyOwn.id = keyOwn.id || uid + '-own';
  if (keyPart) keyPart.id = keyPart.id || uid + '-part';
  each(fig.querySelectorAll('.pmap-item'), function (li) {
    var a = li.querySelector('a');
    if (!a) return;
    var ids = [];
    if (keyOwn && li.classList.contains('is-own')) ids.push(keyOwn.id);
    if (keyPart && li.classList.contains('is-part')) ids.push(keyPart.id);
    if (ids.length) a.setAttribute('aria-describedby', ids.join(' '));
  });

  // the key entry for the unpublished proposals becomes a highlight toggle
  if (keyOwn && fig.querySelector('.pmap-item.is-own') && !keyOwn.querySelector('button')) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pmap-keybtn';
    btn.setAttribute('aria-pressed', 'false');
    while (keyOwn.firstChild) btn.appendChild(keyOwn.firstChild);
    keyOwn.appendChild(btn);
    btn.addEventListener('click', function () {
      var on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      fig.classList.toggle('is-own-lit', on);
    });
  }

  // ---------------------------------------------------------------- lighting
  function light(list, on) { list.forEach(function (el) { if (el) el.classList.toggle('is-lit', on); }); }
  function hold(target, list) {
    target.addEventListener('mouseenter', function () { light(list, true); });
    target.addEventListener('mouseleave', function () { light(list, false); });
  }
  // a row or column head lights itself and its cells
  each(grid.querySelectorAll('.pmap-row:not(.pmap-headrow)'), function (row) {
    var rowhead = row.querySelector('.pmap-rowhead');
    if (rowhead) hold(rowhead, [rowhead].concat(cells.filter(function (c) { return c.rowhead === rowhead; }).map(function (c) { return c.box; })));
  });
  Object.keys(colheads).forEach(function (col) {
    hold(colheads[col], [colheads[col]].concat(cells.filter(function (c) { return c.col === col; }).map(function (c) { return c.box; })));
  });
  // a cell, hovered or holding focus, lights its row and column heads
  cells.forEach(function (c) {
    var heads = [c.rowhead, colheads[c.col]];
    hold(c.box, heads);
    c.box.addEventListener('focusin', function () { light(heads, true); });
    c.box.addEventListener('focusout', function () { light(heads, false); });
  });

  fig.classList.add('is-enhanced');
})();
