/* miku.js — draggable Hatsune Miku pixel-art desktop buddy (Clippy-style) */
(function () {
  "use strict";

  // ---- Pixel sprite (16 x 20 grid of crisp rects) -------------------------
  // Colors
  var C = {
    teal: "#39c5bb",
    tealD: "#1f8e87",
    skin: "#ffe0c2",
    eye: "#178f86",
    pink: "#ff6fae",
    white: "#f4f8ff",
    grey: "#3a4666",
    boot: "#26304d"
  };
  // helper to make a rect
  function r(x, y, w, h, fill) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"/>';
  }
  function buildSprite() {
    var p = "";
    // twin tails (teal) down the sides
    p += r(0, 3, 2, 11, C.teal) + r(14, 3, 2, 11, C.teal);
    p += r(0, 5, 2, 1, C.tealD) + r(14, 5, 2, 1, C.tealD);   // tie bands
    p += r(0, 9, 2, 1, C.tealD) + r(14, 9, 2, 1, C.tealD);
    p += r(0, 13, 2, 2, C.tealD) + r(14, 13, 2, 2, C.tealD); // tips
    // hair top
    p += r(4, 0, 8, 1, C.teal) + r(3, 1, 10, 1, C.teal);
    p += r(2, 2, 12, 1, C.teal) + r(2, 3, 12, 1, C.teal);
    // face
    p += r(4, 4, 8, 5, C.skin);
    // side hair framing the face
    p += r(3, 4, 1, 4, C.teal) + r(12, 4, 1, 4, C.teal);
    // fringe
    p += r(4, 4, 8, 1, C.teal);
    // eyes
    p += r(5, 6, 2, 2, C.eye) + r(9, 6, 2, 2, C.eye);
    p += r(6, 6, 1, 1, C.white) + r(10, 6, 1, 1, C.white); // sparkle
    // blush
    p += r(4, 7, 1, 1, C.pink) + r(11, 7, 1, 1, C.pink);
    // mouth
    p += r(7, 8, 2, 1, C.pink);
    // neck
    p += r(6, 9, 4, 1, C.skin);
    // top / collar
    p += r(4, 10, 8, 2, C.white);
    p += r(3, 10, 1, 3, C.white) + r(12, 10, 1, 3, C.white); // sleeves
    // teal tie
    p += r(7, 10, 2, 3, C.teal);
    // skirt
    p += r(4, 12, 8, 2, C.grey) + r(3, 14, 10, 1, C.grey);
    // legs
    p += r(5, 15, 2, 2, C.skin) + r(9, 15, 2, 2, C.skin);
    // boots
    p += r(5, 17, 2, 3, C.boot) + r(9, 17, 2, 3, C.boot);
    return '<svg viewBox="0 0 16 20" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
      '<g class="floaty">' + p + "</g></svg>";
  }

  // ---- DOM ---------------------------------------------------------------
  var miku = document.createElement("div");
  miku.id = "miku";
  miku.setAttribute("role", "button");
  miku.setAttribute("tabindex", "0");
  miku.setAttribute("aria-label", "Miku assistant — drag me, or click for tips");
  miku.innerHTML = buildSprite();

  var bubble = document.createElement("div");
  bubble.id = "miku-bubble";

  document.body.appendChild(miku);
  document.body.appendChild(bubble);

  // ---- Dialog content ----------------------------------------------------
  var TIPS = [
    "Tap any animal's <b>Explore</b> button to see its family tree, evolution, and predator/prey history!",
    "The <b>Vaquita</b> is down to about 10 individuals. Gillnets are the main threat.",
    "Did you know? The <b>Giant Panda</b> was moved from Endangered to Vulnerable in 2016 — recovery is possible! 🐼",
    "Use the search box up top to filter animals by name or region.",
    "Red badge = Critically Endangered. Yellow = Endangered. Green = Vulnerable.",
    "An <b>apex predator</b> in one era can become <b>prey</b> in another — usually to us.",
    "The <b>Saola</b> was only discovered by science in 1992. Most die in snares meant for other animals."
  ];
  var FACTS = [
    "🐆 Amur Leopards can leap nearly 3 metres straight up.",
    "🐢 Hawksbill turtles keep coral reefs healthy by eating sponges.",
    "🦏 Many female Javan rhinos have no horn at all.",
    "🦧 Orangutans share about 97% of their DNA with humans.",
    "🐬 The vaquita was only described by science in 1958.",
    "🦍 Mountain gorillas have passed 1,000 individuals — a real win."
  ];

  function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function say(html, actions) {
    var btns = "";
    (actions || []).forEach(function (a, i) {
      btns += '<button data-mk="' + i + '">' + a.label + "</button>";
    });
    bubble.innerHTML =
      '<div class="mk-name">Miku ♪</div>' + html +
      (btns ? '<div class="mk-actions">' + btns + "</div>" : "");
    bubble.classList.add("show");
    positionBubble();
    // wire action buttons
    bubble.querySelectorAll("[data-mk]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = +b.getAttribute("data-mk");
        if (actions[idx] && actions[idx].onClick) actions[idx].onClick();
      });
    });
    clearTimeout(say._t);
    if (!actions || !actions.length) {
      say._t = setTimeout(hide, 7000);
    }
  }
  function hide() { bubble.classList.remove("show"); }

  function defaultMenu() {
    say("Hi, I'm Miku! Need a hand exploring endangered animals? ♪", [
      { label: "💡 Tip", onClick: function () { say(rand(TIPS), backBtn()); } },
      { label: "✨ Fun fact", onClick: function () { say(rand(FACTS), backBtn()); } },
      { label: "🎲 Surprise me", onClick: surpriseAnimal },
      { label: "💃 Dance", onClick: dance },
      { label: "✕ Bye", onClick: hide }
    ]);
  }
  function backBtn() {
    return [{ label: "↩ Menu", onClick: defaultMenu }, { label: "✕", onClick: hide }];
  }

  function surpriseAnimal() {
    if (!window.ANIMALS || !window.ANIMALS.length) { say("No animals loaded!", backBtn()); return; }
    var a = rand(window.ANIMALS);
    say("Let's look at the <b>" + a.name + "</b>! 🐾", [
      { label: "Open " + a.emoji, onClick: function () {
          hide();
          if (window.openAnimal) window.openAnimal(a.id);
        } },
      { label: "↩ Menu", onClick: defaultMenu }
    ]);
  }

  function dance() {
    miku.classList.remove("spin");
    void miku.offsetWidth; // restart animation
    miku.classList.add("spin");
    say("♪~ ＼(^o^)／ ~♪", backBtn());
    setTimeout(function () { miku.classList.remove("spin"); }, 900);
  }
  // expose a couple hooks
  window.mikuSay = say;
  window.mikuDance = dance;

  // ---- Bubble positioning ------------------------------------------------
  function positionBubble() {
    var rct = miku.getBoundingClientRect();
    bubble.style.visibility = "hidden";
    bubble.style.display = "block";
    var bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    bubble.style.display = "";
    bubble.style.visibility = "";
    var left = rct.left;
    var top = rct.top - bh - 14;
    if (top < 8) top = rct.bottom + 14;                  // flip below if no room above
    if (left + bw > window.innerWidth - 8) left = window.innerWidth - bw - 8;
    if (left < 8) left = 8;
    bubble.style.left = left + "px";
    bubble.style.top = top + "px";
  }

  // ---- Dragging ----------------------------------------------------------
  var dragging = false, moved = false, offX = 0, offY = 0;

  function onDown(e) {
    dragging = true; moved = false;
    miku.classList.add("dragging");
    var pt = point(e);
    var rct = miku.getBoundingClientRect();
    offX = pt.x - rct.left;
    offY = pt.y - rct.top;
    // switch to top/left positioning
    miku.style.left = rct.left + "px";
    miku.style.top = rct.top + "px";
    miku.style.right = "auto";
    miku.style.bottom = "auto";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    var pt = point(e);
    moved = true;
    var x = pt.x - offX, y = pt.y - offY;
    var maxX = window.innerWidth - miku.offsetWidth;
    var maxY = window.innerHeight - miku.offsetHeight;
    x = Math.max(0, Math.min(maxX, x));
    y = Math.max(0, Math.min(maxY, y));
    miku.style.left = x + "px";
    miku.style.top = y + "px";
    if (bubble.classList.contains("show")) positionBubble();
  }
  function onUp() {
    dragging = false;
    miku.classList.remove("dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }
  function point(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  miku.addEventListener("pointerdown", onDown);
  miku.addEventListener("click", function () {
    if (moved) { moved = false; return; }            // ignore click that ended a drag
    if (bubble.classList.contains("show")) hide(); else defaultMenu();
  });
  miku.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); defaultMenu(); }
  });

  window.addEventListener("resize", function () {
    if (bubble.classList.contains("show")) positionBubble();
    // keep Miku on-screen
    var rct = miku.getBoundingClientRect();
    if (rct.left > window.innerWidth - 20 || rct.top > window.innerHeight - 20) {
      miku.style.left = ""; miku.style.top = "";
      miku.style.right = "24px"; miku.style.bottom = "24px";
    }
  });

  // greet shortly after load
  setTimeout(function () {
    say("Hi! I'm Miku ♪ Drag me anywhere, or click me for tips!", [
      { label: "Show me around", onClick: defaultMenu },
      { label: "✕", onClick: hide }
    ]);
  }, 1200);
})();
