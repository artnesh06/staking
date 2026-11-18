import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Active, DataRef, Over } from '@dnd-kit/core';
import { ColumnDragData } from '@/components/kanban/board-column';
import { TaskDragData } from '@/components/kanban/task-card';
import { NETWORK_CONSTANT, REWARD_PERIODE } from '@/constants';
import axios, { AxiosError } from 'axios';
import {
  FetchAllStargazeTokensOptions,
  OwnedTokensResponse,
  Token
} from '@/types';
import getConfig from '@/config/config';
import {
  getOwnedTokenIds,
  getTokenData,
  getCollectionInfo,
  mapLimit
} from '@/lib/stargaze/cosmoshub-nft';
import { mst_attributes_reward } from '@prisma/client';
import moment from 'moment';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import {
  SigningCosmWasmClient,
  CosmWasmClient
} from '@cosmjs/cosmwasm-stargate';
import { GasPrice } from '@cosmjs/stargate';
import { OPERATOR_CONSTANTS } from '@/constants/filterConstant';
import { UTApi } from 'uploadthing/server';
import { getAddress, isAddress } from 'ethers';
import { fromBech32, fromHex, toBech32, toHex } from '@cosmjs/encoding';
export { AddressUtils } from './address-utils';

const config = getConfig();

type DraggableData = ColumnDragData | TaskDragData;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function hasDraggableData<T extends Active | Over>(
  entry: T | null | undefined
): entry is T & {
  data: DataRef<DraggableData>;
} {
  if (!entry) {
    return false;
  }

  const data = entry.data.current;

  if (data?.type === 'Column' || data?.type === 'Task') {
    return true;
  }

  return false;
}

export function formatAmount(amount: number | undefined | null) {
  if (!amount) return '0';
  return amount.toLocaleString('en-US'); // Menggunakan lokasi 'en-US' untuk memastikan koma sebagai pemisah ribuan
}

export function formatNumber(num: number | string | null | undefined): string {
  if (!num) return '0';

  const numStr = num.toString();
  // Remove any existing commas first
  const cleanNum = numStr.replace(/,/g, '');

  // Convert to number and back to string to handle edge cases
  const number = parseFloat(cleanNum);
  if (isNaN(number)) return '0';

  // Add comma every 3 digits from the right
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatOddsPoints(
  points: number | string | null | undefined
): string {
  return `✧ ${formatNumber(points)} Odds`;
}

export default function calculatePoint(
  attrreward: mst_attributes_reward,
  lastClaimDate?: Date | null
): number {
  // Validate input
  if (!attrreward) return 0;

  // Get current time
  const currentTime = new Date();

  // If lastClaimDate is undefined, calculate for 1 full period
  if (!lastClaimDate) {
    switch (attrreward.attr_periode) {
      case REWARD_PERIODE.MINUTE:
      case REWARD_PERIODE.HOUR:
      case REWARD_PERIODE.DAY:
        return attrreward.attr_reward || 0;

      default:
        return 0;
    }
  }

  // Calculate time difference
  const timeDifferenceMs = currentTime.getTime() - lastClaimDate.getTime();

  // Calculate points based on reward period
  switch (attrreward.attr_periode) {
    case REWARD_PERIODE.MINUTE:
      // Calculate points for minute-based rewards
      const minutesPassed = timeDifferenceMs / (1000 * 60);
      const minuteReward = (minutesPassed * (attrreward.attr_reward || 0)) / 60;
      return minuteReward || 0;

    case REWARD_PERIODE.HOUR:
      // Calculate points for hour-based rewards
      const hoursPassed = timeDifferenceMs / (1000 * 60 * 60);
      const hourReward = (hoursPassed * (attrreward.attr_reward || 0)) / 24;
      return hourReward || 0;

    case REWARD_PERIODE.DAY:
      // Calculate points for day-based rewards
      const daysPassed = timeDifferenceMs / (1000 * 60 * 60 * 24);
      const dayReward = daysPassed * (attrreward.attr_reward || 0);
      return dayReward || 0;

    default:
      // If an unknown period is provided, return 0
      return 0;
  }
}

interface FetchStargazeTokensOptions {
  owner: string;
  collectionAddresses?: string[]; // Changed from single address to array
  maxTokens?: number;
  sortBy?: string;
  limit?: number;
  offset?: number;
  filterForSale?: string;
}

// ---------------------------------------------------------------------------
// Odds Wizard NFT data (Cosmos Hub). These keep the names and return shapes of
// the former Stargaze GraphQL helpers; Stargaze's APIs no longer exist and the
// collection now lives on the Cosmos Hub (see lib/stargaze/cosmoshub-nft.ts).
// ---------------------------------------------------------------------------

export async function fetchStargazeTokens(
  options: FetchStargazeTokensOptions
): Promise<OwnedTokensResponse> {
  const {
    owner,
    collectionAddresses,
    maxTokens = Infinity,
    limit = 10,
    offset = 0
  } = options;

  const collections = (collectionAddresses || []).filter(Boolean);
  if (!owner || collections.length === 0) {
    return { tokens: [], pageInfo: { total: 0, limit, offset } };
  }

  // Owned token ids across the requested collections
  const owned: Array<{ collection: string; tokenId: string }> = [];
  for (const collection of collections) {
    try {
      const ids = await getOwnedTokenIds(owner, collection);
      ids.forEach((tokenId) => owned.push({ collection, tokenId }));
    } catch (error) {
      console.error(`Error fetching tokens for ${collection}:`, error);
      throw error;
    }
  }

  const pageSize = Math.min(limit, maxTokens);
  const page = owned.slice(offset, offset + pageSize);
  const tokens = await mapLimit(page, 8, ({ collection, tokenId }) =>
    getTokenData(collection, tokenId)
  );

  return {
    tokens: tokens as unknown as Token[],
    pageInfo: { total: owned.length, limit: pageSize, offset }
  };
}

export async function fetchAllStargazeTokens(
  options: FetchAllStargazeTokensOptions
): Promise<Token[]> {
  const { owner, collectionAddress } = options;
  if (!owner || !collectionAddress) return [];
  const ids = await getOwnedTokenIds(owner, collectionAddress);
  const tokens = await mapLimit(ids, 8, (tokenId) =>
    getTokenData(collectionAddress, tokenId)
  );
  return tokens as unknown as Token[];
}

export async function getCollection(collection_address: string): Promise<any> {
  try {
    const info = await getCollectionInfo(collection_address);
    return {
      __typename: 'Collection',
      contractAddress: collection_address,
      name: info.name,
      description: info.description,
      image: info.image,
      floor: null,
      highestOffer: null,
      tokenCounts: { total: info.numTokens, active: info.numTokens, listed: 0 },
      stats: null
    };
  } catch (error) {
    // Collections that are not on the Cosmos Hub have no live stats
    return {
      __typename: 'Collection',
      contractAddress: collection_address,
      floor: null,
      highestOffer: null,
      tokenCounts: { total: 0, active: 0, listed: 0 },
      stats: null
    };
  }
}

/** Stargaze Names no longer resolvable: no associated name. */
export async function getAssosiatedName(_associated_address: string) {
  return null;
}

export async function getToken(collectionAddr: string, tokenId: string) {
  return (await getTokenData(collectionAddr, tokenId, true)) as any;
}

export async function getLaunchpad(address: string, walletAddress?: string) {
  if (!config) throw Error('Config not found');

  const query = `query MinterV2($address: String!, $walletAddress: String) {
    collection(address: $address) {
      __typename
      contractAddress
      contractUri
      name
      description
      website
      isExplicit
      minterAddress
      featured
      floor {
        amount
        amountUsd
        denom
        symbol
        __typename
      }
      creator {
        address
        name {
          name
          records {
            name
            value
            verified
            __typename
          }
          __typename
        }
        __typename
      }
      royaltyInfo {
        sharePercent
        __typename
      }
      minterV2(walletAddress: $walletAddress) {
        ...MinterV2Fields
        __typename
      }
      startTradingTime
      media {
        ...MediaFields
        __typename
      }
    }
  }

  fragment MinterV2Fields on MinterV2 {
    minterType
    minterAddress
    mintableTokens
    mintedTokens
    airdroppedTokens
    numTokens
    currentStage {
      id
      name
      type
      presaleType
      status
      startTime
      endTime
      salePrice {
        denom
        symbol
        amount
        amountUsd
        __typename
      }
      discountPrice {
        denom
        symbol
        amount
        amountUsd
        __typename
      }
      burnConditions {
        collectionAddress
        amountToBurn
        __typename
      }
      addressTokenCounts {
        limit
        mintable
        minted
        __typename
      }
      stageCounts {
        limit
        mintable
        minted
        __typename
      }
      numMembers
      isMember
      proofs
      __typename
    }
    mintStages {
      discountPrice {
        amount
        amountUsd
        denom
        symbol
        __typename
      }
      salePrice {
        amount
        amountUsd
        denom
        symbol
        __typename
      }
      burnConditions {
        collectionAddress
        amountToBurn
        __typename
      }
      status
      type
      id
      presaleType
      startTime
      endTime
      name
      isMember
      numMembers
      proofs
      addressTokenCounts {
        limit
        mintable
        minted
        __typename
      }
      stageCounts {
        limit
        mintable
        minted
        __typename
      }
      __typename
    }
    __typename
  }

  fragment MediaFields on Media {
    type
    url
    height
    width
    visualAssets {
      xs {
        type
        url
        height
        width
        staticUrl
        __typename
      }
      sm {
        type
        url
        height
        width
        staticUrl
        __typename
      }
      md {
        type
        url
        height
        width
        staticUrl
        __typename
      }
      lg {
        type
        url
        height
        width
        staticUrl
        __typename
      }
      xl {
        type
        url
        height
        width
        staticUrl
        __typename
      }
      __typename
    }
    __typename
  }`;

  try {
    const response = await fetch(
      `${config.graphql_url}?t=${new Date().getTime()}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache', // Untuk kompatibilitas dengan HTTP/1.0
          Expires: '0' // Untuk memastikan browser lama juga tidak menyimpan cache
        },
        body: JSON.stringify({
          query,
          variables: {
            address,
            walletAddress
          },
          operationName: 'MinterV2'
        })
      }
    );

    const data = await response.json();
    return data.data.collection;
  } catch (error) {
    console.error('Error fetching launchpad data:', error);
    throw error;
  }
}

export function formatToStars(value?: string | number): number {
  if (!value) return 0;
  let number = typeof value === 'string' ? parseFloat(value) : value;

  number /= 1000000;

  // return formatDecimal(number, 2);
  return number;
}

export function formatDecimal(
  value?: string | number | null | undefined,
  decimal: number = 2
): string {
  if (!value) return '0';

  // Convert string to number if needed
  let number = typeof value === 'string' ? parseFloat(value) : value;

  // Format based on size
  if (number >= 1_000_000) {
    // For millions
    const divided = number / 1_000_000;
    const isWholeAfterDivision = Number.isInteger(divided);
    return isWholeAfterDivision
      ? `${Math.floor(divided)}M`
      : `${divided.toFixed(decimal)}M`;
  } else if (number >= 1_000) {
    // For thousands
    const divided = number / 1_000;
    const isWholeAfterDivision = Number.isInteger(divided);
    return isWholeAfterDivision
      ? `${Math.floor(divided)}K`
      : `${divided.toFixed(decimal)}K`;
  }

  // For numbers less than 1000
  const isWholeNumber = Number.isInteger(number);
  const startsWithZero = number < 1 && number > 0;

  if (isWholeNumber) {
    return `${Math.floor(number)}`;
  } else if (startsWithZero) {
    // If number starts with 0 (like 0.5, 0.25), return as is without toFixed
    return `${number}`;
  } else {
    // For other decimal numbers (like 2.5, 3.55), use toFixed
    return `${number.toFixed(decimal)}`;
  }
}

export function formatAddress(address: string | undefined) {
  if (!address) return '';
  return `${address.substring(5, 9)}...${address.substring(
    address.length - 4
  )}`;
}

export function formatDate(date: Date, format = 'YYYY-MM-DD HH:mm:ss') {
  if (date == null) return;
  return moment(date).format(format);
}

export function extractCollectionAndTokenId(url: string) {
  const regex = /\/m\/([^/]+)\/(\d+)/;
  const match = url?.match(regex);

  if (match) {
    return {
      collection: match[1],
      tokenId: match[2]
    };
  } else {
    // throw new Error("URL format is invalid");
    return {
      collection: undefined,
      tokenId: undefined
    };
  }
}

export async function transferNFT(
  mnemonic: string,
  contractAddress: string,
  recipientAddress: string,
  tokenId: string
) {
  try {
    const rpcEndpoint = config?.rpc_url ?? ''; // Ganti dengan RPC Stargaze yang valid
    // Create wallet instance from mnemonic
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: 'stars' // Stargaze address prefix
    });

    // Get the wallet address
    const [firstAccount] = await wallet.getAccounts();
    console.log('Sender address:', firstAccount.address);

    // Create signing client
    const client = await SigningCosmWasmClient.connectWithSigner(
      rpcEndpoint,
      wallet,
      {
        gasPrice: GasPrice.fromString('0.025ustars')
      }
    );

    // Prepare transfer message
    const transferMsg = {
      transfer_nft: {
        recipient: recipientAddress,
        token_id: tokenId
      }
    };

    // Execute transfer
    const result = await client.execute(
      firstAccount.address,
      contractAddress,
      transferMsg,
      'auto', // automatic gas estimation
      '', // memo
      [] // funds
    );

    console.log('Transfer successful!');
    console.log('Transaction hash:', result.transactionHash);
    return result;
  } catch (error) {
    console.error('Error during transfer:', error);
    throw error;
  }
}

export const arrayToString = (arr: any) => {
  return '[' + arr.join(', ') + ']';
};

export const addSearch = (
  column: any,
  value: any | undefined,
  opr: any,
  opr2?: any
) => {
  if (!value) return;
  return {
    column,
    value,
    opr,
    opr2
  };
};

export const buildSearch = (data: any, params: any) => {
  if (!data) return;

  let filterStr = '';
  let i = 0;
  for (let filter of data) {
    if (!filter) continue;
    let comma = i > 0 ? ',' : '';
    if (OPERATOR_CONSTANTS.LIKE == filter.opr) {
      filterStr += `${comma}${filter.column}=%${filter.value}%`;
    } else {
      if (Array.isArray(filter.value)) {
        if (filter.value.length == 0) continue;
        let value = encodeURIComponent(
          '[' + buildSearch(filter.value, undefined) + ']'
        );

        filterStr += `${comma}${filter.column}${filter.opr}${value}`;
      } else {
        filterStr += `${comma}${filter.column}${filter.opr}${filter.value}`;
      }
    }

    if (filter.opr2 != undefined && filter.opr2 != null) {
      filterStr += ':' + filter.opr2;
    }

    i++;
  }

  if (filterStr == '') return;

  if (params) {
    params['filter'] = filterStr;
  }

  return filterStr;
};

export const uploadFile = async (file: File) => {
  const utapi = new UTApi({
    token: process.env.UPLOADTHING_TOKEN // Gunakan environment variable
  });

  // uploadFiles mengembalikan Promise, jadi perlu await
  const uploadResult = await utapi.uploadFiles(file);

  return uploadResult.data?.url;
};

export async function getUserStakedNFTs(
  userAddress: string,
  daoAddress: string
) {
  const rpc = config?.rpc_url;
  // const daoAddress = "stars1..."; // Replace with the DAO contract address

  // DAO DAO staking contracts lived on Stargaze. If the DAO address is not on
  // the configured chain (or the chain is unreachable), treat it as "nothing
  // staked" instead of failing the whole points calculation.
  if (!rpc) return [];
  let cosmWasmClient: CosmWasmClient;
  try {
    cosmWasmClient = await CosmWasmClient.connect(rpc);
  } catch (error) {
    console.error('DAO DAO staking query skipped (RPC unreachable):', error);
    return [];
  }

  try {
    const queryMsg = {
      staked_nfts: {
        address: userAddress
      }
    };

    const response = await cosmWasmClient.queryContractSmart(
      daoAddress,
      queryMsg
    );
    console.log(`Staked NFTs for ${userAddress}:`, response);
    return response;
  } catch (error) {
    console.error(`Error querying staked NFTs for ${userAddress}:`, error);
    return [];
  }
}

// Helper functions for signing operations
export const getAccountInfo = async (
  chainId: string,
  snapId: string = 'npm:@leapwallet/metamask-cosmos-snap'
) => {
  const result = await window.ethereum.request({
    method: 'wallet_invokeSnap',
    params: {
      snapId: snapId,
      request: {
        method: 'getAccountInfo',
        params: {
          chain_id: chainId
        }
      }
    }
  });
  return result.data;
};

export const signDirect = async (
  chainId: string,
  signer: string,
  signDoc: any,
  snapId: string = 'npm:@leapwallet/metamask-cosmos-snap'
) => {
  const result = await window.ethereum.request({
    method: 'wallet_invokeSnap',
    params: {
      snapId: snapId,
      request: {
        method: 'signDirect',
        params: {
          chain_id: chainId,
          sign_doc: signDoc,
          signer: signer
        }
      }
    }
  });
  return result.data;
};

export const signAmino = async (
  chainId: string,
  signer: string,
  signDoc: any,
  snapId: string = 'npm:@leapwallet/metamask-cosmos-snap'
) => {
  const result = await window.ethereum.request({
    method: 'wallet_invokeSnap',
    params: {
      snapId: snapId,
      request: {
        method: 'signAmino',
        params: {
          chain_id: chainId,
          sign_doc: signDoc,
          signer: signer
        }
      }
    }
  });
  return result.data;
};

export const AddressUtilsLegacy = {
  toBytes(address: string, byteLength: number = 20) {
    if (!address) throw new Error('address is required');

    if (address.match(/^(0x)?[0-9a-fA-F]+$/)) {
      const hex = address.replace(/^0x/, '').padStart(byteLength * 2, '0');
      return fromHex(hex);
    }

    const { data } = fromBech32(address);
    if (data.length >= byteLength) return data;
    return new Uint8Array([
      ...Array(byteLength - data.length).fill(0),
      ...Array.from(data)
    ]);
  },

  toBech32(address: string, prefix: string = 'init') {
    if (!address) return '';
    return toBech32(prefix, AddressUtilsLegacy.toBytes(address));
  },

  toHex(address: string) {
    if (!address) return '';
    return toHex(AddressUtilsLegacy.toBytes(address));
  },

  toPrefixedHex(address: string) {
    if (!address) return '';
    const checksummed = getAddress(AddressUtilsLegacy.toHex(address));
    const bytes = AddressUtilsLegacy.toBytes(address);
    const last = bytes[bytes.length - 1];
    const isSpecial =
      bytes.subarray(0, bytes.length - 1).every((byte: number) => byte === 0) &&
      last < 0x10;
    if (isSpecial) return checksummed.replace(/^0x0+/, '0x');
    return checksummed;
  },

  validate(address: string, prefix: string = 'init') {
    if (isAddress(address)) {
      return true;
    }

    try {
      return fromBech32(address).prefix === prefix;
    } catch {
      return false;
    }
  },

  equals(address1: string, address2: string) {
    return (
      AddressUtilsLegacy.toBech32(address1) ===
      AddressUtilsLegacy.toBech32(address2)
    );
  }
};

export const createLinkCollection = (
  network: string,
  collectionAddress: string
) => {
  if (!network || !collectionAddress) return '#';

  switch (network?.toLocaleLowerCase()) {
    case NETWORK_CONSTANT.STARGAZE:
      return `https://www.stargaze.zone/m/${collectionAddress}/tokens`;
    case NETWORK_CONSTANT.INTERGAZE:
      return `https://intergaze.xyz/m/${collectionAddress}`;
    case NETWORK_CONSTANT.HYPEREVM:
      return `https://drip.trade/collections/${collectionAddress}`;
    case NETWORK_CONSTANT.MEGAETH.toLocaleLowerCase():
      return `https://rarible.fun/collections/megaethtestnet/${collectionAddress}`;
  }

  return '#';
};

export const getLogoNetwork = (network: string) => {
  if (!network) return '#';

  switch (network?.toLocaleLowerCase()) {
    case NETWORK_CONSTANT.STARGAZE:
      return `https://raw.githubusercontent.com/cosmos/chain-registry/master/stargaze/images/stars.png`;
    case NETWORK_CONSTANT.INTERGAZE:
      return `https://registry.initia.xyz/images/intergaze.png`;
    case NETWORK_CONSTANT.HYPEREVM:
      return `https://hyperliquid.xyz/logo.png`;
    case NETWORK_CONSTANT.MEGAETH.toLocaleLowerCase():
      return `https://rarible.com/favicon.ico`;
  }

  return '#';
};
