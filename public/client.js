let token = localStorage.getItem('chat_token');
let currentUser = JSON.parse(localStorage.getItem('chat_user') || 'null');
let socket = null;
let typingTimeout = null;
let isTyping = false;

const authView = document.getElementById('authView');
const chatView = document.getElementById('chatView');
const authForm = document.getElementById('authForm');
const authError = document.getElementById('authError');
const authBtn = document.getElementById('authBtn');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
let mode = 'login';

function switchTab(m){
  mode = m;
  tabLogin.classList.toggle('active', m==='login');
  tabRegister.classList.toggle('active', m==='register');
  authBtn.textContent = m==='login' ? 'Login →' : 'Create account →';
  authError.classList.add('hidden');
}

async function handleAuth(e){
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  authError.classList.add('hidden');
  authBtn.disabled = true;
  authBtn.textContent = 'Please wait…';
  try{
    const res = await fetch(`/api/${mode}`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Failed');
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('chat_token', token);
    localStorage.setItem('chat_user', JSON.stringify(currentUser));
    connectSocket();
    showChat();
  } catch(err){
    authError.textContent = err.message;
    authError.classList.remove('hidden');
  } finally{
    authBtn.disabled = false;
    authBtn.textContent = mode==='login' ? 'Login →' : 'Create account →';
  }
}

function showChat(){
  authView.classList.remove('active');
  chatView.classList.add('active');
  document.getElementById('meName').textContent = currentUser.username;
  document.getElementById('meAvatar').textContent = currentUser.username[0].toUpperCase();
  setTimeout(()=>document.getElementById('messageInput').focus(), 100);
}

function showAuth(){
  chatView.classList.remove('active');
  authView.classList.add('active');
}

function logout(){
  if(socket) socket.disconnect();
  localStorage.removeItem('chat_token');
  localStorage.removeItem('chat_user');
  token = null; currentUser = null;
  document.getElementById('messages').innerHTML='';
  showAuth();
}

// Socket
function connectSocket(){
  if(socket) socket.disconnect();
  socket = io({ auth: { token } });

  socket.on('connect_error', err=>{
    console.error('socket error', err.message);
    if(err.message.includes('token')){
      logout();
    }
  });

  socket.on('chat:history', msgs=>{
    const container = document.getElementById('messages');
    container.innerHTML='';
    msgs.forEach(addMessage);
    scrollBottom();
  });

  socket.on('chat:message', msg=>{
    addMessage(msg);
    scrollBottom();
  });

  socket.on('users:online', list=>{
    document.getElementById('onlineCount').textContent = list.length;
    const el = document.getElementById('onlineList');
    el.innerHTML = list.map(u=>`
      <div class="online-item">
        <span class="dot"></span>
        <span class="name">${escapeHtml(u.username)}</span>
        ${u.username===currentUser.username?'<span style="margin-left:auto;font-size:11px;color:var(--muted)">you</span>':''}
      </div>
    `).join('') || '<div style="color:var(--muted);font-size:13px">No one online</div>';
  });

  const typingMap = new Map();
  socket.on('typing:update', ({ username, isTyping })=>{
    if(username===currentUser.username) return;
    if(isTyping) typingMap.set(username, true);
    else typingMap.delete(username);
    const indicator = document.getElementById('typingIndicator');
    const systemTyping = document.getElementById('systemTyping');
    if(typingMap.size===0){
      indicator.classList.add('hidden');
      systemTyping.classList.add('hidden');
    } else {
      const names = [...typingMap.keys()].join(', ');
      const text = typingMap.size===1 ? `${names} is typing…` : `${names} are typing…`;
      indicator.textContent = '✍️ ' + text;
      indicator.classList.remove('hidden');
      systemTyping.textContent = '⌨️ ' + text;
      systemTyping.classList.remove('hidden');
      // dot animation alternative
      systemTyping.innerHTML = `⌨️ ${escapeHtml(text)} <span class="dots">●●●</span>`;
    }
  });

  socket.on('user:joined', ({ username })=>{
    addSystem(`${username} joined`);
  });
  socket.on('user:left', ({ username })=>{
    addSystem(`${username} left`);
  });
}

// UI helpers
function addMessage(msg){
  const container = document.getElementById('messages');
  const mine = msg.username === currentUser.username;
  const time = new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  const div = document.createElement('div');
  div.className = `msg ${mine?'mine':'other'}`;
  div.innerHTML = `
    ${!mine ? `<div class="meta"><span class="avatar-small">${escapeHtml(msg.username[0].toUpperCase())}</span> ${escapeHtml(msg.username)} • ${time}</div>` : ''}
    <div class="bubble">${escapeHtml(msg.text)}</div>
    ${mine ? `<div class="meta">${time} ✓✓</div>` : ''}
  `;
  container.appendChild(div);
}

function addSystem(text){
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className='system';
  div.textContent = text;
  container.appendChild(div);
  scrollBottom();
}

function scrollBottom(){
  const c = document.getElementById('messages');
  c.scrollTop = c.scrollHeight;
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

// Send
function sendMessage(e){
  e.preventDefault();
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if(!text || !socket) return;
  socket.emit('chat:message', { text });
  // stop typing
  if(isTyping){
    socket.emit('typing:stop');
    isTyping=false;
  }
  input.value='';
  input.focus();
}

// Typing detection
document.getElementById('messageInput').addEventListener('input', ()=>{
  if(!socket) return;
  if(!isTyping){
    isTyping=true;
    socket.emit('typing:start');
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(()=>{
    isTyping=false;
    socket.emit('typing:stop');
  }, 1200);
});

// Init
if(token && currentUser){
  // verify token quickly
  fetch('/api/me', { headers:{ Authorization:`Bearer ${token}` }})
    .then(r=>{
      if(!r.ok) throw new Error('invalid');
      return r.json();
    })
    .then(()=>{
      connectSocket();
      showChat();
    })
    .catch(()=>{ logout(); });
}

// latency badge animation
setInterval(()=>{
  const el=document.getElementById('latency');
  if(!el) return;
  el.textContent = socket && socket.connected ? '● live' : '○ offline';
  el.style.color = socket && socket.connected ? '#22c55e' : '#9aa0c3';
}, 1000);
