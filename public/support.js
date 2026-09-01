/* Floating customer-support chat. Signed-in members choose between the
   in-app chat (a live thread with the admin) and WhatsApp, when a WhatsApp
   number is saved. Visitors who are not signed in get the saved contacts
   or a nudge to sign in. */
(function () {
  var TOK = '';
  try { TOK = localStorage.getItem('ve_tok') || ''; } catch (e) {}

  var css = document.createElement('style');
  css.textContent =
    /* the hidden attribute must always win over display rules below */
    '.ch-sup [hidden]{display:none!important}' +
    '.ch-sup{position:fixed;right:18px;bottom:18px;z-index:9000;font-family:Archivo,system-ui,sans-serif}' +
    '.ch-sup-btn{position:relative;width:54px;height:54px;border-radius:50%;border:none;cursor:pointer;background:#E41827;color:#fff;font-size:24px;box-shadow:0 8px 24px rgba(228,24,39,.45);display:grid;place-items:center;transition:transform .15s}' +
    '.ch-sup-btn:hover{transform:scale(1.07)}' +
    '.ch-sup-btn:focus-visible{outline:3px solid #9B0C17;outline-offset:2px}' +
    '.ch-sup-dot{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;border-radius:10px;background:#FFCC00;color:#3A2A00;font-size:11px;font-weight:800;display:grid;place-items:center;padding:0 5px;border:2px solid #fff}' +
    '.ch-chat{position:absolute;right:0;bottom:66px;width:min(340px,calc(100vw - 36px));height:440px;max-height:calc(100vh - 120px);background:#F6F7F9;border:1px solid #E8EAEF;border-radius:14px;box-shadow:0 24px 60px rgba(14,20,32,.3);display:flex;flex-direction:column;overflow:hidden}' +
    '.ch-chat-h{background:#E41827;color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px}' +
    '.ch-chat-h b{font-size:15px}' +
    '.ch-chat-h small{display:block;font-weight:500;font-size:11px;opacity:.85}' +
    '.ch-chat-x{margin-left:auto;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:4px;line-height:1}' +
    '.ch-msgs{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:8px}' +
    '.ch-b{max-width:80%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}' +
    '.ch-b.me{align-self:flex-end;background:#E41827;color:#fff;border-bottom-right-radius:4px}' +
    '.ch-b.them{align-self:flex-start;background:#fff;color:#1B1E25;border:1px solid #E8EAEF;border-bottom-left-radius:4px}' +
    '.ch-b time{display:block;font-size:10px;opacity:.65;margin-top:4px}' +
    '.ch-empty{color:#8A93A3;font-size:13px;text-align:center;margin:auto;padding:0 18px;line-height:1.6}' +
    '.ch-in{display:flex;gap:8px;padding:10px;background:#fff;border-top:1px solid #E8EAEF}' +
    '.ch-in textarea{flex:1;border:1px solid #E8EAEF;border-radius:10px;padding:9px 11px;font:14px Archivo,system-ui,sans-serif;resize:none;height:40px;outline:none}' +
    '.ch-in textarea:focus{border-color:#E41827}' +
    '.ch-send{width:40px;height:40px;border-radius:10px;border:none;background:#E41827;color:#fff;font-size:16px;cursor:pointer}' +
    '.ch-send:disabled{opacity:.5}' +
    '.ch-menu{position:absolute;right:0;bottom:66px;background:#fff;border:1px solid #E8EAEF;border-radius:12px;box-shadow:0 18px 40px rgba(14,20,32,.22);overflow:hidden;min-width:230px}' +
    '.ch-menu a,.ch-menu button{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:none;cursor:pointer;padding:12px 16px;color:#1B1E25;text-decoration:none;font:600 14px Archivo,system-ui,sans-serif}' +
    '.ch-menu a:hover,.ch-menu button:hover{background:#FDE8EA;color:#E41827}' +
    '.ch-menu small{display:block;font-weight:500;font-size:11.5px;color:#8A93A3;margin-top:2px}' +
    '.ch-menu .t{padding:10px 16px 8px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8A93A3;border-bottom:1px solid #E8EAEF}';
  document.head.appendChild(css);

  var api = function (method, path, body) {
    return fetch('/api' + path, {
      method: method,
      headers: Object.assign({ 'content-type': 'application/json' }, TOK ? { authorization: 'Bearer ' + TOK } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw d; return d; }); });
  };

  var wrap = document.createElement('div');
  wrap.className = 'ch-sup';

  function waLink(support) {
    var num = String(support.whatsapp || '').replace(/[^\d]/g, '');
    return num ? { num: num, href: 'https://wa.me/' + num } : null;
  }

  /* ---------- signed-in members: chooser + in-app chat ---------- */
  function mountChat(support) {
    var wa = waLink(support);
    wrap.innerHTML =
      (wa
        ? '<div class="ch-menu" hidden><div class="t">Customer Support</div>' +
          '<button type="button" data-act="chat">💬 <span>Chat with an agent<small>Right here, in the app</small></span></button>' +
          '<a href="' + wa.href + '" target="_blank" rel="noopener">🟢 <span>WhatsApp us<small>+' + wa.num + '</small></span></a>' +
          '</div>'
        : '') +
      '<div class="ch-chat" hidden>' +
      '  <div class="ch-chat-h">💬<div><b>Customer Support</b><small>We reply as soon as we can</small></div>' +
      '  <button type="button" class="ch-chat-x" aria-label="Close chat">✕</button></div>' +
      '  <div class="ch-msgs"></div>' +
      '  <div class="ch-in"><textarea placeholder="Type a message…" maxlength="1000" aria-label="Message"></textarea>' +
      '  <button type="button" class="ch-send" aria-label="Send">➤</button></div>' +
      '</div>' +
      '<button type="button" class="ch-sup-btn" aria-label="Contact support" aria-expanded="false">💬<span class="ch-sup-dot" hidden></span></button>';
    document.body.appendChild(wrap);

    var btn = wrap.querySelector('.ch-sup-btn');
    var dot = wrap.querySelector('.ch-sup-dot');
    var panel = wrap.querySelector('.ch-chat');
    var menu = wrap.querySelector('.ch-menu');
    var msgs = wrap.querySelector('.ch-msgs');
    var input = wrap.querySelector('textarea');
    var send = wrap.querySelector('.ch-send');
    var lastId = 0, timer = null;

    function render(list) {
      if (!list.length) {
        msgs.innerHTML = '<div class="ch-empty">Hi! 👋<br>Tell us what you need help with — payments, credits, predictions — and we\'ll get right back to you.</div>';
        return;
      }
      var stuck = msgs.scrollTop + msgs.clientHeight >= msgs.scrollHeight - 40;
      msgs.textContent = '';
      list.forEach(function (m) {
        var b = document.createElement('div');
        b.className = 'ch-b ' + (m.sender === 'member' ? 'me' : 'them');
        b.textContent = m.body;
        var t = document.createElement('time');
        var d = new Date(m.at);
        t.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
          (d.toDateString() !== new Date().toDateString() ? ' · ' + d.toLocaleDateString() : '');
        b.appendChild(t);
        msgs.appendChild(b);
      });
      if (stuck || list[list.length - 1].id > lastId) msgs.scrollTop = msgs.scrollHeight;
      lastId = list.length ? list[list.length - 1].id : lastId;
    }

    function refresh(force) {
      api('GET', '/me/support-chat').then(function (d) {
        if (!panel.hidden || force) { render(d.messages); dot.hidden = true; }
        else {
          var unread = d.messages.filter(function (m) { return m.sender === 'admin' && !m.readByMember; }).length;
          if (unread) { dot.textContent = unread > 9 ? '9+' : unread; dot.hidden = false; }
        }
      }).catch(function () {});
    }

    function openChat() {
      if (menu) menu.hidden = true;
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      clearInterval(timer);
      refresh(true);
      timer = setInterval(refresh, 4000);
      setTimeout(function () { input.focus(); }, 50);
    }
    function closeAll() {
      panel.hidden = true;
      if (menu) menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      clearInterval(timer);
      timer = setInterval(refresh, 20000);   // background: keep the badge fresh
    }

    btn.addEventListener('click', function () {
      if (!panel.hidden || (menu && !menu.hidden)) { closeAll(); return; }
      if (menu) { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
      else openChat();
    });
    if (menu) menu.querySelector('[data-act="chat"]').addEventListener('click', openChat);
    wrap.querySelector('.ch-chat-x').addEventListener('click', closeAll);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });

    function doSend() {
      var text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      api('POST', '/me/support-chat', { body: text }).then(function () {
        input.value = '';
        refresh(true);
      }).catch(function (e) {
        alert((e && e.error) || 'Could not send — try again.');
      }).finally(function () { send.disabled = false; input.focus(); });
    }
    send.addEventListener('click', doSend);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });

    timer = setInterval(refresh, 20000);
    refresh(false);
  }

  /* ---------- visitors: external contacts if saved ---------- */
  function mountLinks(support) {
    var links = [];
    var wa = waLink(support);
    if (wa) links.push({ label: 'WhatsApp us', sub: '+' + wa.num, href: wa.href, icon: '🟢' });
    if (support.telegram) links.push({ label: 'Telegram', sub: '', href: 'https://t.me/' + String(support.telegram).replace(/^@/, ''), icon: '✈️' });
    if (support.email) links.push({ label: 'Email us', sub: support.email, href: 'mailto:' + support.email, icon: '✉️' });
    links.push({ label: 'Sign in to chat', sub: 'Message us right in the app', href: 'login.html', icon: '💬' });

    wrap.innerHTML =
      '<div class="ch-menu" hidden><div class="t">Customer Support</div>' +
      links.map(function (l) {
        var ext = l.href.indexOf('http') === 0 || l.href.indexOf('mailto') === 0;
        return '<a href="' + l.href + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + l.icon + ' <span>' + l.label +
          (l.sub ? '<small>' + l.sub + '</small>' : '') + '</span></a>';
      }).join('') +
      '</div><button type="button" class="ch-sup-btn" aria-label="Contact support" aria-expanded="false">💬</button>';
    document.body.appendChild(wrap);
    var btn = wrap.querySelector('.ch-sup-btn');
    var menu = wrap.querySelector('.ch-menu');
    btn.addEventListener('click', function () {
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    });
  }

  fetch('/api/payment-config/public')
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      var support = (cfg && cfg.support) || {};
      if (TOK) {
        // confirm the token is a live member session; expired ones fall back to visitor mode
        api('GET', '/me/support-chat')
          .then(function () { mountChat(support); })
          .catch(function () { TOK = ''; mountLinks(support); });
      } else {
        mountLinks(support);
      }
    })
    .catch(function () {});
})();
