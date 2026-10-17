// ทดสอบ flow ของเซิร์ฟเวอร์ด้วย socket.io-client จริง: สร้างห้อง -> เข้าห้อง -> เล่น 2 ข้อ -> จบเกม
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { io } from "socket.io-client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3999;
const url = `http://127.0.0.1:${PORT}`;
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failed++;
};
const emit = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
const once = (s, ev, ms = 8000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), ms);
    s.once(ev, (d) => {
      clearTimeout(t);
      res(d);
    });
  });

const srv = spawn("node", [path.join(__dirname, "index.js")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((r) => srv.stdout.once("data", r));

const mkQ = (i) => ({
  uri: `deezer:track:${i}`,
  previewUrl: `https://cdns-preview-1.dzcdn.net/stream/test-${i}.mp3`,
  title: `Song ${i}`,
  artist: `Artist ${i}`,
  options: ["A", "B", "C", "D"],
  correctIndex: i, // ข้อ 0 -> A, ข้อ 1 -> B
  positionMs: 1000,
});

try {
  const host = io(url);
  const p2 = io(url);
  const p3 = io(url);
  await Promise.all([once(host, "connect"), once(p2, "connect"), once(p3, "connect")]);

  const c = await emit(host, "room:create", { name: "Host", settings: { rounds: 2, seconds: 10 } });
  ok(c.ok && /^[A-Z0-9]{4}$/.test(c.code), `สร้างห้อง ได้รหัส ${c.code}`);
  ok(c.room.settings.rounds === 3, "จำนวนข้อถูก clamp ขั้นต่ำเป็น 3");

  const bad = await emit(p2, "room:join", { code: "ZZZZ", name: "X" });
  ok(!bad.ok, "รหัสห้องผิดถูกปฏิเสธ");

  const j2 = await emit(p2, "room:join", { code: c.code, name: "มะลิ" });
  const j3 = await emit(p3, "room:join", { code: c.code, name: "Bob" });
  ok(j2.ok && j3.ok, "เพื่อนเข้าห้องได้ 2 คน");
  const dup = await emit(io(url), "room:join", { code: c.code, name: "bob" });
  ok(!dup.ok, "ชื่อซ้ำถูกปฏิเสธ");

  const nonHost = await emit(p2, "game:start", { questions: [mkQ(0)] });
  ok(!nonHost.ok, "คนที่ไม่ใช่ host เริ่มเกมไม่ได้");
  const badQ = await emit(host, "game:start", { questions: [{ uri: "x" }] });
  ok(!badQ.ok, "ข้อมูลคำถามผิดรูปแบบถูกปฏิเสธ");

  const st = await emit(host, "game:start", { questions: [mkQ(0), mkQ(1)] });
  ok(st.ok, "host เริ่มเกมได้");

  // ---- ข้อ 1: host ตอบถูก, p2 ตอบถูกช้ากว่า, p3 ตอบผิด ----
  const [q1, play1, play2, play3] = await Promise.all([
    once(p2, "question"), once(host, "question:play"), once(p2, "question:play"), once(p3, "question:play"),
  ]);
  ok(q1.options.length === 4 && q1.correctIndex === undefined, "ผู้เล่นไม่ได้รับเฉลยล่วงหน้า");
  ok(play1.previewUrl.startsWith("https://cdns-preview-") && play2.previewUrl === play1.previewUrl && play3.previewUrl === play1.previewUrl, "ทุกเครื่องได้รับ Deezer preview สำหรับเล่นเสียง");

  const revealP = once(p3, "reveal");
  await emit(host, "answer", { index: 0, choice: 0 });
  await new Promise((r) => setTimeout(r, 300));
  await emit(p2, "answer", { index: 0, choice: 0 });
  const again = await emit(p2, "answer", { index: 0, choice: 1 });
  ok(!again.ok, "ตอบซ้ำไม่ได้");
  await emit(p3, "answer", { index: 0, choice: 2 });
  const r1 = await revealP;
  ok(r1.correctIndex === 0, "เฉลยข้อ 1 ถูกต้อง");
  const byName = Object.fromEntries(r1.leaderboard.map((p) => [p.name, p.score]));
  ok(byName.Host > byName["มะลิ"] && byName["มะลิ"] >= 500, `ตอบเร็วกว่าได้คะแนนมากกว่า (${byName.Host} > ${byName["มะลิ"]})`);
  ok(byName.Bob === 0, "ตอบผิดได้ 0 คะแนน");

  // ---- ข้อ 2 (host กดข้าม) ----
  const q2P = once(p2, "question");
  host.emit("game:skip");
  const q2 = await q2P;
  ok(q2.index === 1, "ข้ามไปข้อ 2");
  const rev2 = once(host, "reveal");
  await emit(host, "answer", { index: 1, choice: 1 });
  await emit(p2, "answer", { index: 1, choice: 3 });
  await emit(p3, "answer", { index: 1, choice: 1 });
  const r2 = await rev2;
  ok(r2.isLast, "ข้อ 2 เป็นข้อสุดท้าย");

  const fin = once(p2, "finished");
  host.emit("game:skip");
  const f = await fin;
  ok(f.leaderboard[0].name === "Host", `ผู้ชนะคือ Host (${f.leaderboard.map((p) => p.name + ":" + p.score).join(", ")})`);

  // ---- rejoin ----
  const p2b = io(url);
  await once(p2b, "connect");
  const rj = await emit(p2b, "room:rejoin", { code: c.code, playerId: j2.playerId, token: j2.token });
  ok(rj.ok && rj.room.players.length === 3, "เชื่อมต่อกลับด้วย token ได้");
  const rjBad = await emit(p2b, "room:rejoin", { code: c.code, playerId: j2.playerId, token: "nope" });
  ok(!rjBad.ok, "token ผิดเชื่อมต่อกลับไม่ได้");

  // ---- reset ----
  const rs = await emit(host, "game:reset");
  ok(rs.ok, "เริ่มรอบใหม่ (reset) ได้");
  const late = await emit(io(url), "room:join", { code: c.code, name: "Late" });
  ok(late.ok, "หลัง reset กลับ lobby คนใหม่เข้าได้");
} catch (e) {
  console.error(e);
  failed++;
}

srv.kill();
console.log(failed ? `\n${failed} test(s) failed` : "\nall tests passed");
process.exit(failed ? 1 : 0);
