require('dotenv').config()
const express = require('express')
const cron = require('node-cron');
const app = express();
const http = require('http');
const server = http.Server(app);
const { Server } = require("socket.io");
const io = new Server(server);
const SpotifyWebApi = require('spotify-web-api-node');
const HttpManager = require('spotify-web-api-node/src/http-manager');
const WebApiRequest = require('spotify-web-api-node/src/webapi-request');
const port = process.env.PORT || 8888;

var rooms = [];

const scopes = ['user-modify-playback-state', 'user-read-private', 'user-read-playback-state'],
  redirectUri = process.env.CALLBACK,
  clientId = process.env.SPOTIFY_CLIENT_ID,
  clientSecret = process.env.SPOTIFY_CLIENT_SECRET,
  state = 'some-state-of-my-choice';

var spotifyApi = new SpotifyWebApi({clientId, redirectUri});

io.on('connection', (socket) => {
    socket.on('join-room', (token) => {
        if(!rooms[token]) return;
        socket.join(token);
        
        io.to(socket.id).emit("stage-update",
          rooms[token].stage.map(s => ({
            id: s.id,
            name: s.name,
            artist: s.artist,
            image: s.image,
            votes: s.likes.length - s.dislikes.length,
          }))
        );
    });
});

cron.schedule('* * * * *', async () => {
  console.log("Running cron job");
  for(var room_id in rooms){
    //TODO Clean up old rooms

    var room = rooms[room_id];
    var song = room.stage.sort((a, b) => (b.likes.length - b.dislikes.length) - (a.likes.length - a.dislikes.length))[0];
    if(!song || !room.autoQueue) return;

    //Check if last song is still in queue
    var queueData = await room.api.getMyQueue();
    if(queueData.body.queue.some(s => s.id == room.last)) return;

    room.api.addToQueue('spotify:track:' + song.id).then(
      () => {
        room.stage = room.stage.filter(s => s.id != song.id);
        room.last = song.id;
        sendStage(room.id);
      }, err => console.log(err.body.error.message)
    )
  }
});

app.use(express.static(__dirname + '/public'));

app.get('/qrcode.js', (req, res) => {
  res.sendFile(__dirname + '/node_modules/qrcode/build/qrcode.js');
});

app.get('/login', (req, res) => {
  res.redirect(spotifyApi.createAuthorizeURL(scopes, state));
});

app.get('/callback', (req, res) => {
  var room = makeid(5);
  var wrapper = new SpotifyWebApi({clientId, clientSecret, redirectUri});
  wrapper.authorizationCodeGrant(req.query.code).then(data => {
      wrapper.setAccessToken(data.body['access_token']);
      wrapper.setRefreshToken(data.body['refresh_token']);
    },
    err => console.log('Something went wrong!', err)
  );

  wrapper.getMyQueue = function(options, callback) {
    return WebApiRequest.builder(this.getAccessToken())
      .withPath('/v1/me/player/queue')
      .withQueryParameters(options)
      .build()
      .execute(HttpManager.get, callback)
  };

  rooms[room] = {
    id: room,
    auth: '',
    queue: [],
    stage: [],
    autoQueue: false,
    api: wrapper,
  }

  res.redirect(`/admin/${room}`);
});

app.get('/:roomId/search/:query', (req, res) => {
  var room = rooms[req.params.roomId]
  
  if(room){
    room.api.searchTracks(req.params.query).then(
      data => res.json(data.body.tracks.items),
      err => res.status(500).send(err));
  }
});

app.put('/:roomId/remove', (req, res) => {
  var room = rooms[req.params.roomId];
  var user = req.query.user;
  if(!room || room.auth != user){
    res.status(403).send("Not admin");
    return;
  }

  room.stage = room.stage.filter(s => s.id != req.query.song);
  sendStage(req.params.roomId);
})

app.put('/:roomId/add', (req, res) => {
  var song = req.query.song;
  var room = rooms[req.params.roomId];
  var user = req.query.user;

  if(room.stage.some(s => s.id == song)) {
    res.status(500).send('Song already added');
    return;
  };

  room.api.getTrack(song).then(
    (data) => {
      room.stage.push({
        id: data.body.id,
        name: data.body.name,
        artist: data.body.artists[0].name,
        image: data.body.album.images.at(-1).url,
        likes: [user],
        dislikes: [],
      })
      sendStage(req.params.roomId);
      res.status(200).send("Song was added");
    },
    (err) => res.status(500).send(err));
});

app.put('/:roomId/vote', (req, res) => {
  var song = rooms[req.params.roomId].stage.find(s => s.id == req.query.song);
  var user = req.query.user;
  var vote = +req.query.vote;
  
  if([-1, 0].includes(vote)){
    if(song.likes.includes(user)) song.likes = song.likes.filter(l => l != user);
    if(!song.dislikes.includes(user) && vote) song.dislikes.push(user);
  }

  if([1, 0].includes(vote)){
    if(song.dislikes.includes(user)) song.dislikes = song.dislikes.filter(l => l != user);
    if(!song.likes.includes(user) && vote) song.likes.push(user);
  }
  sendStage(req.params.roomId);
  
  res.status(200).send("vote successful");
});

app.put('/:roomId/queue', (req, res) => {
  var room = rooms[req.params.roomId];
  var user = req.query.user;
  if(!room || room.auth != user){
    res.status(403).send("Not admin");
    return;
  }
  
  var song = room.stage.find(s => s.id == req.query.song);

  room.api.addToQueue('spotify:track:' + song.id).then(
      () => {
        room.stage = room.stage.filter(s => s.id != song.id);
        room.last = song.id;
        sendStage(room.id);
      }, err => console.log(err.body.error.message)
  )
});

app.put('/:roomId/autoqueue', (req, res) => {
  var room = rooms[req.params.roomId];
  if(!room || room.auth != req.query.user){
    res.status(403).send("Not admin");
  }else{
    room.autoQueue = req.query.autoqueue;
    res.status(200).send("AutoQueue Changed");
  }
});

app.get('/:roomId/autoqueue', (req, res) => {
  var room = rooms[req.params.roomId];
  if(room){
    res.status(200).send(room.autoQueue);
  }
});

app.get('/admin/:roomId', (req, res) => {
  if(!rooms[req.params.roomId]){

    if(rooms[req.params.roomId.toUpperCase()]){
      res.redirect('/' + req.params.roomId.toUpperCase());
    }else{
      res.redirect('/');
    }

    return;
  }
  res.sendFile(__dirname + '/admin.html');
});

app.put('/:roomId/verify', (req, res) => {

  var room = rooms[req.params.roomId];

  if(!room.auth){
    room.auth = req.query.user;
  }else if(room.auth != req.query.user){
    res.redirect('/' + req.params.roomId);
  }

  res.status(200).send("valid admin")
});

app.get('/:roomId', (req, res) => {
  if(!rooms[req.params.roomId]){

    if(rooms[req.params.roomId.toUpperCase()]){
      res.redirect('/' + req.params.roomId.toUpperCase());
    }else{
      res.redirect('/');
    }

    return;
  }

  res.sendFile(__dirname + '/user.html');
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});

function sendStage(token){
  io.to(token).emit("stage-update",
    rooms[token].stage.map(s => ({
      id: s.id,
      name: s.name,
      artist: s.artist,
      image: s.image,
      votes: s.likes.length - s.dislikes.length,
    }))
  );
}

function makeid(length) {
  var result = '';
  var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var charactersLength = characters.length;
  for ( var i = 0; i < length; i++ ) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}