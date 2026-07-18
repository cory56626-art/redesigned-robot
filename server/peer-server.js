// Optional self-hosted signaling server for Summoner Realms multiplayer.
//
// You do NOT need this to play — by default the game uses the free public
// PeerJS cloud broker. Run this only if you want a private/robust broker.
//
//   cd server && npm install && npm start
//
// Then open the game with URL params pointing at your server, e.g.:
//   https://your-site/?peerhost=localhost&peerport=9000
//   https://your-site/?peerhost=broker.example.com&peerport=443&peersecure=1
//
const { PeerServer } = require('peer');

const port = parseInt(process.env.PORT || '9000', 10);
const path = process.env.PEER_PATH || '/';

const server = PeerServer({ port, path, allow_discovery: true });

server.on('connection', (client) => console.log('peer connected:', client.getId()));
server.on('disconnect', (client) => console.log('peer disconnected:', client.getId()));

console.log(`Summoner Realms PeerServer listening on port ${port} at path "${path}"`);
console.log(`Point clients at: ?peerhost=<this-host>&peerport=${port}`);
