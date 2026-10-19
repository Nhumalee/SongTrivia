# SongTrivia

เว็บเกมเล่นกับเพื่อนแบบเรียลไทม์ สร้างห้องแล้วแชร์รหัสหรือลิงก์เชิญให้เพื่อนเข้าร่วมได้ ปัจจุบันมีเกมให้เลือก 2 แบบ:

- **Song Trivia** — ฟังเพลงตัวอย่างจากเพลย์ลิสต์ แล้วแข่งกันทายชื่อเพลงและศิลปิน
- **World Guess** — ดู Street View ปักหมุดตำแหน่งบนแผนที่ แล้วสะสมคะแนนจากความแม่นยำ

## สิ่งที่ต้องมี

- Node.js 18 ขึ้นไป และ npm
- Spotify Developer App เฉพาะกรณีต้องการนำเข้าเพลย์ลิสต์ Spotify
- Google Maps JavaScript API key เฉพาะกรณีต้องการเล่น World Guess

## เริ่มเล่นในเครื่อง

```bash
npm install
npm run dev
```

เปิด URL ที่ Vite แสดงใน terminal (ปกติคือ `http://localhost:5173`) จากนั้นสร้างห้องหรือเข้าห้องด้วยรหัส ห้องหนึ่งรองรับผู้เล่นได้สูงสุด 12 คน เจ้าของห้องเลือกเกมและตั้งค่าก่อนเริ่มเล่น

สำหรับ Spotify ให้เปิดเว็บด้วย `http://127.0.0.1:5173` ตามขั้นตอนด้านล่าง เพื่อให้ URL ตรงกับ OAuth redirect URI

## นำเข้าเพลย์ลิสต์ Spotify

ปุ่ม Spotify ในหน้าตั้งค่าเกมจะเปิดหน้าต่างเชื่อมบัญชีและเพิ่มเพลย์ลิสต์ การเชื่อมต่อจำเป็นต้องใช้ **Client ID และ Client Secret ของแอป Spotify Developer** ซึ่งตั้งไว้ฝั่งเซิร์ฟเวอร์ ไม่ใช่แค่กดเชื่อมบัญชีอย่างเดียว

1. สร้างแอปที่ [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. ใน Redirect URIs ของแอป เพิ่ม `http://127.0.0.1:5173/api/spotify/callback` แล้วบันทึก
3. ตั้งค่าตัวแปรต่อไปนี้ใน PowerShell ก่อนเริ่มแอป:

   ```powershell
   $env:SPOTIFY_CLIENT_ID="ใส่-client-id"
   $env:SPOTIFY_CLIENT_SECRET="ใส่-client-secret"
   $env:SPOTIFY_REDIRECT_URI="http://127.0.0.1:5173/api/spotify/callback"
   npm run dev
   ```

4. เปิด `http://127.0.0.1:5173` เชื่อมบัญชี Spotify แล้ววางลิงก์เพลย์ลิสต์

อย่าเปิดเว็บผ่าน `localhost` ในขั้นตอนนี้ เพราะ Spotify ต้องการให้ host ของเว็บตรงกับ redirect URI ที่ตั้งไว้ และอย่าใส่ Client Secret ในโค้ดหน้าเว็บหรือ commit ลง Git

หลังนำเข้า แอปจะใช้ข้อมูลเพลย์ลิสต์จาก Spotify เพื่อค้นหาเพลงที่มี preview บน Deezer เพลงที่ไม่มี preview จะไม่ถูกนำมาเล่น และต้องมีเพลงที่จับคู่ได้อย่างน้อย 4 เพลง เพลย์ลิสต์ต้องเป็นรายการที่บัญชีที่เชื่อมต่อมีสิทธิ์ดู

## ตั้งค่า World Guess

เกมนี้ใช้ Google Maps JavaScript API แสดง Street View และใช้ Google Maps JavaScript API สำหรับแผนที่ปักหมุด สร้างไฟล์ `.env` ที่ root ของโปรเจกต์ แล้วใส่:

```dotenv
VITE_GOOGLE_MAPS_MAP_KEY=your_google_maps_javascript_api_key
```

เปิดใช้ **Maps JavaScript API** และ Dynamic Street View ใน Google Cloud Console จากนั้นจำกัด API key ด้วย HTTP referrer ของเว็บไซต์และอนุญาตเฉพาะ Maps JavaScript API กับ Geocoding API (ใช้เมื่อค้นหาพื้นที่) แล้วเริ่ม Vite ใหม่ เกมมีชุดสถานที่ World Mix, Famous Places และ Thailand; เจ้าของห้องเลือกจำนวนรอบได้ 3, 5, 10 หรือ 15 ตำแหน่ง ผู้เล่นมีเวลาต่อรอบตามค่าที่ตั้งในห้อง และได้สูงสุด 5,000 คะแนนต่อจุด

## เพิ่มเกมใหม่

เกมแต่ละเกมแยกเป็นโฟลเดอร์ย่อยใน `src/games/` และลงทะเบียนเกมใน `src/games/registry.js` โครงสร้างปัจจุบัน:

```text
src/games/
├── registry.js
├── song-trivia/
└── geo-guessr/
```

เพิ่มโฟลเดอร์ของเกมใหม่พร้อมหน้าตั้งค่าและหน้าการเล่น แล้วลงทะเบียนเกมใน registry เพื่อให้ปรากฏใน lobby

## คำสั่งที่ใช้บ่อย

| คำสั่ง | รายละเอียด |
| --- | --- |
| `npm run dev` | เริ่มเซิร์ฟเวอร์เกมและเว็บสำหรับพัฒนา |
| `npm run build` | สร้างไฟล์เว็บสำหรับนำไป deploy |
| `npm start` | เริ่ม Express และ Socket.IO สำหรับใช้งานจริง |
| `npm test` | รันการตรวจสอบฝั่งเซิร์ฟเวอร์ |

## Deploy

แอปต้องรันเป็น Node.js web service ที่รองรับ WebSocket/Socket.IO ไม่ใช่โฮสต์ไฟล์ static อย่างเดียว ใช้คำสั่ง:

- Build: `npm install && npm run build`
- Start: `npm start`

กำหนด `PORT` ตามที่แพลตฟอร์ม deploy จัดให้ หากเปิดใช้ Spotify ให้ตั้ง `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` และ `SPOTIFY_REDIRECT_URI` ใน environment ของเซิร์ฟเวอร์ ตัวอย่าง redirect URI สำหรับโดเมนจริงคือ `https://your-domain.example/api/spotify/callback` และต้องเพิ่ม URL เดียวกันใน Spotify Developer Dashboard ด้วย

กำหนด `VITE_GOOGLE_MAPS_MAP_KEY` ก่อน build หากต้องการเปิดใช้ World Guess เพราะค่านี้จะถูกรวมอยู่ในไฟล์เว็บที่ส่งให้เบราว์เซอร์ จึงต้องจำกัด key ด้วย HTTP referrer และ API restrictions ดูขั้นตอนสำหรับ Render ใน [RENDER_SECURITY.md](./RENDER_SECURITY.md)

## หมายเหตุ

- ห้องและสถานะเกมเก็บในหน่วยความจำของเซิร์ฟเวอร์ instance เดียว เมื่อรีสตาร์ตเซิร์ฟเวอร์ ห้องที่กำลังเล่นจะหายไป
- เสียง preview ของ Song Trivia เล่นแยกบนอุปกรณ์ของผู้เล่นแต่ละคน ปรับหรือปิดเสียงได้จากตัวควบคุมเสียงในหน้าเกม
- Avatar ที่อัปโหลดและข้อมูลผู้เล่นบางส่วนเก็บไว้ในเบราว์เซอร์และส่งให้สมาชิกในห้อง
- อย่า commit ไฟล์ `.env` หรือ credentials ส่วนตัว ไฟล์ `.env` ถูกละเว้นโดย Git อยู่แล้ว
