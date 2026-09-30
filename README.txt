OurMoments Birthday Surprise

This is a Vite-powered static web app. The birthday wizard is built with
vanilla JavaScript and GSAP; it does not require WordPress or Elementor at
runtime.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To create a production build:

```bash
npm run build
npm run preview
```

The app keeps its extracted resources organized in:
- `source/styles/` - page styles
- `source/scripts/` - GSAP, birthday app, and supporting runtime scripts
- `assets/favicon.png` - local browser favicon
- `assets/vendor/` - local images, music, and payment SDK files
- Google Fonts - Bricolage Grotesque, Outfit, and Shantell Sans
- `waste/` - legacy scraped assets and duplicate libraries retained outside the app

Static resources are loaded from the project. Surprise data is saved by the
local Express API in MongoDB. Create a `.env` file with:

```text
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DATABASE=birthday_surprises
PUBLIC_URL=http://localhost:3001
WEBHOOK=https://discord.com/api/webhooks/your-webhook
```

Run both the Vite frontend and API with:

```bash
npm run dev:all
```

## Protected production hosting

For password protection, deploy this as a Node web service (for example, a
Render Web Service) so requests pass through the Express server. Do not deploy
the `dist` folder as a static site on GitHub Pages or use a normal static Vercel
deployment; those do not run this server-side access check.

Use these Render commands:

```text
Build command: npm install && npm run build
Start command: npm start
```

Set `SITE_PASSWORD` in the hosting provider's environment settings to the
chosen site password. Also set the required `MONGODB_URI` and other API
environment variables described above. The server checks the password before
serving pages, scripts, photos, audio, or API routes. The access cookie is
HTTP-only and expires after 12 hours.

The Vite development server (`npm run dev`) is for local development and does
not enforce the production access gate. Test protected access through the
Express server (`npm start`).

Before creating a link, the app requests a one-time 4-digit OTP and sends it
to the configured Discord webhook. The link is created only after that OTP is
entered successfully. The API accepts the wizard payload at `POST /api/create`,
returns a private `/s/:code` link, and serves saved JSON at `GET /api/s/:code`.
Payment gateways are no longer used. The existing WhatsApp share button still
opens WhatsApp's external share URL.
