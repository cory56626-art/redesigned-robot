// Summoner Realms — "Claude's Notes".
// Developer annotations that sit beside the GPT stress-test review: for each
// point the reviewer raised, this explains whether it was a real bug (and how it
// was fixed), a misunderstanding, or expected behaviour — plus how to test it
// correctly. Rendered into the in-game "Claude's Notes" overlay (button on the
// main menu and pause menu) and mirrored in CLAUDE_NOTES.md in the repo root.
//
// Keep this in sync with CLAUDE_NOTES.md when either changes.

export const CLAUDE_NOTES_VERSION = 'Stress-test pass #2 · 2026-07';

export function claudeNotesHTML() {
  return `
  <p class="cn-intro">These are developer notes answering the ChatGPT stress-test review point by point.
  Each item says whether it was a <b>real bug</b> (now fixed), a <b>misunderstanding</b>, or <b>working as intended</b>,
  and how to test it. Version: <code>${CLAUDE_NOTES_VERSION}</code>.</p>

  <h4>① Horizontal movement "didn't work"</h4>
  <ul>
    <li><b class="cn-fix">Real bug — fixed.</b> The player had <i>no auto step-up</i>, so walking into any 1-tile
      terrain bump (extremely common on natural ground) stopped horizontal movement dead while jump still worked.
      Left often looked fine (downhill) while right jammed on a ledge — exactly the "reliable one way" symptom.</li>
    <li>Fix: <code>physics.moveAndCollide</code> now auto-climbs ledges up to <code>stepHeight</code> (18px ≈ 1 tile)
      when grounded, and the player sets that height. Enemies already hopped ledges via their own AI.</li>
    <li><b>Testing note:</b> keyboard drives movement in every mode. Automated tests must give the canvas focus and
      use held keys (<code>keyboard.down('d')</code> … <code>keyboard.up('d')</code>). A/D and ←/→ both work; W/Space/↑ jump.
      In our automated run the player now moves the full ~150px/s in both directions.</li>
  </ul>

  <h4>② Mobile joystick "didn't move the player"</h4>
  <ul>
    <li><b class="cn-fix">Real bug — fixed.</b> The move joystick released itself the instant the knob was dragged past
      its own (small) bounds, because a <code>pointerout</code> handler reset it mid-drag. Pushing the stick to the edge —
      the normal way to move fast — dropped the input.</li>
    <li>Fix: the joystick uses pointer capture and now only releases on <code>pointerup</code>/<code>pointercancel</code>.</li>
    <li><b>Testing note:</b> drive it with <code>pointerdown → pointermove → pointerup</code> (or touch equivalents) on
      <code>#joyMove</code>. Keyboard also still works in mobile mode for hybrid setups.</li>
  </ul>

  <h4>③ "New/loaded world inherited an old boss / player damage"</h4>
  <ul>
    <li><b class="cn-fix">Fixed / mostly already handled.</b> New World and Load both call <code>_resetEntities()</code>,
      which clears bosses, enemies, projectiles, drops, minions and particles before the world starts. If an old boss
      survived, it was via <b>death/respawn</b>, not world creation.</li>
    <li>Now, in single-player, <b>dying despawns the boss</b> (its adds and projectiles too), and respawn clears
      combat state — so you never respawn into a boss that "shouldn't" still exist. See <code>onLocalDeath</code>.</li>
  </ul>

  <h4>④ "Black rendering / canvas corruption after placement" &amp; dark caves</h4>
  <ul>
    <li><b>Not corruption — it was the lighting model, and it was too dark.</b> Underground/enclosed tiles fell to a
      near-black floor (0.05), so caves and shaded tree undersides read as "black areas". Placing a block that roofs
      an area correctly shadows below it, which looked like "corruption" in screenshots.</li>
    <li><b class="cn-fix">Fixed:</b> the ambient light floor is raised to <b>0.14</b> and solid tiles attenuate light
      a little less, so terrain stays dimly <i>readable</i> everywhere. Torches (light 0.95) and your own glow are still
      clearly brighter, so lighting the dark still matters — you just aren't blind without it. The canvas itself is
      redrawn every frame; there is no stale/corrupt buffer.</li>
  </ul>

  <h4>⑤ Block placement gave no confirmation</h4>
  <ul>
    <li><b class="cn-fix">Fixed.</b> The aim tile now shows a <span class="cn-good">green</span> ghost of the block when
      placement is valid and a <span class="cn-bad">red</span> ghost when it isn't. A successful place shows a
      "&lt;block&gt; placed" pop; a blocked place shows the reason ("Too far away", "Needs a solid neighbour",
      "Can't place on a player", "Space is occupied").</li>
    <li><b>Rules:</b> the tile must be empty, within reach (6 tiles), touch a solid tile OR be within 3 tiles of you,
      and solid blocks can't be placed inside a player.</li>
  </ul>

  <h4>⑥ Resource gathering feedback "weak"</h4>
  <ul>
    <li><b>Working as intended (and already present).</b> Mining/chopping shows a floating "+N &lt;item&gt;" at the tile
      and the hotbar/inventory count updates immediately. Chopping a tree fells the whole trunk+canopy and pops
      "+N Wood". If a pickup didn't register, movement/targeting was the blocker (see ①) — not the pickup itself.</li>
    <li><b>Tip:</b> right-click (PC) auto-picks the correct tool for the target tile; the wrong tool still works at 25% speed.</li>
  </ul>

  <h4>⑦ Command identifiers (<code>/spawn slime</code>, <code>/give plantfiber</code>)</h4>
  <ul>
    <li><code>/spawn slime</code>: <b>already works.</b> There is no creature literally named "slime" — the slime-like foe
      is the <b>Slugling</b>. <code>slime</code>, <code>slimes</code> and <code>slug</code> are aliased to it.</li>
    <li><code>/give plantfiber</code>: <b class="cn-fix">Fixed.</b> The item id is <code>fiber</code> and its display name is
      "Plant Fiber". The resolver is now space/punctuation-insensitive, so <code>plantfiber</code>, <code>plant fiber</code>,
      <code>fiber</code> and <code>craftingbench</code> all resolve. Autocomplete (Tab) lists exact ids.</li>
    <li>Capacity message: <code>/give</code> reports "(N didn't fit)" when a stack overflows. Stacks are 99 for most
      materials (30 potions, 200 ammo). That message is the actual remaining capacity feedback.</li>
  </ul>

  <h4>⑧ <code>/killall</code> didn't clear the boss + no reset commands</h4>
  <ul>
    <li><b>By design, now clarified + expanded.</b> <code>/killall</code> only defeats regular enemies (so you can clear
      adds without ending a boss fight). It now says so when a boss is present.</li>
    <li><b class="cn-fix">New commands:</b> <code>/clearboss</code> (remove boss + adds + boss shots),
      <code>/resetcombat</code> (clear projectiles/particles/combat state), and <code>/resetworldstate</code>
      (clear all bosses + enemies + projectiles, keep terrain).</li>
  </ul>

  <h4>⑨ "Vulnerable / boss kept hitting me during debug &amp; menu transitions"</h4>
  <ul>
    <li><b class="cn-fix">Fixed for single-player.</b> Opening the Demo Commands console or the inventory now <b>freezes the
      world simulation</b> — enemies and bosses stop while you're in those panels. (A networked/shared world can't be
      frozen unilaterally, so it keeps running there.)</li>
    <li>Escape order is deliberate: it closes the console → How-to → confirm → inventory → other dialogs → then pauses.
      So Escape with the inventory open <i>closes the inventory</i>; it does not also pause. Pressing E toggles the bag.</li>
  </ul>

  <h4>⑩ Boss HP "looked full after several hits" / phases</h4>
  <ul>
    <li><b>Mostly perception — improved.</b> Bosses have large HP (600 / 1100 / 1800) and brief invulnerability windows on
      each phase change (and while burrowing), so early chip damage moves the bar slowly. Damage <i>was</i> applying
      (floating numbers confirm hits).</li>
    <li><b class="cn-fix">Added:</b> the boss bar now shows an exact <b>"HP / max (percent)"</b> readout so reduction is
      unmistakable. Phases still announce with a toast and a flash.</li>
  </ul>

  <h4>Other review notes</h4>
  <ul>
    <li><b>Menu title clipped:</b> <span class="cn-fix">fixed</span> — the title is size-capped and wraps cleanly to
      "Summoner"/"Realms" on very narrow screens instead of overflowing.</li>
    <li><b>Floating spawn:</b> <span class="cn-fix">fixed</span> — the player now spawns resting on the surface instead of
      a few tiles above it.</li>
    <li><b>Hotbar numbers "duplicated/out of order":</b> not a bug. Each slot shows its <i>select key</i> (1–9, then 0)
      in the corner and the <i>stack count</i> separately. Those are two different numbers, not duplicates.</li>
    <li><b>"Playwright button clicks didn't activate the button":</b> a test-harness/focus/timing issue, not a game bug.
      The buttons are standard <code>&lt;button onclick&gt;</code>. For automation, prefer the <code>window.__game</code> hook
      (e.g. <code>__game.startNewWorld(name, seed)</code>) or click by visible coordinates after the overlay is settled.</li>
  </ul>

  <h4>How to test quickly (for GPT)</h4>
  <ul>
    <li><code>window.__game</code> is the live game. Handy: <code>__game.startNewWorld('Name','seed')</code>,
      <code>__game.teleportBiome('underground')</code>, <code>__game.localPlayer</code>, <code>__game.bosses</code>.</li>
    <li>Useful commands: <code>/giveall</code>, <code>/give &lt;item&gt; &lt;n&gt;</code>, <code>/spawn &lt;enemy&gt; &lt;n&gt;</code>,
      <code>/spawnboss &lt;boss&gt;</code>, <code>/clearboss</code>, <code>/resetworldstate</code>, <code>/godmode</code>,
      <code>/fly</code>, <code>/time night</code>, <code>/debugcaves</code>, <code>/debugcollision</code>.</li>
    <li>Enemies: slugling, husk, bonepicker, crawler, boar, blightshade (aliases: slime→slugling, zombie→husk,
      skeleton→bonepicker, spider→crawler, pig→boar). Bosses: grovekeeper, gravemaw, blightSovereign.</li>
  </ul>`;
}
