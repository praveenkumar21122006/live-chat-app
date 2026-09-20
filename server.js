const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-chat-key-2024";
const JWT_EXPIRES = "7d";

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory stores (replace with DB in production)
const users = []; // { id, username, passwordHash, createdAt }
const messages = []; // { id, username, userId, text, timestamp }
const onlineUsers = new Map(); // socketId -> { userId, username }

// Helpers
function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}
function authMiddleware(req,res,next){
  const header = req.headers.authorization;
  if(!header) return res.status(401).json({ error: "No token" });
  const token = header.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch(e){
    return res.status(401).json({ error: "Invalid token" });
  }
}

// REST API
app.post('/api/register', async (req,res)=>{
  const { username, password } = req.body;
  if(!username || !password) return res.status(400).json({ error: "Username and password required" });
  if(username.length < 3 || username.length > 20) return res.status(400).json({ error: "Username 3-20 chars" });
  if(password.length < 4) return res.status(400).json({ error: "Password min 4 chars" });
  if(users.find(u=>u.username.toLowerCase()===username.toLowerCase())) return res.status(409).json({ error: "Username taken" });
  const hash = await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(), username: username.trim(), passwordHash: hash, createdAt: new Date().toISOString() };
  users.push(user);
  const token = generateToken(user);
  res.json({ token, user: { id: user.id, username: user.username } });
});

app.post('/api/login', async (req,res)=>{
  const { username, password } = req.body;
  if(!username || !password) return res.status(400).json({ error: "Username and password required" });
  const user = users.find(u=>u.username.toLowerCase()===username.toLowerCase());
  if(!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if(!ok) return res.status(401).json({ error: "Invalid credentials" });
  const token = generateToken(user);
  res.json({ token, user: { id: user.id, username: user.username } });
});

app.get('/api/messages', authMiddleware, (req,res)=>{
  res.json(messages.slice(-100)); // last 100
});

app.get('/api/users', authMiddleware, (req,res)=>{
  res.json(users.map(u=>({ id: u.id, username: u.username })));
});

app.get('/api/me', authMiddleware, (req,res)=>{
  res.json(req.user);
});

// Socket.io Auth
io.use((socket, next)=>{
  const token = socket.handshake.auth?.token;
  if(!token) return next(new Error("No token"));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch(e){
    next(new Error("Invalid token"));
  }
});

function broadcastOnlineUsers(){
  const list = [...onlineUsers.values()].reduce((acc, cur)=>{
    if(!acc.find(u=>u.userId===cur.userId)) acc.push(cur);
    return acc;
  },[]);
  io.emit('users:online', list);
}

io.on('connection', (socket)=>{
  const { username, id: userId } = socket.user;
  console.log(`+ ${username} connected (${socket.id})`);
  onlineUsers.set(socket.id, { userId, username, socketId: socket.id });
  broadcastOnlineUsers();

  // send history to new user
  socket.emit('chat:history', messages.slice(-100));

  // announce join
  socket.broadcast.emit('user:joined', { username, timestamp: new Date().toISOString() });

  socket.on('chat:message', (payload)=>{
    const text = (payload?.text || "").trim();
    if(!text) return;
    if(text.length > 1000) return;
    const msg = {
      id: Date.now().toString() + Math.random().toString(36).slice(2,6),
      userId,
      username,
      text,
      timestamp: new Date().toISOString()
    };
    messages.push(msg);
    if(messages.length > 500) messages.shift();
    io.emit('chat:message', msg);
  });

  // Typing indicators
  socket.on('typing:start', ()=>{
    socket.broadcast.emit('typing:update', { username, isTyping: true });
  });
  socket.on('typing:stop', ()=>{
    socket.broadcast.emit('typing:update', { username, isTyping: false });
  });

  socket.on('disconnect', ()=>{
    console.log(`- ${username} disconnected`);
    onlineUsers.delete(socket.id);
    socket.broadcast.emit('typing:update', { username, isTyping: false });
    socket.broadcast.emit('user:left', { username, timestamp: new Date().toISOString() });
    broadcastOnlineUsers();
  });
});

app.get('*', (req,res)=>{
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Vercel (serverless) exports the server, local dev listens
if (!process.env.VERCEL) {
  server.listen(PORT, ()=>{
    console.log(`✅ Live Chat running at http://localhost:${PORT}`);
  });
}

module.exports = server;
