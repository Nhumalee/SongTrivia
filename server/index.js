import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { randomBytes } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

// Deezer's public API does not send CORS headers; proxy only its public catalog endpoints.
app.get("/api/deezer/*", async (req, res) => {
  try {
    const resource = req.params[0];
    if (!/^(search\/(playlist|track)|playlist\/\d+)$/.test(resource)) return res.status(400).json({ error: "Unsupported Deezer resource" });
    const upstream = await fetch(`https://api.deezer.com/${resource}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
    const data = await upstream.json();
    if (!upstream.ok || data.error) return res.status(upstream.status || 502).json({ error: data.error?.message || "Deezer request failed" });
    res.json(data);
  } catch { res.status(502).json({ error: "Deezer API is unavailable" }); }
});

const spotifySessions = new Map();
const spotifyStates = new Map();
const spotifyRedirectUri = (req) => process.env.SPOTIFY_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/spotify/callback`;
const spotifySessionId = (req, res) => {
  const cookie = (req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("songtrivia_spotify="));
  let id = cookie?.slice("songtrivia_spotify=".length);
  if (!id || !/^[a-f0-9]{64}$/.test(id)) {
    id = randomBytes(32).toString("hex");
    res.cookie("songtrivia_spotify", id, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 30 * 24 * 60 * 60 * 1000, path: "/" });
  }
  return id;
};
const spotifyConfigured = () => !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
async function spotifyAccessToken(session) {
  if (session.accessToken && session.expiresAt > Date.now() + 30_000) return session.accessToken;
  if (!session.refreshToken) throw new Error("Spotify session expired. Connect Spotify again.");
  const auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken }) });
  const data = await response.json();
  if (!response.ok) throw new Error("Spotify session expired. Connect Spotify again.");
  session.accessToken = data.access_token;
  session.expiresAt = Date.now() + data.expires_in * 1000;
  if (data.refresh_token) session.refreshToken = data.refresh_token;
  return session.accessToken;
}
app.get("/api/spotify/status", (req, res) => {
  const id = spotifySessionId(req, res);
  res.json({ configured: spotifyConfigured(), connected: !!spotifySessions.get(id)?.refreshToken });
});
app.get("/api/spotify/login", (req, res) => {
  if (!spotifyConfigured()) return res.status(503).send("Spotify import is not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to the server environment.");
  const id = spotifySessionId(req, res);
  const state = randomBytes(24).toString("hex");
  spotifyStates.set(state, { id, expiresAt: Date.now() + 10 * 60 * 1000 });
  const params = new URLSearchParams({ client_id: process.env.SPOTIFY_CLIENT_ID, response_type: "code", redirect_uri: spotifyRedirectUri(req), scope: "playlist-read-private playlist-read-collaborative", state });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});
app.get("/api/spotify/callback", async (req, res) => {
  const pending = spotifyStates.get(String(req.query.state || ""));
  spotifyStates.delete(String(req.query.state || ""));
  const id = spotifySessionId(req, res);
  if (!pending || pending.id !== id || pending.expiresAt < Date.now() || req.query.error || !req.query.code) return res.status(400).send("Spotify connection failed. Close this tab and try again.");
  try {
    const auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
    const response = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: String(req.query.code), redirect_uri: spotifyRedirectUri(req) }) });
    const data = await response.json();
    if (!response.ok) throw new Error("Spotify token request failed");
    spotifySessions.set(id, { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 });
    const origin = JSON.stringify(new URL(spotifyRedirectUri(req)).origin);
    res.type("html").send(`<p>Spotify connected. You can close this window.</p><script>window.opener?.postMessage({type:"songtrivia-spotify-connected"},${origin});window.close()</script>`);
  } catch { res.status(502).send("Could not complete Spotify connection. Close this tab and try again."); }
});
app.post("/api/spotify/import", express.json({ limit: "2kb" }), async (req, res) => {
  const id = spotifySessionId(req, res);
  const session = spotifySessions.get(id);
  if (!session) return res.status(401).json({ error: "Connect Spotify before importing a playlist." });
  const raw = String(req.body?.url || "").trim();
  const match = raw.match(/(?:open\.spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/|spotify:playlist:)([A-Za-z0-9]{22})/i);
  if (!match) return res.status(400).json({ error: "Paste a valid Spotify playlist link." });
  try {
    const token = await spotifyAccessToken(session);
    const spotifyFetch = async (url) => {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 403 ? "Spotify only allows importing playlists you own or can edit." : response.status === 404 ? "Spotify playlist not found or not accessible." : data.error?.message || "Spotify request failed.");
      return data;
    };
    const playlist = await spotifyFetch(`https://api.spotify.com/v1/playlists/${match[1]}?fields=id,name,images,external_urls,items(total)`);
    const tracks = [];
    for (let offset = 0; offset < Math.min(playlist.items?.total || 0, 100); offset += 50) {
      const page = await spotifyFetch(`https://api.spotify.com/v1/playlists/${match[1]}/items?limit=50&offset=${offset}`);
      for (const entry of page.items || []) {
        const track = entry.item;
        if (!track || track.type !== "track" || !track.name || !track.artists?.length) continue;
        tracks.push({ title: track.name, artist: track.artists.map((artist) => artist.name).join(", "), spotifyUrl: track.external_urls?.spotify || null });
      }
    }
    res.json({ id: match[1], name: playlist.name, cover: playlist.images?.[0]?.url || null, url: playlist.external_urls?.spotify || raw, tracks });
  } catch (error) {
    if (error.message.includes("session expired")) spotifySessions.delete(id);
    res.status(error.message.includes("session expired") ? 401 : 502).json({ error: error.message || "Could not import Spotify playlist." });
  }
});

// ---------- ค่าเริ่มต้นและขีดจำกัด ----------
const DEFAULTS = { rounds: 10, seconds: 30 };
const LIMITS = { rounds: [3, 30], seconds: [8, 60], players: 12, name: 16 };
const AVATARS = new Set(["momo", "kai", "lily", "tae", "jun", "pond"]);
const REVEAL_MS = 5000;
const ROOM_TTL_MS = 1000 * 60 * 60 * 3;
const GEO_PACKS = {
  world: { title: "World Mix", locations: [
  { lat: 35.6895, lng: 139.6917, heading: 150 },
  { lat: 13.7563, lng: 100.5018, heading: 35 },
  { lat: 48.8584, lng: 2.2945, heading: 220 },
  { lat: 40.7128, lng: -74.006, heading: 110 },
  { lat: -33.8688, lng: 151.2093, heading: 20 },
  { lat: 51.5072, lng: -0.1276, heading: 280 },
  { lat: 25.1972, lng: 55.2744, heading: 180 },
  { lat: 37.5665, lng: 126.978, heading: 45 },
  { lat: -23.5505, lng: -46.6333, heading: 315 },
  { lat: 41.9028, lng: 12.4964, heading: 90 },
  { lat: 19.4326, lng: -99.1332, heading: 5 },
  { lat: 59.3293, lng: 18.0686, heading: 200 },
  { lat: 1.3521, lng: 103.8198, heading: 135 },
  { lat: 52.52, lng: 13.405, heading: 240 },
  { lat: -34.6037, lng: -58.3816, heading: 55 },
  { lat: 43.6532, lng: -79.3832, heading: 190 },
  ] },
  famous: { title: "Famous Places", locations: [
    { lat: 48.8584, lng: 2.2945, heading: 220 }, { lat: 40.6892, lng: -74.0445, heading: 45 },
    { lat: 27.1751, lng: 78.0421, heading: 180 }, { lat: 41.8902, lng: 12.4922, heading: 10 },
    { lat: 51.5007, lng: -0.1246, heading: 280 }, { lat: 37.8199, lng: -122.4783, heading: 90 },
    { lat: 25.1972, lng: 55.2744, heading: 180 }, { lat: 36.0544, lng: -112.1401, heading: 60 },
    { lat: 41.9028, lng: 12.4964, heading: 90 }, { lat: 40.4319, lng: 116.5704, heading: 0 },
    { lat: -22.9519, lng: -43.2105, heading: 240 }, { lat: 29.9792, lng: 31.1342, heading: 30 },
    { lat: 48.8606, lng: 2.3376, heading: 140 }, { lat: 40.758, lng: -73.9855, heading: 210 },
    { lat: 37.9715, lng: 23.7257, heading: 180 }, { lat: 20.6843, lng: -88.5678, heading: 0 },
  ] },
  thailand: { title: "Thailand", locations: [
    { lat: 13.7466, lng: 100.5347, heading: 15 }, { lat: 13.7437, lng: 100.4889, heading: 220 },
    { lat: 18.7883, lng: 98.9853, heading: 90 }, { lat: 18.7969, lng: 98.9685, heading: 180 },
    { lat: 7.8804, lng: 98.3923, heading: 270 }, { lat: 7.9519, lng: 98.3381, heading: 45 },
    { lat: 12.9236, lng: 100.8825, heading: 180 }, { lat: 12.9352, lng: 100.8895, heading: 0 },
    { lat: 16.4322, lng: 102.8236, heading: 90 }, { lat: 14.9799, lng: 102.0978, heading: 180 },
    { lat: 17.4138, lng: 102.7872, heading: 270 }, { lat: 9.1401, lng: 99.3331, heading: 20 },
    { lat: 19.9072, lng: 99.8309, heading: 150 }, { lat: 15.2287, lng: 104.8564, heading: 200 },
    { lat: 13.3611, lng: 100.9847, heading: 20 }, { lat: 8.0863, lng: 98.9063, heading: 90 },
  ] },
};
const geoMonthlyUsage = new Map();
function currentGeoUsage() {
  const month = new Date().toISOString().slice(0, 7);
  return { month, loads: geoMonthlyUsage.get(month) || 0, cap: null, provider: "Google Maps Embed" };
}

/** @type {Map<string, any>} */
const rooms = new Map();

const clamp = (n, [lo, hi]) => Math.max(lo, Math.min(hi, Math.round(Number(n) || lo)));
const cleanName = (s) =>
  String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, LIMITS.name);
const cleanAvatar = (value) => {
  if (AVATARS.has(value)) return value;
  if (typeof value === "string" && value.length <= 60_000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
  return "momo";
};

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let t = 0; t < 50; t++) {
    let c = "";
    for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error("no code");
}

function makeToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function leaderboard(room) {
  return [...room.players.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      avatar: cleanAvatar(p.avatar),
      score: p.score,
      connected: p.connected,
      isHost: p.id === room.hostId,
      lastGain: p.lastGain || 0,
      streak: p.streak || 0,
    }))
    .sort((a, b) => b.score - a.score);
}

function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    gameId: room.gameId || "song-trivia",
    settings: room.settings,
    playlistName: room.playlistName || null,
    playlists: room.playlists || [],
    geoRound: room.geoRound || null,
    geoReveal: room.geoReveal || null,
    geoUsage: currentGeoUsage(),
    geoAnswered: room.geoAnswers?.size || 0,
    revealPaused: room.phase === "reveal" && !!room.revealPaused,
    revealRemainingMs: room.phase === "reveal"
      ? Math.max(0, room.revealPaused ? room.revealRemainingMs : (room.revealEndsAt || Date.now()) - Date.now())
      : null,
    hostId: room.hostId,
    players: leaderboard(room),
  };
}

function distanceKm(a, b) {
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function randomLocationsInArea(area, count) {
  const { north, south, east, west } = area.bounds;
  return Array.from({ length: count }, () => ({
    lat: south + Math.random() * (north - south),
    lng: west + Math.random() * (east - west),
    heading: Math.floor(Math.random() * 360),
    label: area.label,
  }));
}

function startGeoRound(room) {
  const location = room.geoLocations[room.geoIndex];
  room.phase = "geo-playing";
  room.geoReveal = null;
  room.geoAnswers = new Map();
  const seconds = room.settings.seconds;
  const serverNow = Date.now();
  const endsAt = serverNow + seconds * 1000;
  room.geoRound = { index: room.geoIndex, total: room.geoLocations.length, lat: location.lat, lng: location.lng, heading: location.heading, seconds, endsAt, serverNow };
  broadcastRoom(room);
  clearTimeout(room.timer);
  room.timer = setTimeout(() => finishGeoRound(room), seconds * 1000 + 100);
}

function finishGeoRound(room) {
  if (room.phase !== "geo-playing") return;
  clearTimeout(room.timer);
  room.phase = "geo-reveal";
  const location = room.geoLocations[room.geoIndex];
  const results = [];
  for (const player of room.players.values()) {
    const guess = room.geoAnswers.get(player.id);
    const distance = guess ? distanceKm(guess, location) : null;
    const points = distance === null ? 0 : Math.round(5000 * Math.exp(-distance / 2000));
    player.score += points;
    player.lastGain = points;
    results.push({ id: player.id, points, distanceKm: distance === null ? null : Math.round(distance), guess: guess || null });
  }
  results.sort((a, b) => b.points - a.points);
  room.geoReveal = { index: room.geoIndex, isLast: room.geoIndex >= room.geoLocations.length - 1, location, results };
  io.to(room.code).emit("geo:reveal");
  broadcastRoom(room);
  room.timer = setTimeout(() => advanceGeoRound(room), 12000);
}

function advanceGeoRound(room) {
  if (room.phase !== "geo-reveal") return;
  clearTimeout(room.timer);
  if (room.geoIndex + 1 >= room.geoLocations.length) {
    room.phase = "finished";
    io.to(room.code).emit("finished", { leaderboard: leaderboard(room) });
    broadcastRoom(room);
  } else {
    room.geoIndex += 1;
    startGeoRound(room);
  }
}

function broadcastRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

function updateLiveScores(room, question) {
  const correctAnswers = [...room.answers.entries()]
    .filter(([, answer]) => answer.choice === question.correctIndex)
    .sort((a, b) => a[1].elapsedMs - b[1].elapsedMs);
  const pointsByPlayer = new Map();
  const rankByPlayer = new Map();
  let rank = 0;
  let previousElapsedMs = null;

  correctAnswers.forEach(([id, answer], index) => {
    if (answer.elapsedMs !== previousElapsedMs) rank = index + 1;
    rankByPlayer.set(id, rank);
    pointsByPlayer.set(id, Math.max(100, 1000 - (rank - 1) * 100));
    previousElapsedMs = answer.elapsedMs;
  });

  for (const player of room.players.values()) {
    const baseScore = room.roundBaseScores?.get(player.id) ?? player.score;
    player.lastGain = pointsByPlayer.get(player.id) || 0;
    player.score = baseScore + player.lastGain;
  }

  return { pointsByPlayer, rankByPlayer };
}

// ---------- รอบเกม ----------
function startQuestion(room) {
  const q = room.questions[room.index];
  room.phase = "question";
  room.answers = new Map();
  room.roundBaseScores = new Map([...room.players.values()].map((player) => [player.id, player.score]));
  room.questionStartedAt = Date.now();
  room.endsAt = room.questionStartedAt + room.settings.seconds * 1000;
  for (const p of room.players.values()) p.lastGain = 0;

  const base = {
    index: room.index,
    total: room.questions.length,
    options: q.options,
    endsAt: room.endsAt,
    serverNow: Date.now(),
    seconds: room.settings.seconds,
  };
  io.to(room.code).emit("question", base);
  // ส่ง URL preview ให้ผู้เล่นทุกคน เพื่อให้แต่ละเครื่องเล่นเสียงเอง
  io.to(room.code).emit("question:play", {
    index: room.index,
    previewUrl: q.previewUrl,
    positionMs: q.positionMs,
    startsAt: room.questionStartedAt,
    serverNow: Date.now(),
  });
  broadcastRoom(room);

  clearTimeout(room.timer);
  room.timer = setTimeout(() => endQuestion(room), room.settings.seconds * 1000 + 300);
}

function endQuestion(room) {
  if (room.phase !== "question") return;
  clearTimeout(room.timer);
  room.phase = "reveal";
  room.revealPaused = false;
  room.revealRemainingMs = REVEAL_MS;
  room.revealEndsAt = Date.now() + REVEAL_MS;
  const q = room.questions[room.index];

  const { pointsByPlayer, rankByPlayer } = updateLiveScores(room, q);

  const results = [];
  for (const p of room.players.values()) {
    const a = room.answers.get(p.id);
    if (a && a.choice === q.correctIndex) {
      const gain = pointsByPlayer.get(p.id) || 100;
      p.streak = (p.streak || 0) + 1;
      p.lastGain = gain;
    } else {
      p.streak = 0;
      p.lastGain = 0;
    }
    results.push({
      id: p.id,
      name: p.name,
      choice: a ? a.choice : null,
      correct: !!a && a.choice === q.correctIndex,
      responseSeconds: a ? Number((a.elapsedMs / 1000).toFixed(2)) : null,
      points: p.lastGain,
      answerRank: rankByPlayer.get(p.id) ?? null,
    });
  }

  io.to(room.code).emit("reveal", {
    index: room.index,
    correctIndex: q.correctIndex,
    track: { title: q.title, artist: q.artist, cover: q.cover || null },
    results,
    leaderboard: leaderboard(room),
    nextInMs: REVEAL_MS,
    isLast: room.index >= room.questions.length - 1,
  });
  broadcastRoom(room);

  room.timer = setTimeout(() => nextStep(room), REVEAL_MS);
}

function nextStep(room) {
  if (room.phase !== "reveal") return;
  clearTimeout(room.timer);
  room.revealPaused = false;
  room.revealRemainingMs = null;
  room.revealEndsAt = null;
  if (room.index + 1 >= room.questions.length) {
    room.phase = "finished";
    io.to(room.code).emit("finished", { leaderboard: leaderboard(room) });
    broadcastRoom(room);
    return;
  }
  room.index += 1;
  startQuestion(room);
}

function validQuestion(q) {
  return (
    q &&
    typeof q.uri === "string" &&
    q.uri.startsWith("deezer:track:") &&
    typeof q.previewUrl === "string" &&
    (() => { try { const url = new URL(q.previewUrl); return url.protocol === "https:" && /(^|\.)dzcdn\.net$/.test(url.hostname); } catch { return false; } })() &&
    Array.isArray(q.options) &&
    q.options.length === 4 &&
    q.options.every((o) => typeof o === "string") &&
    Number.isInteger(q.correctIndex) &&
    q.correctIndex >= 0 &&
    q.correctIndex < 4 &&
    typeof q.title === "string" &&
    typeof q.artist === "string"
  );
}

// ---------- Socket.IO ----------
io.on("connection", (socket) => {
  let room = null;
  let playerId = null;

  const ack = (cb, payload) => typeof cb === "function" && cb(payload);

  function attach(r, p) {
    room = r;
    playerId = p.id;
    p.socketId = socket.id;
    p.connected = true;
    if (p.id === r.hostId) r.hostSocketId = socket.id;
    socket.join(r.code);
  }

  socket.on("room:create", ({ name, avatar, settings }, cb) => {
    const nm = cleanName(name);
    if (!nm) return ack(cb, { ok: false, error: "กรุณาใส่ชื่อของคุณ" });
    const code = makeCode();
    const id = makeToken();
    const token = makeToken();
    const r = {
      code,
      hostId: id,
      hostSocketId: socket.id,
      phase: "lobby",
      settings: {
        rounds: clamp(settings?.rounds ?? DEFAULTS.rounds, LIMITS.rounds),
        seconds: clamp(settings?.seconds ?? DEFAULTS.seconds, LIMITS.seconds),
        geoPack: "world",
      },
      players: new Map(),
      questions: [],
      index: 0,
      answers: new Map(),
      timer: null,
      revealPaused: false,
      revealRemainingMs: null,
      revealEndsAt: null,
      createdAt: Date.now(),
      playlistName: null,
      gameId: "song-trivia",
      playlists: [],
    };
    const p = { id, token, name: nm, avatar: cleanAvatar(avatar), score: 0, connected: true, streak: 0, lastGain: 0 };
    r.players.set(id, p);
    rooms.set(code, r);
    attach(r, p);
    ack(cb, { ok: true, code, playerId: id, token, room: publicRoom(r) });
    broadcastRoom(r);
  });

  socket.on("room:join", ({ code, name, avatar }, cb) => {
    const r = rooms.get(String(code || "").toUpperCase().trim());
    if (!r) return ack(cb, { ok: false, error: "ไม่พบห้องนี้ ตรวจสอบรหัสอีกครั้ง" });
    if (r.phase !== "lobby") return ack(cb, { ok: false, error: "เกมเริ่มไปแล้ว เข้าร่วมไม่ได้" });
    if (r.players.size >= LIMITS.players)
      return ack(cb, { ok: false, error: "ห้องเต็มแล้ว" });
    const nm = cleanName(name);
    if (!nm) return ack(cb, { ok: false, error: "กรุณาใส่ชื่อของคุณ" });
    const dup = [...r.players.values()].some((p) => p.name.toLowerCase() === nm.toLowerCase());
    if (dup) return ack(cb, { ok: false, error: "ชื่อนี้มีคนใช้แล้ว ลองชื่ออื่น" });
    const id = makeToken();
    const token = makeToken();
    const p = { id, token, name: nm, avatar: cleanAvatar(avatar), score: 0, connected: true, streak: 0, lastGain: 0 };
    r.players.set(id, p);
    attach(r, p);
    ack(cb, { ok: true, code: r.code, playerId: id, token, room: publicRoom(r) });
    broadcastRoom(r);
  });

  // เชื่อมต่อใหม่หลังรีเฟรช/สัญญาณหลุด
  socket.on("room:rejoin", ({ code, playerId: pid, token }, cb) => {
    const r = rooms.get(String(code || "").toUpperCase());
    const p = r?.players.get(pid);
    if (!r || !p || p.token !== token) return ack(cb, { ok: false });
    attach(r, p);
    const payload = { ok: true, code: r.code, playerId: p.id, room: publicRoom(r) };
    if (r.phase === "question") {
      const q = r.questions[r.index];
      const now = Date.now();
      payload.question = {
        index: r.index,
        total: r.questions.length,
        options: q.options,
        endsAt: r.endsAt,
        serverNow: Date.now(),
        seconds: r.settings.seconds,
      };
      if (r.gameId === "song-trivia") {
        payload.playback = {
          previewUrl: q.previewUrl,
          positionMs: q.positionMs + Math.max(0, now - (r.questionStartedAt || now)),
          startsAt: now,
          serverNow: now,
        };
      }
      payload.answered = r.answers.has(p.id) ? r.answers.get(p.id).choice : null;
    }
    ack(cb, payload);
    broadcastRoom(r);
  });

  socket.on("player:avatar", ({ avatar }, cb) => {
    const player = room?.players.get(playerId);
    if (!player) return ack(cb, { ok: false });
    player.avatar = cleanAvatar(avatar);
    ack(cb, { ok: true });
    broadcastRoom(room);
  });

  socket.on("room:settings", ({ settings, playlistName, playlists, gameId }, cb) => {
    if (!room || playerId !== room.hostId || room.phase !== "lobby")
      return ack(cb, { ok: false });
    if (settings) {
      room.settings.rounds = clamp(settings.rounds ?? room.settings.rounds, LIMITS.rounds);
      room.settings.seconds = clamp(settings.seconds ?? room.settings.seconds, LIMITS.seconds);
      if (["world", "famous", "thailand"].includes(settings.geoPack)) room.settings.geoPack = settings.geoPack;
    }
    if (typeof gameId === "string" && ["song-trivia", "geo-guessr"].includes(gameId)) room.gameId = gameId;
    if (Array.isArray(playlists)) {
      room.playlists = playlists.slice(0, 10).map((playlist) => ({
        name: String(playlist?.name || "Playlist").slice(0, 80),
        cover: typeof playlist?.cover === "string" && playlist.cover.startsWith("https://") ? playlist.cover.slice(0, 500) : null,
        trackCount: Math.max(0, Math.min(1000, Number(playlist?.trackCount) || 0)),
      }));
      room.playlistName = room.playlists.map((playlist) => playlist.name).join(" + ").slice(0, 80);
    } else if (typeof playlistName === "string") {
      room.playlistName = playlistName.slice(0, 80);
    }
    ack(cb, { ok: true });
    broadcastRoom(room);
  });

  socket.on("game:start", ({ questions }, cb) => {
    if (room?.gameId !== "song-trivia") return ack(cb, { ok: false, error: "Song Trivia is not selected." });
    if (!room || playerId !== room.hostId) return ack(cb, { ok: false, error: "เฉพาะ host" });
    if (room.phase !== "lobby" && room.phase !== "finished")
      return ack(cb, { ok: false, error: "เกมกำลังเล่นอยู่" });
    if (!Array.isArray(questions) || questions.length < 1 || !questions.every(validQuestion))
      return ack(cb, { ok: false, error: "ข้อมูลคำถามไม่ถูกต้อง" });
    room.questions = questions.slice(0, LIMITS.rounds[1]).map((q) => ({
      uri: q.uri,
      previewUrl: q.previewUrl,
      title: q.title.slice(0, 150),
      artist: q.artist.slice(0, 150),
      options: q.options.map((o) => o.slice(0, 200)),
      correctIndex: q.correctIndex,
      positionMs: Math.max(0, Math.round(Number(q.positionMs) || 0)),
      cover: typeof q.cover === "string" && q.cover.startsWith("https://") ? q.cover : null,
    }));
    for (const p of room.players.values()) {
      p.score = 0;
      p.streak = 0;
      p.lastGain = 0;
    }
    room.index = 0;
    ack(cb, { ok: true });
    io.to(room.code).emit("game:starting", { total: room.questions.length });
    setTimeout(() => startQuestion(room), 2500);
  });

  socket.on("geo:start", ({ pack, area } = {}, cb) => {
    if (!room || playerId !== room.hostId || room.gameId !== "geo-guessr") return ack(cb, { ok: false, error: "Only the host can start this game." });
    if (room.phase !== "lobby" && room.phase !== "finished") return ack(cb, { ok: false, error: "Game is already running." });
    clearTimeout(room.timer);
    const selectedPack = GEO_PACKS[pack] ? pack : (room.settings.geoPack || "world");
    room.settings.geoPack = selectedPack;
    let locations;
    if (area) {
      const bounds = area.bounds || {};
      const numbers = [bounds.south, bounds.west, bounds.north, bounds.east].map(Number);
      const [south, west, north, east] = numbers;
      if (!String(area.label || "").trim() || numbers.some((value) => !Number.isFinite(value)) || south < -85 || north > 85 || south >= north || west < -180 || east > 180 || west >= east)
        return ack(cb, { ok: false, error: "The selected area has invalid map bounds. Search for the area again." });
      locations = randomLocationsInArea({ label: String(area.label).slice(0, 160), bounds: { south, west, north, east } }, clamp(room.settings.rounds, LIMITS.rounds));
    } else {
      locations = [...GEO_PACKS[selectedPack].locations];
      for (let i = locations.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [locations[i], locations[j]] = [locations[j], locations[i]];
      }
    }
    room.geoLocations = locations.slice(0, clamp(room.settings.rounds, LIMITS.rounds));
    room.geoIndex = 0;
    room.geoReveal = null;
    room.geoLoadedPlayers = new Set();
    for (const player of room.players.values()) { player.score = 0; player.lastGain = 0; player.streak = 0; }
    ack(cb, { ok: true });
    startGeoRound(room);
  });

  socket.on("geo:panorama-loaded", ({ roundIndex } = {}) => {
    if (!room || room.phase !== "geo-playing" || roundIndex !== room.geoIndex || !room.players.has(playerId)) return;
    room.geoLoadedPlayers ||= new Set();
    if (room.geoLoadedPlayers.has(playerId)) return;
    room.geoLoadedPlayers.add(playerId);
    const month = new Date().toISOString().slice(0, 7);
    geoMonthlyUsage.set(month, (geoMonthlyUsage.get(month) || 0) + 1);
    broadcastRoom(room);
  });

  socket.on("geo:guess", ({ lat, lng }, cb) => {
    if (!room || room.phase !== "geo-playing" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180)
      return ack(cb, { ok: false });
    room.geoAnswers.set(playerId, { lat: Number(lat), lng: Number(lng) });
    ack(cb, { ok: true });
    const connectedPlayers = [...room.players.values()].filter((player) => player.connected);
    if (connectedPlayers.length > 0 && connectedPlayers.every((player) => room.geoAnswers.has(player.id))) {
      finishGeoRound(room);
      return;
    }
    broadcastRoom(room);
  });

  socket.on("geo:next", () => {
    if (room && playerId === room.hostId) advanceGeoRound(room);
  });

  socket.on("answer", ({ index, choice }, cb) => {
    if (!room || room.phase !== "question" || index !== room.index)
      return ack(cb, { ok: false });
    if (room.answers.has(playerId)) return ack(cb, { ok: false });
    if (![0, 1, 2, 3].includes(choice)) return ack(cb, { ok: false });
    const elapsedMs = Math.max(0, Date.now() - (room.endsAt - room.settings.seconds * 1000));
    room.answers.set(playerId, { choice, elapsedMs });
    updateLiveScores(room, room.questions[room.index]);
    ack(cb, { ok: true });
    io.to(room.code).emit("answer:count", {
      answered: room.answers.size,
      total: [...room.players.values()].filter((p) => p.connected).length,
    });
    const allIn = [...room.players.values()]
      .filter((p) => p.connected)
      .every((p) => room.answers.has(p.id));
    if (allIn) endQuestion(room);
    else broadcastRoom(room);
  });

  socket.on("game:toggleRevealPause", () => {
    if (!room || playerId !== room.hostId || room.phase !== "reveal") return;
    if (room.revealPaused) {
      const remaining = Math.max(0, Number(room.revealRemainingMs) || 0);
      room.revealPaused = false;
      room.revealEndsAt = Date.now() + remaining;
      if (remaining <= 0) return nextStep(room);
      room.timer = setTimeout(() => nextStep(room), remaining);
    } else {
      room.revealRemainingMs = Math.max(0, (room.revealEndsAt || Date.now()) - Date.now());
      room.revealPaused = true;
      room.revealEndsAt = null;
      clearTimeout(room.timer);
    }
    broadcastRoom(room);
  });

  socket.on("game:skip", () => {
    if (!room || playerId !== room.hostId) return;
    if (room.phase === "reveal") nextStep(room);
    else if (room.phase === "question") endQuestion(room);
  });

  socket.on("game:reset", (_p, cb) => {
    if (!room || playerId !== room.hostId) return ack(cb, { ok: false });
    clearTimeout(room.timer);
    room.phase = "lobby";
    room.revealPaused = false;
    room.revealRemainingMs = null;
    room.revealEndsAt = null;
    room.questions = [];
    room.geoLocations = [];
    room.geoRound = null;
    room.geoReveal = null;
    room.geoAnswers = new Map();
    room.index = 0;
    room.roundBaseScores = null;
    for (const p of room.players.values()) {
      p.score = 0;
      p.streak = 0;
      p.lastGain = 0;
    }
    ack(cb, { ok: true });
    io.to(room.code).emit("game:reset");
    broadcastRoom(room);
  });

  socket.on("room:kick", ({ id }) => {
    if (!room || playerId !== room.hostId || id === room.hostId) return;
    const p = room.players.get(id);
    if (!p) return;
    io.to(p.socketId).emit("kicked");
    room.players.delete(id);
    broadcastRoom(room);
  });

  socket.on("room:leave", () => {
    if (!room) return;
    leave(true);
  });

  socket.on("disconnect", () => leave(false));

  function leave(explicit) {
    if (!room) return;
    const r = room;
    const p = r.players.get(playerId);
    room = null;
    if (!p) return;
    socket.leave(r.code);
    if (explicit && r.phase === "lobby" && p.id !== r.hostId) {
      r.players.delete(p.id);
    } else {
      p.connected = false;
    }
    if (explicit && p.id === r.hostId) {
      clearTimeout(r.timer);
      io.to(r.code).emit("room:closed");
      rooms.delete(r.code);
      return;
    }
    broadcastRoom(r);
    // ถ้าทุกคนที่ยังออนไลน์ตอบครบแล้วระหว่างรอบ ให้จบรอบเลย
    if (r.phase === "question") {
      const online = [...r.players.values()].filter((x) => x.connected);
      if (online.length && online.every((x) => r.answers.has(x.id))) endQuestion(r);
    }
  }
});

// ล้างห้องที่เก่าเกินไป
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const anyone = [...r.players.values()].some((p) => p.connected);
    if (now - r.createdAt > ROOM_TTL_MS || (!anyone && now - r.createdAt > 60_000)) {
      clearTimeout(r.timer);
      rooms.delete(code);
    }
  }
}, 60_000).unref();

// ---------- เสิร์ฟ client ที่ build แล้ว ----------
const dist = path.join(__dirname, "..", "dist");
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

server.listen(PORT, () => console.log(`Song Trivia server: http://localhost:${PORT}`));

export { server, io, rooms };
