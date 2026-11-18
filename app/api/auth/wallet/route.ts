import { NextRequest, NextResponse } from 'next/server';
import {
  createSessionToken,
  readSession,
  sessionCookie,
  verifyLoginProof,
  isAdminWallet
} from '@/lib/auth/wallet-session';

export const dynamic = 'force-dynamic';

/** GET: current session wallet (if any). */
export async function GET(request: NextRequest) {
  const address = readSession(request);
  return NextResponse.json({ address, isAdmin: address ? isAdminWallet(address) : false });
}

/** POST { address, issuedAt, signature }: verify the signed login message and start a session. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.address !== 'string' || typeof body.issuedAt !== 'string') {
    return NextResponse.json({ message: 'Invalid request' }, { status: 400 });
  }
  const invalid = await verifyLoginProof({
    address: body.address,
    issuedAt: body.issuedAt,
    signature: body.signature
  });
  if (invalid) return NextResponse.json({ message: invalid }, { status: 401 });

  const response = NextResponse.json({ address: body.address, isAdmin: isAdminWallet(body.address) });
  response.cookies.set(sessionCookie(createSessionToken(body.address)));
  return response;
}

/** DELETE: sign out. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie('', 0));
  return response;
}
