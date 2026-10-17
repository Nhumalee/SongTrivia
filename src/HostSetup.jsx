import { useEffect, useMemo, useState } from "react";
import { socket } from "./socket.js";
import * as dz from "./deezer.js";
import { buildQuestions } from "./deezer.js";

const ROUND_OPTIONS = [5, 10, 15, 20];
const SECOND_OPTIONS = [10, 15, 20, 30];
const GENRES = [
  { label: "Pop", query: "Pop" },
  { label: "Rap", query: "Rap" },
  { label: "Rock", query: "Rock" },
  { label: "Latino", query: "Latino" },
  { label: "R&B", query: "R&B" },
  { label: "Electronic", query: "Electronic" },
  { label: "K-Pop", query: "K-Pop" },
  { label: "Thai", query: "เพลงไทย" },
  { label: "Country", query: "Country" },
  { label: "Metal", query: "Metal" },
];
const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020].map((year) => ({
  label: `${String(year).slice(-2)}s`,
  query: `${year}s`,
}));

export default function HostSetup({ room, picked, setPicked, playerStatus, playerRef, onCopyLink, onLeave }) {
  const [playlists, setPlaylists] = useState(null);
  const [filter, setFilter] = useState("");
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [selectedDecade, setSelectedDecade] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sources = picked.sources;
  const pool = useMemo(() => {
    const tracks = new Map();
    sources.forEach((source) => source.tracks.forEach((track) => tracks.set(track.uri, track)));
    return [...tracks.values()];
  }, [sources]);

  useEffect(() => {
    socket.emit("room:settings", {
      playlists: sources.map((source) => ({
        name: source.name,
        cover: source.cover || source.tracks[0]?.cover || null,
        trackCount: source.tracks.length,
      })),
    });
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
  const setCatalogFilters = (genre, decade) => {
    setSelectedGenre(genre);
    setSelectedDecade(decade);
    setFilter([genre?.query, decade?.query].filter(Boolean).join(" ") || "hits");
  };
  const editSearch = (value) => {
    setSelectedGenre(null);
    setSelectedDecade(null);
    setFilter(value);
  };
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
    <div className="stack choose-quiz">
      <header className="setup-header">
        <div className="brand-mark"><span>SONG</span><strong>TRIVIA</strong></div>
        <div className="step-flow"><span>⚙ &nbsp; Configuration</span><b>→</b><strong>♫ &nbsp; Choose Quiz</strong><b>→</b><span>▶ &nbsp; Play</span></div>
        <div className="room-pill"><small>ROOM</small><strong>{room.code}</strong><span>◉</span><b>♧ &nbsp; Private</b><button className="btn small invite-btn" onClick={onCopyLink}>Invite</button><button className="btn small ghost" onClick={onLeave}>Exit</button></div>
      </header>
      <section className="card settings-card">
        <h2>ตั้งค่าห้อง</h2>
        <div className="row">
          <label className="field"><span>จำนวนข้อ</span><select value={room.settings.rounds} onChange={(event) => setSetting({ rounds: Number(event.target.value) })}>{ROUND_OPTIONS.map((n) => <option key={n} value={n}>{n} ข้อ</option>)}</select></label>
          <label className="field"><span>เวลาต่อข้อ</span><select value={room.settings.seconds} onChange={(event) => setSetting({ seconds: Number(event.target.value) })}>{SECOND_OPTIONS.map((n) => <option key={n} value={n}>{n} วินาที</option>)}</select></label>
        </div>
      </section>

      <section className="card catalog-card">
        <div className="catalog-heading"><div><span className="eyebrow">BUILD YOUR ROUND</span><h2>Choose a playlist</h2><p className="hint">Search Deezer playlists or pick a genre to get started.</p></div><span className="source-badge">♫ &nbsp; DEEZER</span></div>
        <p className="hint">Deezer มีคลิปตัวอย่างสูงสุด 30 วินาที ตั้งเวลา 30 วินาทีเพื่อฟังคลิปได้เต็มช่วง</p>
        {sources.length > 0 && <div className="picked">
          <div className="chips">{sources.map((source) => <span className="chip" key={source.key}><em>Deezer</em>{source.name}<span className="muted"> · {source.tracks.length} เพลง</span><button className="x" onClick={() => remove(source.key)} aria-label={`นำ ${source.name} ออก`}>×</button></span>)}</div>
          <span className="muted small">รวม {pool.length} เพลง{pool.length < 4 ? " · ต้องมีอย่างน้อย 4 เพลง" : ` · เล่น ${Math.min(room.settings.rounds, pool.length)} ข้อ`}</span>
        </div>}
        <input className="input" placeholder="ค้นหาเพลย์ลิสต์ เช่น pop hits, k-pop…" value={filter === "hits" ? "" : filter} onChange={(event) => editSearch(event.target.value)} />
        <div className="catalog-filter-group">
          <span className="catalog-filter-label">แนวเพลง</span>
          <div className="genre-pills">{GENRES.map((genre) => <button key={genre.label} type="button" className={selectedGenre?.label === genre.label ? "genre-pill active" : "genre-pill"} onClick={() => setCatalogFilters(selectedGenre?.label === genre.label ? null : genre, selectedDecade)}>{genre.label}</button>)}</div>
        </div>
        <div className="catalog-filter-group">
          <span className="catalog-filter-label">ยุคเพลง · เลือกช่วงละ 10 ปี</span>
          <div className="genre-pills decade-pills">
            <button type="button" className={!selectedDecade && filter === "hits" ? "genre-pill active" : "genre-pill"} onClick={() => setCatalogFilters(selectedGenre, null)}>ทุกยุค</button>
            {DECADES.map((decade) => <button key={decade.query} type="button" className={selectedDecade?.query === decade.query ? "genre-pill active" : "genre-pill"} onClick={() => setCatalogFilters(selectedGenre, selectedDecade?.query === decade.query ? null : decade)}>{decade.label}</button>)}
          </div>
        </div>
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
