// ===== 满分男孩 - 客户端逻辑 =====

// 连接 Socket.IO（自动连接当前服务器）
const socket = io();

// ===== 状态 =====
let myPlayerId = null;
let myRoomCode = null;
let isDrawer = false;

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

// ===== 生成头像文字 =====
function avatarText(name) {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

// ===== 颜色生成 =====
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
  // 弹出名字设置
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
  // 首轮抽牌人信息由紧随的 next_turn 事件提供
});

// 有人抽牌了
socket.on('card_drawn', (data) => {
  // 抽牌人：显示描述区
  if (data.drawerId === myPlayerId) {
    showSection('describeSection');
  } else {
    // 非抽牌人：显示等待打分
    showSection('waitRatingSection');
  }
});

// 牌值（只发给非抽牌人）
socket.on('card_value', (data) => {
  document.getElementById('viewerCardValue').textContent = data.value;
});

// 结果揭晓
socket.on('round_result', (data) => {
  const diff = Math.abs(data.cardValue - data.rating);
  document.getElementById('resultCard').textContent = data.cardValue;
  document.getElementById('resultRating').textContent = data.rating;
  document.getElementById('resultDiff').textContent = diff;
  const scoreEl = document.getElementById('resultScore');
  scoreEl.textContent = data.score > 0 ? `+${data.score}` : `+0`;
  scoreEl.className = 'result-score' + (data.score === 0 ? ' zero' : '');
  document.getElementById('resultDrawer').textContent = `由 ${data.drawerName} 抽牌`;

  // 更新记分板
  renderScoreboard(data.players);

  showSection('resultSection');

  // 房主显示下一轮按钮
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

  // 开始按钮状态
  const btn = document.getElementById('btnStartGame');
  const named = players.filter(p => p.name.trim());
  if (players.length >= 2 && named.length === players.length) {
    btn.disabled = false;
    btn.textContent = players.find(p => p.isHost)?.id === myPlayerId
      ? '🎮 开始游戏！'
      : '👈 等待房主开始游戏...';
  } else {
    btn.disabled = true;
    if (players.length < 2) {
      btn.textContent = `👈 至少需要2名玩家（当前${players.length}人）`;
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
  document.getElementById('ratingSlider').value = 5;
  document.getElementById('sliderDisplay').textContent = '5';
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
    // 我是抽牌人 → 显示抽牌按钮
    showSection('drawSection');
  } else {
    // 我是观众 → 等待别人抽牌，准备好显示牌面
    document.getElementById('viewerCardValue').textContent = '?';
    showSection('viewerSection');
    // 抽牌还没发生，先隐藏viewerSection... 改用waitDrawSection
    showSection('waitDrawSection');
    document.getElementById('waitDrawText').textContent = `等待 ${drawerName} 抽牌...`;
  }
}

function drawCard() {
  // 播放震动反馈
  socket.emit('draw_card');
}

function updateSlider(val) {
  document.getElementById('sliderDisplay').textContent = val;
}

function submitRating() {
  const val = parseInt(document.getElementById('ratingSlider').value);
  socket.emit('submit_rating', { rating: val });
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
    const isCurrent = p.id === (window._currentDrawerId);
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

// ===== next_turn（每轮切换时触发，含第一轮） =====
socket.on('next_turn', (data) => {
  window._currentDrawerId = data.currentDrawer;
  renderScoreboard(data.players);
  document.getElementById('roundInfo').textContent = `第 ${data.round}/10 轮`;
  resetGameArea();
  setupDrawPhase(data.currentDrawer, data.players);
});

// ===== 键盘支持 =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const activePage = document.querySelector('.page.active');
    if (activePage?.id === 'page-home') {
      joinRoom();
    }
  }
});
