import { useEffect, useRef, useState } from "react";
import { socket } from "./socket.js";
import HostSetup from "./HostSetup.jsx";

const SHAPES = ["▲", "◆", "●", "■"];
const SESSION_KEY = "st_session";
const AVATARS = ["momo", "kai", "lily", "tae", "jun", "pond"];
const AVATAR_NAMES = { momo: "Momo", kai: "Kai", lily: "Lily", tae: "Tae", jun: "Jun", pond: "Pond" };
const avatarUrl = (id) => `/avatar/${AVATARS.includes(id) ? id : "momo"}.png`;

function AvatarPicker({ value, onChange, compact = false }) {
  return <div className={`avatar-picker${compact ? " compact" : ""}`}>
    <span className="avatar-picker-label">Choose your avatar</span>
    <div className="avatar-options">{AVATARS.map((item) => <button key={item} type="button" className={`avatar-option${value === item ? " active" : ""}`} aria-label={AVATAR_NAMES[item]} title={AVATAR_NAMES[item]} aria-pressed={value === item} onClick={() => onChange(item)}><img src={avatarUrl(item)} alt="" /></button>)}</div>
  </div>;
}

const loadSession = () => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
};
const saveSession = (s) => localStorage.setItem(SESSION_KEY, JSON.stringify(s));
const clearSession = () => localStorage.removeItem(SESSION_KEY);

// ---------- Deezer preview player (host) ----------
function usePlayer(enabled, onError) {
  const [status, setStatus] = useState("idle");
  const [unlocked, setUnlocked] = useState(false);
  const [volume, setVolumeState] = useState(() => {
    const v = parseFloat(localStorage.getItem("st_volume"));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
  });
  const [muted, setMuted] = useState(false);
  const ref = useRef(null);
  const effective = muted ? 0 : volume;
  const effRef = useRef(effective);
  effRef.current = effective;
  useEffect(() => {
    ref.current?.setVolume(effective);
  }, [effective, status]);
  const setVolume = (v) => {
    setVolumeState(v);
    if (v > 0) setMuted(false);
    try {
      localStorage.setItem("st_volume", String(v));
    } catch {}
  };
  const toggleMute = () => {
    if (muted) {
      if (volume === 0) setVolume(0.5);
      else setMuted(false);
    } else setMuted(true);
  };
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    setUnlocked(false);
    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = effRef.current;
    audio.addEventListener("error", () => !dead && onError("เล่นคลิปตัวอย่างไม่สำเร็จ ลองเริ่มเกมอีกครั้ง"));
    ref.current = {
      audio,
      activate() {
        // Prime playback inside the host's Start click so browsers allow the first preview.
        audio.muted = true;
        audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
        audio.play().then(() => { audio.pause(); audio.removeAttribute("src"); audio.load(); audio.muted = false; }).catch(() => { audio.muted = false; });
        setUnlocked(true);
      },
      play(url, positionMs = 0) {
        if (!url) return onError("เพลงนี้ไม่มีคลิปตัวอย่าง");
        audio.src = url;
        const start = () => {
          audio.onloadedmetadata = null;
          audio.currentTime = Math.min(27, Math.max(0, positionMs / 1000));
          audio.play().catch(() => onError("เปิดเสียงบนเครื่องนี้ก่อนเริ่มเกมเพื่อฟังคลิปเพลง"));
        };
        if (audio.readyState >= 1) start();
        else audio.onloadedmetadata = start;
      },
      pause: () => audio.pause(),
      setVolume: (value) => {
        audio.volume = value;
        audio.muted = value === 0;
      },
      disconnect: () => { audio.pause(); audio.removeAttribute("src"); },
    };
    setStatus("ready");
    return () => {
      dead = true;
      ref.current?.disconnect();
      ref.current = null;
      setUnlocked(false);
      setStatus("idle");
    };
  }, [enabled]);
  return { status, ref, volume: effective, muted, setVolume, toggleMute, unlocked };
}

function VolumeControl({ volume, muted, ready, setVolume, toggleMute }) {
  const pct = Math.round(volume * 100);
  const icon = muted || volume === 0 ? "🔇" : volume < 0.35 ? "🔈" : volume < 0.7 ? "🔉" : "🔊";
  return (
    <div className={"volume" + (ready ? "" : " off")}>
      <button className="vol-btn" onClick={toggleMute} aria-label={muted ? "เปิดเสียง" : "ปิดเสียง"} title={muted ? "เปิดเสียง" : "ปิดเสียง"}>
        {icon}
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={volume}
        aria-label="ระดับเสียงเพลง"
        onChange={(e) => setVolume(Number(e.target.value))}
      />
      <span className="vol-pct">{pct}%</span>
    </div>
  );
}

// ---------- ส่วนย่อย ----------
function Timer({ endsAt, offset, seconds }) {
  const [left, setLeft] = useState(seconds * 1000);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, endsAt - (Date.now() + offset)));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [endsAt, offset]);
  const pct = Math.min(100, (left / (seconds * 1000)) * 100);
  return (
    <div className={"timer" + (left < 5000 ? " low" : "")}>
      <div className="timer-bar" style={{ width: pct + "%" }} />
      <span>{Math.ceil(left / 1000)}</span>
    </div>
  );
}

function Leaderboard({ list, meId, compact }) {
  return (
    <ol className={"board" + (compact ? " compact" : "")}>
      {list.map((p, i) => (
        <li key={p.id} className={(p.id === meId ? "me " : "") + (p.connected ? "" : "off")}>
          <span className="rank">{i + 1}</span>
          <span className="pname">
            {p.name}
            {p.isHost && <em className="badge">host</em>}
            {p.streak >= 2 && <em className="streak">🔥{p.streak}</em>}
          </span>
          {p.lastGain > 0 && <span className="gain">+{p.lastGain}</span>}
          <span className="score">{p.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}

function Home({ name, setName, avatar, setAvatar, busy, error, initialCode, onCreate, onJoin }) {
  const [code, setCode] = useState(initialCode || "");
  return (
    <div className="home home-screen">
      <header className="home-topbar">
        <div className="brand-mark"><span>SONG</span><strong>TRIVIA</strong></div>
        <h1>Play with <em>friends</em></h1>
        <span className="language-pill">◎ &nbsp; EN <b>⌄</b></span>
      </header>

      <div className="side-note side-note-left">PLAY<br />LISTEN<br />GUESS<br />TOGETHER<br /><span>♡</span></div>
      <div className="side-note side-note-right">GOOD<br />MUSIC<br />BETTER<br />PEOPLE<br /><span>♡</span></div>
      <div className="floating-note note-left">♫</div>
      <div className="floating-note note-right">♫</div>
      <div className="equalizer equalizer-left" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <i key={i} style={{ "--bar": (35 + ((i * 23) % 65)) + "%" }} />)}</div>
      <div className="equalizer equalizer-right" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <i key={i} style={{ "--bar": (35 + (((6 - i) * 23) % 65)) + "%" }} />)}</div>

      <main className="home-main">
        <label className="nickname-field">
          <span>Your player name</span>
          <input className="input" maxLength={16} placeholder="Enter your name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <AvatarPicker value={avatar} onChange={setAvatar} />
        <div className="home-cards">
          <section className="action-card create-card">
            <div className="hero-art friends-art" aria-hidden="true"><span>👧🏻</span><span>👩🏼‍🎤</span><span>🧑🏽‍🎤</span><b>♟＋</b></div>
            <h2>Create a <em>private lobby</em></h2>
            <p>Create a lobby and invite your friends to play together in real time.</p>
            <button className="btn lobby-cta" disabled={busy || !name.trim()} onClick={onCreate}>
              <span>⊕</span>{busy ? "Creating lobby…" : "Create my lobby"}<b>›</b>
            </button>
          </section>

          <section className="action-card join-card">
            <div className="hero-art envelope-art" aria-hidden="true"><span>✉</span><b>{code || "1234"}</b><i>✦</i><i>✦</i></div>
            <h2>Join with a <em>code</em></h2>
            <input
              className="input join-code"
              autoComplete="off"
              maxLength={4}
              aria-label="Four digit room code"
              placeholder="— — — —"
              value={code}
              onChange={(e) => {
                const next = e.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase();
                setCode(next);
              }}
              onKeyDown={(e) => e.key === "Enter" && code.length === 4 && name.trim() && !busy && onJoin(code)}
            />
            <p className="join-hint">Enter the 4-character code, then join the lobby.</p>
            <button className="btn join-cta" disabled={busy || code.length !== 4 || !name.trim()} onClick={() => onJoin(code)}>
              {busy ? "Joining lobby…" : "Join lobby"}<b>›</b>
            </button>
          </section>
        </div>
        {error && <div className="alert home-alert">{error}</div>}
      </main>

      <footer className="home-footer"><span>🌙</span><div><strong>Shh, the ad is taking a nap</strong><small>Enjoy the quiet and keep playing 🎶</small></div></footer>
    </div>
  );
}
// ---------- แอปหลัก ----------
export default function App() {
  const [name, setName] = useState(() => localStorage.getItem("st_name") || "");
  const [avatar, setAvatar] = useState(() => {
    const saved = localStorage.getItem("st_avatar");
    return AVATARS.includes(saved) ? saved : AVATARS[0];
  });
  const [session, setSession] = useState(loadSession);
  const [room, setRoom] = useState(null);
  const [question, setQuestion] = useState(null);
  const [myChoice, setMyChoice] = useState(null);
  const [answeredCount, setAnsweredCount] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [final, setFinal] = useState(null);
  const [starting, setStarting] = useState(false);
  const [picked, setPicked] = useState({ sources: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);
  const [rejoining, setRejoining] = useState(!!loadSession());

  const initialCode = new URLSearchParams(window.location.search).get("room")?.toUpperCase() || "";
  const isHost = !!room && !!session && room.hostId === session.playerId;

  const showToast = (m) => {
    setToast(m);
    setTimeout(() => setToast(""), 4000);
  };
  const {
    status: playerStatus,
    ref: playerRef,
    volume,
    muted,
    setVolume,
    toggleMute,
  } = usePlayer(true, showToast);

  useEffect(() => localStorage.setItem("st_name", name), [name]);
  useEffect(() => localStorage.setItem("st_avatar", avatar), [avatar]);

  useEffect(() => {
    const unlockOnFirstInteraction = () => {
      playerRef.current?.activate();
      window.removeEventListener("pointerdown", unlockOnFirstInteraction);
      window.removeEventListener("keydown", unlockOnFirstInteraction);
    };
    window.addEventListener("pointerdown", unlockOnFirstInteraction);
    window.addEventListener("keydown", unlockOnFirstInteraction);
    return () => {
      window.removeEventListener("pointerdown", unlockOnFirstInteraction);
      window.removeEventListener("keydown", unlockOnFirstInteraction);
    };
  }, []);

  const chooseAvatar = (nextAvatar) => {
    if (!AVATARS.includes(nextAvatar)) return;
    setAvatar(nextAvatar);
    if (room && session) socket.emit("player:avatar", { avatar: nextAvatar });
  };

  const resetGameState = () => {
    setQuestion(null);
    setReveal(null);
    setFinal(null);
    setMyChoice(null);
    setAnsweredCount(null);
    setStarting(false);
  };

  const leaveLocal = (msg) => {
    clearSession();
    setSession(null);
    setRoom(null);
    setPicked({ sources: [] });
    resetGameState();
    if (msg) setError(msg);
  };

  // ----- socket events -----
  useEffect(() => {
    const tryRejoin = () => {
      const s = loadSession();
      if (!s) return setRejoining(false);
      socket.emit("room:rejoin", s, (res) => {
        setRejoining(false);
        if (!res?.ok) {
          clearSession();
          setSession(null);
          setRoom(null);
          return;
        }
        setSession(s);
        setRoom(res.room);
        if (res.question) {
          setQuestion({ ...res.question, offset: res.question.serverNow - Date.now() });
          setMyChoice(res.answered);
        }
      });
    };
    socket.on("connect", tryRejoin);
    if (socket.connected) tryRejoin();

    socket.on("room:update", setRoom);
    socket.on("game:starting", () => {
      resetGameState();
      setStarting(true);
    });
    socket.on("question", (q) => {
      setStarting(false);
      setReveal(null);
      setFinal(null);
      setMyChoice(null);
      setAnsweredCount(0);
      setQuestion({ ...q, offset: q.serverNow - Date.now() });
    });
    socket.on("question:play", ({ previewUrl, positionMs }) => playerRef.current?.play(previewUrl, positionMs));
    socket.on("answer:count", ({ answered, total }) => setAnsweredCount(`${answered}/${total}`));
    socket.on("reveal", (r) => {
      playerRef.current?.pause();
      setReveal(r);
    });
    socket.on("finished", (f) => {
      setFinal(f);
      setReveal(null);
      setQuestion(null);
      playerRef.current?.pause();
    });
    socket.on("game:reset", () => {
      resetGameState();
      playerRef.current?.pause();
    });
    socket.on("kicked", () => leaveLocal("คุณถูกเชิญออกจากห้อง"));
    socket.on("room:closed", () => leaveLocal("host ปิดห้องแล้ว"));
    return () => socket.removeAllListeners();
  }, []);

  // ----- actions -----
  const enter = (res) => {
    const s = { code: res.code, playerId: res.playerId, token: res.token };
    saveSession(s);
    setSession(s);
    setRoom(res.room);
    resetGameState();
    window.history.replaceState({}, "", "/");
  };

  const create = () => {
    playerRef.current?.activate();
    setBusy(true);
    setError("");
    socket.emit("room:create", { name: name.trim(), avatar, settings: {} }, (res) => {
      setBusy(false);
      res?.ok ? enter(res) : setError(res?.error || "สร้างห้องไม่สำเร็จ");
    });
  };

  const join = (code) => {
    playerRef.current?.activate();
    setBusy(true);
    setError("");
    socket.emit("room:join", { code, name: name.trim(), avatar }, (res) => {
      setBusy(false);
      res?.ok ? enter(res) : setError(res?.error || "เข้าห้องไม่สำเร็จ");
    });
  };

  const leave = () => {
    if (isHost && !window.confirm("ออกจากห้องจะปิดห้องสำหรับทุกคน ยืนยัน?")) return;
    socket.emit("room:leave");
    leaveLocal();
  };

  const answer = (choice) => {
    if (myChoice !== null || !question) return;
    setMyChoice(choice);
    socket.emit("answer", { index: question.index, choice });
  };

  const copyLink = async () => {
    const link = `${window.location.origin}/?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("คัดลอกลิงก์นี้ส่งให้เพื่อน", link);
    }
  };

  // ----- views -----
  if (rejoining) return <div className="center muted">กำลังเชื่อมต่อ…</div>;

  if (!room || !session) {
    return (
      <Home
        name={name}
        setName={setName}
        avatar={avatar}
        setAvatar={chooseAvatar}
        busy={busy}
        error={error}
        initialCode={initialCode}
        onCreate={create}
        onJoin={join}
      />
    );
  }

  const meId = session.playerId;
  const me = room.players.find((p) => p.id === meId);
  const phase = room.phase;

  return (
    <div className="room">
      {!(isHost && phase === "lobby") && <header className="top">
        <div>
          <span className="muted small">รหัสห้อง</span>
          <div className="roomcode">{room.code}</div>
        </div>
        <div className="top-actions">
          <button className="btn small" onClick={copyLink}>
            {copied ? "คัดลอกแล้ว ✓" : "คัดลอกลิงก์เชิญ"}
          </button>
          <button className="btn small ghost" onClick={leave}>
            ออก
          </button>
        </div>
      </header>}

      {toast && <div className="toast">{toast}</div>}

      {room && (
        <VolumeControl
          volume={volume}
          muted={muted}
          ready={playerStatus === "ready"}
          setVolume={setVolume}
          toggleMute={toggleMute}
        />
      )}

      {starting && (
        <div className="center big-msg">
          <div className="pulse">🎧</div>
          <h2>เกมกำลังเริ่ม…</h2>
          <p className="muted">เตรียมหูให้พร้อม!</p>
        </div>
      )}

      {!starting && phase === "lobby" && (
        <div className="lobby-grid">
          <aside className="player-panel">
          <section className="card">
            <h2>ผู้เล่นในห้อง ({room.players.length})</h2>
            <AvatarPicker value={me?.avatar || avatar} onChange={chooseAvatar} compact />
            <ul className="players">
              {room.players.map((p) => (
                <li key={p.id} className={(p.id === meId ? "me " : "") + (p.connected ? "" : "off")}>
                  <span className="player-avatar"><img src={avatarUrl(p.avatar)} alt={`${p.name} avatar`} /></span>
                  <span>
                    {p.name}
                    {p.isHost && <em className="badge">host</em>}
                    {p.id === meId && <em className="badge you">คุณ</em>}
                  </span>
                  {isHost && !p.isHost && (
                    <button className="x" title="เชิญออก" onClick={() => socket.emit("room:kick", { id: p.id })}>
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          </aside>
          <div className="lobby-content">
          {isHost ? (
            <HostSetup
              room={room}
              picked={picked}
              setPicked={setPicked}
              playerStatus={playerStatus}
              playerRef={playerRef}
              onCopyLink={copyLink}
              onLeave={leave}
            />
          ) : (
            <>
            <section className="card center-text">
              <div className="pulse">⏳</div>
              <h2>รอ host เริ่มเกม</h2>
              <p className="muted">
                เพลย์ลิสต์: {room.playlistName || "ยังไม่ได้เลือก"} · {room.settings.rounds} ข้อ ·{" "}
                {room.settings.seconds} วินาที/ข้อ
              </p>
            </section>
            {room.playlists?.length > 0 && <section className="shared-playlists">
              <h3>Playlist selected by host</h3>
              <div className="shared-playlist-list">
                {room.playlists.map((playlist, index) => <div className="shared-playlist" key={playlist.name + index}>
                  {playlist.cover ? <img src={playlist.cover} alt="" /> : <span className="shared-playlist-icon">♫</span>}
                  <span><strong>{playlist.name}</strong><small>{playlist.trackCount} preview tracks</small></span>
                  <b>✓</b>
                </div>)}
              </div>
            </section>}
            </>
          )}
          </div>
        </div>
      )}

      {!starting && phase === "question" && question && (
        <div className="game-layout">
          <main className="game-main stack">
          <div className="qhead game-qhead">
            <span>
              ข้อ {question.index + 1}/{question.total}
            </span>
            <span className="muted">ตอบแล้ว {answeredCount ?? "0"}</span>
          </div>
          <Timer endsAt={question.endsAt} offset={question.offset} seconds={question.seconds} />
          <div className="listen">
            <div className="eq">
              <i /> <i /> <i /> <i />
            </div>
            <h2>เพลงอะไรเอ่ย?</h2>
            <p className="muted small">
              {isHost ? "เพลงกำลังเล่นจากเครื่องของคุณ" : "ฟังเสียงจากเครื่องของ host"}
            </p>
          </div>
          <div className="options">
            {question.options.map((o, i) => (
              <button
                key={i}
                className={"opt o" + i + (myChoice === i ? " chosen" : "") + (myChoice !== null && myChoice !== i ? " dim" : "")}
                disabled={myChoice !== null}
                onClick={() => answer(i)}
              >
                <b>{SHAPES[i]}</b>
                <span>{o}</span>
              </button>
            ))}
          </div>
          {myChoice !== null && <p className="center-text muted">ล็อกคำตอบแล้ว รอคนอื่น…</p>}
          {isHost && (
            <button className="btn ghost" onClick={() => socket.emit("game:skip")}>
              จบข้อนี้เลย
            </button>
          )}
          </main>
          <aside className="game-score-panel card">
            <div className="score-panel-heading"><div><span className="eyebrow">LIVE SCORE</span><h2>อันดับคะแนน</h2></div><span className="live-dot">LIVE</span></div>
            <div className="my-score-card"><span>คะแนนของคุณ</span><strong>{(me?.score || 0).toLocaleString()}</strong><small>คะแนนสะสม</small></div>
            <Leaderboard list={room.players} meId={meId} compact />
            <p className="score-live-hint">คะแนนจะปรับตามคำตอบถูก และอันดับอาจเปลี่ยนจนกว่าจะเฉลย</p>
          </aside>
        </div>
      )}

      {!starting && phase === "reveal" && reveal && (
        <div className="stack">
          <div className="qhead">
            <span>
              เฉลยข้อ {reveal.index + 1}
            </span>
          </div>
          <div className="trackcard">
            {reveal.track.cover && <img src={reveal.track.cover} alt="" />}
            <div>
              <h2>{reveal.track.title}</h2>
              <p className="muted">{reveal.track.artist}</p>
            </div>
          </div>
          {(() => {
            const r = reveal.results.find((x) => x.id === meId);
            if (!r) return null;
            const gain = me?.lastGain || 0;
            return (
              <div className={"verdict " + (r.correct ? "ok" : "no")}>
                {r.correct ? `ถูกต้อง! +${gain}` : r.choice === null ? "ไม่ได้ตอบ" : "ผิดนะ"}
              </div>
            );
          })()}
          <section className="answer-results card">
            <h3>เวลาตอบและคะแนนรอบนี้</h3>
            <ol>
              {[...reveal.results].sort((a, b) => {
                const group = (item) => item.correct ? 0 : item.choice === null ? 2 : 1;
                return group(a) - group(b) || (a.responseSeconds ?? Infinity) - (b.responseSeconds ?? Infinity);
              }).map((result) => (
                <li key={result.id} className={result.correct ? "correct" : result.choice === null ? "unanswered" : "incorrect"}>
                  <span className="answer-rank">{result.correct ? `#${result.answerRank}` : "–"}</span>
                  <strong>{result.name || room.players.find((player) => player.id === result.id)?.name || "Player"}</strong>
                  <span className="answer-time">{result.responseSeconds === null ? "ไม่ตอบ" : `${result.responseSeconds.toFixed(2)} วินาที`}</span>
                  <b>{result.correct ? `ถูก +${result.points}` : result.choice === null ? "—" : "ผิด +0"}</b>
                </li>
              ))}
            </ol>
          </section>
          <div className="options small-opts">
            {question?.options?.map((o, i) => (
              <div
                key={i}
                className={"opt o" + i + (i === reveal.correctIndex ? " correct" : " dim") + (myChoice === i && i !== reveal.correctIndex ? " wrong" : "")}
              >
                <b>{SHAPES[i]}</b>
                <span>{o}</span>
              </div>
            ))}
          </div>
          <Leaderboard list={reveal.leaderboard} meId={meId} compact />
          {isHost ? (
            <button className="btn primary big" onClick={() => socket.emit("game:skip")}>
              {reveal.isLast ? "ดูผลสุดท้าย" : "ข้อต่อไป →"}
            </button>
          ) : (
            <p className="center-text muted">กำลังไปข้อต่อไปอัตโนมัติ…</p>
          )}
        </div>
      )}

      {!starting && phase === "finished" && (
        <div className="stack">
          <div className="center-text">
            <div className="trophy">🏆</div>
            <h2>จบเกม!</h2>
            {(() => {
              const lb = final?.leaderboard || room.players;
              const w = lb[0];
              return w ? (
                <p>
                  ผู้ชนะคือ <strong>{w.name}</strong> ({w.score.toLocaleString()} คะแนน)
                </p>
              ) : null;
            })()}
          </div>
          <Leaderboard list={final?.leaderboard || room.players} meId={meId} />
          {isHost ? (
            <div className="row">
              <button className="btn primary big" onClick={() => socket.emit("game:reset")}>
                เล่นอีกรอบ
              </button>
            </div>
          ) : (
            <p className="center-text muted">รอ host เริ่มรอบใหม่ หรือกด "ออก" เพื่อกลับหน้าแรก</p>
          )}
        </div>
      )}
    </div>
  );
}
