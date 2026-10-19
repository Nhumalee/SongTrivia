import { useEffect, useRef, useState } from "react";
import { socket } from "../../socket.js";

const EMBED_KEY = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY || "";
function GeoMap({ guess, onGuess, answer }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef(null);
  const callbackRef = useRef({ onGuess, answer });
  const [ready, setReady] = useState(false);
  callbackRef.current = { onGuess, answer };

  useEffect(() => {
    const cssId = "leaflet-css";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId; link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    let disposed = false;
    const init = () => {
      if (disposed || !containerRef.current || !window.L || mapRef.current) return;
      const L = window.L;
      const map = L.map(containerRef.current, { worldCopyJump: true, minZoom: 2 }).setView([20, 0], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      }).addTo(map);
      layersRef.current = L.layerGroup().addTo(map);
      map.on("click", (event) => {
        const current = callbackRef.current;
        if (!current.answer) current.onGuess({ lat: event.latlng.lat, lng: event.latlng.lng });
      });
      mapRef.current = map;
      setReady(true);
      setTimeout(() => map.invalidateSize(), 0);
    };
    if (window.L) init();
    else {
      let script = document.getElementById("leaflet-js");
      if (!script) {
        script = document.createElement("script");
        script.id = "leaflet-js"; script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; script.async = true;
        document.body.appendChild(script);
      }
      script.addEventListener("load", init);
    }
    return () => { disposed = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    const L = window.L;
    if (!ready || !map || !layers || !L) return;
    layers.clearLayers();
    if (guess) L.circleMarker([guess.lat, guess.lng], { radius: 8, color: "#1f2937", weight: 2, fillColor: "#f4cf61", fillOpacity: 1 }).addTo(layers);
    if (answer) {
      L.circleMarker([answer.lat, answer.lng], { radius: 8, color: "#fff", weight: 2, fillColor: "#ff765f", fillOpacity: 1 }).addTo(layers);
      if (guess) {
        L.polyline([[guess.lat, guess.lng], [answer.lat, answer.lng]], { color: "#e9a93b", dashArray: "6 6", weight: 2 }).addTo(layers);
        map.fitBounds([[guess.lat, guess.lng], [answer.lat, answer.lng]], { padding: [32, 32], maxZoom: 7 });
      } else map.setView([answer.lat, answer.lng], 4);
    } else if (guess) map.panTo([guess.lat, guess.lng]);
  }, [guess, answer, ready]);

  return <div className="geo-map-wrap"><div ref={containerRef} className="geo-map" role="application" aria-label="Click the map to place your guess." /><div className="geo-map-hint">{answer ? "Actual location and your guess" : guess ? "Click the map to move your pin" : "Click the map to place your guess"} · © OpenStreetMap</div></div>;
}

function Countdown({ endsAt, serverOffset, seconds }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - (Date.now() + serverOffset)) / 1000)));
    tick(); const id = setInterval(tick, 200); return () => clearInterval(id);
  }, [endsAt, serverOffset]);
  return <div className={"geo-timer" + (left <= 10 ? " low" : "")}><span style={{ width: Math.max(0, left / seconds * 100) + "%" }} /><b>{left}s</b></div>;
}

export default function GeoGame({ room, meId, isHost }) {
  const [guess, setGuess] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const reportedLoads = useRef(new Set());
  const round = room.geoRound;
  const reveal = room.geoReveal;
  const key = EMBED_KEY.trim();
  const embedUrl = key && round ? "https://www.google.com/maps/embed/v1/streetview?" + new URLSearchParams({
    key, location: round.lat + "," + round.lng, heading: String(round.heading || 0), pitch: "0", fov: "90", source: "outdoor",
  }) : "";
  useEffect(() => { setGuess(null); setSubmitted(false); }, [round?.index]);
  const reportPanoramaLoad = () => {
    if (!round || reportedLoads.current.has(round.index)) return;
    reportedLoads.current.add(round.index);
    socket.emit("geo:panorama-loaded", { roundIndex: round.index });
  };
  const myResult = reveal?.results?.find((result) => result.id === meId);
  const usage = room.geoUsage || { loads: 0, month: "", provider: "Google Maps Embed" };
  const packNames = { world: "World Mix", famous: "Famous Places", thailand: "Thailand" };
  return <main className="geo-game">
    <header className="geo-round-header"><div><span className="eyebrow">WORLD GUESS</span><h1>Round {(round?.index || 0) + 1} <small>/ {room.settings.rounds}</small></h1></div>
      {room.phase === "geo-playing" && round && <Countdown endsAt={round.endsAt} serverOffset={round.serverNow - Date.now()} seconds={round.seconds} />}
      <span className="geo-submitted">{reveal ? "Round results" : (room.geoAnswered || 0) + "/" + room.players.filter((p) => p.connected).length + " guessed"}</span></header>
    <div className="geo-play-grid"><section className="geo-panorama">
      {embedUrl ? <iframe title="Google Maps Street View" src={embedUrl} onLoad={reportPanoramaLoad} allowFullScreen loading="eager" referrerPolicy="strict-origin-when-cross-origin" /> :
        <div className="geo-panorama-empty"><span>🌍</span><h2>Street View is ready to connect</h2><p>Add your Google Maps Embed API key to <code>VITE_GOOGLE_MAPS_EMBED_KEY</code>, then restart the app.</p></div>}
    </section><section className="geo-guess-panel"><h2>{reveal ? "Round result" : "Where are you?"}</h2>
      <GeoMap guess={guess} onGuess={setGuess} answer={reveal?.location} />
      {reveal ? <div className="geo-result-card"><strong>{myResult ? "+" + myResult.points.toLocaleString() + " points" : "Round complete"}</strong><span>{myResult ? myResult.distanceKm.toLocaleString() + " km away" : "No guess submitted"}</span>{isHost && <button className="btn primary" onClick={() => socket.emit("geo:next")}>{reveal.isLast ? "Show final scores" : "Next round →"}</button>}</div> :
        <div className="geo-submit-row"><span>{guess ? guess.lat.toFixed(2) + ", " + guess.lng.toFixed(2) : "Select a spot on the map"}</span><button className="btn primary" disabled={!guess || submitted || room.phase !== "geo-playing"} onClick={() => { setSubmitted(true); socket.emit("geo:guess", guess); }}>{submitted ? "Guess locked" : "Make guess"}</button></div>}
    </section></div>
    <section className="geo-usage card" aria-label="Street View usage estimate"><div><span className="eyebrow">STREET VIEW USAGE</span><strong>{usage.loads.toLocaleString()} loads</strong><small>{packNames[room.settings.geoPack] || "World Mix"} · this server · {usage.month}</small></div><div className="geo-usage-note"><b>Google Maps Embed API</b><span>No fixed monthly usage cap. Counter is an estimate and resets if the game server restarts.</span></div></section>
    {reveal && <section className="card geo-score-list"><h2>Round leaderboard</h2><ol>{reveal.results.map((result) => <li key={result.id}><strong>{room.players.find((p) => p.id === result.id)?.name || "Player"}</strong><span>{result.distanceKm === null ? "No guess" : result.distanceKm.toLocaleString() + " km"}</span><b>+{result.points.toLocaleString()}</b></li>)}</ol></section>}
  </main>;
}
