// Snake, built from scratch: grid model, game loop, collision detection,
// scoring, and an optional autopilot AI (BFS pathing + flood-fill fallback)
// used to demo the game without manual input.
(function () {
  "use strict";

  const GRID_SIZE = 20; // cells per side
  const CELL_PX = 20; // pixel size per cell
  const BASE_TICK_MS = 140; // starting speed
  const MIN_TICK_MS = 60; // fastest speed
  const SPEEDUP_EVERY = 5; // food eaten per speed level
  const SPEEDUP_STEP_MS = 10;

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const speedEl = document.getElementById("speed");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");

  const DIRS = {
    UP: { x: 0, y: -1 },
    DOWN: { x: 0, y: 1 },
    LEFT: { x: -1, y: 0 },
    RIGHT: { x: 1, y: 0 },
  };

  function opposite(a, b) {
    return a.x === -b.x && a.y === -b.y;
  }

  let snake, dir, nextDir, food, score, best, running, paused, tickMs, level, timer, autopilot;

  function loadBest() {
    const stored = Number(localStorage.getItem("snake-best") || 0);
    return Number.isFinite(stored) ? stored : 0;
  }

  function saveBest(value) {
    localStorage.setItem("snake-best", String(value));
  }

  function randCell(exclude) {
    const excluded = new Set(exclude.map((p) => p.x + "," + p.y));
    let x, y;
    do {
      x = Math.floor(Math.random() * GRID_SIZE);
      y = Math.floor(Math.random() * GRID_SIZE);
    } while (excluded.has(x + "," + y));
    return { x, y };
  }

  function reset() {
    const mid = Math.floor(GRID_SIZE / 2);
    snake = [
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
      { x: mid - 3, y: mid },
    ];
    dir = DIRS.RIGHT;
    nextDir = DIRS.RIGHT;
    food = randCell(snake);
    score = 0;
    tickMs = BASE_TICK_MS;
    level = 1;
    running = true;
    paused = false;
    overlay.classList.remove("show");
    updateHud();
  }

  function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    speedEl.textContent = level + "x";
  }

  function cellsEqual(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function willHitSelf(head, body) {
    return body.some((seg) => cellsEqual(seg, head));
  }

  function inBounds(p) {
    return p.x >= 0 && p.x < GRID_SIZE && p.y >= 0 && p.y < GRID_SIZE;
  }

  // ---- Autopilot: BFS shortest path to food using the snake's own body as
  // obstacles (minus the tail cell, which will move out of the way), with a
  // flood-fill "most open space" fallback when no path exists. ----
  function neighborsOf(p) {
    return [DIRS.UP, DIRS.DOWN, DIRS.LEFT, DIRS.RIGHT]
      .map((d) => ({ x: p.x + d.x, y: p.y + d.y, from: d }))
      .filter(inBounds);
  }

  function bfsPath(start, goal, blocked) {
    const key = (p) => p.x + "," + p.y;
    const blockedSet = new Set(blocked.map(key));
    const queue = [start];
    const cameFrom = new Map();
    const seen = new Set([key(start)]);
    while (queue.length) {
      const current = queue.shift();
      if (cellsEqual(current, goal)) {
        const path = [];
        let cur = current;
        while (cameFrom.has(key(cur))) {
          const { from, dir: d } = cameFrom.get(key(cur));
          path.unshift(d);
          cur = from;
        }
        return path;
      }
      for (const n of neighborsOf(current)) {
        const k = key(n);
        if (seen.has(k) || blockedSet.has(k)) continue;
        seen.add(k);
        cameFrom.set(k, { from: current, dir: n.from });
        queue.push({ x: n.x, y: n.y });
      }
    }
    return null;
  }

  function floodFillSize(start, blocked) {
    const key = (p) => p.x + "," + p.y;
    const blockedSet = new Set(blocked.map(key));
    const seen = new Set([key(start)]);
    const stack = [start];
    let count = 0;
    while (stack.length) {
      const cur = stack.pop();
      count++;
      for (const n of neighborsOf(cur)) {
        const k = key(n);
        if (seen.has(k) || blockedSet.has(k)) continue;
        seen.add(k);
        stack.push({ x: n.x, y: n.y });
      }
    }
    return count;
  }

  function chooseAutopilotDir() {
    const head = snake[0];
    const bodyWithoutTail = snake.slice(0, -1); // tail cell will vacate this tick
    const path = bfsPath(head, food, bodyWithoutTail);
    if (path && path.length) {
      const candidate = path[0];
      if (!opposite(candidate, dir)) return candidate;
    }
    // No safe path to food: pick the legal move that maximizes reachable
    // open space, to survive as long as possible.
    let best = null;
    let bestScore = -1;
    for (const d of [DIRS.UP, DIRS.DOWN, DIRS.LEFT, DIRS.RIGHT]) {
      if (opposite(d, dir)) continue;
      const next = { x: head.x + d.x, y: head.y + d.y };
      if (!inBounds(next)) continue;
      if (willHitSelf(next, bodyWithoutTail)) continue;
      const space = floodFillSize(next, snake);
      if (space > bestScore) {
        bestScore = space;
        best = d;
      }
    }
    return best || dir;
  }

  function step() {
    if (!running || paused) return;

    if (autopilot) {
      nextDir = chooseAutopilotDir();
    }
    dir = nextDir;

    const head = snake[0];
    const newHead = { x: head.x + dir.x, y: head.y + dir.y };

    if (!inBounds(newHead) || willHitSelf(newHead, snake.slice(0, -1))) {
      gameOver();
      return;
    }

    snake.unshift(newHead);

    if (cellsEqual(newHead, food)) {
      score += 10;
      if (score > best) {
        best = score;
        saveBest(best);
      }
      if (score % (SPEEDUP_EVERY * 10) === 0 && tickMs > MIN_TICK_MS) {
        tickMs = Math.max(MIN_TICK_MS, tickMs - SPEEDUP_STEP_MS);
        level++;
        restartTimer();
      }
      food = randCell(snake);
    } else {
      snake.pop();
    }

    updateHud();
    draw();
  }

  function gameOver() {
    running = false;
    overlayTitle.textContent = "Game Over";
    overlaySub.textContent = "Score " + score + " · Press Space to restart";
    overlay.classList.add("show");
    clearInterval(timer);
    draw();
  }

  function restartTimer() {
    clearInterval(timer);
    timer = setInterval(step, tickMs);
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL_PX, 0);
      ctx.lineTo(i * CELL_PX, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL_PX);
      ctx.lineTo(canvas.width, i * CELL_PX);
      ctx.stroke();
    }

    ctx.fillStyle = "#f87171";
    roundRect(food.x * CELL_PX + 2, food.y * CELL_PX + 2, CELL_PX - 4, CELL_PX - 4, 5);
    ctx.fill();

    snake.forEach((seg, i) => {
      ctx.fillStyle = i === 0 ? "#4ade80" : "#22c55e";
      roundRect(seg.x * CELL_PX + 1, seg.y * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2, 4);
      ctx.fill();
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function setDirection(d) {
    if (!running) return;
    if (opposite(d, dir)) return;
    nextDir = d;
  }

  function togglePause() {
    if (!running) {
      best = Math.max(best, loadBest());
      reset();
      restartTimer();
      return;
    }
    paused = !paused;
    if (paused) {
      overlayTitle.textContent = "Paused";
      overlaySub.textContent = "Press Space to resume";
      overlay.classList.add("show");
    } else {
      overlay.classList.remove("show");
    }
  }

  window.addEventListener("keydown", (e) => {
    switch (e.code) {
      case "ArrowUp":
      case "KeyW":
        setDirection(DIRS.UP);
        e.preventDefault();
        break;
      case "ArrowDown":
      case "KeyS":
        setDirection(DIRS.DOWN);
        e.preventDefault();
        break;
      case "ArrowLeft":
      case "KeyA":
        setDirection(DIRS.LEFT);
        e.preventDefault();
        break;
      case "ArrowRight":
      case "KeyD":
        setDirection(DIRS.RIGHT);
        e.preventDefault();
        break;
      case "Space":
        togglePause();
        e.preventDefault();
        break;
      case "KeyP":
        autopilot = !autopilot;
        e.preventDefault();
        break;
    }
  });

  // Public hook for automated demo/testing (e.g. Playwright driving a
  // recorded playthrough) without needing to fake DOM key events.
  window.SnakeGame = {
    setAutopilot(on) {
      autopilot = !!on;
    },
    restart() {
      reset();
      restartTimer();
    },
    getState() {
      return { snake, food, score, best, running, paused, level };
    },
  };

  best = loadBest();
  autopilot = false;
  reset();
  restartTimer();
  draw();
})();
