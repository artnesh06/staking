// pages/api/collections/index.ts
import {
  MarketplaceCollectionParams,
  StargazeService
} from '@/lib/stargaze/stargaze-service';
import { FormattedCollection, FormattedPriceInfo } from '@/types/marketplace';
import { NextRequest, NextResponse } from 'next/server';
import { getCollectionInfo } from '@/lib/stargaze/cosmoshub-nft';

const ODDS_WIZARD = 'cosmos1yvwczgea2pz20thq4gn4xac7664p7h5w6s7ga5x9xhvxgmaczafsda5mze';

/** Odds Wizard row from its Cosmos Hub contract (marketplace stats are not available there). */
async function oddsWizardRow(): Promise<FormattedCollection[]> {
  try {
    const info = await getCollectionInfo(ODDS_WIZARD);
    const zero = { value: 0, currency: 'ATOM', usdValue: 0 };
    return [
      {
        contractAddress: ODDS_WIZARD,
        name: info.name,
        description: info.description || '',
        imageUrl: info.image || '',
        floorPrice: zero,
        bestOffer: zero,
        volume: { value: 0, change: 0 },
        owners: { count: 0, unique: 0 },
        forSale: { percentage: 0, count: 0 },
        categories: [],
        isExplicit: false
      }
    ];
  } catch {
    return [];
  }
}
export const dynamic = 'force-dynamic';

// Helper functions to format data for your components
function formatPriceInfo(priceData: any): FormattedPriceInfo {
  if (!priceData || !priceData.amount) {
    return {
      value: 0,
      currency: 'STARS',
      usdValue: 0
    };
  }

  // Convert from smallest unit using exponent
  const value =
    parseFloat(priceData.amount) / Math.pow(10, priceData.exponent || 6);

  return {
    value,
    currency: priceData.symbol || 'STARS',
    usdValue: priceData.amountUsd || 0
  };
}

function getVolume(type: string | null, stats: any) {
  if (!type) return stats.volumeUsd24hour;

  switch (type) {
    case 'VOLUME_USD_6_HOUR_DESC':
      return stats.volumeUsd6hour;
    case 'VOLUME_USD_24_HOUR_DESC':
      return stats.volumeUsd24hour;
    case 'VOLUME_USD_7_DAY_DESC':
      return stats.volumeUsd7day;
    case 'VOLUME_USD_30_DAY_DESC':
      return stats.volumeUsd30day;
    default:
      return stats.volumeUsd24hour;
  }
}

function getVolumePercn(type: string | null, stats: any) {
  if (!type) return stats.changeUsd24hourPercent;

  switch (type) {
    case 'VOLUME_USD_6_HOUR_DESC':
      return stats.changeUsd6hourPercent;
    case 'VOLUME_USD_24_HOUR_DESC':
      return stats.changeUsd24hourPercent;
    case 'VOLUME_USD_7_DAY_DESC':
      return stats.changeUsd7dayPercent;
    case 'VOLUME_USD_30_DAY_DESC':
      return stats.changeUsd30dayPercent;
    default:
      return stats.changeUsd24hourPercent;
  }
}

function formatCollection(
  rawCollection: any,
  sortBy: string | null
): FormattedCollection {
  const stats = rawCollection.stats || {};
  const tokenCounts = rawCollection.tokenCounts || {};

  // Calculate for sale percentage
  const activeTokens = tokenCounts.active || 1;
  const listedTokens = tokenCounts.listed || 0;
  const forSalePercentage =
    activeTokens > 0 ? Math.round((listedTokens / activeTokens) * 100) : 0;

  return {
    contractAddress: rawCollection.contractAddress,
    name: rawCollection.name || 'Unknown Collection',
    description: rawCollection.description || '',
    imageUrl:
      rawCollection.media.type == 'animated_image'
        ? rawCollection.media?.url || ''
        : rawCollection.media?.visualAssets?.md?.url || '',
    floorPrice: formatPriceInfo(rawCollection.floor),
    bestOffer: formatPriceInfo(rawCollection.highestOffer?.offerPrice),
    volume: {
      value: getVolume(sortBy, stats) || 0,
      change: stats.changeUsd7dayPercent || 0
    },
    owners: {
      count: stats.numOwners || 0,
      unique: Math.round(getVolumePercn(stats, sortBy) || 0)
    },
    forSale: {
      percentage: forSalePercentage,
      count: listedTokens
    },
    categories: rawCollection.categories?.public || [],
    isExplicit: rawCollection.isExplicit || false
  };
}

const COSMOS_MARKETPLACE_API = process.env.STARGAZE_MARKETPLACE_API || 'https://marketplace-api.cosmos.stargaze-apis.com/api/v1';

type Period = { sort: string; volume: string; delta: string };

/** Table period (sortBy) -> REST stats fields. 6h is not offered by the new API (uses 1d). */
function periodFor(sortBy: string | null | undefined): Period {
  switch (sortBy) {
    case 'VOLUME_USD_7_DAY_DESC':
      return { sort: 'volume7d', volume: 'volume7d', delta: 'volumeDelta7d' };
    case 'VOLUME_USD_30_DAY_DESC':
      return { sort: 'volume30d', volume: 'volume30d', delta: 'volumeDelta30d' };
    default:
      return { sort: 'volume1d', volume: 'volume1d', delta: 'volumeDelta1d' };
  }
}

function coin(value: any): FormattedPriceInfo {
  if (!value?.amount) return { value: 0, currency: value?.symbol || 'ATOM', usdValue: 0 };
  return {
    value: parseFloat(value.amount) / Math.pow(10, value.exponent ?? 6),
    currency: value.symbol || 'ATOM',
    usdValue: value.amountUsd || 0
  };
}

/** Collection from marketplace-api.cosmos.stargaze-apis.com -> table row. */
function formatCosmosCollection(raw: any, period: Period): FormattedCollection {
  const stats = raw.stats || {};
  const active = stats.activeTokens || 0;
  const listed = stats.listedTokens || 0;
  const media = raw.media || {};
  return {
    contractAddress: raw.contractAddress,
    name: raw.name || 'Unknown Collection',
    description: raw.description || '',
    imageUrl:
      media.type === 'animated_image'
        ? media.url || ''
        : media.visualAssets?.md?.url || media.url || '',
    floorPrice: coin(raw.floorPrice),
    bestOffer: coin(raw.highestOffer?.price),
    volume: {
      value: stats[period.volume]?.amountUsd || 0,
      change: Math.round((stats.volumeDelta7d || 0) * 100)
    },
    owners: {
      count: stats.uniqueHolders || 0,
      // the table shows this as the volume change % for the selected period
      unique: Math.round((stats[period.delta] || 0) * 100)
    },
    forSale: {
      percentage: active > 0 ? Math.round((listed / active) * 100) : 0,
      count: listed
    },
    categories: [],
    isExplicit: false
  };
}

// API handler
export async function GET(req: NextRequest) {
  if (req.method !== 'GET') {
    return NextResponse.json(
      {
        success: false,
        error: 'Method not allowed'
      },
      {
        status: 405
      }
    );
  }

  try {
    const { searchParams } = req.nextUrl;
    // Parse query parameters
    const offset = searchParams.get('offset');
    const limit = searchParams.get('limit');
    const sortBy = searchParams.get('sortBy');
    const searchQuery = searchParams.get('searchQuery');
    const filterByCategories = searchParams.get('filterByCategories');
    const minMaxFilters = searchParams.get('minMaxFilters');
    const filterByDenoms = searchParams.get('filterByDenoms');
    const filterByVerified = searchParams.get('filterByVerified');

    // Build parameters for Stargaze API
    const params: MarketplaceCollectionParams = {
      offset: offset ? parseInt(offset as string) : 0,
      limit: limit ? parseInt(limit as string) : 50,
      sortBy: (sortBy as string) || 'VOLUME_USD_7_DAY_DESC',
      searchQuery: searchQuery as string,
      filterByCategories: filterByCategories
        ? ((Array.isArray(filterByCategories)
            ? filterByCategories
            : [filterByCategories]) as string[])
        : undefined,
      minMaxFilters: minMaxFilters ? JSON.parse(minMaxFilters as string) : {},
      filterByDenoms: filterByDenoms
        ? ((Array.isArray(filterByDenoms)
            ? filterByDenoms
            : [filterByDenoms]) as string[])
        : undefined,
      filterByVerified: filterByVerified === 'true'
    };

    // Stargaze (Cosmos Hub) marketplace REST API - the old GraphQL API is gone
    const period = periodFor(params.sortBy as string);
    const apiUrl = `${COSMOS_MARKETPLACE_API}/collections?limit=${params.limit}&offset=${params.offset}&sort=${period.sort}%3Adesc`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(15_000), next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`Marketplace API HTTP ${res.status}`);
    const raw = await res.json();
    const list: any[] = Array.isArray(raw?.collections) ? raw.collections : [];
    const formattedCollections = list.map((item) => formatCosmosCollection(item, period));
    const total = typeof raw?.pageInfo?.total === 'number' ? raw.pageInfo.total : (params.offset ?? 0) + list.length;

    // Build pagination info
    const pageInfo = {
      total,
      offset: params.offset,
      limit: params.limit,
      hasNextPage: list.length === params.limit,
      hasPreviousPage: (params.offset ?? 0) > 0
    };

    // Return formatted response
    return NextResponse.json(
      {
        success: true,
        data: {
          collections: formattedCollections,
          pageInfo
        }
      },
      {
        status: 200
      }
    );
  } catch (error) {
    // Stargaze's marketplace API no longer exists (the collections moved to
    // the Cosmos Hub). Answer with an empty list instead of failing the page.
    console.warn(
      'Marketplace collections unavailable:',
      error instanceof Error ? error.message : error
    );
    const collections = await oddsWizardRow();
    return NextResponse.json(
      {
        success: true,
        unavailable: true,
        data: {
          collections,
          pageInfo: {
            total: collections.length,
            offset: 0,
            limit: 0,
            hasNextPage: false,
            hasPreviousPage: false
          }
        }
      },
      { status: 200 }
    );
  }
}
