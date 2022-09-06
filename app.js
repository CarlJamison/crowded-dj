require('dotenv').config()
const express = require('express')
const app = express();
const http = require('http');
const server = http.Server(app);
const { Server } = require("socket.io");
const io = new Server(server);
const SpotifyWebApi = require('spotify-web-api-node');
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

app.use(express.static(__dirname + '/public'));

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
    auth: '',
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
  var song = room.stage.find(s => s.id == req.query.song);
  var user = req.query.user;
  if(room.auth != user){
    res.status(403).send("Not admin");
    return;
  }

  room.api.addToQueue('spotify:track:' + song.id).then(
    data => {
      room.stage = room.stage.filter(s => s.id != song.id);
      sendStage(req.params.roomId);
      res.status(200).send("song added");
    },
    err =>
      room.api.getMyDevices().then(
        data => room.api.transferMyPlayback([data.body.devices[0].id]).then(
          data => room.api.addToQueue('spotify:track:' + song.id).then(
            data => {
              room.stage = room.stage.filter(s => s.id != song.id);
              sendStage(req.params.roomId);
              res.status(200).send("song added");
            },
            err => res.status(500).send(err)
          ),
          err => res.status(500).send(err)
        ),
        err => res.status(500).send(err)
      )
  )
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