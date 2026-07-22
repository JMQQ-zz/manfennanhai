const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ===== 房间状态存储 =====
const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function generateCard() {
  return Math.floor(Math.random() * 10) + 1; // 1-10
}

// ===== Socket.IO 事件处理 =====
io.on('connection', (socket) => {
  console.log(`[连接] ${socket.id}`);

  // ------ 创建房间 ------
  socket.on('create_room', () => {
    let code;
    do {
      code = generateRoomCode();
    } while (rooms[code]);
    
    const room = {
      code,
      players: [],
      state: 'lobby',             // lobby | playing | describing | round_end | game_over
      currentDrawer: null,
      cardValue: null,
      ratings: [],                 // [{playerId, rating}]
      round: 0,
      maxRounds: 10,
      turnIndex: -1,
    };
    rooms[code] = room;

    // 创建人自动加入
    const player = {
      id: socket.id,
      name: '',
      score: 0,
      isHost: true,
    };
    room.players.push(player);
    socket.join(code);
    socket.roomCode = code;
    socket.playerId = socket.id;

    socket.emit('room_created', { roomCode: code, playerId: socket.id });
    io.to(code).emit('players_update', { players: room.players });
    console.log(`[房间] ${code} 已创建`);
  });

  // ------ 加入房间 ------
  socket.on('join_room', ({ roomCode, playerName }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];
    if (!room) {
      return socket.emit('error_msg', { message: '房间不存在，请检查房间码' });
    }
    if (room.state !== 'lobby') {
      return socket.emit('error_msg', { message: '游戏已开始，无法加入' });
    }
    if (room.players.length >= 10) {
      return socket.emit('error_msg', { message: '房间已满（最多10人）' });
    }

    const player = {
      id: socket.id,
      name: playerName,
      score: 0,
      isHost: false,
    };
    room.players.push(player);
    socket.join(code);
    socket.roomCode = code;
    socket.playerId = socket.id;

    socket.emit('room_joined', { roomCode: code, playerId: socket.id });
    io.to(code).emit('players_update', { players: room.players });
    console.log(`[房间] ${playerName}(${socket.id}) 加入了 ${code}`);
  });

  // ------ 更新玩家名字 ------
  socket.on('update_name', ({ playerId, name }) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.name = name;
      io.to(socket.roomCode).emit('players_update', { players: room.players });
    }
  });

  // ------ 开始游戏 ------
  socket.on('start_game', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) {
      return socket.emit('error_msg', { message: '只有房主可以开始游戏' });
    }

    const unnamed = room.players.filter(p => !p.name.trim());
    if (unnamed.length > 0) {
      return socket.emit('error_msg', { message: '请所有玩家先设置名字' });
    }
    if (room.players.length < 3) {
      return socket.emit('error_msg', { message: '至少需要3名玩家' });
    }

    room.state = 'playing';
    room.round = 0;
    room.turnIndex = -1;
    room.players.forEach(p => p.score = 0);

    nextTurn(room);
    io.to(socket.roomCode).emit('game_started', { players: room.players });
    io.to(socket.roomCode).emit('next_turn', {
      currentDrawer: room.currentDrawer,
      round: room.round,
      players: room.players,
    });
    console.log(`[游戏] ${room.code} 开始`);
  });

  // ------ 抽牌 ------
  socket.on('draw_card', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    if (room.state !== 'playing') return;
    if (room.currentDrawer !== socket.id) return;

    room.cardValue = generateCard();
    room.ratings = [];

    // 通知所有人：有人抽牌了（不包含牌值）
    io.to(socket.roomCode).emit('card_drawn', { drawerId: socket.id });

    // 单独发给每个非抽牌玩家：牌值
    room.players.forEach(p => {
      if (p.id !== socket.id) {
        io.to(p.id).emit('card_value', { value: room.cardValue });
      }
    });

    room.state = 'describing';
    console.log(`[抽牌] ${room.code} 抽到 ${room.cardValue}`);
  });

  // ------ 提交多人打分 ------
  socket.on('submit_ratings', ({ ratings }) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    if (room.state !== 'describing') return;
    if (room.currentDrawer !== socket.id) return;

    if (!Array.isArray(ratings) || ratings.length === 0) return;

    // 验证并存储
    const validRatings = [];
    for (const r of ratings) {
      const rating = parseInt(r.rating);
      if (isNaN(rating) || rating < 0 || rating > 10) continue;
      // 确保是有效的非抽牌玩家
      const player = room.players.find(p => p.id === r.playerId);
      if (!player || player.id === socket.id) continue;
      validRatings.push({ playerId: r.playerId, rating });
    }

    if (validRatings.length === 0) return;

    room.ratings = validRatings;

    // 计算每个描述者的得分：10 - |牌面 - 评分|
    const results = validRatings.map(r => {
      const diff = Math.abs(room.cardValue - r.rating);
      return {
        playerId: r.playerId,
        rating: r.rating,
        diff,
        score: 10 - diff,
      };
    });

    // 找出最接近的（最小差值）
    const minDiff = Math.min(...results.map(r => r.diff));
    const winners = results.filter(r => r.diff === minDiff);

    // 赢家加分
    const winnerNames = [];
    winners.forEach(w => {
      const p = room.players.find(pl => pl.id === w.playerId);
      if (p) {
        p.score += 10;  // 赢家加10分
        winnerNames.push(p.name);
      }
    });

    room.state = 'round_end';

    // 揭晓
    io.to(socket.roomCode).emit('round_result', {
      drawerId: socket.id,
      drawerName: room.players.find(p => p.id === socket.id)?.name || '未知',
      cardValue: room.cardValue,
      results,
      winners: winners.map(w => w.playerId),
      winnerNames,
      players: room.players,
    });
    console.log(`[结果] ${room.code} 牌=${room.cardValue} 赢家=${winnerNames.join(',')}`);
  });

  // ------ 下一回合 ------
  socket.on('next_round', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    if (room.state !== 'round_end') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) {
      return socket.emit('error_msg', { message: '只有房主可以进入下一轮' });
    }

    if (room.round >= room.maxRounds) {
      room.state = 'game_over';
      io.to(socket.roomCode).emit('game_over', { players: room.players });
      return;
    }

    nextTurn(room);
    io.to(socket.roomCode).emit('next_turn', {
      currentDrawer: room.currentDrawer,
      round: room.round,
      players: room.players,
    });
  });

  // ------ 重新开始 ------
  socket.on('restart_game', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return;

    room.players.forEach(p => p.score = 0);
    room.state = 'playing';
    room.round = 0;
    room.turnIndex = -1;
    nextTurn(room);
    io.to(socket.roomCode).emit('game_started', { players: room.players });
    io.to(socket.roomCode).emit('next_turn', {
      currentDrawer: room.currentDrawer,
      round: room.round,
      players: room.players,
    });
  });

  // ------ 断开连接 ------
  socket.on('disconnect', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx === -1) return;

    const wasHost = room.players[idx].isHost;
    room.players.splice(idx, 1);

    if (room.players.length === 0) {
      delete rooms[socket.roomCode];
      console.log(`[房间] ${socket.roomCode} 已销毁（无人）`);
      return;
    }

    if (wasHost && room.players.length > 0) {
      room.players[0].isHost = true;
    }

    io.to(socket.roomCode).emit('players_update', { players: room.players });
    console.log(`[断开] ${socket.id} 离开了 ${socket.roomCode}`);
  });
});

// ===== 工具函数 =====
function nextTurn(room) {
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.currentDrawer = room.players[room.turnIndex].id;
  room.round++;
  room.cardValue = null;
  room.ratings = [];
  room.state = 'playing';
}

// ===== 启动 =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[启动] 满分男孩服务器运行在 http://0.0.0.0:${PORT}`);
});
