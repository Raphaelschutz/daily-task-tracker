(function () {
  'use strict';

  var CFG = window.DTT_CONFIG;
  var KEYS = { day: 'dtt.day', pending: 'dtt.pending', history: 'dtt.history', profile: 'dtt.profile' };
  var ALLOWED_DOMAINS = (CFG.allowedDomains || ['cryoport.com']);

  /* ---------- Utils ---------- */
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function label(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return h + 'h' + pad(m);
  }
  function taskMinutes(t) { return (t.hours || 0) * 60 + (t.minutes || 0); }
  function dayTotal(tasks) { return tasks.reduce(function (s, t) { return s + taskMinutes(t); }, 0); }
  function longDate(iso, short) {
    var p = iso.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
    var opts = short ? { weekday: 'long', day: 'numeric', month: 'short' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    var s = d.toLocaleDateString('fr-FR', Object.assign({ timeZone: 'UTC' }, opts));
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function shortDate(iso) { var p = iso.split('-'); return p[2] + '/' + p[1]; }
  function timeHM(isoDate) {
    var d = new Date(isoDate);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* stockage indisponible */ }
  }
  function buzz(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms || 10); } catch (e) {} } }

  var toastTimer;
  function toast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  /* ---------- State ---------- */
  var state = {
    day: load(KEYS.day, null) || { date: todayISO(), tasks: [], sentAt: null },
    pending: load(KEYS.pending, null),
    history: load(KEYS.history, { days: [], loadedAt: null }),
    profile: load(KEYS.profile, { name: '', email: '' }),
    view: 'home',
    sheet: null,
    sending: false,
    historyLoading: false,
    historyError: null,
    openDays: {}
  };

  function persistDay() { save(KEYS.day, state.day); }

  function profileError(p) {
    var email = String(p.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { return 'Adresse email invalide'; }
    if (ALLOWED_DOMAINS.indexOf(email.split('@')[1]) === -1) { return 'Adresse @' + ALLOWED_DOMAINS.join(' ou @') + ' uniquement'; }
    return null;
  }
  function hasProfile() { return !profileError(state.profile); }

  function rolloverIfNeeded() {
    var today = todayISO();
    if (state.day.date === today) { return; }
    if (state.day.sentAt || state.day.tasks.length === 0) {
      state.day = { date: today, tasks: [], sentAt: null };
      persistDay();
    }
    // Sinon : journée précédente non envoyée, on la garde et on affiche un bandeau.
  }

  function startNewDay() {
    state.day = { date: todayISO(), tasks: [], sentAt: null };
    persistDay();
    state.sheet = null;
    render();
  }

  /* ---------- API ---------- */
  function apiSendReport(payload) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 25000) : null;
    return fetch(CFG.apiBase + '/dtt/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-key': CFG.apiKey },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.ok) { var e = new Error(j.error || ('Erreur ' + r.status)); e.server = true; throw e; }
        return j;
      });
    }).finally(function () { if (timer) { clearTimeout(timer); } });
  }

  function apiHistory() {
    return fetch(CFG.apiBase + '/dtt/history?limit=' + (CFG.historyLimit || 60) + '&email=' + encodeURIComponent(state.profile.email), {
      headers: { 'x-app-key': CFG.apiKey }
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { throw new Error(j.error || 'Erreur'); }
      return j.days || [];
    });
  }

  function buildPayload(day) {
    return {
      email: state.profile.email,
      name: state.profile.name,
      date: day.date,
      tasks: day.tasks.map(function (t) {
        return { title: t.title, hours: t.hours || 0, minutes: t.minutes || 0, done: !!t.done, comment: t.comment || '' };
      })
    };
  }

  function sendReport() {
    if (state.sending) { return; }
    var day = state.day;
    if (!day.tasks.length) { toast('Ajoute au moins une tâche', true); return; }
    if (!hasProfile()) { state.sheet = { type: 'profile', next: 'send' }; render(); return; }
    state.sending = true;
    render();
    var payload = buildPayload(day);
    apiSendReport(payload).then(function (res) {
      state.sending = false;
      state.day.sentAt = new Date().toISOString();
      persistDay();
      state.pending = null; save(KEYS.pending, null);
      state.sheet = { type: 'sent', totalLabel: res.totalLabel || label(dayTotal(day.tasks)) };
      buzz([10, 40, 10]);
      render();
      refreshHistory(true);
    }).catch(function (err) {
      state.sending = false;
      if (err.server) {
        state.sheet = null;
        render();
        toast(err.message, true);
      } else {
        // Pas de réseau : on garde le rapport en attente, il partira au prochain essai.
        state.pending = { payload: payload, at: new Date().toISOString() };
        save(KEYS.pending, state.pending);
        state.sheet = null;
        render();
        toast('Hors ligne — rapport mis en attente', true);
      }
    });
  }

  function retryPending() {
    if (!state.pending || state.sending) { return; }
    state.sending = true;
    render();
    var p = state.pending;
    apiSendReport(p.payload).then(function () {
      state.sending = false;
      state.pending = null; save(KEYS.pending, null);
      if (state.day.date === p.payload.date) { state.day.sentAt = new Date().toISOString(); persistDay(); }
      render();
      toast('Rapport envoyé');
      refreshHistory(true);
    }).catch(function (err) {
      state.sending = false;
      if (err.server) { state.pending = null; save(KEYS.pending, null); }
      render();
      toast(err.server ? err.message : 'Toujours hors ligne', true);
    });
  }

  function refreshHistory(silent) {
    if (state.historyLoading || !hasProfile()) { return; }
    state.historyLoading = true;
    state.historyError = null;
    if (!silent) { render(); }
    apiHistory().then(function (days) {
      state.history = { days: days, loadedAt: new Date().toISOString() };
      save(KEYS.history, state.history);
      state.historyLoading = false;
      render();
    }).catch(function (err) {
      state.historyLoading = false;
      state.historyError = err.name === 'TypeError' ? 'Pas de connexion' : (err.message || 'Impossible de charger');
      render();
    });
  }

  /* ---------- Rendering ---------- */
  var app = document.getElementById('app');
  var sheetRoot = document.getElementById('sheet-root');

  function render() {
    app.innerHTML = state.view === 'history' ? viewHistory() : viewHome();
    sheetRoot.innerHTML = state.sheet ? viewSheet() : '';
    if (state.sheet && state.sheet.type === 'profile' && !state.profile.email) {
      var pin = sheetRoot.querySelector('[data-field="name"]');
      if (pin) { setTimeout(function () { pin.focus(); }, 60); }
    }
    if (state.sheet && state.sheet.type === 'edit') {
      var input = sheetRoot.querySelector('[data-field="title"]');
      if (input && !state.sheet.taskId) { setTimeout(function () { input.focus(); }, 60); }
    }
  }

  function icon(name, cls) { return '<svg class="i ' + (cls || '') + '"><use href="#i-' + name + '"/></svg>'; }

  function viewHome() {
    var day = state.day;
    var total = dayTotal(day.tasks);
    var isOld = day.date !== todayISO();
    var h = '<section class="screen">';
    h += '<header class="topbar"><div>';
    h += '<p class="eyebrow">' + (isOld ? 'Journée non envoyée' : 'Aujourd’hui') + '</p>';
    h += '<h1 class="title">' + esc(longDate(day.date, true)) + '</h1>';
    h += '</div><div style="display:flex;gap:8px;align-items:center">';
    h += '<div class="total-pill' + (total ? ' accent' : '') + '">' + label(total) + '</div>';
    h += '<button class="icon-btn" data-action="history" aria-label="Historique">' + icon('clock') + '</button>';
    h += '<button class="icon-btn" data-action="profile" aria-label="Réglages">' + icon('user') + '</button>';
    h += '</div></header>';

    if (state.pending) {
      h += '<div class="banner"><p><strong>Rapport en attente</strong><span class="muted">Journée du ' + shortDate(state.pending.payload.date) + ' — pas encore envoyé</span></p>';
      h += '<div class="banner-actions"><button class="btn btn-sm btn-primary" data-action="retry"' + (state.sending ? ' disabled' : '') + '>' + (state.sending ? '<span class="spinner"></span>' : 'Réessayer') + '</button></div></div>';
    } else if (isOld) {
      h += '<div class="banner"><p><strong>Journée du ' + shortDate(day.date) + '</strong><span class="muted">Envoie-la ou commence aujourd’hui</span></p>';
      h += '<div class="banner-actions"><button class="btn btn-sm btn-ghost" data-action="confirm-new">Nouvelle</button></div></div>';
    } else if (day.sentAt) {
      h += '<div class="banner"><p><strong>Rapport envoyé à ' + timeHM(day.sentAt) + '</strong><span class="muted">Tu peux encore modifier et renvoyer</span></p>';
      h += '<div class="banner-actions"><button class="btn btn-sm btn-ghost" data-action="confirm-new">Nouvelle</button></div></div>';
    }

    if (!day.tasks.length) {
      h += '<div class="empty"><strong>Aucune tâche</strong>Appuie sur + pour commencer la journée</div>';
    } else {
      h += '<div class="list">';
      day.tasks.forEach(function (t) {
        var m = taskMinutes(t);
        h += '<button class="card' + (t.done ? ' done' : '') + '" data-action="edit" data-id="' + t.id + '">';
        h += '<span class="check" data-action="toggle" data-id="' + t.id + '" role="checkbox" aria-checked="' + (!!t.done) + '">' + icon('check') + '</span>';
        h += '<span class="body"><p class="name">' + esc(t.title) + '</p>';
        if (t.comment) { h += '<p class="meta">' + esc(t.comment) + '</p>'; }
        h += '</span>';
        h += '<span class="time' + (m ? '' : ' empty') + '">' + (m ? label(m) : '—') + '</span>';
        h += '</button>';
      });
      h += '</div>';
    }
    h += '</section>';

    h += '<div class="bottom"><div class="bottom-inner">';
    h += '<button class="fab" data-action="add" aria-label="Ajouter une tâche">' + icon('plus') + '</button>';
    var sendLabel = day.sentAt ? 'Renvoyer le rapport' : 'Envoyer le rapport';
    h += '<button class="btn ' + (day.sentAt ? 'btn-secondary' : 'btn-primary') + '" data-action="send-open"' + (day.tasks.length ? '' : ' disabled') + '>' + icon('send') + sendLabel + '</button>';
    h += '</div></div>';
    return h;
  }

  function viewSheet() {
    var s = state.sheet;
    var h = '<div class="scrim" data-action="close"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grip"></div>';
    if (s.type === 'edit') { h += sheetEdit(s); }
    else if (s.type === 'send') { h += sheetSend(); }
    else if (s.type === 'sent') { h += sheetSent(s); }
    else if (s.type === 'confirm-new') { h += sheetConfirmNew(); }
    else if (s.type === 'confirm-delete') { h += sheetConfirmDelete(s); }
    else if (s.type === 'profile') { h += sheetProfile(s); }
    h += '</div>';
    return h;
  }

  function sheetEdit(s) {
    var t = s.taskId ? state.day.tasks.filter(function (x) { return x.id === s.taskId; })[0] : null;
    var d = t || { title: '', hours: 0, minutes: 0, comment: '', done: false };
    var h = '<h2>' + (t ? 'Modifier' : 'Nouvelle tâche') + '</h2>';
    h += '<div class="field"><input class="input" data-field="title" type="text" placeholder="Titre de la tâche" value="' + esc(d.title) + '" maxlength="200" autocomplete="off" enterkeyhint="done"></div>';
    h += '<div class="field"><span class="label">Temps passé</span><div class="time-row">';
    h += stepper('hours', 'Heures', d.hours || 0, 1, 0, 24);
    h += stepper('minutes', 'Minutes', d.minutes || 0, 15, 0, 45);
    h += '</div></div>';
    h += '<div class="field"><textarea class="input" data-field="comment" placeholder="Commentaire (optionnel)" maxlength="1000">' + esc(d.comment) + '</textarea></div>';
    h += '<div class="switch-row" data-action="switch"><span>Terminée</span><span class="switch" role="switch" aria-checked="' + (!!d.done) + '" data-field="done"></span></div>';
    h += '<div class="sheet-actions">';
    h += '<button class="btn btn-primary" data-action="save-task">OK</button>';
    if (t) { h += '<button class="btn btn-danger" data-action="ask-delete" data-id="' + t.id + '">' + icon('trash') + 'Supprimer</button>'; }
    h += '</div>';
    return h;
  }

  function stepper(field, unit, value, step, min, max) {
    return '<div class="stepper" data-stepper="' + field + '" data-step="' + step + '" data-min="' + min + '" data-max="' + max + '">' +
      '<span class="unit">' + unit + '</span>' +
      '<button type="button" data-action="dec" aria-label="Moins">' + icon('minus') + '</button>' +
      '<input type="number" inputmode="numeric" pattern="[0-9]*" data-field="' + field + '" value="' + value + '" min="' + min + '" max="' + max + '">' +
      '<button type="button" data-action="inc" aria-label="Plus">' + icon('plus') + '</button>' +
      '</div>';
  }

  function sheetSend() {
    var day = state.day;
    var total = dayTotal(day.tasks);
    var doneCount = day.tasks.filter(function (t) { return t.done; }).length;
    var h = '<h2>Rapport du ' + esc(longDate(day.date, true).toLowerCase()) + '</h2>';
    h += '<div class="recap">';
    day.tasks.forEach(function (t) {
      var m = taskMinutes(t);
      h += '<div class="recap-row"><span class="dot' + (t.done ? ' done' : '') + '"></span><span class="name' + (t.done ? ' done' : '') + '">' + esc(t.title) + '</span><span class="t">' + (m ? label(m) : '—') + '</span></div>';
    });
    h += '<div class="recap-total"><span>' + day.tasks.length + ' tâche' + (day.tasks.length > 1 ? 's' : '') + ' · ' + doneCount + ' terminée' + (doneCount > 1 ? 's' : '') + '</span><span class="t">' + label(total) + '</span></div>';
    h += '</div>';
    h += '<p class="hint">Envoi à ' + esc(state.profile.email) + '</p>';
    h += '<div class="sheet-actions">';
    h += '<button class="btn btn-accent" data-action="send"' + (state.sending ? ' disabled' : '') + '>' + (state.sending ? '<span class="spinner"></span> Envoi…' : icon('send') + 'Confirmer l’envoi') + '</button>';
    h += '<button class="btn btn-ghost" data-action="close"' + (state.sending ? ' disabled' : '') + '>Annuler</button>';
    h += '</div>';
    return h;
  }

  function sheetSent(s) {
    var h = '<div class="sent"><div class="ring">' + icon('check') + '</div>';
    h += '<h2>Rapport envoyé</h2><div class="big">' + esc(s.totalLabel) + '</div><p>' + esc(state.profile.email) + '</p>';
    h += '<div class="sheet-actions">';
    h += '<button class="btn btn-primary" data-action="new-day">Nouvelle journée</button>';
    h += '<button class="btn btn-ghost" data-action="close">Garder cette journée</button>';
    h += '</div></div>';
    return h;
  }

  function sheetProfile(s) {
    var p = state.profile;
    var first = !hasProfile();
    var h = '<h2>' + (first ? 'Bienvenue' : 'Réglages') + '</h2>';
    if (first) { h += '<p class="hint">Ton rapport de journée sera envoyé à cette adresse.</p>'; }
    h += '<div class="field"><span class="label">Prénom</span><input class="input" data-field="name" type="text" placeholder="Prénom" value="' + esc(p.name) + '" maxlength="60" autocomplete="given-name"></div>';
    h += '<div class="field"><span class="label">Email professionnel</span><input class="input" data-field="email" type="email" inputmode="email" autocapitalize="off" autocomplete="email" placeholder="prenom@' + esc(ALLOWED_DOMAINS[0]) + '" value="' + esc(p.email) + '" maxlength="120"></div>';
    h += '<div class="sheet-actions"><button class="btn btn-primary" data-action="save-profile">OK</button>';
    if (!first) { h += '<button class="btn btn-ghost" data-action="close">Annuler</button>'; }
    h += '</div>';
    return h;
  }

  function saveProfile() {
    var p = {
      name: sheetRoot.querySelector('[data-field="name"]').value.replace(/\s+/g, ' ').trim(),
      email: sheetRoot.querySelector('[data-field="email"]').value.trim().toLowerCase()
    };
    var err = profileError(p);
    if (err) { toast(err, true); sheetRoot.querySelector('[data-field="email"]').focus(); return; }
    var changed = p.email !== state.profile.email;
    state.profile = p;
    save(KEYS.profile, p);
    if (changed) { state.history = { days: [], loadedAt: null }; save(KEYS.history, state.history); }
    var next = state.sheet && state.sheet.next;
    state.sheet = next === 'send' ? { type: 'send' } : null;
    buzz();
    render();
    if (changed) { refreshHistory(true); }
  }

  function sheetConfirmNew() {
    var sent = !!state.day.sentAt;
    var h = '<h2>Nouvelle journée ?</h2>';
    h += '<p class="hint">' + (sent ? 'La liste actuelle sera effacée. Le rapport envoyé reste dans l’historique.' : 'La liste actuelle n’a pas été envoyée et sera perdue.') + '</p>';
    h += '<div class="sheet-actions"><button class="btn ' + (sent ? 'btn-primary' : 'btn-accent') + '" data-action="new-day">Oui, nouvelle journée</button><button class="btn btn-ghost" data-action="close">Annuler</button></div>';
    return h;
  }

  function sheetConfirmDelete(s) {
    var h = '<h2>Supprimer la tâche ?</h2>';
    h += '<div class="sheet-actions"><button class="btn btn-accent" data-action="delete" data-id="' + s.taskId + '">Supprimer</button><button class="btn btn-ghost" data-action="edit" data-id="' + s.taskId + '">Annuler</button></div>';
    return h;
  }

  function viewHistory() {
    var h = '<section class="screen">';
    h += '<header class="topbar"><div style="display:flex;gap:12px;align-items:center">';
    h += '<button class="icon-btn" data-action="home" aria-label="Retour">' + icon('back') + '</button>';
    h += '<h1 class="title sm">Historique</h1></div>';
    h += '<button class="icon-btn" data-action="refresh-history" aria-label="Actualiser"' + (state.historyLoading ? ' disabled' : '') + '>' + (state.historyLoading ? '<span class="spinner dark"></span>' : icon('refresh')) + '</button>';
    h += '</header>';

    var days = state.history.days || [];
    if (state.historyError && !days.length) {
      h += '<div class="empty"><strong>Impossible de charger</strong>' + esc(state.historyError) + '<br><br><button class="btn btn-sm btn-primary" data-action="refresh-history" style="margin:0 auto">Réessayer</button></div>';
    } else if (!days.length) {
      h += state.historyLoading ? '<div class="center"><span class="spinner dark"></span></div>' : '<div class="empty"><strong>Aucun rapport</strong>Les journées envoyées apparaîtront ici</div>';
    } else {
      if (state.historyError) { h += '<div class="banner"><p class="muted">Hors ligne — données du ' + esc(timeHM(state.history.loadedAt)) + '</p></div>'; }
      days.forEach(function (d) {
        var open = !!state.openDays[d.date];
        h += '<div class="day' + (open ? ' open' : '') + '">';
        h += '<button class="day-head" data-action="toggle-day" data-date="' + d.date + '">';
        h += '<span class="body"><p class="name">' + esc(longDate(d.date)) + '</p><p class="meta">' + d.taskCount + ' tâche' + (d.taskCount > 1 ? 's' : '') + ' · ' + d.doneCount + ' terminée' + (d.doneCount > 1 ? 's' : '') + '</p></span>';
        h += '<span class="t">' + esc(d.totalLabel || label(d.totalMinutes || 0)) + '</span>' + icon('chevron', 'chev');
        h += '</button>';
        h += '<div class="day-tasks">';
        (d.tasks || []).forEach(function (t) {
          h += '<div class="day-task"><span class="dot' + (t.done ? ' done' : '') + '"></span><span class="body"><p class="name' + (t.done ? ' done' : '') + '">' + esc(t.title) + '</p>' + (t.comment ? '<p class="c">' + esc(t.comment) + '</p>' : '') + '</span><span class="t">' + label(t.minutes || 0) + '</span></div>';
        });
        h += '</div></div>';
      });
    }
    h += '</section>';
    return h;
  }

  /* ---------- Editor helpers ---------- */
  function readEditor() {
    var root = sheetRoot;
    var title = root.querySelector('[data-field="title"]').value.replace(/\s+/g, ' ').trim();
    var hours = clampInt(root.querySelector('[data-field="hours"]').value, 0, 24);
    var minutes = clampInt(root.querySelector('[data-field="minutes"]').value, 0, 59);
    var comment = root.querySelector('[data-field="comment"]').value.trim();
    var done = root.querySelector('[data-field="done"]').getAttribute('aria-checked') === 'true';
    return { title: title, hours: hours, minutes: minutes, comment: comment, done: done };
  }
  function clampInt(v, min, max) {
    var n = parseInt(v, 10);
    if (isNaN(n)) { n = 0; }
    return Math.min(max, Math.max(min, n));
  }
  function saveTask() {
    var data = readEditor();
    if (!data.title) {
      toast('Donne un titre à la tâche', true);
      sheetRoot.querySelector('[data-field="title"]').focus();
      return;
    }
    var id = state.sheet.taskId;
    if (id) {
      state.day.tasks = state.day.tasks.map(function (t) { return t.id === id ? Object.assign({}, t, data) : t; });
    } else {
      state.day.tasks.push(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, data));
    }
    persistDay();
    state.sheet = null;
    buzz();
    render();
  }
  function stepValue(el, dir) {
    var box = el.closest('[data-stepper]');
    var input = box.querySelector('input');
    var step = parseInt(box.dataset.step, 10), min = parseInt(box.dataset.min, 10), max = parseInt(box.dataset.max, 10);
    var v = clampInt(input.value, min, 59);
    v = dir > 0 ? Math.min(max, v + step - (v % step)) : Math.max(min, (v % step) ? v - (v % step) : v - step);
    input.value = v;
    buzz(5);
  }

  /* ---------- Events ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) { return; }
    var action = el.dataset.action;
    var id = el.dataset.id;
    switch (action) {
      case 'add': state.sheet = { type: 'edit', taskId: null }; render(); break;
      case 'edit': state.sheet = { type: 'edit', taskId: id }; render(); break;
      case 'toggle':
        e.stopPropagation();
        state.day.tasks = state.day.tasks.map(function (t) { return t.id === id ? Object.assign({}, t, { done: !t.done }) : t; });
        persistDay(); buzz(); render();
        break;
      case 'save-task': saveTask(); break;
      case 'ask-delete': state.sheet = { type: 'confirm-delete', taskId: id }; render(); break;
      case 'delete':
        state.day.tasks = state.day.tasks.filter(function (t) { return t.id !== id; });
        persistDay(); state.sheet = null; buzz(); render();
        break;
      case 'inc': stepValue(el, 1); break;
      case 'dec': stepValue(el, -1); break;
      case 'switch': {
        var sw = el.querySelector('.switch');
        sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
        buzz(5);
        break;
      }
      case 'send-open': state.sheet = hasProfile() ? { type: 'send' } : { type: 'profile', next: 'send' }; render(); break;
      case 'profile': state.sheet = { type: 'profile' }; render(); break;
      case 'save-profile': saveProfile(); break;
      case 'send': sendReport(); break;
      case 'retry': retryPending(); break;
      case 'confirm-new': state.sheet = { type: 'confirm-new' }; render(); break;
      case 'new-day': startNewDay(); break;
      case 'close': if (!state.sending && !(state.sheet && state.sheet.type === 'profile' && !hasProfile())) { state.sheet = null; render(); } break;
      case 'history': state.view = 'history'; render(); refreshHistory(true); break;
      case 'home': state.view = 'home'; render(); break;
      case 'refresh-history': refreshHistory(false); break;
      case 'toggle-day': state.openDays[el.dataset.date] = !state.openDays[el.dataset.date]; render(); break;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.matches('[data-field="title"]')) { e.preventDefault(); saveTask(); }
    if (e.key === 'Enter' && e.target.matches('[data-field="name"], [data-field="email"]')) { e.preventDefault(); saveProfile(); }
    if (e.key === 'Escape' && state.sheet && !state.sending) { state.sheet = null; render(); }
  });

  window.addEventListener('online', function () { if (state.pending) { retryPending(); } });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { rolloverIfNeeded(); render(); }
  });

  /* ---------- Boot ---------- */
  rolloverIfNeeded();
  if (!hasProfile()) { state.sheet = { type: 'profile' }; }
  render();
  if (state.pending && navigator.onLine) { retryPending(); }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
