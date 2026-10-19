# Song Trivia
## Import playlists from Spotify

To enable Spotify imports, create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), add this redirect URI to the app settings, and add the credentials to the server environment:

- Local development redirect URI: `http://127.0.0.1:5173/api/spotify/callback`
- `SPOTIFY_CLIENT_ID=your_client_id`
- `SPOTIFY_CLIENT_SECRET=your_client_secret`
- Optional for deployment: `SPOTIFY_REDIRECT_URI=https://your-domain.example/api/spotify/callback`

Keep the client secret on the server and out of browser code. Set these variables in the terminal before starting the app, or add them to your hosting provider's server environment (Vite's `.env` values are not loaded by the Node server):

PowerShell:

    $env:SPOTIFY_CLIENT_ID="your_client_id"
    $env:SPOTIFY_CLIENT_SECRET="your_client_secret"
    $env:SPOTIFY_REDIRECT_URI="http://127.0.0.1:5173/api/spotify/callback"
    npm run dev

Open the local app at `http://127.0.0.1:5173` when using Spotify. Spotify no longer accepts `localhost` as an OAuth redirect URI, and the app and callback need to use the same host so the login session cookie is shared.

In the lobby's **Choose Quiz → Configure** page, connect Spotify, paste a playlist link, and choose **Import playlist**. The app reads playlist metadata through Spotify after you authorize it, then searches Deezer for matching tracks with playable previews. Tracks without a Deezer preview are skipped; at least four matched tracks are needed to start a round. Spotify currently limits playlist item access to playlists the connected account owns or can edit.

### Import steps

1. Create a Spotify developer app and register the callback URL above.
2. Set the two Spotify credentials in the server environment (and the public callback URL when deployed).
3. Restart the app, connect Spotify in the quiz setup, and paste the playlist URL.
4. Import it; matched Deezer previews are added to the selected playlist list.

## World Guess setup

World Guess is a private multiplayer geography game in this app. Add a Google Maps Embed API key to a local .env file before starting Vite:

    VITE_GOOGLE_MAPS_EMBED_KEY=your_restricted_maps_embed_key

Enable Maps Embed API in Google Cloud. Restrict the key to Maps Embed API and to the website referrers you use. The key is sent to browsers to display Street View, so never use an unrestricted key. Do not commit .env.

The guess map uses Leaflet with OpenStreetMap tiles and displays its required attribution.

เกมทายเพลงแบบเรียลไทม์ เล่นกับเพื่อนด้วยรหัสห้อง 4 ตัว Host เลือกเพลย์ลิสต์สาธารณะจาก Deezer แล้วทุกคนฟังคลิปพรีวิวและตอบให้เร็วที่สุด

## เริ่มเล่นในเครื่อง

ต้องใช้ Node.js 18 ขึ้นไป

```bash
npm install
npm run dev
```

เปิดเว็บที่ Vite แสดงใน terminal ผู้เล่นเข้าห้องด้วยรหัสหรือเปิดลิงก์ที่ host แชร์ให้ ไม่ต้องใช้บัญชีหรือ API key เพลง

## Deploy

แอปนี้ใช้ Express และ Socket.IO สำหรับห้องเกม จึงต้อง deploy เป็น Node web service ที่รองรับ WebSocket เช่น Render โดยตั้งค่า:

- Build command: `npm install && npm run build`
- Start command: `npm start`
- ใช้ Node.js 18 หรือใหม่กว่า

Host ค้นหา playlist จาก Deezer public API ผ่าน server proxy แล้วเล่นตัวอย่างเสียง 30 วินาทีจากเครื่อง host ผู้เล่นคนอื่นฟังเสียงจากลำโพง/การแชร์เสียงของ host

## ข้อจำกัด

- Deezer ส่งคลิปตัวอย่างให้เฉพาะเพลงที่มี preview เท่านั้น เกมต้องมีเพลงตัวอย่างอย่างน้อย 4 เพลง
- ห้องเก็บในหน่วยความจำของ server instance เดียว เหมาะกับเกมกลุ่มเพื่อนและ deploy แบบ instance เดียว
- เสียงเล่นบนเครื่อง host; ให้เพื่อนฟังผ่านลำโพงหรือแชร์เสียงจากแอปประชุม
