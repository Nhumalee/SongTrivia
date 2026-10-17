import { useEffect, useMemo, useState } from "react";
import { socket } from "./socket.js";
import * as dz from "./deezer.js";
import { buildQuestions } from "./deezer.js";

const ROUND_OPTIONS = [5, 10, 15, 20];
const SECOND_OPTIONS = [10, 15, 20, 30];

export default function HostSetup({ room, picked, setPicked, playerStatus, playerRef }) {
  const [playlists, setPlaylists] = useState(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sources = picked.sources;
  const pool = useMemo(() => {
    const tracks = new Map();
    sources.forEach((source) => source.tracks.forEach((track) => tracks.set(track.uri, track)));
    return [...tracks.values()];
  }, [sources]);

  useEffect(() => {
    socket.emit("room:settings", { playlistName: sources.map((source) => source.name).join(" + ") });
  }, [sources]);

  useEffect(() => {
    let cancelled = false;
    const query = filter.trim() || "hits";
    setPlaylists(null);
    dz.searchPlaylists(query)
      .then((results) => !cancelled && setPlaylists(results))
      .catch((error) => { if (!cancelled) { setPlaylists([]); setErr(error.message); } });
    return () => { cancelled = true; };
  }, [filter]);

  const remove = (key) => setPicked((state) => ({ sources: state.sources.filter((source) => source.key !== key) }));
  const togglePlaylist = async (playlist) => {
    const key = `deezer:playlist:${playlist.id}`;
    if (sources.some((source) => source.key === key)) return remove(key);
    setBusy(true);
    setErr("");
    try {
      const source = await dz.getPlaylist(playlist.id);
      setPicked((state) => state.sources.some((item) => item.key === source.key)
        ? state : { sources: [...state.sources, source] });
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const setSetting = (settings) => socket.emit("room:settings", { settings });
  const start = () => {
    setErr("");
    playerRef.current?.activate();
    try {
      const questions = buildQuestions(pool, Math.min(room.settings.rounds, pool.length), room.settings.seconds);
      socket.emit("game:start", { questions }, (result) => {
        if (!result?.ok) setErr(result?.error || "เริ่มเกมไม่สำเร็จ");
      });
    } catch (error) {
      setErr(error.message);
    }
  };

  const shown = playlists || [];
  return (
    <div className="stack">
      <section className="card">
        <h2>ตั้งค่าห้อง</h2>
        <div className="row">
          <label className="field"><span>จำนวนข้อ</span><select value={room.settings.rounds} onChange={(event) => setSetting({ rounds: Number(event.target.value) })}>{ROUND_OPTIONS.map((n) => <option key={n} value={n}>{n} ข้อ</option>)}</select></label>
          <label className="field"><span>เวลาต่อข้อ</span><select value={room.settings.seconds} onChange={(event) => setSetting({ seconds: Number(event.target.value) })}>{SECOND_OPTIONS.map((n) => <option key={n} value={n}>{n} วินาที</option>)}</select></label>
        </div>
      </section>

      <section className="card">
        <h2>เลือกเพลย์ลิสต์จาก Deezer</h2>
        <p className="hint">Deezer มีคลิปตัวอย่างสูงสุด 30 วินาที ตั้งเวลา 30 วินาทีเพื่อฟังคลิปได้เต็มช่วง</p>
        {sources.length > 0 && <div className="picked">
          <div className="chips">{sources.map((source) => <span className="chip" key={source.key}><em>Deezer</em>{source.name}<span className="muted"> · {source.tracks.length} เพลง</span><button className="x" onClick={() => remove(source.key)} aria-label={`นำ ${source.name} ออก`}>×</button></span>)}</div>
          <span className="muted small">รวม {pool.length} เพลง{pool.length < 4 ? " · ต้องมีอย่างน้อย 4 เพลง" : ` · เล่น ${Math.min(room.settings.rounds, pool.length)} ข้อ`}</span>
        </div>}
        <input className="input" placeholder="ค้นหาเพลย์ลิสต์ เช่น pop hits, k-pop…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <ul className="playlists">
          {playlists === null && <li className="muted">กำลังค้นหาเพลย์ลิสต์…</li>}
          {playlists && shown.length === 0 && <li className="muted">ไม่พบเพลย์ลิสต์ ลองค้นคำอื่น</li>}
          {shown.map((playlist) => {
            const selected = sources.some((source) => source.key === `deezer:playlist:${playlist.id}`);
            return <li key={playlist.id}><button className={`pl${selected ? " active" : ""}`} disabled={busy} onClick={() => togglePlaylist(playlist)}>
              {playlist.cover ? <img src={playlist.cover} alt="" /> : <div className="ph">♫</div>}
              <div className="pl-text"><strong>{playlist.name}</strong><span className="muted">{playlist.total} เพลง · {playlist.owner}</span></div>
              {selected && <span className="tick">✓</span>}
            </button></li>;
          })}
        </ul>
        {busy && <span className="spin" />}
      </section>
      {err && <div className="alert">{err}</div>}
      <div className={`player-status ${playerStatus}`}>{playerStatus === "ready" ? "ตัวเล่นคลิปพรีวิวพร้อมแล้ว" : "กำลังเตรียมตัวเล่น…"}</div>
      {pool.length < 4 && <p className="hint center-text">เลือกเพลย์ลิสต์ที่มีคลิปพรีวิวได้อย่างน้อย 4 เพลงก่อนเริ่มเกม (ตอนนี้มี {pool.length})</p>}
      {pool.length >= 4 && playerStatus !== "ready" && <p className="hint center-text">กำลังเตรียมเครื่องเล่นเสียง รอสักครู่แล้วลองอีกครั้ง</p>}
      <button className="btn primary big" disabled={playerStatus !== "ready" || pool.length < 4} onClick={start}>
        {room.players.length === 1 ? "เริ่มเล่นคนเดียว" : `เริ่มเกมกับ ${room.players.length} คน`}
      </button>
    </div>
  );
}
