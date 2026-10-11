# Demo script

A short walkthrough for presenting the project. Each part shows one feature: the AI scene agent, the plain-English script language, and AI Parse.

> The scripts in sections 2 and 3 were checked with the project's parser and checker. The AI prompts (sections 1 and 4) have not been run against a live model, so do a dry run before presenting.

## Setup

1. Set `AI_API_KEY` (and optionally `AI_MODEL`) as described in the [README](../README.md).
2. Start the app and open an empty scene.

## 1. AI builds a scene

Paste this into the **AI** tab:

```text
Build a small mini-golf hole I can play.

- A green fairway, 12 m long and 3 m wide, with low wooden walls on both sides so the ball can't roll off.
- A white golf ball at the start that falls and rolls with physics. Let me push it with the space bar and steer it with the arrow keys. Add a "power" setting I can tweak in the Inspector.
- A windmill obstacle halfway down: a stone tower with four red blades on a hub that spin slowly forever.
- A dark hole at the far end with a flag pole and a yellow flag that sways gently. When the ball touches the hole, broadcast "scored", flash the flag, and say "Hole in one!".
- A red kill brick strip across the fairway before the windmill. Touching it sends the ball back to the start.
- A warm sun light and a soft fill light so it looks nice.
```

Follow-ups that show it editing an existing scene:

```text
Make the windmill blades spin faster every time I score, and paint the ball yellow after 3 scores.
```

```text
Add a second ball called "Rival" that floats above the hole and pulses.
```

**Talking points:** one prompt produces grouped multi-part objects, materials, lights, physics bodies, and scripts. Press **Play** and drive the ball. Change **power** in the Inspector while playing.

## 2. Plain-English scripts

In a fresh scene, add a box named `Player`, a ball named `Coin`, and a plane named `Ground`. Give `Player` a dynamic RigidBody so `push` works.

Script on **Player**:

```text
-- Arrow keys move, space hops, collect the coin
setting speed = 1 from 0.5 to 3
when game starts
  set score to 0
  paint me #4da3ff
when right is pressed
  move right speed over 0.2 seconds
when left is pressed
  move left speed over 0.2 seconds
when up is pressed
  move forward speed over 0.2 seconds
when down is pressed
  move back speed over 0.2 seconds
when space is pressed
  push me up 5
when I touch Coin
  increase score by 1
  say "Score:" score
  move Coin to (random -4 to 4) 0.5 (random -4 to 4)
  if score is at least 5
    broadcast "win"
when I receive "win"
  paint me yellow
  spin me fast
  say "You win!"
```

Script on **Coin**:

```text
when game starts
  spin slowly
  float gently
```

**Talking points:**

- Events, key input, variables, conditions, random values, and messages between scripts, all written as sentences.
- `setting speed` appears as a slider in the Inspector.
- Hover `Coin` or `me` in the editor to see which object it refers to.
- Messages from `say` appear in the Console.

## 3. AI Parse fixes broken scripts

Replace the **Player** script with this broken version and press **✦ Parse**:

```text
when game begin
  colour me crimson
  wiat 2 secs
when spce is presed
  make me jump up kinda high
when i bump into the coin
  the coin should go somewhere random
  give me a point
```

What happens:

1. **Local fixes, no AI call:** `begin` → `starts`, `wiat` → `wait`, `secs` → `seconds`, `spce` → `space`, `presed` → `pressed`.
2. **AI fixes only the lines that are still broken** (2, 5, 6, 7, and 8). It sees the whole script for context, keeps the lines that already work, and maps casual wording to real commands (for example `colour ... crimson` → `paint me red`, `jump up` → `push me up`, `bump into the coin` → `when I touch Coin`).
3. The review dialog shows which stage ran and highlights the changed lines. Choose **Use rewrite** to apply it.

**Talking points:** valid lines are never changed, and the AI does not add actions you did not write. Every fix is checked with the real parser before you see it. Exact AI wording varies from run to run.

Known quirk: the local typo fixer currently turns `bump` into `jump` before the AI sees line 6. The line is still flagged, so the AI rewrites it, but the review may show that intermediate step.

## 4. Command bar (optional)

Type these one at a time in the command bar. The Console names each object that was created or changed:

```text
create a red ball at 0 3 0 called "Bouncy"
paint Bouncy blue
move Bouncy up 2
```
