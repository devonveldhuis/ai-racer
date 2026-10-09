# AI API

How a program (a scripted bot, a model, a remote service) drives the car. Everything here is
plain JSON. Sources: `src/control/types.ts` (Observation), `src/control/ControllerHost.ts`
(timing), `src/control/RemoteController.ts` (protocol), `src/control/DiscreteActionAdapter.ts`
(named choices), `src/control/DecisionLog.ts` (log), `tools/mock-ai-server.ts` (mock server).

## Observation

A driver sees one `Observation` per decision. It is plain JSON: no `undefined`, no non-finite
numbers. Distances are rounded to 0.01 m, angles to 0.1 degree, speed to 0.01 m/s, everything
else to 0.001.

```jsonc
{
  "t": 12.35,
  "car": {
    "accelerator": 0.75, // last applied input, 0..1
    "steering": -0.25, // last applied input, -1..1
    "speed": 14.21, // m/s, forward (negative = rolling backwards)
    "surface": "road", // "road" | "kerb" | "grass" | "sand" | "wall" | "void"
    "headingError": 0.12, // radians, in (-PI, PI]
    "lateralOffset": -0.3, // -1 = left road edge ... +1 = right road edge
  },
  "rays": [
    {
      "angleDeg": -45,
      "samples": [
        { "distance": 5, "class": "straight" },
        { "distance": 10, "class": "grass" },
        // ... one entry per sample distance
      ],
      "obstacleDistance": null, // metres to the first wall/obstacle on the ray, or null
      "obstacleClass": null, // "wall" | "obstacle" | null (null exactly when the distance is)
    },
    // ... 9 rays by default
  ],
  "progress": { "checkpoint": 1, "totalCheckpoints": 4, "lap": 1, "totalLaps": 1 },
}
```

Conventions:

- **`t`** is the race time in simulation seconds since GO. It is 0 until GO, frozen while
  paused, and **excludes reset penalties** (the HUD's displayed time includes them). It is not
  wall-clock time.
- **Left and right.** Steering is negative to the left and positive to the right. Ray angles
  are relative to the car's heading, negative = left. `headingError` is positive when the car
  points to the **right** of the road direction (so steer left, negative, to correct it).
  `lateralOffset` is positive when the car is right of the centreline.
  Both are `0` when unavailable (e.g. before the race has a progress estimate).
- **`rays`** are ordered left to right. The default cone is 90 degrees wide with 9 rays
  (-45, -33.75, ..., +45); `?fov=` and `?rays=` change it.
- **`samples`** classify the ground at fixed distances along each ray, given in increasing
  order (default 5, 10, 20, 35 m). The ray may leave the road, so a far sample can be `grass`.
- **Sensor classes:** `straight`, `left_curve`, `right_curve`, `start_finish` are road.
  Curves are relative to the racing direction, not to the car's heading: a `left_curve` tile
  turns left in the direction of travel. `kerb`, `grass`, `sand` are off the road centre
  (different grip and drag), `wall` / `obstacle` come from the obstacle cast, and `void`
  means there is no ground there (a fall).
- **Obstacles.** `obstacleDistance` is from a horizontal ray cast of up to 40 m. The game has
  no walls or obstacles yet, so it is always `null` today.
- **`progress.checkpoint`** is the 0-based index of the next checkpoint to cross; the last one is
  the finish line.

## Actions

### Continuous

```json
{ "accelerator": 0.8, "steering": -0.2 }
```

`accelerator` is 0..1: 0 is full brake, 0.5 (`car.neutral`) coasts, 1 is full throttle.
`steering` is -1 (full left) to +1 (full right). Values outside the range are clamped; a
non-finite or missing field keeps the previous value. There is no reverse.

### Discrete (named choices)

```json
{ "steering_choice": "slight_left", "throttle_choice": "full" }
```

| steering_choice | value | throttle_choice | accelerator   |
| --------------- | ----- | --------------- | ------------- |
| `hard_left`     | -1    | `brake`         | 0             |
| `left`          | -0.6  | `coast`         | 0.5 (neutral) |
| `slight_left`   | -0.25 | `half`          | 0.75          |
| `straight`      | 0     | `full`          | 1             |
| `slight_right`  | 0.25  |                 |               |
| `right`         | 0.6   |                 |               |
| `hard_right`    | 1     |                 |               |

`DiscreteActionAdapter` maps both ways: `toInput({ steering_choice, throttle_choice })` throws
on an unknown choice, and `fromInput(input)` returns the nearest buckets (a tie goes to
`straight` / `coast`). The buckets are configurable in its constructor.

## Timing modes

The `ControllerHost` asks the controller for a decision every `1 / decisionHz` seconds of
**simulation** time (10 Hz for the bot and remote controllers, 60 Hz for the keyboard); the
first is at t = 0. At most one decision is in flight. The car keeps the last input until a new
one arrives.

- **`?mode=realtime`** (default): the simulation keeps running while the controller thinks.
  Due decisions that arrive while one is still pending are skipped (counted in `skipped`), and
  the decision that comes back describes a car that has moved on. Latency is part of the
  challenge. Use it to measure how a driver copes with delay.
- **`?mode=lockstep`**: the simulation pauses until the pending decision arrives. Every
  decision is seen on the observation it was made for, whatever the latency. Use it to evaluate
  slow or remote models fairly, and for training data.

Example (seed 3, mock server with 300 ms latency): lockstep finishes the lap in the normal
time (the game just takes longer in wall-clock time), while realtime drives mostly off the road.

## Remote protocol

`?controller=remote&url=http://localhost:8787` (optionally `&timeoutMs=2000`). The URL must be
http or https; otherwise the game warns and falls back to the keyboard.

Request, once per decision:

```
POST <url>
Content-Type: application/json

{ "observation": { ...the Observation above... } }
```

Response, `200` with one of:

```json
{ "accelerator": 0.8, "steering": -0.2 }
```

```json
{ "steering_choice": "slight_left", "throttle_choice": "full" }
```

Anything else is an error: a timeout (default 2000 ms, then the request is aborted), a network
failure, a non-2xx status, a body that is not JSON, numbers that are not finite, or an unknown
choice. On an error the host **keeps the last input** and counts it (`errors` in the debug
panel and the host stats); the bridge logs one console warning per kind of error, not one per
decision. The next decision tries again. The browser enforces CORS, so a server on another
origin must answer the `OPTIONS` preflight (allow `POST` and the `Content-Type` header).

## Mock AI server

```
npm run mock-ai -- [--port 8787] [--latency <ms>] [--choices]
```

A small Node HTTP server (run with Node 22's built-in TypeScript type stripping, no extra
dependencies; it is not part of the browser bundle). It decides with the same
`rayFollowerDecide` as `?controller=bot`, statelessly (no steering smoothing across requests).
`--latency` delays every answer, `--choices` answers with named choices. A body that is not
`{ "observation": <valid Observation> }` gets a `400`. It listens on localhost only (127.0.0.1
and ::1) and allows CORS from `http://localhost:*` and `http://127.0.0.1:*`.

```
npm run dev                      # http://localhost:5173
npm run mock-ai -- --latency 300
# http://localhost:5173/?controller=remote&url=http://localhost:8787&mode=lockstep
```

## Decision log

Non-keyboard controllers record every decision in a ring buffer (default 20 000 entries, the
oldest dropped first; `decisionLogCapacity` in the config). On the finish screen the
**Download decision log (JSONL)** button (or the `L` key at any time) saves
`decisions-<seed>-<controller>.jsonl`. It is only offered when the log is not empty.

One JSON object per line, oldest first:

```json
{"t":12.4,"observation":{...},"action":{"accelerator":1,"steering":-0.25},"latencyMs":3.2}
```

- `t`: `observation.t`.
- `observation`: exactly what the controller was given (it passes `isObservation`).
- `action`: the input the host applied after validation and clamping. For a failed decision it
  is the held previous input and the entry has an `error` string (the failure message).
- `latencyMs`: wall-clock milliseconds from `decide()` to its result.

A synchronous result is logged in the step it was decided; an asynchronous one when it is
applied. Skipped decisions are not logged. Training code can pair `observation` with
`DiscreteActionAdapter.fromInput(action)` to get choice labels.
