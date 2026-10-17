import { io } from "socket.io-client";

// dev: vite proxy ส่งต่อไปที่ :3001 / production: เซิร์ฟเวอร์เดียวกัน
export const socket = io({ autoConnect: true });
