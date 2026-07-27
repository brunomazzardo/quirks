// Client-side helper for the shape companion. Adapted from Superpowers'
// visual-companion helper (MIT) — session key renamed, API exposed as
// window.shape. Transport diverges from upstream: SSE + fetch POST instead of
// WebSocket, because the Bun-run server has no upgrade support (see server.cjs).
(function() {
  const TOMBSTONE_AFTER_MS = 15000; // show the "paused" overlay after this long disconnected

  function escapeHtml(v) {
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Pure: proposal JSON → tree-preview markup (QK-COMP-002). The JSON mirrors
  // what the session will record through `quirks goal new` / `task propose`, so
  // the thing the operator reviews is the thing that gets written. Task nodes
  // are clickable (multiselect): a click means "discuss this one".
  //
  // Shape: { proposals: [ { goal: {id,title,why,doneWhen[]},
  //                         tasks: [ {id,title,dependsOn[],deliverables[],
  //                                   criteria[],verify[],flags[],note} ] } ] }
  function buildProposalHtml(proposal) {
    const groups = (proposal && proposal.proposals) || [];
    return groups.map(function(group) {
      const goal = group.goal || {};
      const tasks = group.tasks || [];
      let html = '<div class="tree" data-multiselect>';
      html += '<div class="tree-goal">' +
        '<div class="tree-goal-head"><span class="tid">' + escapeHtml(goal.id || '(no goal)') + '</span>' +
        '<h3>' + escapeHtml(goal.title || '') + '</h3></div>' +
        (goal.why ? '<p class="twhy">' + escapeHtml(goal.why) + '</p>' : '') +
        (goal.doneWhen || []).map(function(c) {
          return '<div class="tdone">done when: ' + escapeHtml(c) + '</div>';
        }).join('') +
        '</div>';
      html += tasks.map(function(t) {
        const flags = (t.flags || []).map(function(f) {
          return '<span class="badge badge-flag">' + escapeHtml(f) + '</span>';
        }).join('');
        const deps = (t.dependsOn || []).map(function(d) {
          return '<span class="dep">after ' + escapeHtml(d) + '</span>';
        }).join('');
        function list(label, items, cls) {
          if (!items || !items.length) return '';
          return '<div class="label">' + label + '</div><ul class="tlist' + (cls ? ' ' + cls : '') + '">' +
            items.map(function(x) { return '<li>' + escapeHtml(x) + '</li>'; }).join('') + '</ul>';
        }
        return '<div class="tnode" tabindex="0" role="button" data-choice="task:' + escapeHtml(t.id || '') + '" onclick="toggleSelect(this)">' +
          '<div class="tnode-head"><span class="tid">' + escapeHtml(t.id || '?') + '</span>' +
          '<h3>' + escapeHtml(t.title || '') + '</h3>' + flags + deps + '</div>' +
          (t.note ? '<p class="twhy">' + escapeHtml(t.note) + '</p>' : '') +
          list('deliverables', t.deliverables) +
          list('accepted when', t.criteria, 'tcrit') +
          list('verified by', t.verify, 'tverify') +
          '</div>';
      }).join('');
      return html + '</div>';
    }).join('');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TOMBSTONE_AFTER_MS, buildProposalHtml, escapeHtml };
  }

  // Everything below is browser-only; bail out when loaded outside one (tests).
  if (typeof window === 'undefined') return;

  let es = null;
  let eventQueue = [];
  let disconnectedSince = null;
  let everConnected = false;
  let tombstoneShown = false;

  function sessionKey() {
    try {
      return window.sessionStorage && window.sessionStorage.getItem('shape-session-key');
    } catch (e) {}
    return null;
  }

  // The key rides the query string when we have it; otherwise the HttpOnly
  // session cookie (set at bootstrap) authenticates same-origin requests.
  function keyedPath(pathname) {
    const key = sessionKey();
    return pathname + (key ? '?key=' + encodeURIComponent(key) : '');
  }

  function reloadAfterRecovery() {
    const key = sessionKey();
    if (key) {
      window.location.replace('/?key=' + encodeURIComponent(key));
    } else {
      window.location.reload();
    }
  }

  // Reflect connection state in the frame's status pill (absent on full-doc screens).
  function setStatus(state) {
    const el = document.querySelector('.status');
    if (!el) return;
    const map = {
      connecting:   ['Connecting…',   'var(--text-tertiary)'],
      connected:    ['Connected',     'var(--success)'],
      reconnecting: ['Reconnecting…', 'var(--warning)'],
      disconnected: ['Disconnected',  'var(--error)']
    };
    const [text, color] = map[state] || map.disconnected;
    el.textContent = text;
    el.style.setProperty('--status-color', color);
  }

  // Self-styled so it works on framed and full-document screens alike.
  function showTombstone() {
    if (tombstoneShown) return;
    tombstoneShown = true;
    const el = document.createElement('div');
    el.id = 'shape-tombstone';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;' +
      'align-items:center;justify-content:center;padding:2rem;text-align:center;' +
      'background:rgba(20,20,22,0.92);color:#f5f5f7;font-family:system-ui,sans-serif';
    el.innerHTML = '<div style="max-width:480px">' +
      '<h2 style="margin:0 0 .5rem;font-weight:600">Companion paused</h2>' +
      '<p style="margin:0;opacity:.85">The shape companion has stopped. ' +
      'Ask the agent to bring it back — this page reconnects automatically.</p></div>';
    if (document.body) document.body.appendChild(el);
  }

  function connect() {
    setStatus(everConnected ? 'reconnecting' : 'connecting');
    es = new EventSource(keyedPath('/events-stream'));

    es.onopen = () => {
      const recovered = tombstoneShown;
      everConnected = true;
      disconnectedSince = null;
      tombstoneShown = false;
      setStatus('connected');
      const queued = eventQueue;
      eventQueue = [];
      queued.forEach(e => sendEvent(e));
      // Recovered from a tombstoned outage (e.g. the server restarted on the same
      // port) — reload through the keyed bootstrap when possible so the cookie is
      // refreshed before the visible URL returns to bare /.
      if (recovered) reloadAfterRecovery();
    };

    es.onmessage = (msg) => {
      let data;
      try { data = JSON.parse(msg.data); } catch (e) { return; }
      if (data.type === 'reload') window.location.reload();
    };

    // EventSource reconnects on its own (server sends retry: 1000); this only
    // tracks how long we've been down and paints the status accordingly.
    es.onerror = () => {
      if (disconnectedSince === null) disconnectedSince = Date.now();
      if (Date.now() - disconnectedSince >= TOMBSTONE_AFTER_MS) {
        setStatus('disconnected');
        showTombstone();
      } else {
        setStatus('reconnecting');
      }
    };
  }

  function sendEvent(event) {
    if (!event.timestamp) event.timestamp = Date.now();
    fetch(keyedPath('/event'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    }).catch(() => { eventQueue.push(event); });
  }

  // Capture clicks on choice elements
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-choice]');
    if (!target) return;

    sendEvent({
      type: 'click',
      text: target.textContent.trim(),
      choice: target.dataset.choice,
      id: target.id || null
    });

  });

  // Keyboard: Enter/Space activate a focused choice, same as a click.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest && e.target.closest('[data-choice]');
    if (!target) return;
    e.preventDefault();
    target.click();
  });

  // Frame UI: selection tracking
  window.selectedChoice = null;

  window.toggleSelect = function(el) {
    const container = el.closest('.options') || el.closest('.cards') || el.closest('.tree');
    const multi = container && container.dataset.multiselect !== undefined;
    if (container && !multi) {
      container.querySelectorAll('.option, .card, .tnode').forEach(o => o.classList.remove('selected'));
    }
    if (multi) {
      el.classList.toggle('selected');
    } else {
      el.classList.add('selected');
    }
    window.selectedChoice = el.dataset.choice;
  };

  // Render any embedded proposal blocks (tree preview): the fragment carries a
  // JSON script block tagged data-proposal and the tree is drawn right after it.
  // Helper is injected at the end of body, so DOM is ready. (No literal closing
  // script tag may appear anywhere in this file — it would terminate the inline
  // script element that carries it; the server also escapes as a backstop.)
  document.querySelectorAll('script[type="application/json"][data-proposal]').forEach(s => {
    let data;
    try { data = JSON.parse(s.textContent); } catch (e) { return; }
    const target = document.createElement('div');
    target.innerHTML = buildProposalHtml(data);
    s.insertAdjacentElement('afterend', target);
  });

  // Expose API for explicit use
  window.shape = {
    send: sendEvent,
    choice: (value, metadata = {}) => sendEvent({ type: 'choice', value, ...metadata }),
    renderProposal: buildProposalHtml
  };

  connect();
})();
