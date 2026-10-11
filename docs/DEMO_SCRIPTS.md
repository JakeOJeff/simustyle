# Live demos: scripts

This companion to [the main demo walkthrough](DEMO.md) is a script-focused run of show. The first three demonstrations use the editor's built-in script language and do not need an AI provider. See the main walkthrough for the AI scene assistant and AI Parse segment.

## Before the demo

Start SimuStyle and create a new scene. Keep the **Console** and **Inspector** windows visible. In the script editor, paste a complete example, then choose **Apply**. Press **Play** to run game-start and repeating events; press **Stop** before changing the setup.

## 1. Click to animate

Add a box, name it `Spinner` in Inspector, select it, and choose **Script**. Paste:

```text
when clicked
  spin fast
  wait 2 seconds
  stop
  paint yellow
```

Press **Play**, click Spinner in the viewport, and point out the two-second spin. It stops and turns yellow. This is a quick first example of an event, timed actions, animation, and a visual change.

## 2. Collect three coins

Set up a small floor scene:

1. Add a Plane named `Ground`; leave it at the origin and scale it wider if needed.
2. Add a Box named `Player` and place it near the edge of the plane.
3. Add three Spheres and name them `Coin`, `Coin2`, and `Coin3`. Spread them across the plane.
4. Turn on **Physics** for Player. Turn on **Collision** for Ground and each coin, and make sure scene collisions are enabled.
5. Select Player, open its script editor, and paste:

```text
setting speed = 0.12 from 0 to 0.35

when game starts
  set score to 0
  paint blue

forever
  if key left is pressed
    move left speed
  if key right is pressed
    move right speed
  if key up is pressed
    move forward speed
  if key down is pressed
    move back speed

when space is pressed
  move up 1 over 0.25 seconds
  move down 1 over 0.25 seconds

when I touch a coin
  destroy it
  change score by 1
  say "Coins:" score
  if score is at least 3
    broadcast "win"

when I receive "win"
  paint yellow
  say "All 3 coins collected!"
  bounce
```

For a little motion on each coin, add this short script to each one:

```text
when game starts
  spin slowly
```

Press **Play**, then use the arrow keys to collect the coins. **Space** gives Player a small hop. Console prints the score after each pickup; collecting all three changes Player to yellow and makes it bounce. Adjust `speed` from Player's Script settings in Inspector to show the live parameter control.

## 3. Patrol with a repeating routine

Add a second box named `Patrol`, place it where there is room, and attach:

```text
when game starts
  forever
    move right 3 over 1.5 seconds
    wait 1.5 seconds
    move left 3 over 1.5 seconds
    wait 1.5 seconds
```

Press **Play** to see it glide back and forth. While presenting, point out how indentation groups the routine under `forever`, and that each move is a relative distance with a duration.

## Presenter run of show

| Time | Action | Point to make |
| --- | --- | --- |
| 0:00 | Click Spinner | Events can react to an object click. |
| 0:30 | Show the script editor and Inspector setting | Scripts are readable sentences; settings become controls. |
| 1:00 | Start the coin scene and collect one | Key input, collision events, a variable, and Console output work together. |
| 2:00 | Collect the remaining coins | Conditions and broadcast messages trigger a win response. |
| 2:45 | Show Patrol | Indented routines, waits, and timed movement make repeatable behavior. |
| 3:15 | Stop and reset the scene | Stop returns the scene to its pre-Play state. |

## If something does not respond

- Check that the script has no inline errors and that you chose **Apply**.
- Start with **Play** before clicking an object or pressing movement keys.
- If coins do not trigger touch events, confirm scene collisions are on, Player has **Physics** enabled, and Ground and each coin have **Collision** enabled.
- Press **Stop** to reset the Play simulation before trying the sequence again.
