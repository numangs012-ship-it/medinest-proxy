(function () {
  "use strict";

  if (window.location.search) {
    window.history.replaceState(null, document.title, window.location.pathname + window.location.hash);
  }

  var OWNER_EMAIL = "numangs012@gmail.com";
  var FIREBASE_API_KEY = (window.MEDINEST_FIREBASE_API_KEY || "").trim();
  var AUTH_PROXY_URL = "/.netlify/functions/auth";
  var HOMEOPATHIC_CATEGORIES = ["Syrup", "German Potency", "Pakistan Potency", "Drops", "Tablet", "Capsule", "Other"];
  var ALLOPATHIC_CATEGORIES = ["Injection", "Drip", "Syrup", "Tablet", "Capsule", "Cotton", "Needle", "Bandage", "Syringe", "Ointment", "Other"];
  var stores = {
    "alshifa-clinic": {
      id: "alshifa-clinic", name: "alshifa clinic", doctorName: "hafiz adeem", city: "Bahawalpur", type: "homeopathic",
      referralCode: "HS-ALSHIFA", medicines: [], orders: [], referrals: [], delivery: { base: 0, perKg: 0 }
    },
    "numan-homeo-clinic": {
      id: "numan-homeo-clinic", name: "numan homeo clinic", doctorName: "Dr Ghulam Murtaza", city: "Bahawalpur", type: "homeopathic",
      referralCode: "HS-NUMANHOMEO", medicines: [], orders: [], referrals: [], delivery: { base: 0, perKg: 0 }
    }
  };
  var sessionAccounts = [];
  var state = {
    user: null,
    activeStoreId: "alshifa-clinic",
    tab: "overview",
    editingMedicineId: "",
    toastTimer: null
  };

  var icons = {
    store: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v9h16v-9"></path><path d="M3 10 5 4h14l2 6"></path><path d="M9 19v-5h6v5"></path></svg>',
    bottle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v4l-2 2v11h8V9l-2-2V3"></path><path d="M8 12h8"></path></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"></path></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4-.8L19 8l-3-3L5 16zM14 7l3 3"></path></svg>',
    logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"></path></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>'
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character];
    });
  }
  function uid(prefix) {
    var bytes = new Uint32Array(2);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else { bytes[0] = Date.now(); bytes[1] = Math.floor(Math.random() * 1000000); }
    return prefix + "-" + bytes[0].toString(36) + bytes[1].toString(36);
  }
  function money(value) {
    try { return new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 2 }).format(Number(value || 0)); }
    catch (error) { return "PKR " + Number(value || 0).toFixed(2); }
  }
  function showToast(message) {
    var toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 2600);
  }
  function categories(store) {
    return store.type === "allopathic" ? ALLOPATHIC_CATEGORIES : HOMEOPATHIC_CATEGORIES;
  }
  function categoryOptions(store, selected) {
    return categories(store).map(function (category) {
      return '<option value="' + escapeHtml(category) + '"' + (category === selected ? " selected" : "") + '>' + escapeHtml(category) + '</option>';
    }).join("");
  }
  function activeStore() { return stores[state.activeStoreId]; }

  function parseAuthResponse(response) {
    return response.json().catch(function () { return {}; }).then(function (payload) {
      if (!response.ok) {
        var error = new Error((payload && payload.error && (payload.error.message || payload.error)) || payload.message || ("Authentication request failed (" + response.status + ")"));
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      if (!payload || !payload.idToken) {
        var invalid = new Error("Authentication service returned an invalid response.");
        invalid.status = response.status;
        throw invalid;
      }
      return payload;
    });
  }

  function proxyAuth(action, email, password) {
    return fetch(AUTH_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: action, email: email, password: password })
    }).then(function (response) {
      if (response.status === 404) {
        var missing = new Error("Authentication proxy was not found.");
        missing.status = 404;
        missing.proxyUnavailable = true;
        throw missing;
      }
      return parseAuthResponse(response);
    }).catch(function (error) {
      if (error && error.status && error.status !== 404) throw error;
      error = error || new Error("Authentication proxy could not be reached.");
      error.proxyUnavailable = true;
      throw error;
    });
  }

  function directFirebaseAuth(version, action, email, password) {
    var isV1 = version === "v1";
    var operation;
    if (isV1) operation = action === "signin" ? "accounts:signInWithPassword" : "accounts:signUp";
    else operation = action === "signin" ? "verifyPassword" : "signupNewUser";
    var base = isV1 ? "https://identitytoolkit.googleapis.com/v1/" : "https://www.googleapis.com/identitytoolkit/v3/relyingparty/";
    var url = base + operation + "?key=" + encodeURIComponent(FIREBASE_API_KEY);
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
    }).then(parseAuthResponse);
  }

  function authenticate(action, email, password) {
    return proxyAuth(action, email, password).catch(function (proxyError) {
      if (!proxyError.proxyUnavailable) throw proxyError;
      return directFirebaseAuth("v1", action, email, password).catch(function () {
        return directFirebaseAuth("v3", action, email, password);
      });
    });
  }

  function authMessage(error) {
    var raw = String(error && error.message || "Unable to reach the authentication service.");
    var messages = {
      EMAIL_NOT_FOUND: "No account exists for that email.",
      INVALID_PASSWORD: "Incorrect email or password.",
      INVALID_LOGIN_CREDENTIALS: "Incorrect email or password.",
      EMAIL_EXISTS: "That email is already registered.",
      WEAK_PASSWORD: "Use a password with at least 6 characters.",
      USER_DISABLED: "This account has been disabled.",
      TOO_MANY_ATTEMPTS_TRY_LATER: "Too many attempts. Please wait and try again."
    };
    var code = raw.split(" : ")[0].split(":")[0].trim();
    return messages[code] || raw.replace(/_/g, " ");
  }

  function loginWall(keepAccounts) {
    var app = document.getElementById("app");
    app.setAttribute("data-ready", "true");
    app.innerHTML = '<main class="boot-wall auth-wall" aria-labelledby="boot-title">' +
      '<section class="boot-intro"><div><h1 id="boot-title">Please login to continue</h1><p>Sign in to open the two clinic workspaces, medicines, orders and account tools.</p></div>' +
      '<div class="boot-note"><strong>Secure Medinest access</strong>Sign-in requests stay on this page while Medinest checks your account.</div></section>' +
      '<section class="boot-grid" aria-label="Account access">' +
      '<article class="boot-card"><header><span class="boot-step">Existing account</span><h2>Login</h2><p>Sign in securely to open your Medinest workspace.</p></header>' +
      '<form id="boot-auth-form" method="post" onsubmit="return false;"><div class="boot-field"><label for="boot-email">Email</label><input id="boot-email" name="email" type="email" autocomplete="email" required></div>' +
      '<div class="boot-field"><label for="boot-password">Password</label><input id="boot-password" name="password" type="password" minlength="6" autocomplete="current-password" required></div>' +
      '<button id="boot-signin-button" class="boot-submit" type="submit">Sign In</button></form></article>' +
      '<article class="boot-card boot-card-create"><header><span class="boot-step">New account</span><h2>Create Account</h2><p>Create your secure Medinest account.</p></header>' +
      '<form id="boot-create-form" method="post" onsubmit="return false;"><div class="boot-field"><label for="boot-name">Full name</label><input id="boot-name" name="name" type="text" maxlength="80" required></div>' +
      '<fieldset class="boot-types"><legend>Account type</legend>' +
      '<label><input type="radio" name="accountType" value="customer" checked><span><strong>Customer</strong><small>Browse both local clinic workspaces</small></span></label>' +
      '<label><input type="radio" name="accountType" value="homeopathic_doctor"><span><strong>Homeopathic Doctor</strong><small>Use a separate session workspace</small></span></label>' +
      '<label><input type="radio" name="accountType" value="allopathic_doctor"><span><strong>Allopathic Doctor</strong><small>Use allopathic medicine categories</small></span></label></fieldset>' +
      '<div class="boot-field"><label for="boot-create-email">Email</label><input id="boot-create-email" name="email" type="email" required></div>' +
      '<div class="boot-field"><label for="boot-create-password">Password</label><input id="boot-create-password" name="password" type="password" minlength="6" required></div>' +
      '<button id="boot-create-button" class="boot-submit" type="submit">Create Account</button></form></article></section>' +
      '<div id="startup-notice" class="boot-feedback" role="status" aria-live="polite"></div></main>';
    bindAuthButtons();
  }

  function bindAuthButtons() {
    var signInButton = document.getElementById("boot-signin-button");
    var createButton = document.getElementById("boot-create-button");
    if (signInButton) {
      signInButton.addEventListener("click", async function (event) {
        event.preventDefault();
        var form = document.getElementById("boot-auth-form");
        if (!form || signInButton.disabled) return;
        if (!form.checkValidity()) { form.reportValidity(); return; }
        await handleLogin(form);
      });
    }
    if (createButton) {
      createButton.addEventListener("click", async function (event) {
        event.preventDefault();
        var form = document.getElementById("boot-create-form");
        if (!form || createButton.disabled) return;
        if (!form.checkValidity()) { form.reportValidity(); return; }
        await handleCreate(form);
      });
    }
  }

  function showAuthFeedback(message) {
    var notice = document.getElementById("startup-notice");
    if (!notice) return;
    notice.textContent = message;
    notice.classList.add("show");
  }

  function shell(content) {
    var store = activeStore();
    return '<div class="offline-strip"><strong>Signed-in session</strong><span>Authenticated online · workspace changes in this build reset on reload</span></div>' +
      '<header class="topbar"><div class="shell topbar-inner"><div class="topbar-copy"><strong>' + escapeHtml(store.name) + '</strong><span>' + escapeHtml(store.doctorName) + ' · ' + escapeHtml(store.city) + '</span></div>' +
      (state.user && state.user.isOwner ? '<label class="store-switch"><span class="visually-hidden">Active store</span><select id="store-switch">' + Object.keys(stores).map(function (id) { return '<option value="' + id + '"' + (id === state.activeStoreId ? ' selected' : '') + '>' + escapeHtml(stores[id].name) + '</option>'; }).join("") + '</select></label>' : '') +
      '<button class="icon-btn" type="button" data-action="logout" aria-label="Log out">' + icons.logout + '</button></div></header>' +
      '<main class="shell dashboard">' + content + '</main>' +
      '<nav class="bottom-nav" aria-label="Workspace sections">' + navButton("overview", "Overview") + navButton("medicines", "Medicines") + navButton("orders", "Orders") + '</nav>';
  }
  function navButton(tab, label) {
    return '<button class="nav-btn' + (state.tab === tab ? ' active' : '') + '" type="button" data-tab="' + tab + '">' + (tab === "medicines" ? icons.bottle : tab === "orders" ? icons.check : icons.store) + '<span>' + label + '</span></button>';
  }
  function dashboardTabs() {
    var tabs = [
      ["overview", "Overview"], ["medicines", "Medicines"], ["bulk", "Bulk add"], ["inventory", "Inventory"],
      ["orders", "Orders"], ["referrals", "Referrals"], ["delivery", "Delivery"]
    ];
    return '<div class="tabs dashboard-tabs">' + tabs.map(function (item) { return '<button type="button" class="tab' + (state.tab === item[0] ? ' active' : '') + '" data-tab="' + item[0] + '">' + item[1] + '</button>'; }).join("") + '</div>';
  }
  function pageHeading(title, subtitle) {
    return '<div class="dashboard-head"><div><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(subtitle) + '</p></div><span class="owner-pill">' + (state.user.isOwner ? 'Owner access' : escapeHtml(state.user.role)) + '</span></div>';
  }

  function renderOverview(store) {
    var low = store.medicines.filter(function (item) { return Number(item.stock) <= 5; }).length;
    var pending = store.orders.filter(function (item) { return item.status !== "Delivered" && item.status !== "Cancelled"; }).length;
    return pageHeading(store.name, store.doctorName + " · " + store.city) +
      '<div class="notice session-note"><strong>Workspace isolation is active.</strong> Medicines, orders, referrals and delivery rates below belong only to this store.</div>' +
      '<div class="stat-row stats-four"><div class="stat"><strong>' + store.medicines.length + '</strong><span>Medicines</span></div><div class="stat stat-low"><strong>' + low + '</strong><span>Low stock</span></div><div class="stat"><strong>' + pending + '</strong><span>Open orders</span></div><div class="stat"><strong>' + store.referrals.length + '</strong><span>Referrals</span></div></div>' +
      '<section class="owner-tools"><div class="owner-tools-head"><div><h2>Offline workspace tools</h2><p>Every tool works without contacting an external service.</p></div></div>' +
      '<div class="owner-tool-grid"><button class="owner-tool" type="button" data-tab="medicines"><strong>Medicine management</strong><span>Add, edit or remove items in this store only.</span></button>' +
      '<button class="owner-tool" type="button" data-tab="bulk"><strong>Bulk medicine add</strong><span>Paste one medicine per line for fast entry.</span></button>' +
      '<button class="owner-tool" type="button" data-tab="inventory"><strong>Inventory</strong><span>Review stock and low-stock warnings.</span></button>' +
      '<button class="owner-tool" type="button" data-tab="orders"><strong>Orders</strong><span>Create orders and move them through delivery stages.</span></button>' +
      '<button class="owner-tool" type="button" data-tab="referrals"><strong>Referrals</strong><span>Use the store code and record referred people.</span></button>' +
      '<button class="owner-tool" type="button" data-tab="delivery"><strong>Delivery calculator</strong><span>Set this store’s rates and calculate a delivery amount.</span></button></div></section>';
  }

  function medicineForm(store) {
    var existing = store.medicines.find(function (item) { return item.id === state.editingMedicineId; });
    existing = existing || { name: "", category: categories(store)[0], price: "", stock: "" };
    return '<section class="form-card"><h2>' + (state.editingMedicineId ? 'Edit medicine' : 'Add medicine') + '</h2><form id="medicine-form" class="form-grid">' +
      '<div class="field"><label for="medicine-name">Medicine name</label><input id="medicine-name" name="name" value="' + escapeHtml(existing.name) + '" maxlength="100" required></div>' +
      '<div class="field"><label for="medicine-category">Category</label><select id="medicine-category" name="category">' + categoryOptions(store, existing.category) + '</select></div>' +
      '<div class="field"><label for="medicine-price">Price (PKR)</label><input id="medicine-price" name="price" type="number" min="0" step="0.01" value="' + escapeHtml(existing.price) + '" required></div>' +
      '<div class="field"><label for="medicine-stock">Stock</label><input id="medicine-stock" name="stock" type="number" min="0" step="1" value="' + escapeHtml(existing.stock) + '" required></div>' +
      '<div class="form-actions full">' + (state.editingMedicineId ? '<button type="button" class="btn btn-secondary" data-action="cancel-edit">Cancel</button>' : '') + '<button class="btn btn-primary" type="submit">' + (state.editingMedicineId ? 'Update medicine' : 'Add medicine') + '</button></div></form></section>';
  }
  function medicineList(store) {
    if (!store.medicines.length) return '<div class="empty">' + icons.bottle + '<h3>No medicines yet</h3><p>Add a medicine above or use Bulk add.</p></div>';
    return '<div class="list">' + store.medicines.map(function (item) {
      return '<article class="list-item"><div class="thumb">' + icons.bottle + '</div><div class="item-main"><div class="item-title-row"><strong>' + escapeHtml(item.name) + '</strong><span class="category-badge">' + escapeHtml(item.category) + '</span></div><span>' + money(item.price) + ' · <span class="stock-level' + (Number(item.stock) === 0 ? ' is-out' : Number(item.stock) <= 5 ? ' is-low' : '') + '">' + Number(item.stock) + ' in stock</span></span></div>' +
        '<div class="item-actions"><button class="btn btn-secondary btn-sm" type="button" data-edit-medicine="' + item.id + '">' + icons.edit + ' Edit</button><button class="btn btn-danger btn-sm" type="button" data-delete-medicine="' + item.id + '">' + icons.trash + ' Remove</button></div></article>';
    }).join("") + '</div>';
  }
  function renderMedicines(store) {
    return pageHeading("Medicines", "Manage " + store.name + " without a network connection.") + medicineForm(store) + '<div class="section-head"><div><h2>Medicine list</h2><p>' + store.medicines.length + ' item' + (store.medicines.length === 1 ? '' : 's') + ' in this store</p></div></div>' + medicineList(store);
  }
  function renderBulk(store) {
    return pageHeading("Bulk add", "Add several medicines to " + store.name + " in one pass.") +
      '<section class="form-card bulk-card"><div class="bulk-head"><div><h2>Paste medicine lines</h2><p>Use: name - price - stock. Each valid line becomes a separate medicine.</p></div><span class="bulk-step">Offline parser</span></div>' +
      '<form id="bulk-form" class="form-grid"><div class="field full"><label for="bulk-category">Category for these items</label><select id="bulk-category" name="category">' + categoryOptions(store, categories(store)[0]) + '</select></div>' +
      '<div class="field full"><label for="bulk-lines">Medicine lines</label><textarea id="bulk-lines" name="lines" rows="9" placeholder="Medicine name - price - stock" required></textarea><small>Blank or invalid lines are skipped and reported.</small></div>' +
      '<div class="form-actions full"><button class="btn btn-primary" type="submit">' + icons.plus + ' Add valid lines</button></div></form></section>';
  }
  function renderInventory(store) {
    var totalUnits = store.medicines.reduce(function (sum, item) { return sum + Number(item.stock || 0); }, 0);
    var low = store.medicines.filter(function (item) { return Number(item.stock) <= 5; }).length;
    var rows = store.medicines.slice().sort(function (a, b) { return Number(a.stock) - Number(b.stock); });
    return pageHeading("Inventory", "Stock for " + store.name + " only.") +
      '<div class="stat-row"><div class="stat"><strong>' + store.medicines.length + '</strong><span>Products</span></div><div class="stat"><strong>' + totalUnits + '</strong><span>Total units</span></div><div class="stat stat-low"><strong>' + low + '</strong><span>Low or out</span></div></div>' +
      (rows.length ? '<div class="inventory-list">' + rows.map(function (item) { var stock = Number(item.stock); var label = stock === 0 ? 'Out of stock' : stock <= 5 ? 'Low stock' : 'Ready'; var statusClass = stock === 0 ? 'out' : stock <= 5 ? 'low' : 'ready'; return '<article class="inventory-row"><div class="thumb">' + icons.bottle + '</div><div class="inventory-product"><strong>' + escapeHtml(item.name) + '</strong><span>' + escapeHtml(item.category) + ' · ' + money(item.price) + '</span></div><div class="inventory-stock"><strong>' + stock + '</strong><span>units</span></div><div class="inventory-status"><span class="stock-status stock-status-' + statusClass + '">' + label + '</span></div><button class="btn btn-secondary btn-sm" type="button" data-edit-medicine="' + item.id + '">Adjust</button></article>'; }).join("") + '</div>' : '<div class="empty"><h3>No inventory yet</h3><p>Add medicines before reviewing stock.</p></div>');
  }

  function orderCard(order) {
    var statuses = ["Pending", "Processing", "Shipped", "Delivered"];
    var options = statuses.concat(["Cancelled"]).map(function (status) { return '<option' + (status === order.status ? ' selected' : '') + '>' + status + '</option>'; }).join("");
    return '<article class="order-card"><div class="order-top"><div><h3>' + escapeHtml(order.customerName) + '</h3><p>' + escapeHtml(order.phone || 'No phone') + ' · ' + escapeHtml(order.type) + '</p></div><span class="status status-' + order.status.toLowerCase() + '">' + escapeHtml(order.status) + '</span></div>' +
      '<div class="order-lines"><div class="order-line"><span>' + escapeHtml(order.items) + '</span><strong>' + money(order.amount) + '</strong></div></div>' +
      '<div class="order-meta"><span>Pending amount: <strong>' + money(order.pending) + '</strong></span><label>Status <select data-order-status="' + order.id + '">' + options + '</select></label></div></article>';
  }
  function renderOrders(store) {
    return pageHeading("Orders", "Orders remain isolated inside " + store.name + ".") +
      '<section class="form-card"><h2>Add order</h2><form id="order-form" class="form-grid"><div class="field"><label for="order-customer">Customer name</label><input id="order-customer" name="customerName" required></div>' +
      '<div class="field"><label for="order-phone">Phone</label><input id="order-phone" name="phone" inputmode="tel"></div><div class="field"><label for="order-type">Order type</label><select id="order-type" name="type"><option>Customer order</option><option>Doctor order</option></select></div>' +
      '<div class="field"><label for="order-amount">Order amount (PKR)</label><input id="order-amount" name="amount" type="number" min="0" step="0.01" required></div>' +
      '<div class="field"><label for="order-pending">Pending amount (PKR)</label><input id="order-pending" name="pending" type="number" min="0" step="0.01" required></div>' +
      '<div class="field full"><label for="order-items">Items / notes</label><textarea id="order-items" name="items" rows="3" required></textarea></div><div class="form-actions full"><button class="btn btn-primary" type="submit">Add order</button></div></form></section>' +
      '<div class="section-head"><div><h2>Store orders</h2><p>' + store.orders.length + ' order' + (store.orders.length === 1 ? '' : 's') + '</p></div></div>' +
      (store.orders.length ? '<div class="list">' + store.orders.map(orderCard).join("") + '</div>' : '<div class="empty"><h3>No orders yet</h3><p>Orders added here stay separate from the other clinic.</p></div>');
  }
  function renderReferrals(store) {
    return pageHeading("Referrals", "Referral records for " + store.name + " only.") +
      '<section class="referral-card"><div class="referral-card-head"><div><h2>Store referral code</h2><p>Share this code through your preferred channel.</p></div><div class="referral-count"><strong>' + store.referrals.length + '</strong><span>Referrals</span></div></div>' +
      '<div class="referral-code"><span>Referral code</span><strong>' + escapeHtml(store.referralCode) + '</strong></div><div class="referral-actions"><button class="btn btn-secondary" type="button" data-action="copy-referral">Copy code</button></div></section>' +
      '<section class="form-card bulk-card"><h2>Record a referral</h2><form id="referral-form" class="form-grid"><div class="field"><label for="referral-name">Name</label><input id="referral-name" name="name" required></div><div class="field"><label for="referral-contact">Contact or note</label><input id="referral-contact" name="contact"></div><div class="form-actions full"><button class="btn btn-primary" type="submit">Add referral</button></div></form></section>' +
      '<div class="section-head"><div><h2>Referred people</h2></div></div>' + (store.referrals.length ? '<div class="referral-list">' + store.referrals.map(function (entry) { return '<article class="referral-row"><div class="referral-avatar">' + icons.check + '</div><div><strong>' + escapeHtml(entry.name) + '</strong><span>' + escapeHtml(entry.contact || 'No note') + '</span></div></article>'; }).join("") + '</div>' : '<div class="empty"><h3>No referrals recorded</h3><p>Add a referral using the form above.</p></div>');
  }
  function renderDelivery(store) {
    return pageHeading("Delivery calculator", "Rates and calculations for " + store.name + " only.") +
      '<section class="owner-tools"><div class="owner-delivery"><div><h3>Set rates and calculate</h3><p>Enter your own delivery rates. No external courier price is requested.</p></div>' +
      '<form id="delivery-form" class="owner-delivery-fields"><label>Base charge (PKR)<input name="base" type="number" min="0" step="0.01" value="' + store.delivery.base + '" required></label><label>Per kg charge (PKR)<input name="perKg" type="number" min="0" step="0.01" value="' + store.delivery.perKg + '" required></label><label>Package weight (kg)<input name="weight" type="number" min="0" step="0.01" value="0" required></label><label>Quantity<input name="quantity" type="number" min="1" step="1" value="1" required></label><button class="btn btn-primary" type="submit">Calculate</button></form>' +
      '<div id="delivery-result" class="owner-delivery-breakdown"><span>Base <strong>' + money(store.delivery.base) + '</strong></span><span>Weight charge <strong>' + money(0) + '</strong></span><span class="owner-delivery-total">Total <strong>' + money(store.delivery.base) + '</strong></span></div></div></section>';
  }

  function renderApp() {
    if (!state.user) { loginWall(); return; }
    var store = activeStore();
    var content = dashboardTabs();
    if (state.tab === "overview") content += renderOverview(store);
    else if (state.tab === "medicines") content += renderMedicines(store);
    else if (state.tab === "bulk") content += renderBulk(store);
    else if (state.tab === "inventory") content += renderInventory(store);
    else if (state.tab === "orders") content += renderOrders(store);
    else if (state.tab === "referrals") content += renderReferrals(store);
    else if (state.tab === "delivery") content += renderDelivery(store);
    document.getElementById("app").innerHTML = shell(content);
    document.getElementById("app").setAttribute("data-ready", "true");
  }

  function handleLogin(form) {
    var data = new FormData(form);
    var email = String(data.get("email") || "").trim().toLowerCase();
    var password = String(data.get("password") || "");
    var button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Signing in…";
    return proxyAuth("signin", email, password).then(function (result) {
      var saved = sessionAccounts.find(function (item) { return item.email === email; });
      state.user = {
        id: result.localId || result.userId || (saved && saved.id) || uid("account"),
        email: email,
        name: (saved && saved.name) || (email === OWNER_EMAIL ? "Medinest Owner" : email.split("@")[0]),
        role: (saved && saved.role) || (email === OWNER_EMAIL ? "owner" : "customer"),
        isOwner: email === OWNER_EMAIL,
        idToken: result.idToken
      };
      state.tab = "overview";
      renderApp();
      showToast(state.user.isOwner ? "Owner login successful" : "Signed in successfully");
    }).catch(function (error) {
      button.disabled = false;
      button.textContent = "Sign In";
      showAuthFeedback(authMessage(error));
    });
  }
  function handleCreate(form) {
    var data = new FormData(form);
    var name = String(data.get("name") || "").trim();
    var email = String(data.get("email") || "").trim().toLowerCase();
    var password = String(data.get("password") || "");
    var role = String(data.get("accountType") || "customer");
    var button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Creating account…";
    return proxyAuth("signup", email, password).then(function (result) {
      var account = { id: result.localId || result.userId || uid("account"), name: name, email: email, role: role, isOwner: email === OWNER_EMAIL, idToken: result.idToken };
      sessionAccounts = sessionAccounts.filter(function (item) { return item.email !== email; });
      sessionAccounts.push(account);
      state.user = account;
      state.tab = "overview";
      renderApp();
      showToast("Account created successfully");
    }).catch(function (error) {
      button.disabled = false;
      button.textContent = "Create Account";
      showAuthFeedback(authMessage(error));
    });
  }
  function parseBulk(lines, category, store) {
    var added = 0, skipped = 0;
    String(lines || "").split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var parts = line.split("-").map(function (part) { return part.trim(); });
      if (parts.length < 3) { skipped += 1; return; }
      var stock = Number(parts.pop());
      var price = Number(parts.pop());
      var name = parts.join(" - ").trim();
      if (!name || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) { skipped += 1; return; }
      store.medicines.push({ id: uid("medicine"), name: name, category: category, price: price, stock: stock });
      added += 1;
    });
    return { added: added, skipped: skipped };
  }

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (form.id === "boot-auth-form") { handleLogin(form); return; }
    if (form.id === "boot-create-form") { handleCreate(form); return; }
    if (!state.user) return;
    var store = activeStore();
    var data = new FormData(form);
    if (form.id === "medicine-form") {
      var payload = { name: String(data.get("name") || "").trim(), category: String(data.get("category") || ""), price: Number(data.get("price")), stock: Number(data.get("stock")) };
      if (state.editingMedicineId) {
        var existing = store.medicines.find(function (item) { return item.id === state.editingMedicineId; });
        if (existing) Object.assign(existing, payload);
        state.editingMedicineId = "";
        showToast("Medicine updated");
      } else { payload.id = uid("medicine"); store.medicines.push(payload); showToast("Medicine added"); }
      renderApp(); return;
    }
    if (form.id === "bulk-form") {
      var result = parseBulk(data.get("lines"), String(data.get("category") || "Other"), store);
      state.tab = "medicines";
      renderApp();
      showToast(result.added + " added" + (result.skipped ? "; " + result.skipped + " skipped" : "")); return;
    }
    if (form.id === "order-form") {
      store.orders.unshift({ id: uid("order"), customerName: String(data.get("customerName") || "").trim(), phone: String(data.get("phone") || "").trim(), type: String(data.get("type") || "Customer order"), amount: Number(data.get("amount")), pending: Number(data.get("pending")), items: String(data.get("items") || "").trim(), status: "Pending" });
      renderApp(); showToast("Order added to " + store.name); return;
    }
    if (form.id === "referral-form") {
      store.referrals.unshift({ id: uid("referral"), name: String(data.get("name") || "").trim(), contact: String(data.get("contact") || "").trim() });
      renderApp(); showToast("Referral recorded"); return;
    }
    if (form.id === "delivery-form") {
      store.delivery.base = Number(data.get("base")); store.delivery.perKg = Number(data.get("perKg"));
      var weight = Number(data.get("weight")); var quantity = Number(data.get("quantity"));
      var weightCharge = store.delivery.perKg * weight * quantity;
      var total = store.delivery.base + weightCharge;
      var resultBox = document.getElementById("delivery-result");
      resultBox.innerHTML = '<span>Base <strong>' + money(store.delivery.base) + '</strong></span><span>Weight charge <strong>' + money(weightCharge) + '</strong></span><span class="owner-delivery-total">Total <strong>' + money(total) + '</strong></span>';
      showToast("Delivery total calculated offline");
    }
  });

  document.addEventListener("click", function (event) {
    var tab = event.target.closest("[data-tab]");
    if (tab) { state.tab = tab.getAttribute("data-tab"); state.editingMedicineId = ""; renderApp(); window.scrollTo(0, 0); return; }
    var action = event.target.closest("[data-action]");
    if (action) {
      var name = action.getAttribute("data-action");
      if (name === "logout") { state.user = null; state.tab = "overview"; state.editingMedicineId = ""; renderApp(); return; }
      if (name === "cancel-edit") { state.editingMedicineId = ""; renderApp(); return; }
      if (name === "copy-referral") {
        var code = activeStore().referralCode;
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(function () { showToast("Referral code copied"); }).catch(function () { showToast("Referral code: " + code); });
        else showToast("Referral code: " + code);
        return;
      }
    }
    var edit = event.target.closest("[data-edit-medicine]");
    if (edit) { state.editingMedicineId = edit.getAttribute("data-edit-medicine"); state.tab = "medicines"; renderApp(); window.scrollTo(0, 0); return; }
    var remove = event.target.closest("[data-delete-medicine]");
    if (remove) {
      var store = activeStore();
      var id = remove.getAttribute("data-delete-medicine");
      store.medicines = store.medicines.filter(function (item) { return item.id !== id; });
      renderApp(); showToast("Medicine removed");  try {
    var _savedToken = localStorage.getItem("medinest_token");
    var _savedUser = JSON.parse(localStorage.getItem("medinest_user") || "null");
    if (_savedToken && _savedUser && _savedUser.email) {
      state.user = {
        id: _savedUser.uid || ("account-" + Date.now()),
        email: _savedUser.email,
        name: String(_savedUser.email).split("@")[0],
        role: _savedUser.email === OWNER_EMAIL ? "owner" : "customer",
        isOwner: _savedUser.email === OWNER_EMAIL,
        idToken: _savedToken
      };
    }
  } catch (_restoreError) {}
  if (state.user) { renderApp(); } else { loginWall(); }
  var _fixedBtn = document.getElementById('boot-signin-button');
  if (_fixedBtn) {
  document.getElementById('boot-signin-button').addEventListener('click', async function(e) {
    e.preventDefault();
    console.log('Sign In clicked');
    const email = document.querySelector('#boot-auth-form input[type="email"]')?.value || document.querySelector('input[type="email"]')?.value;
    const password = document.querySelector('#boot-auth-form input[type="password"]')?.value || document.querySelector('input[type="password"]')?.value;
    console.log('Email:', email);
    if (!email || !password) {
      alert('Please enter email and password');
      return;
    }
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    try {
      console.log('Fetching auth...');
      const resp = await fetch('/.netlify/functions/auth', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'signin', email: email, password: password})
      });
      console.log('Response status:', resp.status);
      const data = await resp.json();
      console.log('Response data:', data);
      if (data.idToken) {
        console.log('Login success!');
        localStorage.setItem('medinest_token', data.idToken);
        localStorage.setItem('medinest_user', JSON.stringify({email: email, uid: data.localId}));
        location.reload();
      } else {
        alert('Login failed: ' + (data.error || 'Unknown error'));
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    } catch (err) {
      console.error('Fetch error:', err);
      alert('Login error: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
  }
    }
  });

  document.addEventListener("change", function (event) {
    if (event.target.id === "store-switch") {
      state.activeStoreId = event.target.value;
      state.editingMedicineId = "";
      state.tab = "overview";
      renderApp();
      showToast("Switched to " + activeStore().name);
      return;
    }
    if (event.target.matches("[data-order-status]")) {
      var order = activeStore().orders.find(function (item) { return item.id === event.target.getAttribute("data-order-status"); });
      if (order) { order.status = event.target.value; renderApp(); showToast("Order status updated"); }
    }
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("assets/sw.js").catch(function () {}); });
  }
  
})();
^}
