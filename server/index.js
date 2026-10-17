import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

// Deezer's public API does not send CORS headers; proxy only its public catalog endpoints.
app.get("/api/deezer/*", async (req, res) => {
  try {
    const resource = req.params[0];
    if (!/^(search\/playlist|playlist\/\d+)$/.test(resource)) return res.status(400).json({ error: "Unsupported Deezer resource" });
    const upstream = await fetch(`https://api.deezer.com/${resource}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
    const data = await upstream.json();
    if (!upstream.ok || data.error) return res.status(upstream.status || 502).json({ error: data.error?.message || "Deezer request failed" });
    res.json(data);
  } catch { res.status(502).json({ error: "Deezer API is unavailable" }); }
});

// ---------- ค่าเริ่มต้นและขีดจำกัด ----------
const DEFAULTS = { rounds: 10, seconds: 30 };
const LIMITS = { rounds: [3, 30], seconds: [8, 60], players: 12, name: 16 };
const AVATARS = new Set(["momo", "kai", "lily", "tae", "jun", "pond"]);
const REVEAL_MS = 5000;
const ROOM_TTL_MS = 1000 * 60 * 60 * 3;

/** @type {Map<string, any>} */
const rooms = new Map();

const clamp = (n, [lo, hi]) => Math.max(lo, Math.min(hi, Math.round(Number(n) || lo)));
const cleanName = (s) =>
  String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, LIMITS.name);
const cleanAvatar = (value) => AVATARS.has(value) ? value : "momo";

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
    settings: room.settings,
    playlistName: room.playlistName || null,
    playlists: room.playlists || [],
    revealPaused: room.phase === "reveal" && !!room.revealPaused,
    revealRemainingMs: room.phase === "reveal"
      ? Math.max(0, room.revealPaused ? room.revealRemainingMs : (room.revealEndsAt || Date.now()) - Date.now())
      : null,
    hostId: room.hostId,
    players: leaderboard(room),
  };
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
  room.endsAt = Date.now() + room.settings.seconds * 1000;
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
  // host เท่านั้นที่ได้ข้อมูลเพลงสำหรับเล่นเสียง
  io.to(room.code).emit("question:play", {
    index: room.index,
    previewUrl: q.previewUrl,
    positionMs: q.positionMs,
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
      payload.question = {
        index: r.index,
        total: r.questions.length,
        options: q.options,
        endsAt: r.endsAt,
        serverNow: Date.now(),
        seconds: r.settings.seconds,
      };
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

  socket.on("room:settings", ({ settings, playlistName, playlists }, cb) => {
    if (!room || playerId !== room.hostId || room.phase !== "lobby")
      return ack(cb, { ok: false });
    if (settings) {
      room.settings.rounds = clamp(settings.rounds ?? room.settings.rounds, LIMITS.rounds);
      room.settings.seconds = clamp(settings.seconds ?? room.settings.seconds, LIMITS.seconds);
    }
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
