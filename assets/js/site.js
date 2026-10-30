/* Zenith Advisory Services: site script */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('js');

  // Header: solid after scrolling past the top of the page
  var head = document.querySelector('.site-head');
  if (head && !head.classList.contains('always-solid')) {
    var onScroll = function () { head.classList.toggle('solid', window.scrollY > 40); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Mobile menu
  var toggle = document.querySelector('.nav-toggle');
  var links = document.getElementById('nav-links');
  function setMenu(open) {
    root.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.style.overflow = open ? 'hidden' : '';
  }
  if (toggle && links) {
    toggle.addEventListener('click', function () { setMenu(!root.classList.contains('nav-open')); });
    links.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('nav-open')) { setMenu(false); toggle.focus(); } });
    window.matchMedia('(min-width: 1024px)').addEventListener('change', function (m) { if (m.matches) setMenu(false); });
  }

  // Reveal on first sight
  var els = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }

  // Pre-select a service from ?service= on the contact page
  var params = new URLSearchParams(location.search);
  var svc = params.get('service');
  if (svc) {
    var pick = document.querySelector('input[name="service"][value="' + svc.replace(/"/g, '') + '"]');
    if (pick) pick.checked = true;
  }

  // Enquiry form: validates, posts to /api/enquiry, shows a clear result
  document.querySelectorAll('form[data-enquiry]').forEach(function (form) {
    var status = form.querySelector('.form-status');
    var btn = form.querySelector('button[type="submit"]');
    var messages = {
      name: 'Please tell us your name.',
      email: 'Please enter a valid email address.',
      message: 'Please add a few words about what you need.',
      service: 'Please choose what you would like to discuss.'
    };

    function fieldError(name, msg) {
      var input = form.elements[name];
      var err = form.querySelector('[data-err="' + name + '"]');
      if (input && input.setAttribute && !input.length) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (err) err.textContent = msg || '';
    }

    function validate() {
      var ok = true, first = null;
      var data = new FormData(form);
      ['name', 'email', 'message', 'service'].forEach(function (n) {
        if (!form.elements[n]) return;
        var v = String(data.get(n) || '').trim();
        var bad = !v || (n === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v));
        fieldError(n, bad ? messages[n] : '');
        if (bad) { ok = false; if (!first) first = n; }
      });
      if (first) {
        var el = form.elements[first];
        (el.length ? el[0] : el).focus();
      }
      return ok;
    }

    form.addEventListener('input', function (e) { if (e.target.name) fieldError(e.target.name, ''); });
    form.addEventListener('change', function (e) { if (e.target.name === 'service') fieldError('service', ''); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.className = 'form-status';
      status.textContent = '';
      if (!validate()) return;
      btn.setAttribute('aria-busy', 'true');
      var payload = Object.fromEntries(new FormData(form).entries());
      payload.page = location.pathname;
      fetch('/api/enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error(body.error || 'Request failed');
        });
      }).then(function () {
        form.reset();
        status.className = 'form-status ok';
        status.textContent = 'Thank you. Your enquiry has reached us and will be handled confidentially. We usually reply within one to two business days.';
        status.focus();
      }).catch(function (err) {
        status.className = 'form-status error';
        status.textContent = (err && err.message && err.message !== 'Request failed' && err.message !== 'Failed to fetch')
          ? err.message
          : 'Sorry, your enquiry could not be sent just now. Please try again, or email enquiries@zenithadvisory.ae directly.';
        status.focus();
      }).then(function () { btn.removeAttribute('aria-busy'); });
    });
  });

})();
