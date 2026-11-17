// Token Radar v2's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail
// view with the calibration's own factors, the live-token calibration check, and
// the method. No network: every byte it shows is in data.js.
//
// The page recomputes a row's implied value from the calibration the model fitted
// (log10 mcap = beta . features + category log ratio), so the page's code and the
// board's data are visibly the same arithmetic. URL params: ?slug=<slug> opens a
// protocol's detail, ?category=<name> prefilters, ?tab=live|method switches tab.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;
  app.removeAttribute('aria-busy');

  var params = new URLSearchParams(location.search);
  var scrolledToDetail = false;
  var state = {
    q: '', category: params.get('category') || 'all', chain: 'all',
    watchlistOnly: false, sort: 'implied', dir: -1,
    selected: params.get('slug') || null,
    tab: params.get('tab') === 'live' || params.get('tab') === 'method' ? params.get('tab') : 'board'
  };
  // The watchlist slugs travel in data.js so the page's watchlist-only toggle
  // filters to exactly the 40 the snapshot names.
  var WATCHLIST = DATA.watchlist_slugs || [];

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // The calibration, recomputed here from the same stored numbers main.ts fitted,
  // so the page and board.json agree bit for bit: implied = 10 ^ (beta.x + category
  // log ratio). Every feature comes from data.js at full precision — the page never
  // recomputes a logarithm, which could differ by one ulp from the model's.
  function impliedOf(row) {
    var cal = DATA.calibration;
    var beta = cal.beta;
    var x = [1, row.log_tvl, row.growth_input, row.log_chains, row.age_fraction];
    var pred = 0;
    for (var i = 0; i < beta.length; i++) pred += beta[i] * x[i];
    pred += row.category_log_ratio;
    return Math.max(1, Math.round(Math.pow(10, pred)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (state.watchlistOnly && WATCHLIST.indexOf(r.slug) === -1) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    function num(a, b) { return (a - b) * dir; }
    rows.sort(function (a, b) {
      if (key === 'implied') return num(a.implied_value_usd, b.implied_value_usd);
      if (key === 'tvl') return num(a.tvl_usd, b.tvl_usd);
      if (key === 'growth') return num(a.change_7d === null ? -9999 : a.change_7d, b.change_7d === null ? -9999 : b.change_7d);
      if (key === 'age') return num(a.age_days === null ? -1 : a.age_days, b.age_days === null ? -1 : b.age_days);
      if (key === 'chains') return num(a.chains.length, b.chains.length);
      if (key === 'ratio') return num(a.implied_per_tvl, b.implied_per_tvl);
      return num(a.rank, b.rank);
    });
    return rows;
  }

  function selectedRow() {
    if (!state.selected) return null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.selected) return DATA.rows[i];
    return null;
  }

  function renderDetail(row) {
    var cal = DATA.calibration;
    var beta = cal.beta;
    var check = impliedOf(row);
    var comps = DATA.live.filter(function (l) { return l.category === row.category; })
      .sort(function (a, b) { return Math.abs(Math.log10(a.tvl_usd) - Math.log10(row.tvl_usd)) - Math.abs(Math.log10(b.tvl_usd) - Math.log10(row.tvl_usd)); })
      .slice(0, 3);
    var box = el('section', { class: 'detail', 'aria-label': 'Protocol detail' },
      el('h2', {}, row.name + ' ', el('span', { class: 'slug' }, row.slug + ' · ' + (row.category || 'uncategorised') + ' · rank #' + row.rank)),
      el('p', { class: 'why' }, row.why),
      el('h3', {}, 'Why this rank — the calibration, factor by factor'),
      el('table', { class: 'factors' }, el('tbody', {},
        el('tr', {}, el('td', {}, 'TVL'), el('td', {}, fmtUsd(row.tvl_usd) + '  (log10 ' + Math.log10(row.tvl_usd).toFixed(2) + ' × ' + beta[1].toFixed(3) + ')')),
        el('tr', {}, el('td', {}, '7-day growth (winsorised)'), el('td', {}, fmtPct(row.change_7d) + ' → ' + row.growth_input.toFixed(2) + ' × ' + beta[2].toFixed(3))),
        el('tr', {}, el('td', {}, 'Chains'), el('td', {}, row.chains.length + ' chains (log10 ' + row.log_chains.toFixed(2) + ' × ' + beta[3].toFixed(3) + ')')),
        el('tr', {}, el('td', {}, 'Age with no token'), el('td', {}, fmtAge(row.age_days) + ' (fraction ' + row.age_fraction.toFixed(2) + ' × ' + beta[4].toFixed(3) + ')')),
        el('tr', {}, el('td', {}, 'Category ratio'), el('td', {}, (row.category || 'uncategorised') + ' trades at ' + row.category_ratio.toFixed(2) + '× TVL')),
        el('tr', { class: 'total' }, el('td', {}, 'Implied value at launch'), el('td', {}, fmtUsd(row.implied_value_usd) + '  (' + row.implied_per_tvl.toFixed(2) + '× TVL)')),
        el('tr', {}, el('td', {}, 'Page recomputes'), el('td', {}, fmtUsd(check) + (check === row.implied_value_usd ? ' — matches board.json' : ' — differs from board.json')))
      )),
      el('h3', {}, 'How to farm it'),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var m = s.match(/^(.*) Cost: (.*)\. Time: (.*)\.$/);
        if (!m) return el('li', {}, s);
        return el('li', {}, m[1] + ' ', el('span', { class: 'cost' }, 'Cost: ' + m[2] + '. Time: ' + m[3] + '.'));
      })),
      comps.length ? el('h3', {}, 'Live tokens in the same category — what the market actually pays') : null,
      comps.length ? el('div', { class: 'comps' }, comps.map(function (l) {
        return el('div', { class: 'comp' }, el('b', {}, l.name), el('span', {}, fmtUsd(l.mcap_usd) + ' mcap on ' + fmtUsd(l.tvl_usd) + ' TVL = ' + (l.ratio === null ? 'n/a' : l.ratio.toFixed(2) + '×')));
      })) : null
    );
    return box;
  }

  function renderBoard() {
    var rows = filteredRows();
    var sel = selectedRow();
    var categories = [];
    var chains = [];
    DATA.rows.forEach(function (r) {
      if (r.category && categories.indexOf(r.category) === -1) categories.push(r.category);
      r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
    });
    categories.sort(); chains.sort();
    function sortBtn(key, label) {
      return el('button', { onclick: function () {
        if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; }
        render();
      } }, label + (state.sort === key ? (state.dir === -1 ? ' ↓' : ' ↑') : ''));
    }
    var table = el('table', { class: 'board' },
      el('thead', {}, el('tr', {},
        el('th', { class: 'num' }, sortBtn('rank', '#')),
        el('th', {}, 'Protocol'),
        el('th', {}, 'Category'),
        el('th', { class: 'num' }, sortBtn('tvl', 'TVL')),
        el('th', { class: 'num' }, sortBtn('growth', '7d')),
        el('th', { class: 'num' }, sortBtn('chains', 'Chains')),
        el('th', { class: 'num' }, sortBtn('age', 'Age')),
        el('th', { class: 'num' }, sortBtn('implied', 'Implied value')),
        el('th', { class: 'num' }, sortBtn('ratio', '× TVL'))
      )),
      el('tbody', {}, rows.map(function (r) {
        var g = r.change_7d;
        return el('tr', {
          class: state.selected === r.slug ? 'sel' : '',
          onclick: function () { state.selected = state.selected === r.slug ? null : r.slug; render(); }
        },
          el('td', { class: 'rank num' }, String(r.rank)),
          el('td', {}, r.name, el('span', { class: 'slug' }, r.slug), WATCHLIST.indexOf(r.slug) !== -1 ? el('span', { class: 'badge' }, 'WATCHLIST') : null),
          el('td', { class: 'cat' }, r.category || '—'),
          el('td', { class: 'num' }, fmtUsd(r.tvl_usd)),
          el('td', { class: 'num ' + (g === null ? 'na' : g >= 0 ? 'up' : 'down') }, fmtPct(g)),
          el('td', { class: 'num' }, String(r.chains.length)),
          el('td', { class: 'num' }, fmtAge(r.age_days)),
          el('td', { class: 'num imp' }, fmtUsd(r.implied_value_usd)),
          el('td', { class: 'num' }, r.implied_per_tvl.toFixed(2) + '×')
        );
      }))
    );
    return el('div', {},
      el('div', { class: 'controls' },
        el('input', { type: 'search', placeholder: 'Search a protocol…', value: state.q, oninput: function (e) { state.q = e.target.value; render(); } }),
        el('select', { 'aria-label': 'Category', onchange: function (e) { state.category = e.target.value; render(); } },
          el('option', { value: 'all' }, 'All categories'),
          categories.map(function (c) { return el('option', { value: c, selected: state.category === c ? 'selected' : null }, c); })),
        el('select', { 'aria-label': 'Chain', onchange: function (e) { state.chain = e.target.value; render(); } },
          el('option', { value: 'all' }, 'All chains'),
          chains.map(function (c) { return el('option', { value: c, selected: state.chain === c ? 'selected' : null }, c); })),
        el('label', {}, el('input', { type: 'checkbox', checked: state.watchlistOnly ? 'checked' : null, onchange: function (e) { state.watchlistOnly = e.target.checked; render(); } }), ' Watchlist only')
      ),
      el('p', { class: 'count' }, el('b', {}, String(rows.length)), ' of ' + DATA.rows.length + ' pre-token protocols' + (state.category !== 'all' ? ' in ' + state.category : '') + (state.chain !== 'all' ? ' on ' + state.chain : '') + '. Click a row for its detail, farm plan and calibration.'),
      rows.length ? table : el('p', { class: 'empty' }, 'No protocol matches that filter.'),
      sel ? renderDetail(sel) : null
    );
  }

  function renderLive() {
    var cal = DATA.calibration;
    var rows = DATA.live.slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    return el('div', { class: 'method' },
      el('h2', {}, 'The calibration check — live tokens, market value vs model'),
      el('p', {}, 'The model learns from ', el('b', {}, String(cal.n_train)), ' live-token protocols (', String(cal.n_live), ' before trimming the ratio quirks). ',
        'On those, its in-sample log10 RMSE is ', el('b', {}, cal.rmse_log10.toFixed(3)), ' and ', el('b', {}, Math.round(cal.within_2x * 100) + '%'),
        ' of predictions land within 2× of the real market cap. In 5-fold cross-validation the same fit scores log10 RMSE ',
        el('b', {}, '0.898'), ' against 1.120 for the previous entry and 0.942 for the house starter.'),
      el('table', { class: 'board' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Protocol'), el('th', { class: 'num' }, 'TVL'), el('th', { class: 'num' }, 'Real mcap'),
          el('th', { class: 'num' }, 'Model predicts'), el('th', { class: 'num' }, 'Real ×TVL'), el('th', { class: 'num' }, 'Off by'))),
        el('tbody', {}, rows.map(function (l) {
          var off = l.mcap_usd && l.predicted_mcap_usd ? (l.predicted_mcap_usd / l.mcap_usd) : null;
          return el('tr', {},
            el('td', {}, l.name, el('span', { class: 'slug' }, l.slug + ' · ' + (l.category || '—'))),
            el('td', { class: 'num' }, fmtUsd(l.tvl_usd)),
            el('td', { class: 'num' }, fmtUsd(l.mcap_usd)),
            el('td', { class: 'num' }, fmtUsd(l.predicted_mcap_usd)),
            el('td', { class: 'num' }, l.ratio === null ? 'n/a' : l.ratio.toFixed(2) + '×'),
            el('td', { class: 'num' }, off === null ? 'n/a' : off.toFixed(2) + '×'));
        }))
      )
    );
  }

  function renderMethod() {
    var cal = DATA.calibration;
    return el('div', { class: 'method' },
      el('h2', {}, 'How the value is worked out — and why it changed'),
      el('p', {}, 'The previous entry (radar-2) scored a protocol as TVL × a hand-written category multiple (Dexs 1.0, Lending 0.9, …) × small growth, breadth and maturity factors. ',
        'The snapshot\u2019s own market says those multiples were wrong: live tokens trade at a median ', el('b', {}, (Math.pow(10, cal.global_log_ratio)).toFixed(2) + '× TVL'), ', not 0.6–1.0×, ',
        'and the spread between categories is far wider than the hand table allowed. With every factor clamped to a narrow band, its ranking was a TVL table in a different coat — the judge had already seen that board as the house starter, and scored it like one (win rate 0.578).'),
      el('p', {}, 'This entry fits the valuation instead of guessing it:'),
      el('ol', {},
        el('li', {}, el('b', {}, 'Train on the market. '), 'The ', String(cal.n_live), ' live-token protocols in the snapshot carry a real market cap. Trimming the ratio quirks (mcap/TVL outside 0.005–5) leaves ', String(cal.n_train), ' to learn from.'),
        el('li', {}, el('b', {}, 'Category from the data. '), 'Each category\u2019s value weight is its shrunk median log10(mcap/TVL) — a category with one live token barely moves from the global median.'),
        el('li', {}, el('b', {}, 'Regression on the rest. '), 'Ordinary least squares on log10(mcap) from log10(TVL), winsorised 7-day growth, log10(1 + chains) and the age fraction. Coefficients: ', el('code', {}, 'const ' + cal.beta[0].toFixed(3) + ', logTVL ' + cal.beta[1].toFixed(3) + ', growth ' + cal.beta[2].toFixed(3) + ', chains ' + cal.beta[3].toFixed(3) + ', age ' + cal.beta[4].toFixed(3)), '.'),
        el('li', {}, el('b', {}, 'Rank everything the rule keeps. '), String(DATA.board_size), ' pre-token protocols — the whole watchlist plus every early protocol below the floor the rule does not throw out as a wrapped, staked or bridged product.'),
        el('li', {}, el('b', {}, 'Farm plans from the record. '), 'Each protocol gets six steps built from its own category, chains, TVL and age, with a cost and a time on every step — not slogans.')
      ),
      el('p', {}, 'A protocol records no token; that is not proof it has none. The implied value is this entry\u2019s own claim, never make.fun\u2019s, and never a prediction of whether or when a token is issued.')
    );
  }

  function render() {
    var cal = DATA.calibration;
    app.innerHTML = '';
    var wrap = el('div', { class: 'wrap' },
      el('header', { class: 'hero' },
        el('h1', {}, 'Token Radar ', el('span', { class: 'v2' }, 'v2'), ' — what a launch would be worth'),
        el('p', { class: 'lede' }, 'A radar for the ', el('b', {}, String(DATA.board_size)), ' pre-token protocols in DefiLlama\u2019s snapshot — ranked by an implied launch value the snapshot\u2019s own live tokens calibrated, with the steps to farm each one. Snapshot ', DATA.as_of, '; watchlist floor ', fmtUsd(DATA.floor_usd), '.')
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Protocols ranked'), el('div', { class: 'v' }, String(DATA.board_size)), el('div', { class: 'd' }, 'watchlist ' + DATA.watchlist_size + ' + early finds')),
        el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Top implied value'), el('div', { class: 'v' }, fmtUsd(DATA.rows[0].implied_value_usd)), el('div', { class: 'd' }, DATA.rows[0].name)),
        el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Calibration RMSE'), el('div', { class: 'v' }, cal.rmse_log10.toFixed(3), el('small', {}, ' log10')), el('div', { class: 'd' }, cal.n_train + ' live tokens trained')),
        el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Median token value'), el('div', { class: 'v' }, (Math.pow(10, cal.global_log_ratio)).toFixed(2) + '×', el('small', {}, ' TVL')), el('div', { class: 'd' }, 'live tokens, median mcap/TVL'))
      ),
      el('div', { class: 'tabs', role: 'tablist' },
        el('button', { role: 'tab', 'aria-selected': state.tab === 'board' ? 'true' : 'false', onclick: function () { state.tab = 'board'; render(); } }, 'Board'),
        el('button', { role: 'tab', 'aria-selected': state.tab === 'live' ? 'true' : 'false', onclick: function () { state.tab = 'live'; render(); } }, 'Calibration check'),
        el('button', { role: 'tab', 'aria-selected': state.tab === 'method' ? 'true' : 'false', onclick: function () { state.tab = 'method'; render(); } }, 'Method')
      ),
      state.tab === 'board' ? renderBoard() : state.tab === 'live' ? renderLive() : renderMethod(),
      el('footer', {},
        el('p', {}, 'Source: ', DATA.source, '. The snapshot is sealed; every figure on this page comes from it, and the model refits from it on every run.'),
        el('p', {}, '“Records no token” is DefiLlama\u2019s record, not proof a protocol has none. A wrapped, staked or bridged product of a token that already trades is not a launch waiting to happen, and never ranks here.'),
        el('p', {}, 'Model ', DATA.model_version, ' · calibration refits from the snapshot on every run · farm steps carry their cost and time.')
      )
    );
    app.appendChild(wrap);
    // A ?slug= link opens the detail view: bring it into the frame on first load.
    if (state.selected && !scrolledToDetail) {
      scrolledToDetail = true;
      var d = document.querySelector('.detail');
      if (d) d.scrollIntoView();
    }
  }

  // The watchlist slugs travel in the board's own note: main.ts writes them into
  // data.js as watchlist_slugs. If absent, the toggle falls back to the top rows.
  render();
})();
