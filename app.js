/* app.js — renders cards + the explore modal (family / evolution / roles) */
(function () {
  "use strict";

  var grid = document.getElementById("grid");
  var search = document.getElementById("search");
  var sortSel = document.getElementById("sort");
  var countEl = document.getElementById("count");

  var backdrop = document.getElementById("modal-backdrop");
  var modalBody = document.getElementById("modal-body");
  var modalTitle = document.getElementById("modal-title");
  var modalSci = document.getElementById("modal-sci");
  var modalEmoji = document.getElementById("modal-emoji");

  var data = (window.ANIMALS || []).slice();
  // largest population across set, for relative bars
  var maxPop = data.reduce(function (m, a) { return Math.max(m, a.population); }, 1);
  var lastFocused = null; // element to restore focus to when modal closes

  function badgeClass(status) {
    if (/critically/i.test(status)) return "cr";
    if (/^endangered/i.test(status)) return "en";
    return "vu";
  }
  function fmt(n) { return n.toLocaleString("en-US"); }
  function trendSymbol(t) {
    return t === "up" ? "▲ increasing" : t === "down" ? "▼ decreasing" : "● stable";
  }

  function cardHTML(a) {
    var pct = Math.max(3, Math.round((a.population / maxPop) * 100));
    return (
      '<article class="card" data-id="' + a.id + '">' +
        '<div class="top">' +
          '<div class="emoji" aria-hidden="true">' + a.emoji + "</div>" +
          "<div>" +
            "<h2>" + a.name + "</h2>" +
            '<div class="sci">' + a.sci + "</div>" +
            '<span class="badge ' + badgeClass(a.status) + '">' + a.status + "</span>" +
          "</div>" +
        "</div>" +
        '<div class="popline">' +
          '<span class="num">' + fmt(a.population) + "</span>" +
          '<span class="lbl">individuals (as of ' + a.asOf + ")</span>" +
        "</div>" +
        '<div class="trend ' + a.trend + '">' + trendSymbol(a.trend) + "</div>" +
        '<div class="bar"><span style="width:' + pct + '%"></span></div>' +
        '<p class="blurb">' + a.blurb + "</p>" +
        '<div class="meta">📍 ' + a.region + "</div>" +
        '<button class="btn" data-explore="' + a.id + '">🔍 Explore trees &amp; history</button>' +
      "</article>"
    );
  }

  function render() {
    var q = (search.value || "").trim().toLowerCase();
    var list = data.filter(function (a) {
      return !q ||
        a.name.toLowerCase().indexOf(q) > -1 ||
        a.sci.toLowerCase().indexOf(q) > -1 ||
        a.region.toLowerCase().indexOf(q) > -1;
    });

    var sort = sortSel.value;
    list.sort(function (a, b) {
      if (sort === "pop-asc") return a.population - b.population;
      if (sort === "pop-desc") return b.population - a.population;
      return a.name.localeCompare(b.name);
    });

    if (!data.length) {
      grid.innerHTML = '<p style="color:var(--bad)">⚠️ Animal data failed to load. ' +
        'Make sure <code>data.js</code> is present next to <code>index.html</code>.</p>';
      countEl.textContent = "";
      return;
    }
    grid.innerHTML = list.map(cardHTML).join("") ||
      '<p style="color:var(--muted)">No animals match your search.</p>';
    countEl.textContent = list.length + " of " + data.length + " species";
  }

  // ---- Modal -------------------------------------------------------------
  function treeHTML(tree, evo) {
    var items = tree.nodes.map(function (n, i) {
      return '<li class="' + (evo ? "evo" : "") + '">' +
        '<span class="depth">level ' + (i + 1) + "</span>" + n + "</li>";
    }).join("");
    return "<p style='color:var(--muted);margin:0 0 12px'>" + tree.label + "</p>" +
      '<ul class="tree">' + items + "</ul>";
  }

  function rolesHTML(roles) {
    var rows = roles.map(function (rr) {
      return '<div class="role">' +
        '<div><div class="era">' + rr.era + "</div>" +
        '<span class="tag ' + rr.role + '">' + rr.role.toUpperCase() + "</span></div>" +
        '<div class="note">' + rr.note + "</div>" +
      "</div>";
    }).join("");
    return '<div class="roles">' + rows + "</div>";
  }

  function openAnimal(id) {
    var a = data.find(function (x) { return x.id === id; });
    if (!a) return;
    lastFocused = document.activeElement; // remember trigger for focus return
    modalTitle.textContent = a.name;
    modalSci.textContent = a.sci;
    modalEmoji.textContent = a.emoji;

    modalBody.innerHTML =
      '<div class="tabs" role="tablist">' +
        '<button class="tab active" data-tab="family">🌳 Family tree</button>' +
        '<button class="tab" data-tab="evo">🧬 Evolution tree</button>' +
        '<button class="tab" data-tab="roles">⚔️ Predator vs Prey</button>' +
      "</div>" +
      '<div class="panel active" data-panel="family">' + treeHTML(a.family, false) + "</div>" +
      '<div class="panel" data-panel="evo">' + treeHTML(a.evolution, true) + "</div>" +
      '<div class="panel" data-panel="roles">' + rolesHTML(a.roles) + "</div>";

    // tab switching
    modalBody.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", function () {
        modalBody.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
        modalBody.querySelectorAll(".panel").forEach(function (x) { x.classList.remove("active"); });
        t.classList.add("active");
        var p = modalBody.querySelector('.panel[data-panel="' + t.getAttribute("data-tab") + '"]');
        if (p) p.classList.add("active");
      });
    });

    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    document.querySelector(".modal .close").focus();
  }
  window.openAnimal = openAnimal; // let Miku open animals too

  function closeModal() {
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
    if (lastFocused && typeof lastFocused.focus === "function") {
      lastFocused.focus();
      lastFocused = null;
    }
  }

  // ---- Events ------------------------------------------------------------
  grid.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-explore]");
    if (btn) openAnimal(btn.getAttribute("data-explore"));
  });
  search.addEventListener("input", render);
  sortSel.addEventListener("change", render);

  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) closeModal();
  });
  document.querySelector(".modal .close").addEventListener("click", closeModal);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && backdrop.classList.contains("open")) closeModal();
  });

  render();
})();
