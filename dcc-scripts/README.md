# Phase-2 render-node scripts (Route A)

**These scripts have never been run.** This project's build/test environment has no SketchUp, no 3ds Max, no Arnold, and no Windows machine — they're written against each DCC's documented scripting API (SketchUp Ruby API, 3ds Max pymxs) but not executed or debugged. Treat them as a strong starting point, not a working deliverable: expect real debugging once they run against actual software. Everything they talk to (the `/api/archviz/render-jobs/*` HTTP contract) **is** tested — see `scripts/archviz/stub-worker.mjs`, which fulfills the exact same contract and is what proves the orchestrator side works.

## What each script does

Both scripts loop: claim a job → download the model (once) → apply a white/grey material override → apply the job's lighting preset → set the camera → render → POST the PNG back → restore original materials.

- `sketchup/analyze_angles.rb` — run inside SketchUp (Ruby Console `load '...'`, or a startup plugin). SketchUp is single-threaded/UI-driven, so it polls via a repeating `UI.start_timer`, not a blocking loop.
- `3dsmax/analyze_angles.py` — run via `3dsmaxbatch analyze_angles.py` (Handbook §12: 3ds Max + Arnold is the first-choice render node — ships sun&sky/GI and batch rendering out of the box). This one polls in a plain blocking loop since `3dsmaxbatch` is a dedicated batch process, not an interactive session.

## Known gaps to expect when you actually run these

- **SketchUp has no direct azimuth/elevation sun API.** `model.shadow_info` drives shadows from a `Time` + geographic location, not a `sunAzimuth`/`sunElevation` pair. The script flags this with a `TODO` rather than faking a conversion. Interior ambient+GI has no native SketchUp equivalent at all — per the Handbook itself, the SketchUp channel needs a V-Ray/Enscape plugin for that, or you use it exterior-only and route interior jobs to the 3ds Max node.
- **3ds Max's `Physical_Sun_Sky`/`Skylight` class availability depends on the active renderer and Max version.** The script checks `getattr(rt, 'Physical_Sun_Sky', None)` and logs a warning rather than crashing if it's missing — you'll need to confirm the exact class names against your install (this is exactly the kind of thing I can't verify without the software).
- **Camera FOV**: `fovMm` in a job payload is a focal-length-style value (24/28/35/50, assuming a 36mm sensor), converted to a vertical FOV angle via `2·atan(18/fovMm)`. Sanity-check this conversion against your renderer's actual FOV convention.
- **Coordinate system**: camera sampling produces Y-up positions; the 3ds Max script swaps Y/Z on the way in since Max is Z-up by convention. Double-check this against how your specific scenes are set up (some studios author Z-up already, some don't).
- **Reload-per-job**: both scripts reopen the scene file only when the job's `modelId` doesn't match what's currently loaded — fine for one node handling one model's whole run, but if a node round-robins between multiple different models' jobs you'll want to rethink this (dedicate one node process per open model instead).

## Deploying

1. Set `ARCHVIZ_WORKER_TOKEN` as an environment variable **on the Next.js server** (`src/server/archviz/db.ts` auto-generates and persists one if you don't — check the server's startup log the first time `getArchvizDb()` runs, or query `SELECT value FROM meta WHERE key='worker_token'` in `data/archviz.db` directly). Set the **same** value as `ARCHVIZ_WORKER_TOKEN` in the environment that launches SketchUp / `3dsmaxbatch`.
2. Set `ARCHVIZ_ORCHESTRATOR_URL` to wherever the Next.js app is actually reachable from the render node (not `localhost` unless the render node *is* the app server).
3. SketchUp: load the script (Ruby Console, or wire it into a startup plugin so it runs whenever SketchUp launches on that node). 3ds Max: `3dsmaxbatch -sceneFile <a-scene-with-your-license-loaded>.max dcc-scripts/3dsmax/analyze_angles.py`, kept running as a long-lived process (a Windows service / scheduled task that restarts it on exit is recommended for production).
4. Confirm the node only claims jobs for its own DCC — jobs are already tagged `dcc: 'sketchup' | '3dsmax'` at creation time (matching the uploaded file's extension), and `GET /render-jobs/next?dcc=...` only returns matching jobs, so a SketchUp node and a 3ds Max node can run side by side against the same orchestrator without stepping on each other.

## Local dry-run without real DCC software

You can exercise the exact same worker contract today with:

```bash
ARCHVIZ_WORKER_TOKEN=<token from data/archviz.db meta table> node scripts/archviz/stub-worker.mjs
```

This won't tell you whether the Ruby/Python scripts themselves work, but it proves the orchestrator, job queue, Stage-1 scoring, and Stage-2 evaluation all function correctly end-to-end — so once the DCC scripts are debugged against real software, swapping them in is the only remaining unknown.
