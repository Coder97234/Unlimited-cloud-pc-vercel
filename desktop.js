/* eslint-disable no-undef */
/**
 * The browser desktop.
 *
 * If VM_DESKTOP_URL is configured (server.js / api/vm-config) this page becomes a thin shell
 * around the REAL Windows machine and nothing below the iframe matters.
 * Otherwise it boots a self-contained desktop so the site is usable with no VM at all.
 */
(function () {
  var shell = document.getElementById('dtRoot');
  var frame = document.getElementById('dtFrame');
  var chrome = document.getElementById('dtChrome');
  var stateText = document.getElementById('dtState');
  var stateDot = document.getElementById('dtStateDot');
  var openLink = document.getElementById('dtOpen');
  var stopLink = document.getElementById('dtStop');

  // ---------------------------------------------------------------- VM mode
  function connectVM(cfg) {
    frame.src = cfg.desktopUrl + (cfg.desktopUrl.indexOf('?') === -1 ? '?' : '&') + 'autoconnect=1&resize=scale';
    frame.hidden = false;
    chrome.hidden = true;
    stateDot.className = 'dot';
    stateText.textContent = cfg.label || 'Windows 10';
    openLink.hidden = false;
    openLink.onclick = function () {
      window.open(cfg.directUrl || cfg.desktopUrl, '_blank', 'noopener');
    };
    document.title = (cfg.label || 'Windows 10') + ' — PC-Free';
  }

  fetch('api/vm-config')
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (cfg) {
      if (cfg && cfg.desktopUrl) connectVM(cfg);
      else bootDemo();
    })
    .catch(bootDemo);

  // ------------------------------------------------------------- demo mode
  var APPS = {
    files:   { name: 'File Explorer', icon: '📁', w: 560, h: 380, render: renderFiles },
    notepad: { name: 'Notepad',      icon: '📝', w: 480, h: 360, render: renderNotepad },
    calc:    { name: 'Calculator',   icon: '🧮', w: 268, h: 372, render: renderCalc },
    term:    { name: 'Terminal',     icon: '⌨️', w: 560, h: 340, render: renderTerm },
    settings:{ name: 'Settings',     icon: '⚙️', w: 470, h: 400, render: renderSettings },
    guide:   { name: 'Connect a real PC', icon: '🖥️', w: 540, h: 470, render: renderGuide },
    about:   { name: 'About PC-Free', icon: 'ℹ️', w: 430, h: 320, render: renderAbout }
  };

  var zTop = 20;
  var openWindows = {};
  var clockTimer = null;

  function bootDemo() {
    if (shell.dataset.booted) return;
    shell.dataset.booted = '1';
    stateDot.className = 'dot demo';
    stateText.textContent = 'demo desktop';
    stopLink.hidden = true;
    document.title = 'Windows 10 (demo) — PC-Free';
    startClock();
    bindTaskbar();
    bindIcons();
    toast(
      '<b>This is the desktop, running in demo mode.</b> It works, but it is not a real Windows ' +
      'machine yet. Start the VM (<code>docker compose -f windows10.yml up -d</code>), put its ' +
      'port 8006 address in <code>.env</code> as <code>VM_DESKTOP_URL</code>, restart ' +
      '<code>npm start</code> — then this same page becomes the live Windows desktop. ' +
      'Open <a href="#" data-open="guide">Connect a real PC</a> for the full steps.'
    );
    open('files');
  }

  // --------------------------------------------------------------- clock
  function startClock() {
    var el = document.getElementById('dtClock');
    function tick() {
      var d = new Date();
      el.innerHTML =
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
        '<br>' + d.toLocaleDateString([], { month: '2-digit', day: '2-digit', year: 'numeric' });
    }
    tick();
    clockTimer = setInterval(tick, 15000);
  }

  // ------------------------------------------------------------- taskbar
  function bindTaskbar() {
    var startBtn = document.getElementById('dtStartBtn');
    var startMenu = document.getElementById('dtStart');
    startBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      startMenu.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      if (!startMenu.contains(e.target)) startMenu.classList.remove('open');
    });
    document.querySelectorAll('.dt-start-app').forEach(function (b) {
      b.addEventListener('click', function () {
        startMenu.classList.remove('open');
        open(b.dataset.app);
      });
    });
    document.getElementById('dtLock').addEventListener('click', function () {
      startMenu.classList.remove('open');
      toast('A real lock screen appears when a Windows machine is connected.');
    });
  }

  function bindIcons() {
    document.querySelectorAll('.dt-icon').forEach(function (icon) {
      icon.addEventListener('dblclick', function () { open(icon.dataset.app); });
      icon.addEventListener('click', function () {
        document.querySelectorAll('.dt-icon').forEach(function (i) { i.style.background = ''; });
        icon.style.background = 'rgba(0,120,212,0.35)';
      });
    });
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-open]') : null;
      if (t) { e.preventDefault(); open(t.dataset.open); }
    });
  }

  // -------------------------------------------------------------- windows
  function open(id) {
    var app = APPS[id];
    if (!app) return;
    var win = openWindows[id];
    if (win) {
      win.el.classList.remove('minimized');
      focusWin(id);
      return;
    }
    var el = document.createElement('div');
    el.className = 'dt-window';
    var w = Math.min(app.w, Math.max(260, window.innerWidth - 40));
    var h = Math.min(app.h, Math.max(160, window.innerHeight - 130));
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.left = Math.max(16, Math.round((window.innerWidth - w) / 2 - 40 + Object.keys(openWindows).length * 24)) + 'px';
    el.style.top = Math.max(16, Math.round((window.innerHeight - h) / 2 - 34 + Object.keys(openWindows).length * 20)) + 'px';
    el.style.zIndex = ++zTop;
    el.innerHTML =
      '<div class="dt-titlebar">' +
        '<span class="t-icon">' + app.icon + '</span>' +
        '<span class="t-name">' + app.name + '</span>' +
        '<div class="dt-win-btns">' +
          '<button class="min" title="Minimize">—</button>' +
          '<button class="max" title="Maximize">▢</button>' +
          '<button class="close" title="Close">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="dt-win-body"></div>' +
      '<div class="dt-resize"></div>';

    var body = el.querySelector('.dt-win-body');
    app.render(body, el);
    document.getElementById('dtDesktop').appendChild(el);
    openWindows[id] = { el: el, app: app, title: el.querySelector('.t-name') };

    el.addEventListener('mousedown', function () { focusWin(id); });

    el.querySelector('.close').addEventListener('click', function (e) {
      e.stopPropagation();
      close(id);
    });
    el.querySelector('.min').addEventListener('click', function (e) {
      e.stopPropagation();
      el.classList.add('minimized');
      syncTaskbar();
    });
    el.querySelector('.max').addEventListener('click', function (e) {
      e.stopPropagation();
      el.classList.toggle('maximized');
    });

    dragify(el, el.querySelector('.dt-titlebar'));
    resizeify(el, el.querySelector('.dt-resize'));

    addTaskButton(id, app);
    focusWin(id);
  }

  function close(id) {
    var win = openWindows[id];
    if (!win) return;
    win.el.remove();
    delete openWindows[id];
    var b = document.querySelector('.dt-task-' + id);
    if (b) b.remove();
    syncTaskbar();
  }

  function focusWin(id) {
    var win = openWindows[id];
    if (!win) return;
    win.el.style.zIndex = ++zTop;
    Object.keys(openWindows).forEach(function (k) {
      var b = document.querySelector('.dt-task-' + k);
      if (b) b.classList.toggle('active', k === id);
    });
  }

  function addTaskButton(id, app) {
    var taskbar = document.getElementById('dtTasks');
    var b = document.createElement('button');
    b.className = 'dt-tb-btn running dt-task-' + id;
    b.title = app.name;
    b.textContent = app.icon;
    b.addEventListener('click', function () {
      var win = openWindows[id];
      if (!win) return;
      if (win.el.classList.contains('minimized')) {
        win.el.classList.remove('minimized');
        focusWin(id);
      } else if (win.el.style.zIndex == zTop) {
        win.el.classList.add('minimized');
      } else {
        focusWin(id);
      }
      syncTaskbar();
    });
    taskbar.appendChild(b);
  }

  function syncTaskbar() {
    Object.keys(openWindows).forEach(function (id) {
      var b = document.querySelector('.dt-task-' + id);
      if (!b) return;
      b.classList.toggle('running', !openWindows[id].el.classList.contains('minimized'));
    });
  }

  function dragify(el, handle) {
    handle.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      if (el.classList.contains('maximized')) return;
      var sx = e.clientX, sy = e.clientY;
      var ox = el.offsetLeft, oy = el.offsetTop;
      function move(ev) {
        el.style.left = Math.max(0, Math.min(window.innerWidth - 80, ox + ev.clientX - sx)) + 'px';
        el.style.top = Math.max(0, Math.min(window.innerHeight - 90, oy + ev.clientY - sy)) + 'px';
      }
      function up() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    });
  }

  function resizeify(el, grip) {
    grip.addEventListener('mousedown', function (e) {
      var sw = el.offsetWidth, sh = el.offsetHeight, sx = e.clientX, sy = e.clientY;
      function move(ev) {
        el.style.width = Math.max(280, sw + ev.clientX - sx) + 'px';
        el.style.height = Math.max(170, sh + ev.clientY - sy) + 'px';
      }
      function up() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    });
  }

  // ---------------------------------------------------------------- apps
  function renderFiles(body) {
    body.innerHTML =
      '<div class="dt-files">' +
        '<div class="side">' +
          '<div class="cur" data-folder="This PC">This PC</div>' +
          '<div data-folder="Desktop">Desktop</div>' +
          '<div data-folder="Documents">Documents</div>' +
          '<div data-folder="Downloads">Downloads</div>' +
          '<div data-folder="Shared">Shared (VM folder)</div>' +
        '</div>' +
        '<div class="main"></div>' +
      '</div>';
    var folders = {
      'This PC': [
        ['Local Disk (C:)', '💽'], ['Windows (C:\\Windows)', '🗂️'], ['Shared folder', '📂'],
        ['PC-Free.lnk', '🔗'], ['README.txt', '📄']
      ],
      Desktop: [['README.txt', '📄'], ['Connect a real PC.lnk', '🖥️']],
      Documents: [['notes.txt', '📄'], ['passwords — do not store here.txt', '📄']],
      Downloads: [['windows10.yml', '📄'], ['.env.example', '📄']],
      Shared: [['(empty — mount ./shared in windows10.yml)', '📁']]
    };
    var main = body.querySelector('.main');
    function paint(name) {
      main.innerHTML = '';
      (folders[name] || []).forEach(function (f) {
        var d = document.createElement('div');
        d.className = 'dt-file';
        d.innerHTML = '<span class="glyph">' + f[1] + '</span>' + f[0];
        d.addEventListener('dblclick', function () {
          if (f[0] === 'README.txt') open('notepad');
          else if (f[0].indexOf('Connect a real PC') === 0) open('guide');
          else if (f[0] === 'notes.txt') open('notepad');
          else toast('“' + f[0] + '” is a placeholder — real files live inside the VM.');
        });
        main.appendChild(d);
      });
    }
    body.querySelectorAll('.side div').forEach(function (row) {
      row.addEventListener('click', function () {
        body.querySelectorAll('.side div').forEach(function (r) { r.classList.remove('cur'); });
        row.classList.add('cur');
        paint(row.dataset.folder);
      });
    });
    paint('This PC');
  }

  var NOTEPAD_TEXT =
    'PC-Free — clipboard\r\n' +
    '===================\r\n\r\n' +
    'This Notepad is part of the demo desktop, so anything you type stays in the\r\n' +
    'browser tab and is not saved.\r\n\r\n' +
    'Once a real machine is connected, use the Windows build of Notepad inside\r\n' +
    'the desktop instead — files there are persisted in the container volume.\r\n';

  function renderNotepad(body) {
    var ta = document.createElement('textarea');
    ta.className = 'dt-notepad';
    ta.spellcheck = false;
    ta.value = NOTEPAD_TEXT;
    body.appendChild(ta);
    ta.focus();
  }

  function renderTerm(body) {
    body.innerHTML = '<div class="dt-term"><div class="out"></div></div>';
    var term = body.querySelector('.dt-term');
    var out = term.querySelector('.out');
    var history = [];

    function println(html, cls) {
      var d = document.createElement('div');
      d.className = 'line' + (cls ? ' ' + cls : '');
      d.innerHTML = html;
      out.appendChild(d);
      term.scrollTop = term.scrollHeight;
    }

    var banner = [
      ['PC-Free demo shell — not a real Windows prompt.', 'dim'],
      ['Type <b>help</b>. A real terminal appears once the VM is connected.', 'dim'],
      ['']
    ];
    banner.forEach(function (b) { println(b[0], b[1]); });

    var form = document.createElement('div');
    form.className = 'line';
    form.innerHTML = '<span class="dim">PS C:\\Users\\you&gt;</span> <input type="text" autocomplete="off" spellcheck="false">';
    out.appendChild(form);
    var input = form.querySelector('input');

    var cmds = {
      help: function () {
        println('  help              this list');
        println('  docker compose -f windows10.yml up -d    start the real machine');
        println('  echo $VM_DESKTOP_URL                     what the site will connect to');
        println('  connect           open the connect guide');
        println('  clear             clear the screen');
      },
      connect: function () { open('guide'); },
      clear: function () { out.innerHTML = ''; },
      'docker compose -f windows10.yml up -d': function () {
        println('demo shell — nothing is really running here.', 'dim');
        println('Run this on the machine that has Docker + /dev/kvm.', 'dim');
        open('guide');
      },
      'echo $vm_desktop_url': function () {
        println('(unset) — add it to .env, e.g. http://localhost:8006', 'dim');
      }
    };

    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var raw = input.value;
      var cmd = raw.trim();
      history.push(raw);
      println('<span class="dim">PS C:\\Users\\you&gt;</span> ' + escapeHtml(raw));
      input.value = '';
      if (!cmd) return;
      var fn = cmds[cmd.toLowerCase()];
      if (fn) fn();
      else println('“' + escapeHtml(cmd) + '” is not recognised in the demo shell — try <b>help</b>.', 'err');
    });

    input.focus();
    term.addEventListener('click', function (e) {
      if (e.target !== input) input.focus();
    });
  }

  function renderCalc(body) {
    body.innerHTML =
      '<div class="dt-calc">' +
        '<div class="screen"><small>&nbsp;</small><span id="calcVal">0</span></div>' +
        '<div class="keys"></div>' +
      '</div>';
    var valEl = body.querySelector('#calcVal');
    var memoEl = body.querySelector('.screen small');
    var keys = body.querySelector('.keys');
    var keyset = [
      ['C', 'c'], ['⌫', 'back'], ['%', 'op'], ['÷', 'op'],
      ['7', 'n'], ['8', 'n'], ['9', 'n'], ['×', 'op'],
      ['4', 'n'], ['5', 'n'], ['6', 'n'], ['−', 'op'],
      ['1', 'n'], ['2', 'n'], ['3', 'n'], ['+', 'op'],
      ['±', 'n'], ['0', 'n'], ['.', 'n'], ['=', 'eq']
    ];
    var cur = '0', prev = null, op = null, fresh = true;
    var ops = { '÷': '/', '×': '*', '−': '-', '+': '+' };

    keyset.forEach(function (k) {
      var b = document.createElement('button');
      b.textContent = k[0];
      if (k[1] === 'op') b.className = 'op';
      if (k[1] === 'eq') b.className = 'eq';
      b.addEventListener('click', function () { press(k[0]); });
      keys.appendChild(b);
    });

    function show() {
      valEl.textContent = cur;
      memoEl.innerHTML = prev !== null && op ? prev + ' ' + op : '&nbsp;';
    }
    function calc(a, b, o) {
      a = parseFloat(a); b = parseFloat(b);
      if (o === '+') return a + b;
      if (o === '-') return a - b;
      if (o === '*') return a * b;
      if (o === '/') return b === 0 ? 'Cannot divide by zero' : a / b;
      return b;
    }
    function press(k) {
      if (/^[0-9]$/.test(k)) {
        cur = fresh || cur === '0' ? k : cur + k;
        fresh = false;
      } else if (k === '.') {
        if (fresh) { cur = '0.'; fresh = false; }
        else if (cur.indexOf('.') === -1) cur += '.';
      } else if (k === 'C') {
        cur = '0'; prev = null; op = null; fresh = true;
      } else if (k === '⌫') {
        cur = cur.length > 1 ? cur.slice(0, -1) : '0';
      } else if (k === '±') {
        cur = cur.charAt(0) === '-' ? cur.slice(1) : '-' + cur;
      } else if (k === '%') {
        cur = String(parseFloat(cur) / 100);
      } else if (ops[k]) {
        if (op && !fresh) {
          cur = String(calc(prev, cur, ops[op]));
        }
        prev = cur; op = k; fresh = true;
      } else if (k === '=') {
        if (op) {
          cur = String(calc(prev, cur, ops[op]));
          prev = null; op = null; fresh = true;
        }
      }
      show();
    }
    show();
  }

  var WALLS = [
    ['#0a2a5e', 'radial-gradient(120% 120% at 20% 10%, #1b4f9c 0%, #0b3d7a 35%, #06224a 70%, #04142c 100%)'],
    ['#3b0a2a', 'radial-gradient(120% 120% at 25% 15%, #8e2d63 0%, #5c1a44 40%, #2b0a20 75%, #12040c 100%)'],
    ['#0a3b2b', 'radial-gradient(120% 120% at 30% 10%, #1f7a5c 0%, #10543f 40%, #052a20 75%, #03140f 100%)'],
    ['#2a2a2f', 'radial-gradient(120% 120% at 30% 15%, #4d4d57 0%, #303039 45%, #1b1b21 80%, #0d0d10 100%)'],
    ['#4a2a05', 'radial-gradient(120% 120% at 25% 12%, #a86a1c 0%, #71460f 42%, #3a2305 78%, #170d02 100%)']
  ];

  function renderSettings(body) {
    body.innerHTML =
      '<div class="dt-set">' +
        '<h3>Background</h3><div class="row"></div>' +
        '<h3>Accent colour</h3><div class="accents"></div>' +
        '<h3>About this shell</h3>' +
        '<div class="meta">' +
          'Browser desktop · demo mode<br>' +
          'Real machine: <code>windows10.yml</code> (dockurr/windows, noVNC on port 8006)<br>' +
          'Server: <code>server.js</code> on Node<br>' +
          'No ads, no tracking, no accounts.' +
        '</div>' +
      '</div>';
    var row = body.querySelector('.row');
    WALLS.forEach(function (w, i) {
      var b = document.createElement('button');
      b.className = 'dt-sw' + (i === 0 ? ' on' : '');
      b.style.background = w[1];
      b.addEventListener('click', function () {
        shell.style.setProperty('--wall', w[1]);
        document.getElementById('dtWall').style.background = w[1];
        body.querySelectorAll('.dt-sw').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
      row.appendChild(b);
    });
    var accents = body.querySelector('.accents');
    ['#0078d4', '#d13438', '#107c10', '#8764b8', '#ff8c00'].forEach(function (c, i) {
      var b = document.createElement('button');
      b.style.background = c;
      if (i === 0) b.className = 'on';
      b.addEventListener('click', function () {
        document.documentElement.style.setProperty('--accent', c);
        shell.style.setProperty('--accent', c);
        accents.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
      accents.appendChild(b);
    });
  }

  function renderGuide(body) {
    body.innerHTML =
      '<div class="dt-pad">' +
        '<h3>Turn this into a real Windows PC</h3>' +
        '<p>The page you are looking at is a browser desktop. To get a full Windows 10 machine ' +
        'in the same tab, run the container and point the site at it:</p>' +
        '<p><code>docker compose -f windows10.yml up -d</code><br>' +
        'The desktop comes up on port <code>8006</code>.</p>' +
        '<p>Then create <code>.env</code> next to <code>server.js</code>:</p>' +
        '<p><code>VM_DESKTOP_URL=http://localhost:8006</code></p>' +
        '<p>Restart <code>npm start</code> and reload this page — the real desktop replaces this ' +
        'shell. Nothing else to configure.</p>' +
        '<p>No Docker machine handy? Run the same container inside a GitHub Codespace and use its ' +
        '<code>https://…-8006.app.github.dev</code> URL instead.</p>' +
        '<p style="color:#f0b429">The sandbox this repo was set up in has no Docker and no ' +
        '/dev/kvm, so the Windows box cannot run on the server hosting these pages — it has to run ' +
        'where the hardware is.</p>' +
      '</div>';
  }

  function renderAbout(body) {
    body.innerHTML =
      '<div class="dt-pad">' +
        '<h3>PC-Free</h3>' +
        '<p>Windows 10 in a browser tab. Static pages served by <code>server.js</code>; the machine ' +
        'is a <code>dockurr/windows</code> container exposed over noVNC on port 8006.</p>' +
        '<p>This desktop shell is a self-contained stand-in that runs with zero setup — windows, ' +
        'taskbar, settings, calculator, terminal and a text editor, all local.</p>' +
        '<p style="color:#93a6ba;font-size:11.5px">No ads · no analytics · no accounts · single user</p>' +
      '</div>';
  }

  // ---------------------------------------------------------------- toast
  function toast(html) {
    var existing = document.querySelector('.dt-toast');
    if (existing) existing.remove();
    var t = document.createElement('div');
    t.className = 'dt-toast';
    t.innerHTML = '<button title="Dismiss">✕</button><div>' + html + '</div>';
    t.querySelector('button').addEventListener('click', function () { t.remove(); });
    shell.appendChild(t);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var sm = document.getElementById('dtStart');
      if (sm) sm.classList.remove('open');
    }
  });

  window.addEventListener('beforeunload', function () {
    if (clockTimer) clearInterval(clockTimer);
  });
})();
