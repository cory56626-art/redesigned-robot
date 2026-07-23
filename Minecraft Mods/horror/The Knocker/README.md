# The Knocker 🚪

A psychological-horror stalker add-on for **Minecraft: Bedrock Edition**.

> A tall, robed figure with a pale, gaunt face. It appears at the edge of your
> vision and is gone the instant you look. It grows bolder through the night.
> Eventually it walks up to your door and **knocks**… and then it either leaves,
> or it doesn't.

It does **not** talk. It does not chat. It watches, it knocks, it burns, it
crawls, and it hunts — and everything it does is reactive and staged so the
dread builds.

---

## ✨ Features

| Feature | What happens |
|---|---|
| **Stalking** | Spawns at the edge of sight and follows you. |
| **"Disappears when you look"** | While calm/curious, if you put it in your crosshair (with line of sight) it vanishes in a puff and repositions out of view. |
| **Anger stages** | `CALM → CURIOUS → HOSTILE → ENRAGED`. Anger climbs at night, near you, while it's watched, and especially when you hit it. Each stage makes it faster and bolder. |
| **The Knock (60 / 40)** | At higher anger it walks to your nearest door and knocks three times. **60 %** it leaves. **40 %** it breaks the door, steps inside, stalks to within **5 blocks**, *stares*, then lets out a **very loud scream** and chases you. |
| **House arson** | When it's near you and you're **not** looking at it, it sets nearby flammable blocks (planks, logs, wool, leaves…) on fire. |
| **Crawling** | Drops to a low crawl to creep toward you / fit under gaps. |
| **Real block breaking** | Breaks blocks like a player **with a genuine per-block break timer (its "cooldown")**. It wields an **iron axe** for wood/doors and switches to an **iron pickaxe** for stone — so if you barricade the door with stone, it mines through. |
| **Original scream** | The scream (and every other sound) is **synthesised from scratch** — a brand-new, unique sound, not taken from any existing clip. |
| **Loot** | If you somehow kill it (120 HP), it drops its iron axe & pickaxe. |

It is fire-immune (it won't die in the fires it sets), ignores fall/drown damage,
and is persistent. **No experimental toggles are required.**

---

## 📥 Installation

1. Download **`TheKnocker.mcaddon`** (in this folder / attached in chat).
2. Open it — Minecraft imports the Behavior Pack **and** Resource Pack automatically.
3. Create/edit a world:
   - **Behavior Packs →** activate *The Knocker » Behavior*.
   - **Resource Packs →** activate *The Knocker » Resources* (usually auto-added).
   - Turn **On** the world option **“Additional Modding Capabilities / Use of GameTest/Scripting”** if your version shows it. (No "Beta APIs" toggle needed.)
4. Enter the world. You'll see a one-time chat line:
   `The Knocker is loaded. Type /scriptevent knocker:help for tests.`

> It also appears on its own at night. To play it purely on your terms, run
> `/scriptevent knocker:autospawn off` and summon it with the commands below.

You can also get the spawn egg from the Creative inventory, or run
`/summon knocker:knocker`.

---

## 🧪 Test commands (`/scriptevent`)

Run these from chat. They operate on the knocker nearest to you (spawning one if
needed). Full list any time with **`/scriptevent knocker:help`**.

| Command | Effect |
|---|---|
| `/scriptevent knocker:demo` | **Guided ~45 s showcase of every feature.** Stand still and watch. |
| `/scriptevent knocker:spawn [dist]` | Spawn one, stalking, ~`dist` blocks away (default 12). |
| `/scriptevent knocker:despawn` | Remove all knockers. |
| `/scriptevent knocker:status` | Print anger / stage / mode / distance of each knocker. |
| `/scriptevent knocker:stage <0-3 \| calm \| curious \| hostile \| enraged>` | Force the anger stage. |
| `/scriptevent knocker:anger <0-100 \| +n \| -n>` | Set / nudge anger directly. |
| `/scriptevent knocker:knock` | Walk to your nearest **door** and do the 60/40 knock sequence. *(place a door first)* |
| `/scriptevent knocker:peek` | Appear **5 blocks** in front of you, stare, then scream + chase. |
| `/scriptevent knocker:scream` | Scream at you right now. |
| `/scriptevent knocker:chase` *(or `rage`)* | Go **enraged** and hunt you. |
| `/scriptevent knocker:crawl on` / `crawl off` | Toggle crawling. |
| `/scriptevent knocker:burn` | Set nearby flammable blocks alight. |
| `/scriptevent knocker:break` | Break the block **you're looking at** — watch it pick axe vs. pickaxe by material and respect the break timer. |
| `/scriptevent knocker:vanish` | Make it disappear and reposition out of sight. |
| `/scriptevent knocker:come` | Teleport the nearest knocker next to you. |
| `/scriptevent knocker:stalk` | Reset it to passive stalking (then try looking at it). |
| `/scriptevent knocker:ambient` · `whisper` · `heartbeat` | Play a sound to you. |
| `/scriptevent knocker:autospawn <on\|off>` | Toggle the nightly auto-spawn (default **on**). |
| `/scriptevent knocker:night` | Set time to night (handy for testing its boldness). |

**Quick start:** place a wooden door, stand behind it, then run
`/scriptevent knocker:night` and `/scriptevent knocker:knock`.

---

## 🧠 How it works (for tinkerers)

```
Knocker_BP/                         Knocker_RP/
├── manifest.json                   ├── manifest.json
├── entities/knocker.json           ├── entity/knocker.entity.json
│   • anger-stage component groups  ├── models/entity/knocker.geo.json   (robed humanoid)
│   • crawl / pose groups + events  ├── textures/entity/knocker.png      (black robe, pale face)
├── scripts/main.js   ← the brain   ├── animations/…                     (idle/walk/crawl/scream/knock)
├── loot_tables/…     (axe + pick)  ├── animation_controllers/…          (selects pose by mark_variant)
└── texts/                          ├── render_controllers/…
                                    ├── sounds/sound_definitions.json
                                    └── sounds/custom/*.ogg               (all original)
```

* **`scripts/main.js`** is the entire AI: line-of-sight checks, the vanish logic,
  the anger model, the knock sequence, arson, tool-based breaking, crawling and
  all `/scriptevent` commands.
* Visual state (crawl / scream / knock pose) is encoded in `minecraft:mark_variant`
  and switched through entity **events** the script triggers; the client
  **animation controller** reads `query.mark_variant` to pick the animation. This
  is why **no experimental toggles** are needed.
* Held-item visuals (axe/pickaxe) depend on your Bedrock version's rendering of
  custom-mob equipment; the **break behaviour and tool selection always work**
  regardless.

### Sounds are original
Everything in `sounds/custom/` is generated by `src/generate_sounds.py` — the
scream is a from-scratch **source-filter vocal model** (a jittering glottal
source, vocal-tract formants, distortion, and the voice "breaking" into a
shriek). Re-generate or tweak any sound with:

```bash
pip install numpy soundfile pillow
python3 "src/generate_sounds.py"     # rebuilds the .ogg sounds
python3 "src/generate_textures.py"   # rebuilds the skin + pack icons
```

---

## ⚙️ Compatibility

* Built for **Minecraft Bedrock 1.21+** using the **stable** `@minecraft/server`
  scripting API (`1.14.0`).
* If your game ever reports that the script module version is unavailable, open
  `Knocker_BP/manifest.json` and change the `@minecraft/server` `version`
  to match your install (e.g. `1.13.0`, `1.15.0`, `1.16.0`), then re-import.

## License
MIT. The sounds and textures are original to this project and free to use.

*Sleep well. And don't answer the door.*
