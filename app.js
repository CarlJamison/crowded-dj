const express = require('express')
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const SpotifyWebApi = require('spotify-web-api-node');

var rooms = [];

const scopes = ['user-read-private', 'user-read-email'],
  redirectUri = 'http://localhost:8888/callback',
  clientId = 'd446a494fa264b17af513f2bc326a989',
  clientSecret = '39afee48a3154f07877c58ce4b85c0d0',
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

  rooms[room] = {
    queue: [],
    stage: [],
    api: wrapper,
  }

  res.redirect(`/admin/${room}`);
});

app.get('/:roomId/search/:query', (req, res) => {
  rooms[req.params.roomId].api.searchTracks(req.params.query).then(
    data => res.json(data.body.tracks.items),
    err => res.status(500).send(err))
});

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

app.get('/:roomId/vote', (req, res) => {
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

app.get('/admin/:roomId', (req, res) => {
  res.sendFile(__dirname + '/admin.html');
});

app.get('/:roomId', (req, res) => {
  res.sendFile(__dirname + '/user.html');
});

server.listen(8888, () => {
  console.log(`Server running at http://localhost:${8888}/`);
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