# Render deployment security

Before deploying the web service:

1. Set `NODE_ENV=production` and `APP_ORIGINS` to the exact public origins that should be allowed to connect. For example: `https://your-service.onrender.com,https://play.example.com`. Do not include paths or a trailing slash. Include every custom domain used by the app.
2. Set `VITE_GOOGLE_MAPS_MAP_KEY` in Render's **Build** environment, then trigger a new deploy so Vite can include it in the browser bundle. This key is public. In Google Cloud, allow the exact website referrer (for example `https://your-service.onrender.com/*` and `https://play.example.com/*`) under Website restrictions. Enable Maps JavaScript API and Dynamic Street View, and allow those APIs under API restrictions. Also allow Geocoding API if area search is enabled. Check that billing is active and set billing alerts and quotas.
3. Keep `SPOTIFY_CLIENT_SECRET` and other server credentials as Render environment variables without a `VITE_` prefix. Set `SPOTIFY_REDIRECT_URI` to the exact HTTPS callback URL registered with Spotify.
4. Start with one service instance. Room state, Spotify tokens, and usage counters are currently in process memory; restarts clear them, and multiple instances will not share them. Use shared storage before scaling horizontally.

Room codes are six characters and rejoin tokens are generated with cryptographic randomness. The server also restricts browser origins, limits per-connection event volume, and caps active rooms. These controls reduce abuse but are not a substitute for edge rate limiting if the app becomes public.

Geo Guess needs to deliver the Street View target position to each player's browser so Google Maps can render it. A player with browser developer tools can inspect that position, so this client-rendered game cannot guarantee cheat-proof answer secrecy.
