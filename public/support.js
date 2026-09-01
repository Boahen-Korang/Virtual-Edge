/* Floating customer-support button. Reads the contacts the admin saved
   (WhatsApp / email / Telegram) and renders nothing if none are set. */
(function () {
  fetch('/api/payment-config/public')
    .then((r) => r.json())
    .then((cfg) => {
      const s = (cfg && cfg.support) || {};
      const links = [];
      if (s.whatsapp) {
        const num = String(s.whatsapp).replace(/[^\d]/g, '');
        if (num) links.push({ label: 'WhatsApp', href: 'https://wa.me/' + num, icon: '💬' });
      }
      if (s.telegram) {
        links.push({ label: 'Telegram', href: 'https://t.me/' + String(s.telegram).replace(/^@/, ''), icon: '✈️' });
      }
      if (s.email) links.push({ label: 'Email us', href: 'mailto:' + s.email, icon: '✉️' });
      if (!links.length) return;

      const css = document.createElement('style');
      css.textContent =
        '.ch-sup{position:fixed;right:18px;bottom:18px;z-index:9000;font-family:Archivo,system-ui,sans-serif}' +
        '.ch-sup-btn{width:54px;height:54px;border-radius:50%;border:none;cursor:pointer;background:#E41827;color:#fff;font-size:24px;box-shadow:0 8px 24px rgba(228,24,39,.45);display:grid;place-items:center;transition:transform .15s}' +
        '.ch-sup-btn:hover{transform:scale(1.07)}' +
        '.ch-sup-btn:focus-visible{outline:3px solid #9B0C17;outline-offset:2px}' +
        '.ch-sup-menu{position:absolute;right:0;bottom:64px;background:#fff;color:#1B1E25;border:1px solid #E8EAEF;border-radius:12px;box-shadow:0 18px 40px rgba(14,20,32,.22);overflow:hidden;min-width:190px}' +
        '.ch-sup-menu a{display:flex;align-items:center;gap:10px;padding:12px 16px;color:#1B1E25;text-decoration:none;font-weight:600;font-size:14px}' +
        '.ch-sup-menu a:hover{background:#FDE8EA;color:#E41827}' +
        '.ch-sup-t{padding:10px 16px 8px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8A93A3;border-bottom:1px solid #E8EAEF}';
      document.head.appendChild(css);

      const wrap = document.createElement('div');
      wrap.className = 'ch-sup';
      // one channel: the button links straight to it; several: a small menu
      if (links.length === 1) {
        wrap.innerHTML =
          '<a class="ch-sup-btn" style="text-decoration:none" href="' + links[0].href +
          '" target="_blank" rel="noopener" aria-label="Contact support">' + links[0].icon + '</a>';
      } else {
        wrap.innerHTML =
          '<div class="ch-sup-menu" hidden><div class="ch-sup-t">Customer Support</div>' +
          links.map((l) => '<a href="' + l.href + '" target="_blank" rel="noopener">' + l.icon + ' ' + l.label + '</a>').join('') +
          '</div><button class="ch-sup-btn" aria-label="Contact support" aria-expanded="false">💬</button>';
        const btn = wrap.querySelector('.ch-sup-btn');
        const menu = wrap.querySelector('.ch-sup-menu');
        btn.addEventListener('click', () => {
          menu.hidden = !menu.hidden;
          btn.setAttribute('aria-expanded', String(!menu.hidden));
        });
        document.addEventListener('click', (e) => {
          if (!wrap.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
        });
      }
      document.body.appendChild(wrap);
    })
    .catch(() => {});
})();
