import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // ให้เพื่อนในวง LAN เปิดผ่าน IP เครื่องคุณได้
    allowedHosts: [".loca.lt"],
    port: 5173,
    proxy: {
      "/socket.io": { target: "http://127.0.0.1:3001", ws: true },
      "/api/deezer": { target: "http://127.0.0.1:3001" },
      "/api/spotify": { target: "http://127.0.0.1:3001" },
    },
  },
});
