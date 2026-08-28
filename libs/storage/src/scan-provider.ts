import { Socket } from 'net';

export interface ScanResult {
  clean: boolean;
  /** The signature clamd reported, when infected — surfaced in the audit event, never shown to the uploader verbatim beyond a generic "rejected" message (avoids confirming exact malware identity to an attacker probing detection). */
  signature?: string;
}

/**
 * Malware-scan abstraction for the `scan` worker stage (ADR-0003). Same
 * Fake/real-binding shape as `StorageProvider` — a fully-wired Fake makes
 * the stage's control flow (infected → `documents.status = failed` + audit)
 * testable without a real antivirus engine.
 */
export interface ScanProvider {
  scan(data: Buffer): Promise<ScanResult>;
}

/**
 * The standard EICAR antivirus test string (not a real virus — a signature
 * every real AV engine is designed to flag) — recognized here so a fixture
 * can exercise the reject path deterministically without a real engine.
 * https://www.eicar.org/download-anti-malware-testfile/ — a widely published,
 * intentionally-benign test string, not a secret or an exploit.
 */
const EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Dev/test binding — never flags anything infected except the EICAR test string, so the reject path stays testable. */
export class FakePassThroughScanProvider implements ScanProvider {
  async scan(data: Buffer): Promise<ScanResult> {
    if (data.includes(EICAR_SIGNATURE)) {
      return { clean: false, signature: 'Eicar-Test-Signature' };
    }
    return { clean: true };
  }
}

/**
 * Real clamd binding over the INSTREAM protocol (ADR-0003) — a plain TCP/Unix
 * socket exchange, no client library dependency needed. Not exercised by any
 * test: like `GcsStorageProvider`/`OciStorageProvider`, it needs a live clamd
 * daemon this environment doesn't have.
 */
export class ClamdScanProvider implements ScanProvider {
  constructor(private readonly opts: { host: string; port: number; timeoutMs?: number }) {}

  scan(data: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      const timeoutMs = this.opts.timeoutMs ?? 15 * 60_000; // matches ADR-0003's OCR-stage-scale ceiling; scan itself is far faster in practice

      socket.setTimeout(timeoutMs);
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error('ClamdScanProvider: scan timed out'));
      });
      socket.once('error', reject);

      socket.connect(this.opts.port, this.opts.host, () => {
        socket.write('zINSTREAM\0');

        // clamd's INSTREAM protocol: each chunk is a 4-byte big-endian length prefix followed by
        // the chunk bytes; a zero-length chunk terminates the stream.
        const CHUNK_SIZE = 64 * 1024;
        for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
          const chunk = data.subarray(offset, Math.min(offset + CHUNK_SIZE, data.length));
          const lengthPrefix = Buffer.alloc(4);
          lengthPrefix.writeUInt32BE(chunk.length, 0);
          socket.write(lengthPrefix);
          socket.write(chunk);
        }
        const zeroLength = Buffer.alloc(4);
        socket.write(zeroLength);
      });

      socket.on('data', (chunk) => chunks.push(chunk));
      socket.once('close', () => {
        const response = Buffer.concat(chunks).toString('utf8').replace(/\0$/, '');
        // "stream: OK" (clean) or "stream: <signature> FOUND" (infected).
        const foundMatch = response.match(/stream:\s*(.+)\s+FOUND$/);
        if (foundMatch) {
          resolve({ clean: false, signature: foundMatch[1] });
        } else {
          resolve({ clean: true });
        }
      });
    });
  }
}
