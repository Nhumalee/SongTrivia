import songTrivia from "./song-trivia/index.js";
import geoGuessr from "./geo-guessr/index.js";

// Add each new game folder here. The lobby picker reads this registry.
export const games = [
  songTrivia,
  geoGuessr,
  {
    id: "coming-soon",
    title: "เกมใหม่เร็ว ๆ นี้",
    description: "กำลังเตรียมเกมใหม่มาให้เลือกเล่น",
    icon: "+",
    status: "coming-soon",
  },
];

export const gamesById = Object.fromEntries(games.map((game) => [game.id, game]));
export const getGame = (id) => gamesById[id] || songTrivia;
