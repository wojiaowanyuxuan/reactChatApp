const express = require('express');
const cors = require('cors');
const bodyParse = require('body-parser');
const session = require('express-session');

const router = require('./router');
const proxyRoute = require('./proxyRoute');
const Message = require('./mongodb/message');
const Tidings = require('./mongodb/tidings');

const app = express();
const server = require('http')
const servers = server.Server(app);
const io = require('socket.io')(servers, {
  pingTimeout: 30000,
});

let sum = 0;
let map = new Map();

// 使用cors模块配置跨域预检
app.use(cors({
  origin: ['http://localhost:3000', 'http://10.128.154.110:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with', 'Set-Cookie'],
  credentials: true,
  maxAge: 172800,
}))

app.use('/uploadImg', express.static('./uploadImg/'))

app.use(session({
  secret: 'keybord cat',
  saveUninitialized: true,
  resave: false,
}))

app.use(bodyParse.json())

app.use(router);

app.use(proxyRoute);

io.on('connection', socket => {
  console.log(`当前连接客户端:${++sum}`);

  socket.on('ADD_USER', (data) => {
    // 存储登录用户 
    map.set(data.Account, socket);
  });

  socket.on('REMOVE_USER', (data, fn) => {
    // 删除登录用户的socket
    map.delete(data.Account);
    fn();
  })

  socket.on('sendTo', (mesObj) => {
    let targetSocket = map.get(mesObj.receiveAccount);
    let headImage = mesObj.headImage;
    let status = 0;
    let saveObj = {
      sendId: mesObj.currentTidings,
      receiveId: mesObj.sendId,
      receiveObj: {
        Account: mesObj.Account,
        _id: mesObj.sendId,
        headImage: mesObj.headImage,
        Username: mesObj.Username
      }
    }

    if (targetSocket) {
      targetSocket.emit('message', mesObj);
      status = 1;
    } else {
      socket.emit('warnning', '对方已离线状态');
    }
    // 如果对方消息队列不存在则创建一个tidings并返回到实时队列中
    Tidings.findOne({'receiveObj._id': mesObj.sendId, sendId: mesObj.currentTidings}, (err, res) => {
      if (!res) {
        console.log(`接收方${mesObj.receiveName}不存在对你的消息窗口`);
        new Tidings({
          ...saveObj
        })
        .save((err) => {
          if (err) {
            console.log('生成窗口错误');
          } else {
            if (targetSocket) {
              targetSocket.emit('addNewTiding', {
                ...saveObj,
                receiveId: {
                  _id: mesObj.sendId,
                  headImage,
                }
              });
            }
          }
        });
      }
    });

    Reflect.deleteProperty(mesObj, 'headImage');

    new Message({
      status,
      ...mesObj,
    }).save((err) => {
      if (err) {
        socket.emit('handleError', '数据接收异常，发送失败');
      }
    });
    
  })

  socket.on('rFriend', (rObj) => {
    let targetSocket = map.get(rObj.Account);

    if (targetSocket) {
      // 对方如果在线直接通知他
      targetSocket.emit('notifyReq', rObj);
    }
  })

  socket.on('disconnect', () => {
    console.log('socket 断开连接');
    sum--;
  })
})

servers.listen(8080, () => {
  console.log('服务器启动');
})

