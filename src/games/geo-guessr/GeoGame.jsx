import { useEffect, useRef, useState } from "react";
import { socket } from "../../socket.js";

const MAP_KEY = import.meta.env.VITE_GOOGLE_MAPS_MAP_KEY || import.meta.env.VITE_GOOGLE_MAPS_MAPS_KEY || "";
const PACK_NAMES = { world: "World", famous: "Famous Places", thailand: "Thailand" };

function loadGoogleMaps() {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!window.__geoGoogleMapsPromise) window.__geoGoogleMapsPromise = new Promise((resolve, reject) => {
    window.gm_authFailure = () => window.dispatchEvent(new Event("geo-google-auth-failure"));
    const script = document.createElement("script");
    const timeout = setTimeout(() => reject(new Error("Google Maps did not load")), 15000);
    script.id = "geo-google-maps-js";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAP_KEY)}&v=weekly&loading=async`;
    script.async = true;
    script.onload = () => { clearTimeout(timeout); resolve(window.google.maps); };
    script.onerror = () => { clearTimeout(timeout); reject(new Error("Google Maps failed to load")); };
    document.head.appendChild(script);
  });
  return window.__geoGoogleMapsPromise;
}

function GeoMap({ guess, onGuess, answer, compact = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const googleObjectsRef = useRef(null);
  const googleFallbackClickRef = useRef(null);
  const callbackRef = useRef({ onGuess, answer });
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");
  callbackRef.current = { onGuess, answer };

  useEffect(() => {
    let disposed = false;
    const markGoogleFailed = () => {
      setMapError("Google Maps rejected this API key or website address.");
    };
    window.addEventListener("geo-google-auth-failure", markGoogleFailed);
    if (!MAP_KEY) {
      setMapError("Add VITE_GOOGLE_MAPS_MAP_KEY to .env and restart Vite.");
    } else loadGoogleMaps().then((google) => {
      if (disposed || !containerRef.current || mapRef.current) return;
      const map = new google.Map(containerRef.current, { center: { lat: 20, lng: 0 }, zoom: 2, minZoom: 2, clickableIcons: false, streetViewControl: false, mapTypeControl: false, fullscreenControl: false, gestureHandling: "greedy" });
      let lastMapClick = 0;
      // Some Maps Demo Key/browser combinations swallow the Maps click event.
      // Convert a plain container click to coordinates as a fallback in that case.
      const mapElement = containerRef.current;
      const fallbackClick = (event) => setTimeout(() => {
        if (Date.now() - lastMapClick < 100 || disposed || callbackRef.current.answer || !callbackRef.current.onGuess) return;
        const projection = map.getProjection();
        const center = map.getCenter();
        const zoom = map.getZoom();
        if (!projection || !center || zoom == null) return;
        const rect = mapElement.getBoundingClientRect();
        const centerPoint = projection.fromLatLngToPoint(center);
        const scale = 2 ** zoom;
        const point = new google.Point(
          centerPoint.x + (event.clientX - rect.left - rect.width / 2) / scale,
          centerPoint.y + (event.clientY - rect.top - rect.height / 2) / scale,
        );
        const latLng = projection.fromPointToLatLng(point);
        if (latLng) callbackRef.current.onGuess({ lat: latLng.lat(), lng: latLng.lng() });
      }, 120);
      mapElement.addEventListener("click", fallbackClick);
      googleFallbackClickRef.current = fallbackClick;
      mapRef.current = map;
      googleObjectsRef.current = { google, markers: [], line: null, clickListener: null };
      googleObjectsRef.current.clickListener = google.event.addListener(map, "click", (event) => {
        const current = callbackRef.current;
        if (!current.answer && current.onGuess && event.latLng) {
          lastMapClick = Date.now();
          current.onGuess({ lat: event.latLng.lat(), lng: event.latLng.lng() });
        }
      });
      setReady(true);
      setMapError("");
    }).catch((error) => { if (!disposed) { console.error(error); setMapError("Google Maps could not load. Check the API key and restrictions."); } });
    return () => {
      disposed = true;
      window.removeEventListener("geo-google-auth-failure", markGoogleFailed);
      if (googleObjectsRef.current) {
        googleObjectsRef.current.markers.forEach((marker) => marker.setMap(null));
        googleObjectsRef.current.line?.setMap(null);
        googleObjectsRef.current.google.event.removeListener(googleObjectsRef.current.clickListener);
        if (containerRef.current && googleFallbackClickRef.current) containerRef.current.removeEventListener("click", googleFallbackClickRef.current);
        googleFallbackClickRef.current = null;
        mapRef.current?.unbindAll();
      }
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const googleObjects = googleObjectsRef.current;
    if (ready && map && googleObjects) {
      const { google } = googleObjects;
      googleObjects.markers.forEach((marker) => marker.setMap(null));
      googleObjects.markers = [];
      googleObjects.line?.setMap(null);
      googleObjects.line = null;
      const addMarker = (point, color, title) => googleObjects.markers.push(new google.Marker({ map, position: point, title, icon: { path: google.SymbolPath.CIRCLE, scale: compact ? 6 : 8, fillColor: color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 } }));
      if (guess) addMarker(guess, "#b8e34b", "Your guess");
      if (answer) {
        addMarker(answer, "#ff765f", "Correct location");
        if (guess) {
          googleObjects.line = new google.Polyline({ map, path: [guess, answer], strokeColor: "#72a837", strokeOpacity: .9, strokeWeight: 3 });
          const bounds = new google.LatLngBounds(); bounds.extend(guess); bounds.extend(answer); map.fitBounds(bounds, 32);
        } else { map.setCenter(answer); map.setZoom(4); }
      } else if (guess) map.panTo(guess);
      return;
    }
    if (!ready || !map || !googleObjects) return;
  }, [guess, answer, ready, compact]);

  return <div className={`geo-map-wrap${compact ? " compact" : ""}`}>
    <div className="geo-map-title"><strong>WORLD MAP</strong><span>Countries &amp; place names</span></div>
    <div ref={containerRef} className="geo-map" role="application" aria-label="Click the map to place or move your guess." />
    {mapError && <div className="geo-map-error" role="status"><strong>Google Maps unavailable</strong><span>{mapError}</span><small>Allow http://127.0.0.1:5173/* and http://localhost:5173/* in HTTP referrer restrictions, and enable Maps JavaScript API.</small></div>}
    {!mapError && !ready && <div className="geo-map-loading" role="status">Loading Google Maps…</div>}
    <div className="geo-map-hint">{answer ? "Actual location and your latest pin" : guess ? "Click anywhere to move your pin" : "Click the map to place your pin"} · Google Maps</div>
  </div>;
}

function StreetView({ round, onLoad }) {
  const containerRef = useRef(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let panorama;
    let listeners = [];
    let reported = false;
    const markGoogleFailed = () => setError("Google Maps rejected this API key or website address.");
    window.addEventListener("geo-google-auth-failure", markGoogleFailed);

    if (!MAP_KEY) {
      setError("Add VITE_GOOGLE_MAPS_MAP_KEY to .env and restart Vite.");
    } else {
      loadGoogleMaps().then((google) => {
        if (disposed || !containerRef.current) return;
        if (!google.StreetViewPanorama) {
          setError("Street View is unavailable. Enable Maps JavaScript API and Dynamic Street View for this key.");
          return;
        }
        panorama = new google.StreetViewPanorama(containerRef.current, {
          position: { lat: round.lat, lng: round.lng },
          pov: { heading: round.heading || 0, pitch: 0 },
          zoom: 1,
          addressControl: false,
          panControl: true,
          zoomControl: true,
          linksControl: true,
          clickToGo: true,
          fullscreenControl: true,
          motionTrackingControl: false,
          enableCloseButton: false,
          visible: true,
        });
        listeners = [
          google.event.addListener(panorama, "status_changed", () => {
            const status = panorama.getStatus?.();
            if (status === google.StreetViewStatus?.OK) {
              setLoading(false);
              setError("");
              if (!reported) {
                reported = true;
                onLoad();
              }
            } else if (status) {
              setLoading(false);
              setError(`Street View could not load this location (${status}).`);
            }
          }),
        ];
      }).catch((cause) => {
      if (!disposed) setError(cause.message || "Google Maps could not load. Check the API key and restrictions.");
      if (!disposed) setLoading(false);
      });
    }

    return () => {
      disposed = true;
      window.removeEventListener("geo-google-auth-failure", markGoogleFailed);
      if (window.google?.maps?.event) listeners.forEach((listener) => window.google.maps.event.removeListener(listener));
      panorama?.setVisible(false);
    };
  }, [round?.index]);

  return <>
    <div ref={containerRef} className="geo-street-view" aria-label="Google Street View panorama" />
    {error && <div className="geo-street-error" role="status"><strong>Street View unavailable</strong><span>{error}</span><small>Allow http://127.0.0.1:5173/* and http://localhost:5173/* in HTTP referrer restrictions. Enable Maps JavaScript API and Dynamic Street View.</small></div>}
    {!error && loading && <div className="geo-panorama-loading" role="status">Loading Street View…</div>}
  </>;
}

function Countdown({ endsAt, serverOffset, seconds }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - (Date.now() + serverOffset)) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [endsAt, serverOffset, seconds]);
  const pct = Math.max(0, left / seconds * 100);
  return <div className={`geo-countdown${left <= 10 ? " low" : ""}`} aria-label={`${left} seconds remaining`}>
    <div className="geo-countdown-track"><i style={{ width: `${pct}%` }} /></div>
    <strong>{left}<small>s</small></strong>
  </div>;
}

function RoundRecap({ room, meId, isHost, guess, reveal }) {
  const myResult = reveal.results.find((result) => result.id === meId);
  const finalGuess = myResult?.guess || guess;
  const sortedResults = [...reveal.results].sort((a, b) => b.points - a.points || (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  return <main className="geo-recap">
    <header className="geo-recap-heading"><span className="eyebrow">ROUND {(reveal.index ?? 0) + 1} / {room.settings.rounds} · ANSWER REVEALED</span><h1>Round summary</h1><p>See the correct location, compare your guess, and check the scores.</p></header>
    <div className="geo-recap-grid">
      <section className="geo-recap-map"><GeoMap guess={finalGuess} answer={reveal.location} /></section>
      <aside className="geo-recap-results">
        <div className="geo-recap-answer"><span className="eyebrow">THE LOCATION</span><strong>{reveal.location.label || PACK_NAMES[room.settings.geoPack] || "Mystery location"}</strong><small>{reveal.location.lat.toFixed(4)}, {reveal.location.lng.toFixed(4)}</small></div>
        <div className="geo-recap-personal"><div><span className="eyebrow">YOUR ROUND SCORE</span><strong>+{myResult?.points.toLocaleString() || "0"}</strong></div><div><span className="eyebrow">DISTANCE</span><strong>{myResult?.distanceKm == null ? "No guess" : `${myResult.distanceKm.toLocaleString()} km`}</strong></div></div>
        <div className="geo-recap-total"><span>Total score</span><strong>{room.players.find((player) => player.id === meId)?.score.toLocaleString() || "0"}</strong></div>
        <section className="geo-round-results"><h2>Round leaderboard</h2><ol>{sortedResults.map((result, index) => <li key={result.id} className={result.id === meId ? "me" : ""}><span className="geo-live-rank">{index + 1}</span><strong>{room.players.find((player) => player.id === result.id)?.name || "Player"}</strong><span>{result.distanceKm == null ? "No guess" : `${result.distanceKm.toLocaleString()} km`}</span><b>+{result.points.toLocaleString()}</b></li>)}</ol></section>
        {isHost ? <button className="btn primary big geo-next-round" onClick={() => socket.emit("geo:next")}>{reveal.isLast ? "Show final scores" : "Next location"} {!reveal.isLast && <span>→</span>}</button> : <p className="geo-wait-host">Waiting for the host to continue…</p>}
      </aside>
    </div>
  </main>;
}

export default function GeoGame({ room, privateGeoRound, meId, isHost }) {
  const [guess, setGuess] = useState(null);
  const [guessSubmitted, setGuessSubmitted] = useState(false);
  const reportedLoads = useRef(new Set());
  const round = privateGeoRound && room.geoRound && privateGeoRound.index === room.geoRound.index ? { ...room.geoRound, ...privateGeoRound } : null;
  const reveal = room.geoReveal;

  useEffect(() => { setGuess(null); setGuessSubmitted(false); }, [round?.index]);
  const updateGuess = (nextGuess) => {
    if (guessSubmitted || room.phase !== "geo-playing") return;
    setGuess(nextGuess);
  };
  const confirmGuess = () => {
    if (!guess || guessSubmitted || room.phase !== "geo-playing") return;
    setGuessSubmitted(true);
    socket.emit("geo:guess", guess, (result) => {
      if (!result?.ok) setGuessSubmitted(false);
    });
  };
  const reportPanoramaLoad = () => {
    if (!round || reportedLoads.current.has(round.index)) return;
    reportedLoads.current.add(round.index);
    socket.emit("geo:panorama-loaded", { roundIndex: round.index });
  };

  if (reveal) return <RoundRecap room={room} meId={meId} isHost={isHost} guess={guess} reveal={reveal} />;

  const packName = PACK_NAMES[room.settings.geoPack] || "World";
  return <main className="geo-game-screen">
    <section className="geo-panorama" aria-label="Street View location">
      {round ? <StreetView key={round.index} round={round} onLoad={reportPanoramaLoad} /> : <div className="geo-panorama-loading" role="status">Preparing Street View…</div>}
    </section>
    <header className="geo-game-hud">
      <div className="geo-hud-brand"><span>WORLD</span><strong>GUESS</strong><small>{packName}</small></div>
      <div className="geo-hud-round"><span>ROUND</span><strong>{(round?.index || 0) + 1}<small> / {round?.total || room.settings.rounds}</small></strong></div>
      {room.phase === "geo-playing" && round && <Countdown endsAt={round.endsAt} serverOffset={round.serverNow - Date.now()} seconds={round.seconds} />}
    </header>
    <section className={`geo-map-overlay${guessSubmitted ? " submitted" : ""}`}>
      <GeoMap guess={guess} onGuess={guessSubmitted ? undefined : updateGuess} compact />
      <div className="geo-pin-prompt">{guessSubmitted ? "Answer confirmed · waiting for others" : guess ? "Pin selected · move it or confirm" : "Choose a location on the map"}</div>
      {!guessSubmitted && <button type="button" className="geo-confirm-guess" disabled={!guess || room.phase !== "geo-playing"} onClick={confirmGuess}>Confirm guess</button>}
    </section>
    <div className="geo-game-footer"><span>{room.geoAnswered || 0}/{room.players.filter((player) => player.connected).length} guesses confirmed</span><span>Choose a pin, then confirm before time runs out</span></div>
  </main>;
}
