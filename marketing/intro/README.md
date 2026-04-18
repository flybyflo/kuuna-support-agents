# Remotion Intro (Hackathon Demo)

Pfad: `marketing/intro/`

Dieses Mini-Projekt enthält ein fertiges Intro-Video als Remotion-Composition (`IntroCouncil`) mit Easter Eggs für die Judges (ohne Namensnennung).

## Enthalten

- **90s Intro** bei 30 FPS in 1920x1080 (mit Live-Demo in voller Länge @ 4.5x playback)
- 12 Szenen:
  1. Cold open (Judge Council)
  2. Flask + Ring + Stern Easter Egg
  3. Terminal-Orakel (`pi` Prompt)
  4. **Sentry als erstes Feature**
  5. Backlog.md Easter Egg (Chaos → shipbare Tasks)
  6. Problem: unstrukturierte Client-Daten in WhatsApp Gruppen
  7. **Live Demo (45s)**: voller Dashboard-Screencast in Browser-Chrome, 4.5x Playback, rotierende Untertitel
  8. **WhatsApp Proof (5s)**: Split-View zweier Chat-Screenshots (Ping + Auto-Onboarding + Tool-Use)
  9. Lösung: Client + Gruppe + Template im Dashboard anlegen
  10. Gruppe erhält Agent mit vorgefertigten Tools + Trigger-Regeln
  11. Ingest → Transcribe → RAG, Knowledge Base wächst
  12. Outro mit allen 4 Easter Eggs + Produkt-Claim

## Setup

```bash
cd marketing/intro
npm install
```

## Studio starten

```bash
npm run dev
```

## Rendern

```bash
npm run render
# Output: marketing/intro/out/intro-council.mp4
```

## Texte anpassen

- Composition Default Props: `src/Root.tsx`
- Inhalt und Timings: `src/IntroVideo.tsx`

### Bilder einbauen / austauschen

- Statische Assets (Video + Screenshots) liegen in `marketing/intro/public/` und werden via `staticFile('...')` geladen:
  - `kuuna-demo.mp4` (Dashboard-Screencast, transcoded aus dem MOV in `images/`)
  - `whatsapp-worked.png`, `whatsapp-tools-works.png` (Split-View in Proof-Szene)
- Story-Bilder sind direkt aus `marketing/intro/images/` importiert:
  - `pi-terminal.png`
  - `pi-terminal-own-extension.png`
  - `pi-terminal-own-extension-context red.png`
- Verwendung in den Szenen: `src/IntroVideo.tsx`

### Demo-Video austauschen

```bash
ffmpeg -y -i "images/<neues-screencast>.mov" \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -movflags +faststart -an \
  public/kuuna-demo.mp4
```

Remotion kopiert `public/` automatisch ins Bundle. Aspect-Ratio des Video-Stage (`aspectRatio` in `SceneLiveDemo`) ggf. an das neue Format anpassen.

### Judge-Easter-Eggs anpassen

- Inhalte und Text pro Szene: `src/IntroVideo.tsx`
- Reihenfolge / Dauer pro Szene: am Ende von `src/IntroVideo.tsx` in den `const ... = X * fps` Blöcken
