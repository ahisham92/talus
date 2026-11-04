# Talus: slope stability

Talus checks cut slopes (with or without benches and berms), embankments, revetments and any drawn section: paste the ground, each layer's top line and the water line as x, y points. Pick the kind of slope and change a number: the answer, the 3D view and the cross-section update while you type, on a desktop or a phone. It finds the critical slip surface for every load case (long term, short term, rapid drawdown and earthquake), shows how the slope would fail, and finds the steepest slope that still meets every target.

It runs inside the Project_Management site at `/talus`. Pull the site and it is there.

## What it calculates

| | |
|---|---|
| **Methods** | Morgenstern-Price (half-sine), Spencer, Bishop simplified, Janbu simplified and corrected, and Ordinary, all solved on the same surface. They come from one General Limit Equilibrium formulation (Fredlund & Krahn 1977), solved exactly slice by slice. |
| **Search** | Thousands of circles are tried over a grid of entry, exit and radius. The best are refined with a simplex search and the critical one is solved by every method. Non-circular surfaces can be optimised as an option. |
| **Loads** | Self-weight above and below the water table. Piezometric line or rᵤ, with ponded water as a surface pressure. Strip surcharge and line loads. Tension crack with or without water. Soil nails and anchors. Pseudo-static earthquake. |
| **Earthquake** | EN 1998-5: kh = 0.5·ag·S·ST and kv = ±0.5·kh, with both signs checked. Yield acceleration ky. Newmark displacement by Jibson (2007). |
| **Design basis** | Global factors of safety (USACE EM 1110-2-1902: 1.5 / 1.3 / 1.2 / 1.1), or Eurocode 7 DA1-C2 (M2 factors γc' = γφ' = 1.25, γcu = 1.4, variable loads × 1.3, target 1.0). |
| **Revetments** | Rock armour by Hudson and by Van der Meer (1988), or by Van Gent et al. (2003) in shallow water, whichever governs. EN 13383 gradings and underlayer. Toe by Van der Meer (1998). Run-up and overtopping by EurOtop (2018). Accropode™ and Accropode™ II units with CLI's design KD and the 4:3 to 3:2 slope range. The armour, underlayer and core are part of the global stability model. |

All calculations run in the browser (`talus_app/static/engine`, plain ES modules, with no build step). The same files are tested in Node. The Flask server only serves the page and keeps each person's projects, with version history.

## Verification

The **Verification** tab runs these checks in the browser. CI runs the same checks on every push.

| Check | Reference | Talus |
|---|---|---|
| Planar wedge (Culmann), static, seismic, surcharge + anchor | Closed form | exact (to 1e-9) |
| Undrained circle, F = su·L·R / (W·d) | Closed form | within 1e-4, all methods |
| Submerged slope ≡ buoyant weight | Archimedes | exact by force equilibrium; rigorous methods within 0.2% |
| Dry sand, F → tan φ / tan β | Infinite slope | within 3% (from above) |
| ACADS 1(a), Giam & Donald (1989) | Referee 1.00; GeoStudio M-P 0.991 | M-P 0.984, Spencer 0.984, Bishop 0.985 |
| Hudson rock mass | Hand calculation | exact |
| Van der Meer (1988) | Formula | exact |
| Accropode Ns | CLI design value 2.7 | 2.71 |
| Toe rock, Van der Meer (1998) | Formula | exact |
| Newmark, Jibson (2007) | Formula | exact |

## Run it alone

```bash
pip install -r requirements.txt
TALUS_DEV_ACCOUNT=me python -m talus_app      # http://127.0.0.1:5057
```

## Tests

```bash
pip install -r requirements-dev.txt
python -m pytest -q          # the server, plus the engine tests through Node
node --test tests/engine.test.mjs   # the engine alone
```

## How it fits into Project_Management

Project_Management keeps a copy of `talus_app/` and mounts it at `/talus` with `app/talus_door.py`, the same way as SiteTwin. The site handles sign-in and access (the `talus` program in Setup) and passes the account to Talus in the request (`talus.site`). Projects live in the site's data folder under `talus/`.

To update the site, copy `talus_app/` across and commit it there.

Accropode is a trademark of Concrete Layer Innovations (CLI). Talus gives design-stage sizes only. Units must be designed and placed to CLI's guidance.
