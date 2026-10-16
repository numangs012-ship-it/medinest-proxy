// Medinest - Ratings & Reviews + WhatsApp Channel prompt
(function() {
  'use strict';

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  /* 1. Inject Reviews tab button + tab content */
  function injectReviewsUI() {
    var tabs = document.querySelector('.tabs');
    if (tabs && !tabs.querySelector('[data-tab="reviews"]')) {
      var btn = document.createElement('button');
      btn.className = 'tab';
      btn.setAttribute('data-tab', 'reviews');
      btn.textContent = 'Reviews';
      tabs.appendChild(btn);
    }
    if (!document.getElementById('tab-reviews')) {
      var tracking = document.getElementById('tab-tracking');
      var wrap = document.createElement('div');
      wrap.id = 'tab-reviews';
      wrap.className = 'hidden';
      wrap.innerHTML = '<div class="card"><h3>Ratings & Reviews</h3><button id="sortRatingBtn">Sort by Rating (Top First)</button><div id="reviewList"><p>No reviews yet.</p></div><h4>Add Review</h4><select id="revStars"><option value="5">★★★★★ 5</option><option value="4">★★★★ 4</option><option value="3">★★★ 3</option><option value="2">★★ 2</option><option value="1">★ 1</option></select><input type="text" id="revText" placeholder="Write a review..."><button id="addRevBtn">Submit Review</button></div>';
      if (tracking && tracking.parentNode) {
        tracking.parentNode.insertBefore(wrap, tracking.nextSibling);
      }
    }
  }

  /* 2. Review system (Firestore 'reviews' collection - LIVE) */
  var reviews = [];
  /* LIVE: reviews stored in Firestore 'reviews' collection (loaded in renderReviews) */

  var sortByRating = false; async function renderReviews(refresh) { if (refresh === undefined) refresh = true; if (refresh) { try { if (typeof fsGet === 'function') { reviews = await fsGet('reviews'); if (typeof byCreated === 'function') reviews.sort(byCreated); } } catch (e) { console.error(e); alert('Could not load reviews: ' + e.message); } } if (sortByRating) { reviews.sort(function(a, b) { return (b.stars || 0) - (a.stars || 0); }); }
    var list = document.getElementById('reviewList');
    if (!list) return;
    if (!reviews.length) { list.innerHTML = '<p>No reviews yet.</p>'; return; }
    list.innerHTML = reviews.map(function(r) {
      var stars = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
      return '<div style="border:1px solid #ddd; padding:10px; margin:5px 0; border-radius:4px;"><strong>' + stars + '</strong> <small>' + escHtml(r.by || 'guest') + '</small><p>' + escHtml(r.text) + '</p></div>';
    }).join('');
  }

  /* 2b. Sort reviews by rating (top rated first) */
  function bindSortRating() {
    var btn = document.getElementById('sortRatingBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.onclick = async function() {
      sortByRating = true;
      /* now persisted in Firestore */
      renderReviews();
    };
  }

  function bindReviewForm() {
    var btn = document.getElementById('addRevBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.onclick = async function() {
      var stars = parseInt(document.getElementById('revStars').value, 10) || 5;
      var text = document.getElementById('revText').value.trim();
      if (!text) { alert('Please write a review first'); return; }
      var by = 'guest';
      try { if (typeof user !== 'undefined' && user) by = user.name || user.email || 'guest'; } catch (e) {}
      try { await fsAdd('reviews', { stars: stars, text: text, by: by, date: new Date().toLocaleString(), createdAt: new Date().toISOString() }); } catch (e) { alert('Submit review failed: ' + e.message); return; }
      /* now persisted in Firestore */
      document.getElementById('revText').value = '';
      renderReviews();
    };
  }

  /* 3. WhatsApp Channel join prompt (localStorage 'medinest_ch_seen') */
  function showChannelPrompt() {
    if (localStorage.getItem('medinest_ch_seen')) return;
    var dash = document.getElementById('dashDiv');
    if (!dash || document.getElementById('channelPrompt')) return;
    var div = document.createElement('div');
    div.className = 'card';
    div.id = 'channelPrompt';
    div.style.cssText = 'background:#e8f5e9; border:2px solid #2e7d32;';
    div.innerHTML = '<h3>📢 Join our WhatsApp Channel!</h3><p>Get updates on new medicines and offers.</p><a href="https://whatsapp.com/channel/0029Vb9MT0kChq6MFsUW142v" target="_blank"><button>Join medinest🌿☘️ Channel</button></a><button onclick="this.parentElement.style.display=\'none\'; localStorage.setItem(\'medinest_ch_seen\',\'1\')" style="background:#999;">Dismiss</button>';
    dash.insertBefore(div, dash.firstChild);
  }

  /* 4. Tab switching (include Reviews + Ledger tabs) */
  function bindTabs() {
    document.querySelectorAll('.tab').forEach(function(t) {
      t.onclick = function() {
        document.querySelectorAll('.tab').forEach(function(x) { x.classList.remove('active'); });
        t.classList.add('active');
        ['stores', 'orders', 'tracking', 'reviews', 'ledger'].forEach(function(id) {
          var el = document.getElementById('tab-' + id);
          if (el) el.classList.add('hidden');
        });
        var target = document.getElementById('tab-' + t.dataset.tab); if (t.dataset.tab === 'reviews') { renderReviews(); } else if (t.dataset.tab === 'ledger' && typeof renderLedger === 'function') { renderLedger(); }
        if (target) target.classList.remove('hidden');
      };
    });
  }

  /* 5. Init */
  injectReviewsUI();
  bindTabs();
  bindReviewForm();
  bindSortRating();
  renderReviews();

  if (typeof window.showDashboard === 'function') {
    var _showDashboard = window.showDashboard;
    window.showDashboard = function() {
      _showDashboard();
      injectReviewsUI();
      bindTabs();
      bindReviewForm();
      bindSortRating();
      renderReviews();
      showChannelPrompt();
    };
  }
  var dashDiv = document.getElementById('dashDiv');
  if (dashDiv && !dashDiv.classList.contains('hidden')) {
    showChannelPrompt();
  }
})();
