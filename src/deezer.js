async function api(path) {
  const res = await fetch(`/api/deezer/${path}`);
  const body = await res.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`Deezer API ส่งข้อมูลที่ไม่ใช่ JSON (HTTP ${res.status}) ตรวจว่า server ที่พอร์ต 3001 ทำงานอยู่`);
  }
  if (!res.ok) throw new Error(data.error || "เรียก Deezer API ไม่สำเร็จ");
  return data;
}

export async function searchPlaylists(query) {
  const data = await api(`search/playlist?q=${encodeURIComponent(query)}&limit=30`);
  return (data.data || []).map((p) => ({
    id: String(p.id), name: p.title, total: p.nb_tracks,
    cover: p.picture_medium || p.picture || null, owner: p.user?.name || "Deezer",
  }));
}

export async function getPlaylist(id) {
  const p = await api(`playlist/${encodeURIComponent(id)}?limit=100`);
  const tracks = (p.tracks?.data || []).filter((t) => t.preview).map((t) => ({
    uri: `deezer:track:${t.id}`, title: t.title, artist: t.artist?.name || "Unknown artist",
    primaryArtist: t.artist?.name || "Unknown artist", durationMs: 30000,
    cover: t.album?.cover_medium || p.picture_medium || null, previewUrl: t.preview,
  }));
  if (!tracks.length) throw new Error("เพลย์ลิสต์นี้ไม่มีเพลงตัวอย่างที่เล่นได้");
  return { key: `deezer:playlist:${id}`, type: "playlist", platform: "Deezer", id: String(id), name: p.title, tracks };
}

export function buildQuestions(tracks, rounds, seconds) {
  const shuffle = (items) => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const label = (track) => `${track.title} — ${track.artist}`;
  const pool = [...new Map(tracks.map((track) => [track.uri, track])).values()];
  if (pool.length < 4) throw new Error("ต้องมีเพลงตัวอย่างอย่างน้อย 4 เพลง");
  return shuffle(pool).slice(0, Math.min(rounds, pool.length)).map((track) => {
    const correct = label(track);
    const distractors = shuffle(pool.filter((other) => other.uri !== track.uri && label(other) !== correct));
    if (distractors.length < 3) throw new Error("ต้องมีเพลงไม่ซ้ำอย่างน้อย 4 เพลง");
    const options = shuffle([correct, ...distractors.slice(0, 3).map(label)]);
    // Keep enough preview left for the whole round; a 30-second round starts at 0.
    const maxStartMs = Math.max(0, 29000 - seconds * 1000);
    return {
      uri: track.uri, previewUrl: track.previewUrl, title: track.title, artist: track.artist,
      cover: track.cover, options, correctIndex: options.indexOf(correct),
      positionMs: Math.floor(Math.random() * maxStartMs),
    };
  });
}
