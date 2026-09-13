import Pusher from 'pusher';

let client;

export function getPusher() {
  if (!client) {
    const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;
    if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) {
      throw new Error('Pusher env vars are not fully configured.');
    }
    client = new Pusher({
      appId: PUSHER_APP_ID,
      key: PUSHER_KEY,
      secret: PUSHER_SECRET,
      cluster: PUSHER_CLUSTER,
      useTLS: true,
    });
  }
  return client;
}

export function userChannel(accountId) {
  return `private-user-${accountId}`;
}

export function callChannel(callId) {
  return `private-call-${callId}`;
}
