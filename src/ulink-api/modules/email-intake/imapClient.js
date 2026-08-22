const { ImapFlow } = require('imapflow');
const config = require('../../config');
const logger = require('../../utils/logger');

function assertConfigured() {
  if (!config.imap.host || !config.imap.user || !config.imap.password) {
    throw new Error('IMAP_HOST, IMAP_USER, and IMAP_PASSWORD must be configured');
  }
}

/**
 * Fetch unseen messages (up to fetchLimit) and hand each one to onMessage
 * with its full raw source. Only flags a message \Seen after onMessage
 * resolves successfully, so a crash mid-run leaves it to be retried on the
 * next cron tick instead of being silently skipped.
 */
async function processUnseenMessages(onMessage) {
  assertConfigured();

  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user: config.imap.user, pass: config.imap.password },
    logger: false,
    // Explicit and shorter than imapflow's own defaults, so a stalled TLS
    // handshake or unresponsive server fails fast (and gets logged, since
    // the job route runs this in the background) instead of stalling
    // indefinitely.
    socketTimeout: config.imap.socketTimeoutMs,
    connectionTimeout: config.imap.connectionTimeoutMs,
    greetingTimeout: config.imap.greetingTimeoutMs,
  });

  // imapflow emits 'error' on the client itself for connection issues that
  // happen AFTER connect() has already resolved (e.g. a socket timeout mid-
  // fetch/idle) — see emitError() in imapflow's source, it only rejects the
  // connect() promise while that promise is still pending, otherwise it
  // falls back to client.emit('error', ...). An EventEmitter's unhandled
  // 'error' event is fatal in Node (throws and crashes the whole process),
  // so this listener is required, not optional — this is what crashed the
  // API process previously. The resulting failure still surfaces normally:
  // whatever call was in flight when the connection dies (fetch iteration,
  // messageFlagsAdd, etc.) rejects on its own once the socket actually
  // closes, which propagates through the try/finally below as usual.
  client.on('error', (err) => {
    logger.error('IMAP connection error', { error: err.message, stack: err.stack });
  });

  const results = [];
  let connected = false;
  let lock;

  try {
    await client.connect();
    connected = true;

    lock = await client.getMailboxLock(config.imap.folder);
    const unseenUids = await client.search({ seen: false });
    const limited = unseenUids.slice(0, config.imap.fetchLimit);

    // Phase 1: drain the FETCH stream as fast as possible — no slow work
    // here, just pull raw messages off the wire. Keeps the IMAP connection
    // "mid-command" for as short a time as possible.
    const fetched = [];
    for await (const message of client.fetch(limited, { uid: true, envelope: true, internalDate: true, source: true })) {
      fetched.push(message);
    }

    // Phase 2: do the slow per-message work (DB transaction, attachment
    // writes via onMessage) with the FETCH command already complete, so a
    // slow message can no longer leave an IMAP command open and idle for the
    // whole batch's duration.
    for (const message of fetched) {
      try {
        const outcome = await onMessage(message);
        await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
        results.push({ uid: message.uid, ok: true, ...outcome });
      } catch (error) {
        results.push({ uid: message.uid, ok: false, error: error.message });
      }
    }
  } finally {
    if (lock) lock.release();
    if (connected) {
      await client.logout().catch(() => undefined);
    }
  }

  return results;
}

module.exports = { processUnseenMessages };
