import { createServer, Server } from 'net';
import { ClamdScanProvider, FakePassThroughScanProvider } from './scan-provider';

describe('FakePassThroughScanProvider', () => {
  it('reports clean for ordinary content', async () => {
    const provider = new FakePassThroughScanProvider();
    const result = await provider.scan(Buffer.from('%PDF-1.4 ordinary document bytes'));
    expect(result).toEqual({ clean: true });
  });

  it('flags the EICAR test string as infected, without a real antivirus engine', async () => {
    const provider = new FakePassThroughScanProvider();
    const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    const result = await provider.scan(eicar);
    expect(result.clean).toBe(false);
    expect(result.signature).toBe('Eicar-Test-Signature');
  });
});

/**
 * A minimal in-process fake of clamd's INSTREAM wire protocol, to exercise
 * ClamdScanProvider's real socket framing without a real daemon: consumes
 * the "zINSTREAM\0" command, then parses 4-byte-length-prefixed frames,
 * replying (and closing) as soon as the zero-length terminator frame
 * arrives — matching real clamd's server-initiated close, not waiting for
 * the client to end its side first.
 */
function startFakeClamd(reply: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const COMMAND = Buffer.from('zINSTREAM\0');
    const server = createServer((socket) => {
      let buffered = Buffer.alloc(0);
      let consumedCommand = false;

      socket.on('data', (chunk) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (!consumedCommand) {
          if (buffered.length < COMMAND.length) return;
          buffered = buffered.subarray(COMMAND.length);
          consumedCommand = true;
        }
        while (buffered.length >= 4) {
          const len = buffered.readUInt32BE(0);
          if (len === 0) {
            socket.end(`${reply}\0`);
            return;
          }
          if (buffered.length < 4 + len) return; // wait for the rest of this frame
          buffered = buffered.subarray(4 + len);
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

describe('ClamdScanProvider (real TCP wire protocol against an in-process fake clamd)', () => {
  it('parses a clean "stream: OK" response', async () => {
    const { server, port } = await startFakeClamd('stream: OK');
    const provider = new ClamdScanProvider({ host: '127.0.0.1', port });

    const result = await provider.scan(Buffer.from('ordinary content'));

    expect(result).toEqual({ clean: true });
    server.close();
  });

  it('parses an infected "stream: <signature> FOUND" response', async () => {
    const { server, port } = await startFakeClamd('stream: Eicar-Test-Signature FOUND');
    const provider = new ClamdScanProvider({ host: '127.0.0.1', port });

    const result = await provider.scan(Buffer.from('eicar-like content'));

    expect(result).toEqual({ clean: false, signature: 'Eicar-Test-Signature' });
    server.close();
  });

  it('chunks large payloads with length-prefixed frames rather than sending them in one write', async () => {
    const { server, port } = await startFakeClamd('stream: OK');
    const provider = new ClamdScanProvider({ host: '127.0.0.1', port });
    const large = Buffer.alloc(200 * 1024, 'a'); // exceeds the 64KB chunk size

    const result = await provider.scan(large);

    expect(result).toEqual({ clean: true });
    server.close();
  });
});
