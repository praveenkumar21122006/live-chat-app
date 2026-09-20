# LiveChat — Instant Messaging (Socket.io)

Features: **WebSockets (Socket.io)**, instant delivery, **JWT authentication**, **typing indicators**, presence (online users), join/leave notices.

## Stack
- **Backend:** Node.js + Express + Socket.io + JWT + bcryptjs (in-memory store, swap to DB in prod)
- **Frontend:** Vanilla HTML/CSS/JS + Socket.io client
- **Auth:** `POST /api/register` & `/api/login` → JWT → Socket.io `auth.token` verified via `io.use()` middleware

## Quick Start
```bash
npm install
npm start        # http://localhost:3000
```

## API
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/register` | no | `{username,password}` → `{token,user}` |
| POST | `/api/login` | no | `{username,password}` → `{token,user}` |
| GET | `/api/me` | Bearer | Returns decoded user |
| GET | `/api/messages` | Bearer | Last 100 messages |
| GET | `/api/users` | Bearer | All registered users |

## Socket Events
- **Client → Server:** `chat:message {text}`, `typing:start`, `typing:stop`
- **Server → Client:** `chat:message {id,username,text,timestamp}`, `chat:history`, `typing:update {username,isTyping}`, `users:online [...]`, `user:joined`, `user:left`

## How It Works
1. User registers/logs in → receives JWT stored in `localStorage`.
2. Socket connects with `io({ auth: { token } })` — server verifies via `jwt.verify`.
3. Messages are broadcast via `io.emit('chat:message', msg)` for <50ms delivery.
4. Typing: `input` event emits `typing:start`, debounce 1.2s emits `typing:stop` → broadcast to others.
5. `onlineUsers` Map tracks presence, deduped and emitted as `users:online`.

## Production Notes
- Replace in-memory `users`/`messages` with MongoDB/Redis + persist.
- Use `httpOnly` cookies for token instead of localStorage for XSS safety.
- Add rate limiting & message sanitization.
- Enable Socket.io adapter (Redis) for horizontal scaling.

## Test
Open two browsers at `http://localhost:3000`, register as different users, chat sees instant delivery and “X is typing…”.
