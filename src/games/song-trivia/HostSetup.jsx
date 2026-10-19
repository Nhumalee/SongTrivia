import { useEffect, useMemo, useState } from "react";
import { socket } from "../../socket.js";
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
import { games as GAMES } from "../../games/registry.js";

export default function HostSetup({ room, picked, setPicked, playerStatus, playerRef, onCopyLink, copied, onLeave, volumeControl }) {
  const [playlists, setPlaylists] = useState(null);
  const [filter, setFilter] = useState("");
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [selectedDecade, setSelectedDecade] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [spotify, setSpotify] = useState({ configured: false, connected: false });
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [spotifyModalOpen, setSpotifyModalOpen] = useState(false);
  const [gameTab, setGameTab] = useState("presets");
  const [setupStep, setSetupStep] = useState("game");
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

  useEffect(() => {
    fetch("/api/spotify/status").then((response) => response.json()).then(setSpotify).catch(() => setSpotify({ configured: false, connected: false }));
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.data?.type !== "songtrivia-spotify-connected") return;
      setSpotify((state) => ({ ...state, connected: true }));
      setErr("");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!spotifyModalOpen) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") setSpotifyModalOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [spotifyModalOpen]);

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

  const importSpotifyPlaylist = async () => {
    setBusy(true);
    setErr("");
    try {
      const response = await fetch("/api/spotify/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: spotifyUrl }) });
      const playlist = await response.json();
      if (!response.ok) throw new Error(playlist.error || "Could not import Spotify playlist.");
      const tracks = new Array(playlist.tracks.length);
      let next = 0;
      const normalize = (value) => value.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      await Promise.all(Array.from({ length: Math.min(4, playlist.tracks.length) }, async () => {
        while (next < playlist.tracks.length) {
          const index = next++;
          const sourceTrack = playlist.tracks[index];
          try {
            const candidates = await dz.searchTracks(`${sourceTrack.title} ${sourceTrack.artist}`);
            const title = normalize(sourceTrack.title);
            const artist = normalize(sourceTrack.artist.split(",")[0]);
            const found = candidates.find((candidate) => {
              const candidateTitle = normalize(candidate.title);
              const candidateArtist = normalize(candidate.artist);
              return (candidateTitle === title || candidateTitle.includes(title) || title.includes(candidateTitle)) && candidateArtist.includes(artist);
            });
            if (found) tracks[index] = found;
          } catch { /* Skip individual tracks Deezer cannot match. */ }
        }
      }));
      const matchedTracks = [...new Map(tracks.filter(Boolean).map((track) => [track.uri, track])).values()];
      if (matchedTracks.length < 4) throw new Error(`จับคู่เพลงกับ Deezer ได้ ${matchedTracks.length} เพลง ต้องมีอย่างน้อย 4 เพลง ลองใช้ playlist อื่น`);
      const source = { key: `spotify:playlist:${playlist.id}`, type: "playlist", platform: "Spotify", id: playlist.id, name: playlist.name, cover: playlist.cover, spotifyUrl: playlist.url, tracks: matchedTracks };
      setPicked((state) => state.sources.some((item) => item.key === source.key) ? state : { sources: [...state.sources, source] });
      setSpotifyUrl("");
      setSpotifyModalOpen(false);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const setSetting = (settings) => socket.emit("room:settings", { settings });
  const selectGame = (gameId) => socket.emit("room:settings", { gameId });
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
        <nav className="step-flow" aria-label="Lobby setup progress">
          <span className={setupStep === "game" ? "current" : "complete"}>♫ <i>Choose Quiz</i></span><b>→</b>
          <span className={setupStep === "config" ? "current" : "pending"}>⚙ <i>Configure</i></span><b>→</b><span>▶ <i>Play</i></span>
        </nav>
        <div className="setup-volume-slot">{volumeControl}</div>
      </header>
      {setupStep === "game" ? <section className="game-picker" aria-labelledby="game-picker-title">
        <div className="game-tabs" role="tablist" aria-label="Game categories"><button type="button" role="tab" aria-selected={gameTab === "presets"} className={gameTab === "presets" ? "active" : ""} onClick={() => setGameTab("presets")}>PRESETS</button><button type="button" role="tab" aria-selected={gameTab === "custom"} className={gameTab === "custom" ? "active" : ""} onClick={() => setGameTab("custom")}>CUSTOM</button></div>
        {gameTab === "presets" ? <div className="game-picker-list">{GAMES.map((game) => {
          const selected = (room.gameId || "song-trivia") === game.id;
          return <button key={game.id} type="button" className={`game-choice${selected ? " selected" : ""}${game.status !== "available" ? " unavailable" : ""}`} disabled={!game.status || game.status !== "available"} aria-pressed={selected} onClick={() => selectGame(game.id)}>
            <span className="game-choice-icon" aria-hidden="true">{game.icon}</span><span className="game-choice-copy"><strong>{game.title}</strong><small>{game.description}</small>{game.status !== "available" && <em>COMING SOON</em>}</span><span className="game-choice-status">{game.status === "available" ? (selected ? "⚙" : "") : ""}</span>
          </button>;
        })}</div> : <div className="custom-game-placeholder"><span>✦</span><strong>สร้างเกมในแบบของคุณ</strong><small>ปรับแต่งกติกาและคำถามได้เร็ว ๆ นี้</small></div>}
        <div className="game-picker-footer"><button className="btn primary game-next" onClick={() => setSetupStep("config")}>▶ &nbsp; Next</button></div>
      </section> : <>
      <button className="btn ghost setup-back" onClick={() => setSetupStep("game")}>← เลือกเกม</button>
      <section className="card settings-card">
        <h2>ตั้งค่าห้อง</h2>
        <div className="row">
          <label className="field"><span>จำนวนข้อ</span><select value={room.settings.rounds} onChange={(event) => setSetting({ rounds: Number(event.target.value) })}>{ROUND_OPTIONS.map((n) => <option key={n} value={n}>{n} ข้อ</option>)}</select></label>
          <label className="field"><span>เวลาต่อข้อ</span><select value={room.settings.seconds} onChange={(event) => setSetting({ seconds: Number(event.target.value) })}>{SECOND_OPTIONS.map((n) => <option key={n} value={n}>{n} วินาที</option>)}</select></label>
        </div>
      </section>

      <section className="card catalog-card">
        <div className="catalog-heading"><div><span className="eyebrow">BUILD YOUR ROUND</span><h2>Choose a playlist</h2><p className="hint">Search Deezer playlists or pick a genre to get started.</p></div><div className="catalog-source-actions"><span className="source-badge">♫ &nbsp; DEEZER</span><button type="button" className="spotify-launch" aria-label="เพิ่มเพลงจาก Spotify" title="เพิ่มเพลงจาก Spotify" onClick={() => setSpotifyModalOpen(true)}><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#1ed760"/><path d="M7.4 11.7c5.9-1.8 12.8-1.2 17.7 1.7M8.7 16.1c4.8-1.4 10.5-.8 14.9 1.7M10 20.2c3.7-1 8.1-.6 11.5 1.4" fill="none" stroke="#102218" strokeWidth="2.2" strokeLinecap="round"/></svg></button></div></div>
        {spotifyModalOpen && <div className="spotify-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSpotifyModalOpen(false); }}>
          <section className="spotify-modal" role="dialog" aria-modal="true" aria-labelledby="spotify-modal-title">
            <button type="button" className="spotify-modal-close" aria-label="ปิดหน้าต่าง" onClick={() => setSpotifyModalOpen(false)}>×</button>
            <div className="spotify-modal-title"><span className="spotify-logo"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#1ed760"/><path d="M7.4 11.7c5.9-1.8 12.8-1.2 17.7 1.7M8.7 16.1c4.8-1.4 10.5-.8 14.9 1.7M10 20.2c3.7-1 8.1-.6 11.5 1.4" fill="none" stroke="#102218" strokeWidth="2.2" strokeLinecap="round"/></svg></span><div><h2 id="spotify-modal-title">เพิ่มเพลงจาก Spotify</h2><p>เชื่อมบัญชี แล้ววางลิงก์ playlist ที่ต้องการนำเข้า</p></div></div>
            {!spotify.configured ? <div className="spotify-modal-setup"><strong>ยังไม่ได้ตั้งค่า Spotify</strong><p>เพิ่ม Spotify Client ID และ Client Secret ใน environment ของ server แล้วเปิดแอปใหม่</p></div> : <>
              <div className="spotify-modal-connect">{spotify.connected ? <span className="spotify-connection connected">✓ เชื่อมบัญชี Spotify แล้ว</span> : <><span>ขั้นที่ 1 · อนุญาตให้เข้าถึง playlist</span><button type="button" className="spotify-connect-button" onClick={() => window.open("/api/spotify/login", "spotify-connect", "popup,width=520,height=720")}>เชื่อมบัญชี Spotify</button></>}</div>
              <label className="spotify-modal-label" htmlFor="spotify-playlist-url">ขั้นที่ 2 · วางลิงก์ playlist</label>
              <div className="spotify-import-controls"><input id="spotify-playlist-url" className="input" type="url" value={spotifyUrl} onChange={(event) => setSpotifyUrl(event.target.value)} placeholder="https://open.spotify.com/playlist/..." disabled={!spotify.connected || busy} /><button type="button" className="btn primary" onClick={importSpotifyPlaylist} disabled={!spotify.connected || !spotifyUrl.trim() || busy}>{busy ? "กำลังนำเข้า…" : "เพิ่มเพลง"}</button></div>
            </>}
            <ol className="spotify-import-steps"><li>ใช้ playlist ที่คุณเป็นเจ้าของหรือแก้ไขได้</li><li>ระบบจะจับคู่เพลงกับ Deezer เพื่อใช้เสียง preview</li><li>เพลงที่ไม่มี preview จะถูกข้าม</li></ol>
            {err && <div className="alert spotify-modal-error" role="alert">{err}</div>}
          </section>
        </div>}
        <p className="hint">Deezer มีคลิปตัวอย่างสูงสุด 30 วินาที ตั้งเวลา 30 วินาทีเพื่อฟังคลิปได้เต็มช่วง</p>
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
        {sources.length > 0 && <div className="picked selected-playlists">
          <h3>Selected playlists</h3>
          <div className="chips">{sources.map((source) => <span className="chip" key={source.key}>{source.platform === "Spotify" && source.spotifyUrl ? <a className="spotify-source-link" href={source.spotifyUrl} target="_blank" rel="noreferrer">Spotify ↗</a> : <em>Deezer</em>}{source.name}<span className="muted"> · {source.tracks.length} เพลง</span><button className="x" onClick={() => remove(source.key)} aria-label={`นำ ${source.name} ออก`}>×</button></span>)}</div>
          <span className="muted small">รวม {pool.length} เพลง{pool.length < 4 ? " · ต้องมีอย่างน้อย 4 เพลง" : ` · เล่น ${Math.min(room.settings.rounds, pool.length)} ข้อ`}</span>
        </div>}
        {busy && <span className="spin" />}
      </section>
      {err && <div className="alert">{err}</div>}
      <div className={`player-status ${playerStatus}`}>{playerStatus === "ready" ? "ตัวเล่นคลิปพรีวิวพร้อมแล้ว" : "กำลังเตรียมตัวเล่น…"}</div>
      {pool.length < 4 && <p className="hint center-text">เลือกเพลย์ลิสต์ที่มีคลิปพรีวิวได้อย่างน้อย 4 เพลงก่อนเริ่มเกม (ตอนนี้มี {pool.length})</p>}
      {pool.length >= 4 && playerStatus !== "ready" && <p className="hint center-text">กำลังเตรียมเครื่องเล่นเสียง รอสักครู่แล้วลองอีกครั้ง</p>}
      <button className="btn primary big" disabled={playerStatus !== "ready" || pool.length < 4} onClick={start}>
        {room.players.length === 1 ? "เริ่มเล่นคนเดียว" : `เริ่มเกมกับ ${room.players.length} คน`}
      </button>
      </>}
    </div>
  );
}
