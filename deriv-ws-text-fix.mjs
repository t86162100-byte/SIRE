import WebSocket from 'ws';

// Deriv sends JSON frames as Buffers through the Node ws client. The SIRE
// browser proxy must forward those frames as WebSocket text frames; otherwise
// browsers expose them as Blob objects and the UI's JSON.parse() reports
// "Invalid Deriv response". Convert binary UTF-8 JSON frames to text globally.
const originalSend = WebSocket.prototype.send;

WebSocket.prototype.send = function patchedSend(data, options, callback) {
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    data = Buffer.from(data).toString('utf8');
  }
  return originalSend.call(this, data, options, callback);
};
