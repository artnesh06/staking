/**
 * Odds Wizard on the Cosmos Hub.
 *
 * Stargaze's public APIs (graphql/rpc/rest.stargaze-apis.com) are gone and
 * the Odds Wizard collection was migrated from Stargaze to a cw721 contract
 * on the Cosmos Hub (cosmoshub-4). This module reads that contract through
 * public REST (LCD) endpoints and returns data in the same shape the old
 * Stargaze GraphQL helpers returned, so callers keep working.
 *
 * Addresses: Stargaze and the Cosmos Hub both use coin type 118, so a
 * stars1... address and its cosmos1... form belong to the same key. All
 * owner lookups are done with the cosmos1 form.
 */

import { fromBech32, toBech32, toBase64, toUtf8 } from '@cosmjs/encoding';

/** Old Stargaze collection address -> migrated Cosmos Hub contract */
const MIGRATED_COLLECTIONS: Record<string, string> = {
  // slug used by the home page collection cards
  oddswizard: 'cosmos1yvwczgea2pz20thq4gn4xac7664p7h5w6s7ga5x9xhvxgmaczafsda5mze',
  stars1vjxr6hlkjkh0z5u9cnktftdqe8trhu4agcc0p7my4pejfffdsl5sd442c7:
    'cosmos1yvwczgea2pz20thq4gn4xac7664p7h5w6s7ga5x9xhvxgmaczafsda5mze'
};

function csv(value: string | undefined, fallback: string[]): string[] {
  const list = (value || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return list.length ? list : fallback;
}

const LCD_URLS = csv(process.env.COSMOS_LCD_URLS, [
  'https://cosmos-rest.publicnode.com',
  'https://rest.cosmos.directory/cosmoshub',
  'https://cosmos-api.polkachu.com'
]);

const IPFS_GATEWAYS = csv(process.env.IPFS_GATEWAYS, [
  'https://eu.orbitor.dev',
  'https://ipfs.orbitor.dev',
  'https://gateway.pinata.cloud',
  'https://w3s.link',
  'https://ipfs.io'
]);

/** Public gateway used in returned image URLs (shown by browsers). */
export const IMAGE_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY || IPFS_GATEWAYS[0];

/** stars1.../cosmos1... (same key) -> cosmos1... */
export function toCosmosAddress(address: string): string {
  if (!address) return address;
  try {
    const { prefix, data } = fromBech32(address);
    return prefix === 'cosmos' ? address : toBech32('cosmos', data);
  } catch {
    return address;
  }
}

/** cosmos1... -> stars1... (for records keyed by the old Stargaze address) */
export function toStarsAddress(address: string): string {
  if (!address) return address;
  try {
    const { prefix, data } = fromBech32(address);
    return prefix === 'stars' ? address : toBech32('stars', data);
  } catch {
    return address;
  }
}

/** Collection address as stored in the app/DB -> contract to query on the Cosmos Hub */
export function resolveContract(collectionAddress: string): string {
  return MIGRATED_COLLECTIONS[collectionAddress] || collectionAddress;
}

/** Only Cosmos Hub contract addresses can be queried (other Stargaze collections were not migrated). */
export function isQueryableContract(collectionAddress: string): boolean {
  return /^cosmos1[02-9ac-hj-np-z]{38,}$/.test(resolveContract(collectionAddress));
}

let preferredLcd = 0;

async function smartQuery<T>(contract: string, query: object): Promise<T> {
  // Works in the browser too (no Buffer)
  const encoded = toBase64(toUtf8(JSON.stringify(query)));
  let lastError = '';
  for (let i = 0; i < LCD_URLS.length; i++) {
    const index = (preferredLcd + i) % LCD_URLS.length;
    try {
      const res = await fetch(
        `${LCD_URLS[index]}/cosmwasm/wasm/v1/contract/${contract}/smart/${encoded}`,
        { signal: AbortSignal.timeout(10_000), cache: 'no-store' }
      );
      const body = await res.json().catch(() => null);
      if (res.ok && body && 'data' in body) {
        preferredLcd = index;
        return body.data as T;
      }
      if (body?.code === 2 && /not found/i.test(String(body?.message))) {
        throw Object.assign(new Error(String(body.message)), { notFound: true });
      }
      lastError = `HTTP ${res.status} ${body?.message ?? ''}`.trim();
    } catch (error) {
      if ((error as { notFound?: boolean }).notFound) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Cosmos Hub query failed: ${lastError}`);
}

export async function getOwnedTokenIds(owner: string, collectionAddress: string): Promise<string[]> {
  const contract = resolveContract(collectionAddress);
  const ownerAddr = toCosmosAddress(owner);
  const ids: string[] = [];
  let startAfter: string | undefined;
  for (let page = 0; page < 100; page++) {
    const data = await smartQuery<{ tokens: string[] }>(contract, {
      tokens: { owner: ownerAddr, limit: 100, ...(startAfter ? { start_after: startAfter } : {}) }
    });
    ids.push(...data.tokens);
    if (data.tokens.length < 100) break;
    startAfter = data.tokens[data.tokens.length - 1];
  }
  return ids.sort((a, b) => Number(a) - Number(b));
}

export async function getTokenOwner(collectionAddress: string, tokenId: string): Promise<string | null> {
  try {
    const data = await smartQuery<{ owner: string }>(resolveContract(collectionAddress), {
      owner_of: { token_id: tokenId }
    });
    return data.owner;
  } catch {
    return null;
  }
}

interface CollectionInfo {
  name: string;
  symbol: string;
  description: string | null;
  image: string | null;
  numTokens: number;
}

const collectionCache = new Map<string, { at: number; info: CollectionInfo }>();

export async function getCollectionInfo(collectionAddress: string): Promise<CollectionInfo> {
  const contract = resolveContract(collectionAddress);
  if (!isQueryableContract(collectionAddress)) {
    throw new Error(`Collection ${collectionAddress} is not on the Cosmos Hub`);
  }
  const cached = collectionCache.get(contract);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.info;

  const [info, count] = await Promise.all([
    smartQuery<{ name: string; symbol: string; extension?: { description?: string; image?: string } }>(contract, {
      get_collection_info_and_extension: {}
    }).catch(() => ({ name: 'Odds Wizard', symbol: 'ODDS', extension: {} as { description?: string; image?: string } })),
    smartQuery<{ count: number }>(contract, { num_tokens: {} }).catch(() => ({ count: 0 }))
  ]);
  const result: CollectionInfo = {
    name: info.name,
    symbol: info.symbol,
    description: info.extension?.description ?? null,
    image: info.extension?.image ? ipfsToHttp(info.extension.image) : null,
    numTokens: count.count
  };
  collectionCache.set(contract, { at: Date.now(), info: result });
  return result;
}

export function ipfsToHttp(uri: string, gateway: string = IMAGE_GATEWAY): string {
  if (!uri) return uri;
  if (uri.startsWith('ipfs://')) return `${gateway}/ipfs/${uri.slice(7).replace(/^ipfs\//, '')}`;
  return uri;
}

export interface TokenData {
  id: string;
  tokenId: string;
  name: string;
  description: string | null;
  mintedAt: string | null;
  image: string;
  media: { url: string; type: string };
  traits: Array<{ name: string; value: string; rarityPercent: number | null; rarity: string | null }>;
  collection: { name: string; contractAddress: string };
  owner?: { address: string; name: null } | null;
}

const metaCache = new Map<string, { at: number; meta: any }>();
const META_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchJson(uri: string): Promise<any | null> {
  const path = uri.startsWith('ipfs://')
    ? uri.slice(7).replace(/^ipfs\//, '')
    : uri.match(/\/ipfs\/(.+)$/)?.[1];
  const candidates = path ? IPFS_GATEWAYS.map((g) => `${g}/ipfs/${path}`) : [uri];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: 'follow' });
      if (res.ok) return await res.json();
    } catch {
      // next gateway
    }
  }
  return null;
}

async function getTokenMetadata(contract: string, tokenId: string): Promise<any | null> {
  const key = `${contract}:${tokenId}`;
  const hit = metaCache.get(key);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.meta;
  const info = await smartQuery<{ token_uri?: string; extension?: any }>(contract, { nft_info: { token_id: tokenId } });
  let meta: any = info.token_uri ? await fetchJson(info.token_uri) : null;
  if (!meta && info.extension && typeof info.extension === 'object') meta = info.extension;
  if (meta) metaCache.set(key, { at: Date.now(), meta });
  return meta;
}

/** One token in the shape of the old Stargaze GraphQL `token`. */
export async function getTokenData(collectionAddress: string, tokenId: string, withOwner = false): Promise<TokenData> {
  const contract = resolveContract(collectionAddress);
  const [meta, collection, owner] = await Promise.all([
    getTokenMetadata(contract, tokenId).catch(() => null),
    getCollectionInfo(collectionAddress).catch(() => null),
    withOwner ? getTokenOwner(collectionAddress, tokenId) : Promise.resolve(null)
  ]);
  const image = meta?.image ? ipfsToHttp(String(meta.image)) : '';
  const attributes: any[] = Array.isArray(meta?.attributes) ? meta.attributes : [];
  return {
    id: `${collectionAddress}-${tokenId}`,
    tokenId,
    name: meta?.name ? String(meta.name) : `${collection?.name ?? 'Odds Wizard'} #${tokenId}`,
    description: meta?.description ?? null,
    mintedAt: null,
    image,
    media: { url: image, type: 'image' },
    traits: attributes
      .filter((a) => a && (a.trait_type || a.name))
      .map((a) => ({ name: String(a.trait_type ?? a.name), value: String(a.value ?? ''), rarityPercent: null, rarity: null })),
    collection: { name: collection?.name ?? 'Odds Wizard', contractAddress: collectionAddress },
    owner: owner ? { address: owner, name: null } : null
  };
}

/** Run async work over items with bounded concurrency. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
