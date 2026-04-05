# Eye + Voice Moodboard

Moodboard of 8 artwork boxes. **Eye tracking** (WebGazer.js) drives a fluid **heat map** and which box is “focused”. When you **speak** (e.g. “expand” or “tell me more”), **2 seconds after you stop** the app calls **Claude** to generate context and **expands** that box.

## Run

1. `npm install`
2. `npm run dev`
3. Open the URL (e.g. http://localhost:5173).
4. Click **Enable eye tracking** and allow **webcam** when prompted.
5. **Calibrate**: 9 dots — look at each, then click (gaze-only; cursor hidden after). **Escape** shows cursor again. Click **Start voice**, look at a box, then say e.g. “expand” or “tell me more about this”.

## API key

The dev server proxies `/api/claude` to Anthropic using `ANTHROPIC_API_KEY` from `.env`. Copy `.env.example` to `.env` and set your key if you’re not using the existing `.env`.

## Stack

- **WebGazer.js** (CDN) for gaze; **fluid heat map** via canvas (decay + grid).
- **Web Speech API** for voice; 2s delay after speech end.
- **Claude API** (via Vite proxy) for generated artwork context.
