# Aviceena

Aviceena is a local wellbeing companion with Ollama-powered conversation, a reading journal, and device ingestion. It starts with an empty journal.

## Web edition

The GitHub Pages edition runs the journal, CSV import, compatible Bluetooth heart-rate connection, and export in your browser. Run locally to enable Ollama conversation.

## Run locally

Requires Node.js 20+ and Ollama for chat. From this folder, run `npm start` and visit http://127.0.0.1:4173. Keep the server running while using the app. For chat, start Ollama, install a local model with `ollama pull qwen2.5:3b`, and open Settings to select it. The journal works independently of Ollama. Launch a fresh Node server to pick up server-side changes.

## Readings and devices

- Use **My readings** to add a timestamped reading in the displayed unit. The journal shows first-to-latest changes, history, and a text summary export.
- Use **Devices** to pair a compatible Bluetooth Low Energy monitor exposing the standard Heart Rate Service. Use a supported browser on localhost, such as Chrome or Edge. The app records at most one heart-rate measurement every 15 seconds while the page is open. Pairing does not support arbitrary wearables or vendor accounts.
- For file imports, use the exact header `timestamp,metric,value`, ISO 8601 timestamps with a timezone, and these keys and units: `heart` (bpm), `glucose` (mg/dL), `temperature` (°C), `sleep` (hours), and `oxygen` (%). Spreadsheet exports with other layouts need conversion first.

## Privacy and boundaries

Conversation stays in the current tab. Readings and check-ins are held in the tab by default; journal storage is opt-in. Downloaded summaries stay where you save them. The app serves on loopback, sends chat requests to Ollama on loopback, and filters out models tagged as remote or cloud. Use a trusted local Ollama installation and local models. Select the readings checkbox to include descriptive summaries of up to 300 recent readings with that message. Past model replies can retain information you previously shared. Start a new conversation to drop that context.

Aviceena provides general wellbeing support and descriptive trends. Model output is unvalidated and can be wrong. The phrase-based emergency prompt runs independently of Ollama and has limited coverage. Aviceena does not provide medical diagnosis, contact emergency services, or monitor in the background.

Run `npm test` for data handling, Bluetooth decoding, and emergency rule tests.

## Sleep and recovery

Log sleep with the date you want it counted on, usually the morning you woke up. Save one optional energy check-in per day. The weekly review uses the newest sleep entry per local calendar day and computes an average after at least three logged days. Comparison with the preceding seven days requires three logged days in both windows. Expand an observation's evidence to see the entries used, then select a date to see its sleep and check-in timeline.

In Settings, you can opt into browser storage, export the journal as JSON, or delete it. Browser storage is per origin and browser profile. The GitHub Pages journal and localhost journal are separate. In the local app, **Discuss this review locally** attaches dated sleep and energy data to your next message; check-in notes are excluded. The server recomputes the review for Ollama. Model explanations can still make mistakes, so verify them against the evidence in the review.

## Cloudflare hosted beta

The hosted build locks AI chat behind a shared invite. Chat text and expressly attached sleep reviews go to Cloudflare Workers AI. The journal stays in the browser. The beta is for fictional data. To deploy from the repository root:

1. Authenticate with Cloudflare using `npx wrangler@4.165.0 login`.
2. Run `node build-cloudflare.mjs` and `npx wrangler@4.165.0 deploy`.
3. Generate a random 64-character lowercase hex invite and set it with `npx wrangler@4.165.0 secret put AVICEENA_INVITE`. Share it privately with testers. Replacing the secret revokes the previous invite.

The site continues to serve the journal when an invite is missing, invalid, or hosted inference is unavailable. The free Workers AI allowance and per-location chat rate limiting constrain usage. Keep the Cloudflare account on its free plan if testing with no paid inference budget.
