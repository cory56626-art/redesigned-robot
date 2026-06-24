/* app.js — UI logic for Endangered Earth */
(function () {
  "use strict";

  const select = document.getElementById("animal-select");
  const detail = document.getElementById("detail");
  const animalGrid = document.getElementById("animal-grid");
  const plantGrid = document.getElementById("plant-grid");

  const fmt = (n) => n.toLocaleString("en-US");

  // Round 1 fix (Mistral/Cohere/Groq): classify by IUCN status, NOT by raw
  // population. A 150k-strong but Critically Endangered species is still
  // "crit"; an Endangered gorilla at ~1,000 is not falsely flagged.
  const SEVERITY = {
    "Extinct in the Wild": "crit",
    "Critically Endangered": "crit",
    "Endangered": "high",
    "Vulnerable": "med"
  };
  const isCrit = (x) => SEVERITY[x.status] === "crit";

  // ---- Populate dropdown ----
  ANIMALS.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `${a.emoji}  ${a.name}`;
    select.appendChild(opt);
  });

  function renderDetail(animal) {
    const crit = isCrit(animal);
    const roleClass = animal.role === "predator" ? "predator" : "prey";
    const roleLabel = animal.role === "predator" ? "🩸 Predator" : "🌿 Prey / Herbivore";

    const nodes = animal.tree
      .map(
        (n) => `
        <div class="tree-node">
          <span class="tree-clade">${n.clade}</span><span class="tree-when">${n.when}</span>
          <div class="tree-note">${n.note}</div>
        </div>`
      )
      .join("");

    detail.innerHTML = `
      <div class="detail-head">
        <div class="detail-emoji" aria-hidden="true">${animal.emoji}</div>
        <div class="detail-title">
          <h3>${animal.name}</h3>
          <div class="sci">${animal.sci}</div>
        </div>
        <span class="badge status" title="IUCN Red List category">${animal.status}</span>
        <span class="badge ${roleClass}" title="${animal.role === "predator" ? "Hunts other animals" : "Eaten by, or low in, the food chain"}">${roleLabel}</span>
      </div>

      <p class="pop-line">Estimated wild population:
        <span class="pop-num ${crit ? "crit" : ""}">${animal.population === 0 ? "0 (wild)" : fmt(animal.population)}</span>
      </p>
      <p class="role-note">${animal.roleNote}</p>
      <p class="role-note"><strong>Range:</strong> ${animal.region}</p>

      <div class="tree">
        <h4>🧬 Family tree — who they evolved from, and when</h4>
        <div class="tree-line">${nodes}</div>
      </div>

      <a class="learn-more" target="_blank" rel="noopener"
         href="https://www.iucnredlist.org/search?query=${encodeURIComponent(animal.sci)}"
         aria-label="Learn more about ${animal.name} on the IUCN Red List (opens in a new tab)">
        🔗 Learn more on the IUCN Red List <span class="ext">↗</span>
      </a>
    `;
  }

  function selectAnimal(id) {
    const animal = ANIMALS.find((a) => a.id === id);
    if (!animal) return;
    select.value = id;
    renderDetail(animal);
    detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  select.addEventListener("change", () => selectAnimal(select.value));

  // ---- Animal cards ----
  ANIMALS.forEach((a) => {
    const card = document.createElement("div");
    card.className = "card" + (isCrit(a) ? " crit" : "");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${a.name}, ${a.status}, about ${fmt(a.population)} left. Show family tree.`);
    card.innerHTML = `
      <div class="c-emoji" aria-hidden="true">${a.emoji}</div>
      <div class="c-name">${a.name}</div>
      <div class="c-sci">${a.sci}</div>
      <div class="c-pop">~<span>${a.population === 0 ? "0 wild" : fmt(a.population)}</span> left</div>
    `;
    const go = () => selectAnimal(a.id);
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });
    animalGrid.appendChild(card);
  });

  // ---- Plant cards ----
  PLANTS.forEach((p) => {
    const card = document.createElement("div");
    card.className = "card card--static"; // informational, not clickable
    card.setAttribute("role", "article");
    card.setAttribute("aria-label", `${p.name} (${p.sci}), ${p.status}`);
    card.innerHTML = `
      <div class="c-emoji" aria-hidden="true">${p.emoji}</div>
      <div class="c-name">${p.name}</div>
      <div class="c-sci">${p.sci}</div>
      <div class="c-pop"><span class="badge status">${p.status}</span></div>
      <p class="role-note" style="margin-top:10px">${p.note}</p>
    `;
    plantGrid.appendChild(card);
  });

  // ---- Jimmy (pixel-art assistant) ----
  function drawJimmy() {
    const canvas = document.getElementById("jimmy");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const S = 8; // pixel size; 8x8 grid -> 64px
    // 8x8 pixel map. Letters map to colors below.
    const map = [
      "..GGGG..",
      ".GGGGGG.",
      "GG.GG.GG",
      "GGWGGWGG",
      "GGGGGGGG",
      "GG.GG.GG",
      ".GMMMMG.",
      "..G..G..",
    ];
    const colors = { G: "#6ee7b7", W: "#0e1116", M: "#0e1116", ".": null };
    ctx.clearRect(0, 0, 64, 64);
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[y].length; x++) {
        const c = colors[map[y][x]];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x * S, y * S, S, S);
      }
    }
  }

  function initJimmy() {
    drawJimmy();
    const wrap = document.getElementById("jimmy-wrap");
    const bubble = document.getElementById("jimmy-bubble");
    let i = 0;
    let hideTimer = null;
    const speak = () => {
      bubble.textContent = JIMMY_FACTS[i % JIMMY_FACTS.length];
      i++;
      bubble.classList.remove("hidden");
      wrap.setAttribute("aria-expanded", "true");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        bubble.classList.add("hidden");
        wrap.setAttribute("aria-expanded", "false");
      }, 7000);
    };
    wrap.addEventListener("click", speak);
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); speak(); }
    });
  }

  // ---- Init ----
  if (ANIMALS.length) selectAnimal(ANIMALS[0].id);
  initJimmy();
})();
