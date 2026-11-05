// Dependency-free Keccak-256 (Ethereum variant, 0x01 padding). Not SHA3-256.
const MASK = (1n << 64n) - 1n;
const rotl = (x: bigint, n: number): bigint =>
  n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;

const RC: bigint[] = (() => {
  const out: bigint[] = [];
  let R = 1;
  for (let i = 0; i < 24; i++) {
    let rc = 0n;
    for (let j = 0; j < 7; j++) {
      const bit = R & 1;
      R = R & 0x80 ? ((R << 1) ^ 0x71) & 0xff : (R << 1) & 0xff;
      if (bit) rc ^= 1n << BigInt((1 << j) - 1);
    }
    out.push(rc);
  }
  return out;
})();

function keccakF(A: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    const C = new Array<bigint>(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) A[x + y] ^= D;
    }
    let x = 1, y = 0, cur = A[1];
    for (let t = 0; t < 24; t++) {
      [x, y] = [y, (2 * x + 3 * y) % 5];
      const idx = x + 5 * y;
      const tmp = A[idx];
      A[idx] = rotl(cur, (((t + 1) * (t + 2)) / 2) % 64);
      cur = tmp;
    }
    for (let yy = 0; yy < 25; yy += 5) {
      const row = A.slice(yy, yy + 5);
      for (let xx = 0; xx < 5; xx++) A[yy + xx] = row[xx] ^ (~row[(xx + 1) % 5] & MASK & row[(xx + 2) % 5]);
    }
    A[0] ^= RC[round];
  }
}

export function keccak256(data: Uint8Array): Uint8Array {
  const rate = 136;
  const padLen = rate - (data.length % rate);
  const msg = new Uint8Array(data.length + padLen);
  msg.set(data);
  msg[data.length] ^= 0x01;
  msg[msg.length - 1] ^= 0x80;
  const A = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < msg.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(msg[off + i * 8 + b]);
      A[i] ^= lane;
    }
    keccakF(A);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = A[i];
    for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; }
  }
  return out;
}
