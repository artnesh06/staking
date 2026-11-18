'use client';

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

/**
 * Client side of wallet sessions (see lib/auth/wallet-session.ts).
 *
 * The connected wallet registers a signer with setLoginSigner(). When an API
 * call answers 401 WALLET_SESSION_REQUIRED, the user is asked to sign the
 * login message once and the request is retried.
 */

export type LoginSigner = {
  address: string;
  /** Signs `message` with the connected wallet (ADR-36 result for Cosmos, hex for EVM). */
  sign: (message: string) => Promise<unknown>;
};

let signer: LoginSigner | null = null;
let pending: Promise<void> | null = null;

export function setLoginSigner(next: LoginSigner | null) {
  signer = next;
}

export function buildLoginMessage(address: string, issuedAt: string): string {
  // Must match lib/auth/wallet-session.ts
  return [
    'Odds Garden - sign in',
    `Address: ${address}`,
    `Issued At: ${issuedAt}`,
    '',
    'Signing is free and does not send a transaction.'
  ].join('\n');
}

export async function loginWithWallet(): Promise<void> {
  if (!signer) throw new Error('Connect your wallet first');
  if (pending) return pending;
  const current = signer;
  pending = (async () => {
    const issuedAt = new Date().toISOString();
    const signature = await current.sign(buildLoginMessage(current.address, issuedAt));
    await axios.post('/api/auth/wallet', { address: current.address, issuedAt, signature }, { headers: { 'x-skip-login-retry': '1' } });
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export async function logoutWallet(): Promise<void> {
  await axios.delete('/api/auth/wallet').catch(() => undefined);
}

let installed = false;

/** Retries a request once after signing in when the API requires a wallet session. */
export function installLoginInterceptor() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  axios.interceptors.response.use(undefined, async (error: AxiosError<any>) => {
    const config = error.config as (InternalAxiosRequestConfig & { _loginRetried?: boolean }) | undefined;
    if (
      error.response?.status === 401 &&
      error.response?.data?.code === 'WALLET_SESSION_REQUIRED' &&
      config &&
      !config._loginRetried &&
      !config.headers?.['x-skip-login-retry'] &&
      signer
    ) {
      config._loginRetried = true;
      await loginWithWallet();
      return axios.request(config);
    }
    throw error;
  });
}
