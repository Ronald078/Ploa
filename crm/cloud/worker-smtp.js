'use strict';
// Let Workers resolve the hostname for its native TLS connection. Nodemailer's
// custom multi-address lookup selects IPv6 first; workerd does not fall back
// from that unreachable address as Node's autoSelectFamily does.
function createWorkerSmtpTransport(createTransport, connect) {
  return options => createTransport({...options, getSocket(_options, callback) {
    let socket, settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { socket?.destroy(); callback(error); }
      else callback(null, {connection: socket, secured: true});
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('SMTP TLS timeout'), {code:'ETIMEDOUT',command:'CONN'})), 10000);
    try {
      socket = connect({host:'smtp.gmail.com',port:465,servername:'smtp.gmail.com',minVersion:'TLSv1.2',rejectUnauthorized:true}, () => finish());
      socket.once('error', finish);
    } catch (error) { finish(error); }
  }});
}
module.exports = {createWorkerSmtpTransport};
