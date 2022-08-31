const express = require('express')
const app = express();
const sockets = require('socket.io')(require('http').Server(app));
const SpotifyWebApi = require('spotify-web-api-node');

var auth = '';

var rooms=[];

const scopes = ['user-read-private', 'user-read-email'],
  redirectUri = 'http://localhost:8888/callback',
  clientId = 'd446a494fa264b17af513f2bc326a989',
  clientSecret = '39afee48a3154f07877c58ce4b85c0d0',
  state = 'some-state-of-my-choice';


// credentials are optional
var spotifyApi = new SpotifyWebApi({
  clientId,
  clientSecret,
  redirectUri
});

sockets.on('connection', (socket) => {
    socket.on('create-room', (message) => {
        auth = message;
    });
});

app.get('/login', (req, res) => {
  res.redirect(spotifyApi.createAuthorizeURL(scopes, state));
});

app.get('/callback', (req, res) => {
  var room = makeid(5);
  var wrapper = new SpotifyWebApi({clientId, clientSecret, redirectUri});
  wrapper.authorizationCodeGrant(req.query.code).then((data) => {
      wrapper.setAccessToken(data.body['access_token']);
      wrapper.setRefreshToken(data.body['refresh_token']);
    },
    (err) => console.log('Something went wrong!', err)
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
    (data) => res.json(data.body.tracks.items),
    (err) => res.status(500).send(err))
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
      res.status(200).send("Song was added");
    },
    (err) => res.status(500).send(err));
});

app.get('/:roomId/vote', (req, res) => {
  var song = req.query.song;
  var user = req.query.user;
  var vote = req.query.vote;
});

app.get('/admin/:roomId', (req, res) => {
  res.sendFile(__dirname + '/admin.html');
});

app.get('/:roomId', (req, res) => {
  res.sendFile(__dirname + '/user.html');
});

//app.use(express.static(__dirname + '/public'));

app.listen(8888, () => {
  console.log(`Server running at http://localhost:${8888}/`);
});

function makeid(length) {
  var result = '';
  var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var charactersLength = characters.length;
  for ( var i = 0; i < length; i++ ) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}