import { useState } from "react";
import { socket } from "../../socket.js";

const MAP_KEY = import.meta.env.VITE_GOOGLE_MAPS_MAP_KEY || import.meta.env.VITE_GOOGLE_MAPS_MAPS_KEY || "";

const PACKS = [
  { id: "world", title: "World Mix", icon: "🌍", text: "A mix of cities and regions around the world." },
  { id: "famous", title: "Famous Places", icon: "🏛️", text: "Recognizable landmarks and popular destinations." },
  { id: "thailand", title: "Thailand", icon: "🇹🇭", text: "Explore destinations across Thailand." },
];

export default function HostSetup({ room }) {
  const [error, setError] = useState("");
  const [area, setArea] = useState("");
  const [starting, setStarting] = useState(false);
  const setSettings = (settings) => socket.emit("room:settings", { gameId: "geo-guessr", settings });
  const start = async () => {
    setError("");
    setStarting(true);
    try {
      let selectedArea = null;
      if (area.trim()) {
        if (!MAP_KEY) throw new Error("Add your Google Maps JavaScript key before searching an area.");
        const address = area.trim();
        const url = `https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(address)}?key=${encodeURIComponent(MAP_KEY)}&languageCode=th&regionCode=TH&fields=${encodeURIComponent("results.formattedAddress,results.location,results.viewport,results.bounds")}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Could not search for that area. Check that Geocoding API is allowed for this key.");
        const result = data.results?.[0];
        const extent = result?.bounds || result?.viewport;
        if (!result || !extent?.low || !extent?.high) throw new Error("No area boundary was found. Try adding the city and country, such as “Ramkhamhaeng, Bangkok, Thailand”.");
        selectedArea = {
          label: result.formattedAddress || address,
          bounds: { south: extent.low.latitude, west: extent.low.longitude, north: extent.high.latitude, east: extent.high.longitude },
        };
      }
      socket.emit("geo:start", { pack: room.settings.geoPack, area: selectedArea }, (result) => {
        setStarting(false);
        if (!result?.ok) setError(result?.error || "Could not start the game.");
      });
    } catch (cause) {
      setStarting(false);
      setError(cause.message || "Could not find that area.");
    }
  };
  return <div className="geo-setup stack">
    <header className="setup-header"><div className="brand-mark"><span>WORLD</span><strong>GUESS</strong></div><nav className="step-flow" aria-label="Game setup progress"><span className="complete">🌍 <i>Choose game</i></span><b>→</b><span className="current">⚙ <i>Configure</i></span><b>→</b><span>▣ <i>Play</i></span></nav><span className="badge">PRIVATE ROOM</span></header>
    <section className="card geo-pack-section"><div><span className="eyebrow">LOCATION PACKS</span><h2>Choose your world</h2><p className="muted">Everyone gets the same randomly selected locations from this pack. A searched area overrides the pack for this game.</p></div><div className="geo-pack-grid">{PACKS.map((pack) => <button type="button" key={pack.id} className={`geo-pack-card${(room.settings.geoPack || "world") === pack.id ? " active" : ""}`} aria-pressed={(room.settings.geoPack || "world") === pack.id} onClick={() => setSettings({ geoPack: pack.id })}><span className="geo-pack-icon">{pack.icon}</span><strong>{pack.title}</strong><small>{pack.text}</small></button>)}</div></section>
    <section className="card geo-area-section"><div><span className="eyebrow">OPTIONAL AREA SEARCH</span><h2>Play around a specific area</h2><p className="muted">Search a neighborhood or place to draw all round locations from its Google boundary. Leave empty to use the selected pack.</p></div><label className="field"><span>Area name</span><input className="input" value={area} onChange={(event) => setArea(event.target.value)} placeholder="Ramkhamhaeng, Bangkok, Thailand" /></label><small className="geo-area-note">Street View finds the nearest panorama to each random point inside the area.</small></section>
    <section className="card settings-card"><div><span className="eyebrow">GAME RULES</span><h2>Set up your game</h2><p className="muted">Each round has one Street View location. Everyone guesses on their own map.</p></div><div className="row">
      <label className="field"><span>Locations</span><select value={room.settings.rounds} onChange={(e) => setSettings({ rounds: Number(e.target.value) })}>{[3, 5, 10, 15].map((n) => <option key={n} value={n}>{n} locations</option>)}</select></label>
      <label className="field"><span>Time per location</span><select value={room.settings.seconds} onChange={(e) => setSettings({ seconds: Number(e.target.value) })}>{[30, 60, 90, 120].map((n) => <option key={n} value={n}>{n} seconds</option>)}</select></label>
    </div></section>
    <section className="card geo-info"><span className="eyebrow">HOW TO PLAY</span><ol><li>Explore the Street View panorama and look for clues.</li><li>Place a pin on the world map before time runs out.</li><li>Get up to 5,000 points for a close guess. See the reveal and leaderboard after each location.</li></ol>{!MAP_KEY && <p className="geo-key-note">Add your Google Maps JavaScript API key as <code>VITE_GOOGLE_MAPS_MAP_KEY</code>, then restart the app. Enable Maps JavaScript API and Dynamic Street View for this key.</p>}</section>
    {error && <div className="alert">{error}</div>}<button className="btn primary big" disabled={starting} onClick={start}>{starting ? "Searching area…" : `Start with ${room.players.length} player${room.players.length === 1 ? "" : "s"}`}</button>
  </div>;
}
