import {
  MARKETPLACE_COLLECTIONS_QUERY,
  LAUNCHPAD_QUERY
} from './query-constants';

// Existing interfaces from the original code
export interface CollectionMinMaxFilters {
  floorMin?: number;
  floorMax?: number;
  volumeMin?: number;
  volumeMax?: number;
}

export interface MarketplaceCollectionParams {
  offset?: number;
  limit?: number;
  sortBy?: string;
  searchQuery?: string;
  filterByCategories?: string[];
  minMaxFilters?: CollectionMinMaxFilters;
  filterByDenoms?: string[];
  filterByVerified?: boolean;
}

export interface MediaAsset {
  type: string;
  url: string;
  height: number;
  width: number;
  staticUrl: string;
  __typename: string;
}

export interface VisualAssets {
  xs: MediaAsset;
  sm: MediaAsset;
  md: MediaAsset;
  lg: MediaAsset;
  xl: MediaAsset;
  __typename: string;
}

export interface Media {
  type: string;
  url: string;
  originalUrl: string;
  height: number;
  width: number;
  visualAssets: VisualAssets;
  __typename: string;
}

export interface TradingAsset {
  denom: string;
  symbol: string;
  price: number;
  exponent: number;
  __typename: string;
}

export interface PriceInfo {
  amount: string;
  amountUsd: number;
  denom: string;
  symbol: string;
  exponent: number;
  __typename: string;
}

export interface HighestOffer {
  offerPrice: PriceInfo;
  __typename: string;
}

export interface TokenCounts {
  listed: number;
  active: number;
  __typename: string;
}

export interface Categories {
  public: string[];
  __typename: string;
}

export interface CollectionStats {
  collectionAddr: string;
  change6HourPercent: number;
  change24HourPercent: number;
  change7DayPercent: number;
  change30dayPercent: number;
  volume6Hour: number;
  volume24Hour: number;
  volume7Day: number;
  volume30Day: number;
  changeUsd6hourPercent: number;
  changeUsd24hourPercent: number;
  changeUsd7dayPercent: number;
  changeUsd30dayPercent: number;
  volumeUsd6hour: number;
  volumeUsd24hour: number;
  volumeUsd7day: number;
  volumeUsd30day: number;
  bestOffer: number;
  bestOfferUsd: number;
  numOwners: number;
  uniqueOwnerPercent: number;
  salesCountTotal: number;
  __typename: string;
}

export interface Collection {
  __typename: string;
  contractAddress: string;
  contractUri: string;
  name: string;
  description: string;
  isExplicit: boolean;
  categories: Categories;
  tradingAsset: TradingAsset;
  floor: PriceInfo;
  highestOffer: HighestOffer;
  tokenCounts: TokenCounts;
  stats: CollectionStats;
  media: Media;
}

export interface PageInfo {
  __typename: string;
  total: number;
  offset: number;
  limit: number;
}

export interface CollectionsResponse {
  __typename: string;
  collections: Collection[];
  pageInfo: PageInfo;
}

export interface MarketplaceCollectionsData {
  collections: CollectionsResponse;
}

// New interfaces for Launchpad functionality
export interface NameRecord {
  name: string;
  value: string;
  verified: boolean;
  __typename: string;
}

export interface CreatorName {
  name: string;
  records: NameRecord[];
  __typename: string;
}

export interface Creator {
  address: string;
  name: CreatorName;
  __typename: string;
}

export interface RoyaltyInfo {
  sharePercent: number;
  __typename: string;
}

export interface BurnCondition {
  collectionAddress: string;
  amountToBurn: number;
  __typename: string;
}

export interface AddressTokenCounts {
  limit: number;
  mintable: number;
  minted: number;
  __typename: string;
}

export interface StageCounts {
  limit: number;
  mintable: number;
  minted: number;
  __typename: string;
}

export interface MintStage {
  id: string;
  name: string;
  type: string;
  presaleType: string;
  status: string;
  startTime: string;
  endTime: string;
  salePrice: PriceInfo;
  discountPrice: PriceInfo;
  burnConditions: BurnCondition[];
  addressTokenCounts: AddressTokenCounts;
  stageCounts: StageCounts;
  numMembers: number;
  isMember: boolean;
  proofs: string[];
  __typename: string;
}

export interface MinterV2 {
  minterType: string;
  minterAddress: string;
  mintableTokens: number;
  mintedTokens: number;
  airdroppedTokens: number;
  numTokens: number;
  currentStage: MintStage;
  mintStages: MintStage[];
  __typename: string;
}

export interface LaunchpadCollection {
  __typename: string;
  contractAddress: string;
  contractUri: string;
  name: string;
  description: string;
  website: string;
  isExplicit: boolean;
  minterAddress: string;
  featured: boolean;
  floor: PriceInfo;
  creator: Creator;
  royaltyInfo: RoyaltyInfo;
  minterV2: MinterV2;
  startTradingTime: string;
  media: Media;
}

export interface LaunchpadData {
  collection: LaunchpadCollection;
}

export interface GraphQLResponse<T = any> {
  data: T;
  errors?: any[];
}

// Configuration interface (you may need to adjust this based on your config structure)
interface Config {
  graphql_url: string;
}

export class StargazeService {
  private readonly apiUrl = 'https://graphql.mainnet.stargaze-apis.com/graphql';
  private config?: Config;

  constructor(config?: Config) {
    this.config = config;
  }

  async getMarketplaceCollection(
    params: MarketplaceCollectionParams = {}
  ): Promise<CollectionsResponse> {
    const {
      offset,
      limit = 100,
      sortBy = 'VOLUME_USD_7_DAY_DESC',
      searchQuery,
      filterByCategories,
      minMaxFilters = {},
      filterByDenoms,
      filterByVerified = false
    } = params;

    const variables = {
      offset,
      limit,
      sortBy,
      searchQuery,
      filterByCategories,
      minMaxFilters,
      filterByDenoms,
      filterByVerified
    };

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          operationName: 'MarketplaceCollections',
          variables,
          query: MARKETPLACE_COLLECTIONS_QUERY
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result: GraphQLResponse<MarketplaceCollectionsData> =
        await response.json();

      if (result.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
      }

      return result.data.collections;
    } catch (error) {
      console.error('Error fetching marketplace collections:', error);
      throw error;
    }
  }

  /**
   * Launchpad data for a collection. Stargaze collections now live on the
   * Cosmos Hub; their data comes from Stargaze's REST APIs
   * (launchpad-api / marketplace-api .cosmos.stargaze-apis.com). The old
   * GraphQL API no longer exists. Times are converted from nanoseconds to ms.
   */
  async getLaunchpad(
    address: string,
    _walletAddress?: string
  ): Promise<LaunchpadCollection> {
    const LAUNCHPAD_API =
      process.env.STARGAZE_LAUNCHPAD_API ||
      'https://launchpad-api.cosmos.stargaze-apis.com/api/v1';
    const MARKETPLACE_API =
      process.env.STARGAZE_MARKETPLACE_API ||
      'https://marketplace-api.cosmos.stargaze-apis.com/api/v1';
    const nsToMs = (v: any) =>
      v === null || v === undefined || v === '' ? v : Math.round(Number(v) / 1e6);
    const getJson = async (url: string) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res.json();
    };

    const [m, col] = await Promise.all([
      getJson(`${LAUNCHPAD_API}/minters/${address}`),
      getJson(`${MARKETPLACE_API}/collections/${address}`).catch(() => null)
    ]);

    const stage = (st: any) =>
      st ? { ...st, startTime: nsToMs(st.startTime), endTime: nsToMs(st.endTime) } : st;
    const minter = m?.minter
      ? {
          ...m.minter,
          currentStage: stage(m.minter.currentStage),
          mintStages: Array.isArray(m.minter.mintStages) ? m.minter.mintStages.map(stage) : []
        }
      : null;

    return {
      contractAddress: m.contractAddress,
      contractUri: null,
      name: m.name,
      description: m.description,
      website: null,
      isExplicit: false,
      minterAddress: minter?.minterAddress ?? null,
      featured: col?.featured ?? false,
      floor: col?.floorPrice ?? null,
      creator: {
        address: m.creator?.address ?? '',
        name: m.creator?.name?.name ?? null
      },
      royaltyInfo: col?.royaltyInfo ?? null,
      minterV2: minter,
      startTradingTime: nsToMs(m.startTradingTime),
      media: col?.media ?? null
    } as unknown as LaunchpadCollection;
  }
}
