# AI Body OS — Handoff Package voor ChatGPT

Dit document bevat (1) een kant-en-klare prompt om te plakken in ChatGPT,
en (2) de volledige technische blueprint als achtergrond. Upload de zip
van de codebase erbij.

---

## DEEL 1 — PROMPT (plak dit in ChatGPT)

```
Je neemt een bestaand project over: AI Body OS, een fysiek-gesimuleerd
3D lichaam (browser, React Three Fiber + Rapier physics) aangestuurd
door een Claude-brain (FastAPI backend). De zip die ik upload is de
volledige, geteste codebase.

WERKREGELS — dit zijn harde eisen, geen suggesties:

1. GEEN mock data, geen placeholders, geen "fake werkend" — als iets
   niet getest is, zeg dat expliciet. Als je twijfelt of iets niet
   klopt, stop en vraag het, ook midden in een sessie.
2. Claim nooit dat iets werkt zonder het echt te hebben getest.
   - Backend: run het echt (`python -m uvicorn main:app`), test
     endpoints met curl/websocket-client, lees de output.
   - Frontend: minimaal `tsc -b` en `vite build` moeten slagen.
     Physics-gedrag (staat het lichaam, werkt de touch-sensor) kun
     je headless verifiëren met Node + @dimforge/rapier3d-compat
     zonder browser — zie verify_*.mjs in de repo als voorbeeld van
     hoe dat hier al gedaan is (en welke twee echte bugs dat opleverde).
3. Voor elke wijziging: als je een aanname doet over hoe een library
   werkt (bijv. een API-methode), verifieer dat tegen de daadwerkelijke
   type-definities in node_modules voordat je het gebruikt. Twee keer
   eerder in dit project ging dat mis (Rapier joint API, Rapier
   ActiveCollisionTypes) en leverde het stille bugs op die pas
   zichtbaar werden toen de gebruiker een screenshot deelde.
4. Wees eerlijk over scope-grenzen. Zeg wat je NIET hebt gebouwd,
   niet alleen wat je wel hebt gebouwd.

JOUW EERSTE TAAK:
Bevestig dat je de zip hebt uitgepakt, lees README.md (bevat het
volledige architecture decision log), en geef een statusoverzicht:
wat werkt bewezen, wat is aangenomen maar ongetest, wat ontbreekt.
Doe dit VOORDAT je nieuwe features bouwt.

DAARNA, in prioriteitsvolgorde (zie Deel 2 hieronder voor detail):
1. GitHub-koppeling oplossen (write-access issue, zie sectie "Open
   issue: GitHub write access")
2. Visueel: vervang de primitive box/capsule/sphere meshes door een
   echt gerigd GLTF-humanoid/robot-model (aparte visual-laag boven
   de bestaande kinematic joint-state — zie Humanoid.tsx voor de
   joint-state API die je moet aansturen)
3. Functioneel: actieve balance-/locomotion-controller (lopen,
   herstellen van een duw) — bewust NIET gebouwd in de huidige versie,
   zie architecture decision log voor waarom
```

---

## DEEL 2 — TECHNISCHE BLUEPRINT

### Oorspronkelijke spec (input van de opdrachtgever)

**AI Body OS als 3D-simulator, geen "virtual neuron lichaam" vanaf nul:**

1. **Digital Body** — 3D lichaam: hoofd, armen, benen, torso; virtuele
   joints, spieren, balans, camera's, oren, touch sensors
2. **Sensor Layer** — Vision (virtuele camera), Audio, Smell
   (gesimuleerde VOC-data), Touch (pressure/temperature/collision),
   Position (joint angles, velocity, balance)
3. **Brain Layer** — LLM voor redeneren, RL voor beweging, memory
   database, planner, action engine
4. **Command Center** — live 3D view, sensor panels, memory stream,
   current goal, emotional/state model, logs, control buttons,
   training dashboard

Stack-beslissing destijds: niet starten met Isaac Sim (vereist
Editor GUI, niet scriptbaar door een AI-coding-agent zonder browser).
Gekozen: React Three Fiber (browser, volledig code-based) + FastAPI
brain-backend + Claude API.

### Architectuurbeslissingen — met bewijs, niet aannames

**1. Dynamische ragdoll-physics → verworpen, met bewijs**
Eerste implementatie: Rapier rigid bodies + revolute joints, motor-
aangedreven. Getest headless (Node + rapier3d-compat, geen browser
nodig — WASM draait overal): het lichaam viel om, ook bij motor-
stiffness 2000 (33x hoger dan normaal). Piekte tot 215° tilt. Dit
bewijst dat het geen tuning-probleem is maar een ontbrekend wereld-
frame feedback-mechanisme (motors houden alleen lokale hoek vast,
niet globale oriëntatie — geen corrigerend koppel op basis van
"torso kantelt X graden").

**2. Kinematische stance-controller → huidige implementatie**
Torso + ledematen zijn `kinematicPosition` rigid bodies: geen
zwaartekracht, pose wordt elke frame berekend uit brain-controlled
state (`Humanoid.tsx`, `useImperativeHandle`-pattern). Zelfde techniek
als Unity/Unreal/Isaac Sim character controllers. Staat gegarandeerd
overeind — kan niet vallen, struikelen, of geduwd worden (bewust
uitgesteld, niet vergeten).

**3. Rapier-gotcha: kinematic-vs-fixed collision events**
`ActiveCollisionTypes.DEFAULT` sluit non-dynamic-vs-non-dynamic paren
uit. Kinematische touch-sensor leek dood (`joints: n/a`,
`touch: none` in Command Center), bleek een missende
`.setActiveCollisionTypes(ActiveCollisionTypes.ALL)` op elke collider.
Gevonden en bevestigd met `verify_kinematic_collision.mjs` (faalde
vóór de fix, slaagde erna).

**4. Rule engine joint-namen mismatch**
`rule_engine.py` stuurde ooit naar `joint="hip"` en `joint="torso"` —
bestonden niet in de rig (echte namen: `hip_l`, `hip_r`, etc.). Rule
engine "werkte" (gaf decisions terug) maar deed feitelijk niets —
silent no-op. Gefixt door namen te matchen op de echte rig.

### Wat bewezen werkt (niet aangenomen)

- Backend importeert, start, `/health` antwoordt (curl getest, live)
- WebSocket `/ws/brain` → rule engine → memory write → memory-API
  readback: volledige loop end-to-end getest met een echte
  websocket-client, real response, real persisted data
- Frontend: `tsc -b` en `vite build` slagen zonder fouten
- Kinematic collision events: headless bewezen (zie hierboven)
- Joint-angle readout: exact (source of truth is nu de brain-state
  zelf, niet afgeleid uit ruizige quaternion-wiskunde)

### Wat NIET bewezen is (geen browser/GPU beschikbaar geweest bij mij)

- Live browser-run met een echte Anthropic-key tegen 60fps physics —
  de gebruiker deed dit zelf en dat leverde 2 van de 3 bovenstaande
  bugs op (screenshot met `tilt: 186°`, `joints: n/a`)
- Docker Compose — nooit gedraaid

### Wat expliciet nog niet gebouwd is

- **Actieve balance/locomotion-controller** (lopen, herstellen van
  een duw). Dit is een apart, serieus controlesysteem-vraagstuk
  (vergelijkbaar met wat Boston Dynamics oplost voor Atlas) — geen
  quick fix, vereist een PD-feedback-loop op wereld-oriëntatie plus
  voet/grondcontact-geometrie.
- **Realistisch visueel model.** Huidige meshes zijn primitives
  (box/capsule/sphere) — functioneel voor de physics/sensor-laag,
  niet het beoogde eindresultaat. Afgesproken vervolgstap: een echt
  gerigd GLTF humanoid/robot-model als aparte visuele laag boven de
  bestaande kinematic joint-state (dus: skinning/animatie-laag volgt
  dezelfde `getJointStates()`/`setJointTargetDeg()`-API die er al is
  in `Humanoid.tsx`, niet een losstaand systeem).
- Lokale open-source LLM fallback (Phase 2 van het brain-router-plan
  in `brain/router.py` — becommentarieerd, niet gebouwd)
- Auth op de API/WebSocket
- Postgres-migratie (nu SQLite, `DATABASE_URL` swap is voorbereid)

### Open issue: GitHub write access

GitHub-koppeling (custom connector, Pro-plan) geeft alleen lees-
toegang, geen schrijf-toegang naar repositories — bevestigd na
meerdere pogingen (create_repository, push_files, create_or_update_file
gaven allemaal 403 "Resource not accessible by integration", ook na
reconnects en permissie-checks). Vermoedelijke oorzaak: custom
connectors op het Pro-plan hebben een read-only scope-limiet op
GitHub Apps. Repo bestaat: `https://github.com/Skidaw99/AI-Body-OS`
(leeg, alleen een initiële README). Als jouw connector wel write-
access heeft: pushen naar `main` — geen nieuwe branch nodig, de repo
is leeg genoeg om direct te overschrijven.

### Tech-stack ken-issues (voorkom herhaling)

- **Python: gebruik 3.11 of 3.12, niet 3.14.** Te nieuw (medio 2026),
  `pydantic-core` heeft nog geen prebuilt wheel, dwingt een Rust-
  compile af die faalt (PyO3 ondersteunt max Python 3.13). Los op met
  `py -3.11 -m venv venv`.
- **npm, niet pnpm.** Geen pnpm-workspace, alles getest met npm.
- **Draai `python -m uvicorn`, niet los `uvicorn`** — voorkomt dat je
  per ongeluk een andere Python-interpreter aanroept dan je venv.
- `apps/brain-api/requirements.txt` gebruikt `>=` in plaats van `==`
  voor de meeste packages — bewust, zodat pip per Python-versie een
  compatibele wheel kan kiezen in plaats van een gefixeerde versie
  die geen wheel heeft.

### Command Center — Claude-model config

`CLAUDE_MODEL` env var, default `claude-sonnet-5`. Zet in
`.env` naast je eigen `ANTHROPIC_API_KEY` (nooit hardcoden, nooit
committen — staat al in `.gitignore`).
