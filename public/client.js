// ===== 满分男孩 - 客户端逻辑 =====

const socket = io();

// ===== 状态 =====
let myPlayerId = null;
let myRoomCode = null;
let isDrawer = false;

// 多人评分数据
let _multiRatings = {};   // { playerId: ratingValue }
let _describers = [];     // 当前轮需要评分的玩家列表

// ===== 页面切换 =====
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
}

// ===== Toast =====
function showToast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function avatarText(name) {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

const AVATAR_COLORS = [
  '#667eea', '#48bb78', '#ed8936', '#f56565',
  '#9f7aea', '#38b2ac', '#d53f8c', '#ecc94b',
  '#4299e1', '#fc8181',
];

function getColor(index) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

// ===== 首页 =====
function createRoom() {
  socket.emit('create_room');
}

function joinRoom() {
  const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!code) return showToast('请输入房间码');
  const name = prompt('请输入你的名字：');
  if (!name || !name.trim()) return;
  socket.emit('join_room', { roomCode: code, playerName: name.trim() });
}

// ===== Socket 事件 =====

// 创建房间成功
socket.on('room_created', (data) => {
  myPlayerId = data.playerId;
  myRoomCode = data.roomCode;
  document.getElementById('roomCodeDisplay').textContent = data.roomCode;
  showPage('page-lobby');
  setTimeout(() => {
    const name = prompt('请输入你的名字（房主）：');
    if (name && name.trim()) {
      socket.emit('update_name', { playerId: myPlayerId, name: name.trim() });
    }
  }, 300);
});

// 加入房间成功
socket.on('room_joined', (data) => {
  myPlayerId = data.playerId;
  myRoomCode = data.roomCode;
  document.getElementById('roomCodeDisplay').textContent = data.roomCode;
  showPage('page-lobby');
});

// 玩家列表更新
socket.on('players_update', (data) => {
  renderPlayerList(data.players);
});

// 错误消息
socket.on('error_msg', (data) => {
  showToast(data.message);
});

// 游戏开始
socket.on('game_started', (data) => {
  showPage('page-game');
  window._currentDrawerId = null;
  renderScoreboard(data.players);
  document.getElementById('roundInfo').textContent = '第 1/10 轮';
  resetGameArea();
});

// 有人抽牌了 → 显示多人评分UI
socket.on('card_drawn', (data) => {
  if (data.drawerId === myPlayerId) {
    // 我是抽牌人 → 构建多人评分列表
    buildMultiRatingUI(data.players);
    showSection('describeSection');
  } else {
    showSection('waitRatingSection');
  }
});

// 牌值（只发给非抽牌人）
socket.on('card_value', (data) => {
  document.getElementById('viewerCardValue').textContent = data.value;
});

// 结果揭晓
socket.on('round_result', (data) => {
  document.getElementById('resultCard').textContent = data.cardValue;
  document.getElementById('resultDrawer').textContent = `由 ${data.drawerName} 抽牌`;

  // 渲染每个人的评分详情
  const detailsEl = document.getElementById('resultDetails');
  detailsEl.innerHTML = data.results.map(r => {
    const player = data.players.find(p => p.id === r.playerId);
    const name = player ? player.name : '未知';
    const isWinner = data.winners.includes(r.playerId);
    return `
      <div class="result-detail-row ${isWinner ? 'is-winner' : ''}">
        <span class="rd-name">${name}</span>
        <span class="rd-rating">${r.rating}分</span>
        <span class="rd-diff">差${r.diff}</span>
        ${isWinner ? '<span class="rd-winner-badge">🏆 +10</span>' : ''}
      </div>
    `;
  }).join('');

  // 显示赢家
  const winnerEl = document.getElementById('winnerAnnounce');
  if (data.winnerNames && data.winnerNames.length > 0) {
    winnerEl.style.display = 'block';
    winnerEl.textContent = `🎉 ${data.winnerNames.join('、')} 最接近！+10分！`;
  } else {
    winnerEl.style.display = 'none';
  }

  renderScoreboard(data.players);
  showSection('resultSection');

  const isHost = data.players.find(p => p.id === myPlayerId)?.isHost;
  document.getElementById('btnNextRound').style.display = isHost ? 'block' : 'none';
  document.getElementById('waitHostNext').style.display = isHost ? 'none' : 'block';
});

// 游戏结束
socket.on('game_over', (data) => {
  showPage('page-gameover');
  renderFinalScores(data.players);
  const isHost = data.players.find(p => p.id === myPlayerId)?.isHost;
  document.getElementById('btnRestart').style.display = isHost ? 'block' : 'none';
});

// ===== next_turn =====
socket.on('next_turn', (data) => {
  window._currentDrawerId = data.currentDrawer;
  renderScoreboard(data.players);
  document.getElementById('roundInfo').textContent = `第 ${data.round}/10 轮`;
  resetGameArea();
  setupDrawPhase(data.currentDrawer, data.players);
});

// ===== 大厅渲染 =====
function renderPlayerList(players) {
  const el = document.getElementById('playerList');
  el.innerHTML = players.map((p, i) => {
    const isMe = p.id === myPlayerId;
    const isHost = p.isHost;
    return `
      <div class="player-item">
        <div class="avatar" style="background:${getColor(i)}">${avatarText(p.name || '?')}</div>
        ${isMe
          ? `<input class="name-input" value="${p.name}" placeholder="输入名字" maxlength="10"
                 onchange="updateName('${p.id}', this.value)">`
          : `<span style="font-weight:600;flex:1">${p.name || '等待命名...'}</span>`
        }
        ${isHost ? '<span class="host-badge">👑 房主</span>' : ''}
        ${isMe ? '<span style="color:#48bb78;font-size:12px;">你</span>' : ''}
      </div>
    `;
  }).join('');

  const btn = document.getElementById('btnStartGame');
  const named = players.filter(p => p.name.trim());
  if (players.length >= 3 && named.length === players.length) {
    btn.disabled = false;
    btn.textContent = players.find(p => p.isHost)?.id === myPlayerId
      ? '🎮 开始游戏！'
      : '👈 等待房主开始游戏...';
  } else {
    btn.disabled = true;
    if (players.length < 3) {
      btn.textContent = `👈 至少需要3名玩家（当前${players.length}人）`;
    } else {
      btn.textContent = '✏️ 请所有玩家设置名字';
    }
  }
}

function updateName(playerId, name) {
  socket.emit('update_name', { playerId, name: name.trim() });
}

function startGame() {
  socket.emit('start_game');
}

// ===== 游戏区域 =====
function resetGameArea() {
  ['drawSection', 'viewerSection', 'waitDrawSection', 'describeSection',
   'waitRatingSection', 'resultSection'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('drawerIndicator').style.display = 'none';
  _multiRatings = {};
  _describers = [];
}

function showSection(sectionId) {
  ['drawSection', 'viewerSection', 'waitDrawSection', 'describeSection',
   'waitRatingSection', 'resultSection'].forEach(id => {
    document.getElementById(id).style.display = id === sectionId ? 'block' : 'none';
  });
}

function setupDrawPhase(drawerId, players) {
  const drawer = players.find(p => p.id === drawerId);
  const drawerName = drawer ? drawer.name : '未知';
  document.getElementById('drawerIndicator').style.display = 'block';
  document.getElementById('drawerName').textContent = `🎯 ${drawerName} 抽牌中`;

  isDrawer = (drawerId === myPlayerId);

  if (isDrawer) {
    showSection('drawSection');
  } else {
    document.getElementById('viewerCardValue').textContent = '?';
    showSection('viewerSection');
    showSection('waitDrawSection');
    document.getElementById('waitDrawText').textContent = `等待 ${drawerName} 抽牌...`;
  }
}

function drawCard() {
  socket.emit('draw_card');
}

// ===== 多人评分UI =====
function buildMultiRatingUI(players) {
  // 排除自己（抽牌人）
  _describers = players.filter(p => p.id !== myPlayerId);
  _multiRatings = {};
  
  const listEl = document.getElementById('multiRatingList');
  listEl.innerHTML = _describers.map((p, i) => {
    _multiRatings[p.id] = 5; // 默认5分
    return `
      <div class="rater-item">
        <div class="rater-name">${p.name}</div>
        <div class="rater-slider-row">
          <span style="font-size:12px;color:#a0aec0;">0</span>
          <input type="range" min="0" max="10" value="5" step="1"
                 data-playerid="${p.id}"
                 oninput="updateMultiRating('${p.id}', this.value)">
          <span class="rater-value" id="mrating-${p.id}">5</span>
        </div>
      </div>
    `;
  }).join('');
}

function updateMultiRating(playerId, val) {
  _multiRatings[playerId] = parseInt(val);
  const display = document.getElementById(`mrating-${playerId}`);
  if (display) display.textContent = val;
}

function submitMultiRatings() {
  const ratings = _describers.map(p => ({
    playerId: p.id,
    rating: _multiRatings[p.id] || 5,
  }));
  socket.emit('submit_ratings', { ratings });
}

function nextRound() {
  socket.emit('next_round');
}

function restartGame() {
  socket.emit('restart_game');
}

// ===== 记分板 =====
function renderScoreboard(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const el = document.getElementById('scoreList');
  el.innerHTML = sorted.map((p, i) => {
    const isMe = p.id === myPlayerId;
    return `
      <div class="score-row ${isMe ? 'current' : ''}">
        <span class="rank">${i + 1}</span>
        <span class="name">${p.name} ${isMe ? '(你)' : ''}</span>
        <span class="score">${p.score}</span>
      </div>
    `;
  }).join('');
}

// ===== 最终排名 =====
function renderFinalScores(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const el = document.getElementById('finalScoreList');
  el.innerHTML = sorted.map((p, i) => {
    const medals = ['🥇', '🥈', '🥉'];
    const medal = i < 3 ? medals[i] : `${i + 1}.`;
    return `
      <div class="score-row" style="font-size:18px;padding:14px 16px;">
        <span style="font-size:20px;">${medal}</span>
        <span class="name">${p.name}</span>
        <span class="score" style="font-size:20px;">${p.score}分</span>
      </div>
    `;
  }).join('');

  const winnerEl = document.getElementById('winnerSection');
  if (winner) {
    winnerEl.innerHTML = `
      <div class="winner-emoji">🏆</div>
      <div class="winner-name">${winner.name}</div>
      <div class="winner-score">${winner.score} 分</div>
    `;
  }
}

// ===== 键盘支持 =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const activePage = document.querySelector('.page.active');
    if (activePage?.id === 'page-home') {
      joinRoom();
    }
  }
});
