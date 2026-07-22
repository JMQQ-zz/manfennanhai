// 测试脚本 - 模拟一局满分男孩游戏
const { io } = require('socket.io-client');

const SERVER = 'https://manfennanhai.onrender.com';
let step = 0;

function log(msg) { console.log(`[${++step}] ${msg}`); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // 房主 A 创建房间
  const hostA = io(SERVER);
  await new Promise(r => hostA.on('connect', r));
  log(`A 已连接: ${hostA.id}`);

  hostA.on('error_msg', (data) => log(`A 错误: ${data.message}`));
  
  // 创建房间
  hostA.emit('create_room');
  const roomData = await new Promise(r => hostA.on('room_created', r));
  const roomCode = roomData.roomCode;
  log(`房间已创建: ${roomCode}`);

  // A 设置名字
  hostA.emit('update_name', { playerId: hostA.id, name: 'Alice' });
  await sleep(200);

  // B 加入
  const hostB = io(SERVER);
  await new Promise(r => hostB.on('connect', r));
  log(`B 已连接: ${hostB.id}`);
  hostB.emit('join_room', { roomCode, playerName: 'Bob' });
  await new Promise(r => hostB.on('room_joined', r));
  log('B 已加入房间');

  // C 加入
  const hostC = io(SERVER);
  await new Promise(r => hostC.on('connect', r));
  log(`C 已连接: ${hostC.id}`);
  hostC.emit('join_room', { roomCode, playerName: 'Charlie' });
  await new Promise(r => hostC.on('room_joined', r));
  log('C 已加入房间');

  await sleep(500);

  // A 开始游戏
  hostA.on('game_started', () => log('游戏开始！'));
  hostA.on('next_turn', (data) => log(`轮到 ${data.currentDrawer} 抽牌，第 ${data.round} 轮`));
  
  hostB.on('game_started', () => log('B: 游戏开始'));
  hostB.on('next_turn', (data) => log(`B: 轮到 ${data.currentDrawer} 抽牌`));
  
  hostC.on('game_started', () => log('C: 游戏开始'));
  hostC.on('next_turn', (data) => log(`C: 轮到 ${data.currentDrawer} 抽牌`));

  hostA.emit('start_game');
  await sleep(1000);

  // 当前抽牌人是 A（房主）
  // A 抽牌
  hostA.on('card_drawn', (data) => {
    log(`A 抽牌完成，需要给 ${data.players.length - 1} 个人评分`);
    log(`players: ${JSON.stringify(data.players.map(p => ({name: p.name, id: p.id})))}`);
    
    // A 给每个人打分（默认5分）
    const ratings = data.players
      .filter(p => p.id !== hostA.id)
      .map(p => ({ playerId: p.id, rating: 7 }));  // 全部打7分
    
    log(`提交评分: ${JSON.stringify(ratings)}`);
    hostA.emit('submit_ratings', { ratings });
  });

  // B 监听 card_value
  hostB.on('card_value', (data) => log(`B 看到牌面: ${data.value}`));
  hostC.on('card_value', (data) => log(`C 看到牌面: ${data.value}`));

  // 所有人监听 round_result
  hostA.on('round_result', (data) => {
    log(`A 收到结果！牌面=${data.cardValue}`);
    log(`结果详情: ${JSON.stringify(data.results)}`);
    log(`赢家: ${data.winnerNames.join(', ')}`);
  });

  hostB.on('round_result', (data) => {
    log(`B 收到结果！牌面=${data.cardValue}`);
    log(`B看到分数: ${JSON.stringify(data.results.map(r => ({playerId: r.playerId, rating: r.rating, diff: r.diff})))}`);
  });

  hostC.on('round_result', (data) => {
    log(`C 收到结果！牌面=${data.cardValue}`);
  });

  // A 抽牌
  log('A 正在抽牌...');
  hostA.emit('draw_card');
  
  await sleep(3000);
  
  log('测试完成！');
  process.exit(0);
}

main().catch(console.error);
