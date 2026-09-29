/* グラスハノイ — Glass Hanoi
 * 入力: D-pad（矢印キー）とタップ（Enter）のみ。Escape は PC 確認用の補助。
 * 依存ライブラリなし。Canvas + DOM。
 * ?auto=1 で最短手順の自動再生（デモ録画用。記録は保存しない）。?n=3..7 で枚数を指定。
 */
(function () {
  'use strict';

  var AUTO = /[?&]auto=1/.test(location.search);
  var nM = /[?&]n=([3-7])/.exec(location.search);

  // ---------- 状態 ----------
  var N = 4;                       // 円盤の枚数（3〜7）
  var pegs = [[], [], []];         // 各柱の円盤（下→上、数字が大きいほど大きい円盤）
  var disks = {};                  // k -> {k, x, y, q:[waypoints], shake}
  var held = null;                 // {k, from}
  var cur = 1;                     // 0=≡メニュー, 1..3=柱
  var hist = [];                   // {k, from, to}
  var cleared = false, clearAt = 0;
  var hintMove = null;             // {from, to}
  var warnFlash = null;            // {peg, t}
  var particles = [];
  var timeAcc = 0, timeT0 = 0, timeRun = false;
  var mode = 'title', menuIdx = 0, menuItems = [], menuEl = 'title-list';
  var howtoBack = null;
  var store = { n: 4, best: {}, clears: 0 };

  var el = function (id) { return document.getElementById(id); };
  var cv = el('board'), ctx = cv.getContext('2d');

  // ---------- 保存 ----------
  var KEY = 'glass-hanoi-v1';
  function save() {
    if (AUTO) return;
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { /* 保存できなくても動作には影響しない */ }
  }
  function load() {
    if (AUTO) return;
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s) return;
      if (s.n >= 3 && s.n <= 7) store.n = s.n | 0;
      if (s.best && typeof s.best === 'object') store.best = s.best;
      store.clears = s.clears | 0;
    } catch (e) { /* 壊れていたら初期値のまま */ }
  }

  // ---------- 形と色 ----------
  var PX = [110, 300, 490];
  var BASE = 400, ROD_TOP = 124, LIFT = 68;
  var NAMES = ['A', 'B', 'ゴール'];
  function DH() { return Math.min(40, Math.floor(250 / N)); }
  function stackY(i) { return BASE - DH() * i - DH() / 2; }
  function diskW(k) { return 54 + (172 - 54) * (k - 1) / (N - 1); }
  function hue(k) { return 28 + (k - 1) * (252 / (N - 1)); }
  function minMoves() { return Math.pow(2, N) - 1; }

  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function elapsed() { return timeAcc + (timeRun ? performance.now() - timeT0 : 0); }
  function timerStart() { if (!timeRun && !cleared) { timeRun = true; timeT0 = performance.now(); } }
  function timerStop() { if (timeRun) { timeAcc += performance.now() - timeT0; timeRun = false; } }

  // ---------- ゲーム ----------
  function newGame() {
    pegs = [[], [], []];
    disks = {};
    for (var k = N; k >= 1; k--) {
      pegs[0].push(k);
      disks[k] = { k: k, x: PX[0], y: stackY(pegs[0].length - 1), q: [], shake: 0 };
    }
    held = null; cur = 1; hist = []; cleared = false; hintMove = null; warnFlash = null; particles = [];
    timeAcc = 0; timeRun = false;
    autoQ = []; autoMistake = false;
    mode = 'game';
    show('game');
    paintUI();
    if (AUTO) { clearTimeout(autoT); autoT = setTimeout(autoTick, 900); }
  }

  function liftTo(d, x) {
    if (d.y > LIFT + 2) d.q = [{ x: d.x, y: LIFT }, { x: x, y: LIFT }];
    else d.q = [{ x: x, y: LIFT }];
  }
  function dropTo(d, p) {
    var y = stackY(pegs[p].length - 1);
    if (Math.abs(d.x - PX[p]) < 1 && d.y <= LIFT + 2) d.q = [{ x: PX[p], y: y }];
    else d.q = [{ x: d.x, y: LIFT }, { x: PX[p], y: LIFT }, { x: PX[p], y: y }];
  }

  function moveCursor(dir) {
    cur = (cur + dir + 4) % 4;
    if (held && cur > 0) liftTo(disks[held.k], PX[cur - 1]);
    paintUI();
  }

  function tap() {
    if (cleared) return;
    if (cur === 0) { pauseMenu(); return; }
    var p = cur - 1;
    if (!held) {
      if (!pegs[p].length) { toast('この柱には円盤がないよ', true); return; }
      var k = pegs[p].pop();
      held = { k: k, from: p };
      timerStart();
      liftTo(disks[k], PX[p]);
      if (hintMove && hintMove.from !== p) hintMove = null;
    } else {
      var d = disks[held.k];
      if (p === held.from) { putBack(); paintUI(); return; }
      var top = pegs[p][pegs[p].length - 1];
      if (top && top < held.k) {
        d.shake = 1;
        warnFlash = { peg: p, t: performance.now() };
        toast('大きい円盤は小さい円盤の上に置けないよ', true);
        return;
      }
      pegs[p].push(held.k);
      hist.push({ k: held.k, from: held.from, to: p });
      dropTo(d, p);
      held = null;
      hintMove = null;
      if (pegs[2].length === N) win();
    }
    paintUI();
  }

  function putBack() {
    if (!held) return;
    pegs[held.from].push(held.k);
    dropTo(disks[held.k], held.from);
    held = null;
  }

  function undo() {
    if (held) { putBack(); return true; }
    var m = hist.pop();
    if (!m) return false;
    pegs[m.to].pop();
    pegs[m.from].push(m.k);
    dropTo(disks[m.k], m.from);
    cur = m.from + 1;
    hintMove = null;
    return true;
  }

  // 現在の配置から「ゴールへの最短手順」の次の1手（どんな途中状態からでも最短）
  function nextMove() {
    var pos = {};
    for (var p = 0; p < 3; p++) for (var i = 0; i < pegs[p].length; i++) pos[pegs[p][i]] = p;
    if (held) pos[held.k] = held.from;
    var target = 2;
    for (var k = N; k >= 1; k--) {
      if (pos[k] === target) continue;
      var from = pos[k], aux = 3 - from - target, ok = true;
      for (var j = k - 1; j >= 1; j--) if (pos[j] !== aux) { ok = false; break; }
      if (ok) return { k: k, from: from, to: target };
      target = aux;
    }
    return null;
  }

  function win() {
    cleared = true;
    clearAt = performance.now();
    timerStop();
    var moves = hist.length, t = elapsed(), isBest = false;
    if (!AUTO) {
      var b = store.best[N] || {};
      if (!b.m || moves < b.m) { b.m = moves; isBest = true; }
      if (!b.t || t < b.t) { b.t = Math.round(t); isBest = true; }
      store.best[N] = b;
      store.clears++;
      save();
    }
    for (var i = 0; i < 90; i++) {
      var k = 1 + (i % N);
      particles.push({
        x: PX[2] + (Math.random() - 0.5) * 160, y: BASE - 60 - Math.random() * 120,
        vx: (Math.random() - 0.5) * 9, vy: -4 - Math.random() * 8,
        h: hue(k), life: 1
      });
    }
    toast(moves === minMoves() ? '🎉 パーフェクト！' : '🎉 クリア！');
    setTimeout(function () { if (cleared && mode === 'game') winMenu(isBest && !AUTO); }, 2400);
  }

  // ---------- UI（HUD・ヒントバー） ----------
  function paintUI() {
    el('menu-btn').classList.toggle('cur', cur === 0 && !cleared);
    var h;
    if (cleared) h = 'ゴールの柱にぜんぶ移せた！';
    else if (hintMove && !held) h = '<span style="color:#ffd166">ヒント：' + NAMES[hintMove.from] + ' → ' + NAMES[hintMove.to] + '</span>';
    else if (hintMove && held) h = '<span style="color:#ffd166">ヒント：' + NAMES[hintMove.to] + ' に置こう</span>';
    else if (cur === 0) h = 'タップでメニュー ・ →で柱へ';
    else if (held && cur - 1 === held.from) h = 'タップでもとにもどす ・ ←→ 柱をえらぶ';
    else if (held) h = 'タップで置く ・ ←→ 柱をえらぶ';
    else h = '←→ 柱をえらぶ ・ タップで持ち上げる';
    el('hint').innerHTML = h;
  }
  var hudLast = '';
  function paintHud() {
    var s = mode === 'title' || mode === 'howto' && !howtoFromGame ? '' :
      N + '枚 ・ 手数 <b>' + hist.length + '</b> / 最短 ' + minMoves() + ' ・ ' + fmtTime(elapsed());
    if (s !== hudLast) { el('hud-right').innerHTML = s; hudLast = s; }
  }

  var toastT = 0;
  function toast(msg, warn) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.toggle('warn', !!warn);
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove('on'); }, 1500);
  }

  // ---------- 描画 ----------
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function stepDisks() {
    for (var k in disks) {
      var d = disks[k];
      if (d.q.length) {
        var t = d.q[0], dx = t.x - d.x, dy = t.y - d.y, dist = Math.sqrt(dx * dx + dy * dy);
        var sp = Math.max(9, dist * 0.3);
        if (dist <= sp) { d.x = t.x; d.y = t.y; d.q.shift(); }
        else { d.x += dx / dist * sp; d.y += dy / dist * sp; }
      }
      d.shake *= 0.9;
      if (d.shake < 0.02) d.shake = 0;
    }
  }

  function drawDisk(d, now, glow) {
    var w = diskW(d.k), h = DH() - 4, hh = hue(d.k);
    var x = d.x - w / 2 + (d.shake ? Math.sin(now / 28) * d.shake * 14 : 0), y = d.y - h / 2;
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'hsl(' + hh + ',100%,76%)');
    g.addColorStop(0.55, 'hsl(' + hh + ',92%,58%)');
    g.addColorStop(1, 'hsl(' + hh + ',88%,40%)');
    ctx.save();
    ctx.shadowColor = 'hsla(' + hh + ',100%,60%,' + (0.35 + glow * 0.6) + ')';
    ctx.shadowBlur = 10 + glow * 22;
    rr(x, y, w, h, Math.min(12, h / 2));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    rr(x + 8, y + 3, w - 16, 3, 1.5);
    ctx.fill();
  }

  function draw(now) {
    ctx.clearRect(0, 0, 600, 500);
    var pulse = 0.5 + 0.5 * Math.sin(now / 220);

    // 台座
    rr(20, BASE, 560, 18, 9);
    ctx.fillStyle = '#1c1f27'; ctx.fill();
    ctx.strokeStyle = '#2e3340'; ctx.lineWidth = 2; ctx.stroke();

    // 柱とラベル
    for (var p = 0; p < 3; p++) {
      var sel = cur === p + 1 && !cleared;
      var hintFrom = hintMove && hintMove.from === p && !held;
      var hintTo = hintMove && hintMove.to === p;
      ctx.save();
      if (sel) { ctx.shadowColor = 'rgba(124,231,255,0.8)'; ctx.shadowBlur = 16; }
      else if (hintFrom || hintTo) { ctx.shadowColor = 'rgba(255,209,102,' + (0.4 + pulse * 0.5) + ')'; ctx.shadowBlur = 18; }
      rr(PX[p] - 6, ROD_TOP, 12, BASE - ROD_TOP + 2, 6);
      ctx.fillStyle = sel ? '#5fb8cc' : (hintFrom || hintTo) ? '#b8954a' : (p === 2 ? '#2f4a3b' : '#343945');
      ctx.fill();
      ctx.restore();
      ctx.font = '800 20px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = sel ? '#7ce7ff' : p === 2 ? '#7bffb0' : '#8a92a4';
      ctx.fillText(p === 2 ? '🏁 ゴール' : NAMES[p], PX[p], BASE + 36);
      if (warnFlash && warnFlash.peg === p) {
        var a = 1 - (now - warnFlash.t) / 700;
        if (a > 0) {
          var top = pegs[p][pegs[p].length - 1];
          if (top) {
            var tw = diskW(top) + 10, ty = stackY(pegs[p].length - 1);
            rr(PX[p] - tw / 2, ty - DH() / 2, tw, DH(), 12);
            ctx.strokeStyle = 'rgba(255,138,138,' + a + ')'; ctx.lineWidth = 3; ctx.stroke();
          }
        } else warnFlash = null;
      }
    }

    // ヒントの矢印
    if (hintMove && hintMove.from !== hintMove.to) {
      var x1 = PX[hintMove.from], x2 = PX[hintMove.to], yA = 118, top2 = yA - 44 - Math.abs(x2 - x1) * 0.12;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,209,102,' + (0.55 + pulse * 0.45) + ')';
      ctx.lineWidth = 4; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -now / 30;
      ctx.beginPath(); ctx.moveTo(x1, yA);
      ctx.quadraticCurveTo((x1 + x2) / 2, top2, x2, yA); ctx.stroke();
      ctx.setLineDash([]);
      var ang = Math.atan2(yA - top2, (x2 - x1) / 2); // 終点での接線の向き
      ctx.fillStyle = ctx.strokeStyle;
      ctx.translate(x2, yA); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-12, -9); ctx.lineTo(-12, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // カーソル ▼
    if (cur > 0 && !cleared) {
      var cy = 18 + Math.sin(now / 200) * 3;
      ctx.fillStyle = '#7ce7ff';
      ctx.beginPath(); ctx.moveTo(PX[cur - 1] - 13, cy - 8); ctx.lineTo(PX[cur - 1] + 13, cy - 8); ctx.lineTo(PX[cur - 1], cy + 8); ctx.closePath(); ctx.fill();
    }

    // 円盤（持ち上げ中のものは最後に描いて最前面へ）
    var t = (now - clearAt) / 1000;
    for (p = 0; p < 3; p++) {
      for (var i = 0; i < pegs[p].length; i++) {
        var d = disks[pegs[p][i]];
        var glow = cleared ? Math.max(0, Math.sin(t * 5 - (N - d.k) * 0.6)) : 0;
        drawDisk(d, now, glow);
      }
    }
    if (held) drawDisk(disks[held.k], now, 0.4 + pulse * 0.3);

    // クリア演出
    if (cleared) {
      for (i = particles.length - 1; i >= 0; i--) {
        var q = particles[i];
        q.x += q.vx; q.y += q.vy; q.vy += 0.28; q.vx *= 0.99; q.life -= 0.009;
        if (q.life <= 0 || q.y > 520) { particles.splice(i, 1); continue; }
        ctx.fillStyle = 'hsla(' + q.h + ',100%,65%,' + q.life + ')';
        ctx.fillRect(q.x - 3, q.y - 3, 6, 6);
      }
      var sc = Math.min(1, t * 3);
      ctx.save();
      ctx.translate(300, 70);
      ctx.scale(0.6 + sc * 0.4, 0.6 + sc * 0.4);
      ctx.globalAlpha = sc;
      ctx.font = '900 52px -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(123,255,176,0.8)'; ctx.shadowBlur = 20;
      ctx.fillStyle = '#7bffb0';
      ctx.fillText(hist.length === minMoves() ? 'PERFECT!' : 'CLEAR!', 0, 0);
      ctx.restore();
    }
  }

  function frame(now) {
    if (mode === 'game') { stepDisks(); draw(now); }
    paintHud();
    requestAnimationFrame(frame);
  }

  // ---------- 画面とメニュー ----------
  var howtoFromGame = false;
  function show(id) {
    ['title', 'game', 'menu', 'howto'].forEach(function (s) { el(s).classList.toggle('hidden', s !== id); });
  }
  function setMenu(listId, items, idx) {
    menuEl = listId; menuItems = items; menuIdx = idx || 0;
    paintMenu();
  }
  function paintMenu() {
    var list = el(menuEl);
    list.innerHTML = '';
    menuItems.forEach(function (it, i) {
      var b = document.createElement('div');
      b.className = 'rail-btn' + (i === menuIdx ? ' cur' : '');
      var label = typeof it.label === 'function' ? it.label() : it.label;
      var sub = typeof it.sub === 'function' ? it.sub() : it.sub;
      b.innerHTML = '<span>' + label + '</span>' + (sub ? '<small>' + sub + '</small>' : '');
      b.addEventListener('click', function () { menuIdx = i; paintMenu(); it.act(); });
      list.appendChild(b);
    });
  }

  function bestText() {
    var b = store.best[N];
    return 'ベスト（' + N + '枚）' + (b && b.m ? b.m + '手 ・ ' + fmtTime(b.t) : '—') + ' ・ クリア ' + store.clears + '回';
  }
  function goTitle() {
    mode = 'title';
    timerStop();
    show('title');
    el('title-sub').innerHTML = '円盤をぜんぶ、右の柱へ移すパズル<br>' + bestText();
    setMenu('title-list', [
      { label: '▶ はじめる', act: newGame },
      { label: function () { return '円盤　◀ ' + N + '枚 ▶'; }, sub: function () { return '最短 ' + minMoves() + '手'; },
        act: function () { setN(N >= 7 ? 3 : N + 1); }, lr: function (dir) { setN(N + dir < 3 ? 7 : N + dir > 7 ? 3 : N + dir); } },
      { label: 'つかいかた', act: function () { goHowto(goTitle, false); } }
    ], menuEl === 'title-list' ? menuIdx : 0);
  }
  function setN(n) {
    N = n; store.n = n;
    save();
    goTitle();
  }
  function goHowto(back, fromGame) {
    mode = 'howto';
    howtoBack = back; howtoFromGame = fromGame;
    show('howto');
    setMenu('howto-list', [{ label: '← もどる', act: function () { howtoBack(); } }]);
  }
  function pauseMenu(idx) {
    putBack();
    timerStop();
    mode = 'menu';
    show('menu');
    el('menu-title').textContent = 'メニュー';
    el('menu-sub').textContent = N + '枚 ・ 手数 ' + hist.length + '（最短 ' + minMoves() + '）・ ' + fmtTime(elapsed());
    setMenu('menu-list', [
      { label: '← もどる', act: backToGame },
      { label: 'やりなおす', act: newGame },
      { label: '1手もどす', sub: hist.length ? '' : 'まだ動かしていない', act: function () {
        backToGame();
        if (!undo()) toast('もどせる手がないよ', true);
        paintUI();
      } },
      { label: 'ヒント', sub: '次の最短手を光らせる', act: function () {
        backToGame();
        var m = nextMove();
        if (m) { hintMove = { from: m.from, to: m.to }; cur = m.from + 1; }
        paintUI();
      } },
      { label: 'つかいかた', act: function () { goHowto(function () { pauseMenu(4); }, true); } },
      { label: 'タイトルへ', act: goTitle }
    ], idx || 0);
  }
  function backToGame() {
    mode = 'game';
    show('game');
    if (hist.length) timerStart();
    paintUI();
  }
  function winMenu(isBest) {
    mode = 'menu';
    show('menu');
    var moves = hist.length, perfect = moves === minMoves();
    el('menu-title').textContent = perfect ? '🎉 パーフェクト！' : '🎉 クリア！';
    el('menu-sub').innerHTML = N + '枚を <span class="big">' + moves + '手</span>（最短 ' + minMoves() + '手）・ ' + fmtTime(elapsed()) +
      (isBest ? '<br><span class="gold">ベスト更新！</span>' : '') +
      (!perfect ? '<br>あと ' + (moves - minMoves()) + '手 へらせる' : '');
    var items = [{ label: '▶ もう一度', act: newGame }];
    if (N < 7) items.push({ label: '＋1枚でちょうせん', sub: (N + 1) + '枚・最短 ' + (Math.pow(2, N + 1) - 1) + '手', act: function () { N++; store.n = N; save(); newGame(); } });
    items.push({ label: 'タイトルへ', act: goTitle });
    setMenu('menu-list', items);
  }

  // ---------- キー ----------
  function menuKey(key) {
    var it = menuItems[menuIdx];
    if (key === 'ArrowUp') { menuIdx = (menuIdx + menuItems.length - 1) % menuItems.length; paintMenu(); }
    else if (key === 'ArrowDown') { menuIdx = (menuIdx + 1) % menuItems.length; paintMenu(); }
    else if ((key === 'ArrowLeft' || key === 'ArrowRight') && it && it.lr) it.lr(key === 'ArrowLeft' ? -1 : 1);
    else if (key === 'Enter' || key === ' ') { if (it) it.act(); }
    else return false;
    return true;
  }
  function gameKey(key) {
    if (cleared) return true;
    if (key === 'ArrowLeft') moveCursor(-1);
    else if (key === 'ArrowRight') moveCursor(1);
    else if (key === 'Enter' || key === ' ') tap();
    else if (key === 'ArrowUp' || key === 'ArrowDown') return true;
    else return false;
    return true;
  }
  function handleKey(key) {
    if (key === 'Escape') { // PC確認用の補助（グラスでは戻るジェスチャーが使えない）
      if (mode === 'howto') howtoBack();
      else if (mode === 'game' && !cleared) pauseMenu();
      else if (mode === 'menu' && !cleared) backToGame();
      else if (mode === 'menu') goTitle();
      return true;
    }
    return mode === 'game' ? gameKey(key) : menuKey(key);
  }

  document.addEventListener('keydown', function (e) {
    if (AUTO && e.isTrusted && mode === 'game') { e.preventDefault(); return; }
    if (e.repeat) { e.preventDefault(); return; }
    if (handleKey(e.key)) e.preventDefault();
  });
  cv.addEventListener('click', function (e) {
    if (mode !== 'game' || cleared || AUTO) return;
    var r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * 600 / r.width;
    var p = x < 205 ? 0 : x < 395 ? 1 : 2;
    if (cur !== p + 1) { cur = p + 1; if (held) liftTo(disks[held.k], PX[p]); }
    tap();
  });
  el('menu-btn').addEventListener('click', function () {
    if (mode !== 'game' || cleared || AUTO) return;
    cur = 0; tap();
  });

  // ---------- 自動再生（デモ録画用） ----------
  var autoT = 0, autoQ = [], autoMistake = false;
  function navKeys(from, to) {
    var out = [];
    while (from !== to) { out.push(from < to ? 'ArrowRight' : 'ArrowLeft'); from += from < to ? 1 : -1; }
    return out;
  }
  function autoPlan() {
    var m = nextMove();
    if (!m) return;
    var c = cur < 1 ? 1 : cur;
    autoQ = navKeys(c, m.from + 1);
    autoQ.push('Enter');
    // 1回だけ「置けない柱」に置こうとして揺れる様子を見せる
    var bad = -1;
    if (!autoMistake && hist.length === 3) {
      for (var p = 0; p < 3; p++) {
        var top = pegs[p][pegs[p].length - 1];
        if (p !== m.from && p !== m.to && top && top < m.k) bad = p;
      }
    }
    if (bad >= 0) {
      autoMistake = true;
      autoQ = autoQ.concat(navKeys(m.from + 1, bad + 1), ['Enter', 'WAIT'], navKeys(bad + 1, m.to + 1), ['Enter']);
    } else {
      hintMove = { from: m.from, to: m.to };
      autoQ = autoQ.concat(navKeys(m.from + 1, m.to + 1), ['Enter']);
    }
    paintUI();
  }
  function autoTick() {
    if (mode !== 'game' || cleared) return;
    if (!autoQ.length) autoPlan();
    var k = autoQ.shift();
    if (!k) return;
    var wasHeld = !!held;
    if (k !== 'WAIT') handleKey(k);
    var wait = k === 'WAIT' ? 650 : k !== 'Enter' ? 150 : wasHeld && !held ? 260 : 190;
    autoT = setTimeout(autoTick, wait);
  }

  load();
  N = AUTO ? (nM ? +nM[1] : 4) : (nM ? +nM[1] : store.n);
  goTitle();
  requestAnimationFrame(frame);
})();
