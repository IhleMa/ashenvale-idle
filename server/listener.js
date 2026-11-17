// The network side of the server: plain HTTP, or HTTPS with automatic http:// → https:// redirects.
//
// With a certificate, the game port speaks both protocols: the first byte of a connection tells TLS
// (0x16, a handshake) from plain HTTP. TLS goes to the HTTPS server, plain HTTP gets a redirect to
// https:// on the same port — so http://game.example.com:25565 just works. An optional second port
// (HTTP_PORT, e.g. 80) does the same and answers Let's Encrypt http challenges.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export function createListener({ handler, onUpgrade, creds = null, tls = null, port, log = console.log }) {
  const servers = [];
  const answerChallenge = (req, res) => {
    const answer = tls?.challengeAnswer(new URL(req.url, 'http://x').pathname);
    if (answer == null) return false;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(answer);
    return true;
  };
  // samePort: the request came in on the game port itself. Keep whatever port the visitor used — none when
  // a proxy like Cloudflare forwarded it from port 80 (then https:// on 443 is right), the game port when they
  // typed http://host:PORT. Requests on HTTP_PORT always go to the game port.
  const redirect = (targetPort, samePort = false) => (req, res) => {
    if (answerChallenge(req, res)) return;
    const rawHost = String(req.headers.host || tls?.config.domain || 'localhost');
    const hostPort = /:(\d+)$/.exec(rawHost)?.[1];
    const host = rawHost.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const port = samePort ? (hostPort ? Number(hostPort) : 443) : targetPort;
    const portPart = port === 443 ? '' : `:${port}`;
    res.writeHead(308, { Location: `https://${host.includes(':') ? `[${host}]` : host}${portPart}${req.url || '/'}`, 'Content-Type': 'text/plain' });
    res.end('This server uses HTTPS.\n');
  };

  let main;
  if (!creds) {
    main = http.createServer((req, res) => { if (!answerChallenge(req, res)) handler(req, res); });
    main.on('upgrade', onUpgrade);
    servers.push(main);
  } else {
    const secure = https.createServer({ ...creds, minVersion: 'TLSv1.2' }, handler);
    secure.on('upgrade', onUpgrade);
    secure.on('tlsClientError', () => { /* scanners, old clients — not worth logging */ });
    const plain = http.createServer(redirect(port, true));
    // one port, both protocols
    main = net.createServer(socket => {
      socket.setTimeout(30_000, () => socket.destroy());
      socket.on('error', () => socket.destroy());
      socket.once('data', chunk => {
        socket.setTimeout(0);
        socket.pause();
        socket.unshift(chunk);
        (chunk[0] === 0x16 ? secure : plain).emit('connection', socket);
        process.nextTick(() => socket.resume());
      });
    });
    main.secureServer = secure;
    servers.push(main, secure, plain);
  }

  // optional second port: redirects (or, before a certificate exists, only ACME challenges)
  let extra = null;
  if (tls?.config.httpPort && tls.config.httpPort !== port) {
    extra = http.createServer(creds ? redirect(port) : (req, res) => {
      if (answerChallenge(req, res)) return;
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('HTTPS is being set up — try again in a minute.\n');
    });
    servers.push(extra);
  }

  return {
    secure: !!creds,
    listen(host, cb) {
      main.listen(port, host, cb);
      if (extra) {
        extra.on('error', e => log(`TLS: could not open HTTP_PORT ${tls.config.httpPort}: ${e.message}`));
        extra.listen(tls.config.httpPort, host);
      }
    },
    // swap the certificate without dropping connections
    setCredentials(c) { main.secureServer?.setSecureContext({ ...c, minVersion: 'TLSv1.2' }); },
    close(cb) {
      let left = 0;
      const done = () => { if (--left <= 0) cb?.(); };
      for (const s of servers) {
        if (s.listening) { left++; s.close(done); }
        s.closeAllConnections?.();
      }
      if (!left) cb?.();
    },
  };
}
