/**
 * Wallet sessions.
 *
 * The API used to trust whatever `wallet_address` a client sent, so anyone
 * could spend another wallet's points, claim its rewards or act as an admin.
 * Now a wallet proves ownership once by signing a login message
 * (Keplr/Leap: ADR-36 signArbitrary, EVM wallets: personal_sign); the server
 * answers with an HttpOnly cookie signed with SESSION_SECRET. Routes then
 * require that the session wallet matches the wallet they act for.
 *
 * Address forms of the same key (stars1/cosmos1/init1/0x) are treated as the
 * same wallet.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { fromBech32, fromBase64, toBase64, toUtf8, toHex } from '@cosmjs/encoding';
import { makeSignDoc, serializeSignDoc, pubkeyToAddress } from '@cosmjs/amino';
import { Secp256k1, Secp256k1Signature, sha256 } from '@cosmjs/crypto';
import { verifyMessage } from 'ethers';
import getConfig from '@/config/config';

export const SESSION_COOKIE = 'og_session';
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const LOGIN_MAX_AGE_MS = 10 * 60 * 1000;

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || '';
  if (s.length < 32) throw new Error('SESSION_SECRET (>= 32 chars) is not configured');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Message the wallet signs to log in. Must match the client (lib/auth/login-message.ts). */
export function buildLoginMessage(address: string, issuedAt: string): string {
  return [
    'Odds Garden - sign in',
    `Address: ${address}`,
    `Issued At: ${issuedAt}`,
    '',
    'Signing is free and does not send a transaction.'
  ].join('\n');
}

/** Raw key bytes (hex) behind an address, so stars1/cosmos1/init1 forms compare equal. */
export function walletKey(address: string | null | undefined): string | null {
  if (!address) return null;
  const a = address.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return a.slice(2).toLowerCase();
  try {
    return toHex(fromBech32(a).data);
  } catch {
    return null;
  }
}

export function sameWallet(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = walletKey(a);
  const kb = walletKey(b);
  return !!ka && ka === kb;
}

export function createSessionToken(address: string): string {
  const payload = Buffer.from(
    JSON.stringify({ a: address, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readSession(request: NextRequest): string | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 2048) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(sig);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data?.a !== 'string' || typeof data?.exp !== 'number') return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data.a;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge
  };
}

export interface LoginProof {
  address: string;
  issuedAt: string;
  /** Cosmos: { pub_key: { value }, signature } from signArbitrary. EVM: hex signature string. */
  signature: string | { pub_key: { type?: string; value: string }; signature: string };
}

/** Returns null when the proof is valid, otherwise the reason. */
export async function verifyLoginProof(proof: LoginProof): Promise<string | null> {
  const { address, issuedAt, signature } = proof;
  if (!address || !issuedAt || !signature) return 'Missing fields';

  const issued = Date.parse(issuedAt);
  const now = Date.now();
  if (!Number.isFinite(issued) || issued < now - LOGIN_MAX_AGE_MS || issued > now + 60_000) {
    return 'Login signature expired, please sign again';
  }
  const message = buildLoginMessage(address, issuedAt);

  // EVM signatures (personal_sign): 0x... addresses, or bech32 addresses of
  // EVM-style chains (e.g. Initia init1...) that wrap the same 20 bytes.
  if (typeof signature === 'string') {
    try {
      const recovered = verifyMessage(message, signature);
      return sameWallet(recovered, address) ? null : 'Invalid signature';
    } catch {
      return 'Invalid signature';
    }
  }

  // Cosmos (bech32) wallets: ADR-36
  if (!signature?.pub_key?.value || !signature.signature) {
    return 'Invalid signature';
  }
  try {
    const prefix = fromBech32(address).prefix;
    const derived = pubkeyToAddress({ type: 'tendermint/PubKeySecp256k1', value: signature.pub_key.value }, prefix);
    if (derived !== address) return 'Public key does not match address';
    const doc = makeSignDoc(
      [{ type: 'sign/MsgSignData', value: { signer: address, data: toBase64(toUtf8(message)) } }],
      { gas: '0', amount: [] },
      '',
      '',
      0,
      0
    );
    const ok = await Secp256k1.verifySignature(
      Secp256k1Signature.fromFixedLength(fromBase64(signature.signature)),
      sha256(serializeSignDoc(doc)),
      fromBase64(signature.pub_key.value)
    );
    return ok ? null : 'Invalid signature';
  } catch {
    return 'Invalid signature';
  }
}

function unauthorized(message = 'Sign in with your wallet to continue') {
  return NextResponse.json({ message, code: 'WALLET_SESSION_REQUIRED' }, { status: 401 });
}

/**
 * Requires a wallet session. If `actingFor` is given, the session wallet must
 * be that wallet. Returns the session address, or a response to return.
 */
export function requireWallet(request: NextRequest, actingFor?: string | null): string | NextResponse {
  const session = readSession(request);
  if (!session) return unauthorized();
  if (actingFor && !sameWallet(session, actingFor)) {
    return NextResponse.json({ message: 'This action belongs to another wallet' }, { status: 403 });
  }
  return session;
}

export function isAdminWallet(address: string | null | undefined): boolean {
  const owners: string[] = getConfig()?.owners ?? [];
  return owners.some((o) => sameWallet(o, address));
}

/** Requires a wallet session that belongs to an admin (config.owners). */
export function requireAdmin(request: NextRequest): string | NextResponse {
  const session = readSession(request);
  if (!session) return unauthorized('Admin sign-in required');
  if (!isAdminWallet(session)) {
    return NextResponse.json({ message: 'Admin only' }, { status: 403 });
  }
  return session;
}
