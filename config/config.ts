import { env } from 'process';
require('dotenv').config();

/**
 * Odds Wizard was migrated from Stargaze to the Cosmos Hub. The "stargaze"
 * network key used across the app now means the Odds collection on
 * cosmoshub-4 (see lib/stargaze/cosmoshub-nft.ts). Stargaze's own APIs no
 * longer exist.
 *
 * Admin wallets (owners) are listed in their cosmos1 form; the stars1, init1
 * or 0x form of the same key is accepted too (see lib/auth/wallet-session.ts).
 */

const ODDS_WIZARD_COSMOS = 'cosmos1yvwczgea2pz20thq4gn4xac7664p7h5w6s7ga5x9xhvxgmaczafsda5mze';

const DEFAULT_OWNERS = [
  'cosmos1eqjmq52czppu4y7vy2qn0dvfjuyqelrw8czq5e',
  'cosmos1tc6prqsj5s3qqpkpam3jpjxh8gf8exgf2sk6f7',
  'cosmos130tcpz6l0j9f382prlj67r29jmr25cgpfyvs4j',
  'cosmos1e5n9d872aryh4y8ydjmc24pr05c7pxg0y5n0e5',
  'cosmos1u98glx08gyupzvdd2n874u86eyktvjmwssad2k'
];

function owners(): string[] {
  const fromEnv = (env.ADMIN_WALLETS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_OWNERS;
}

const config = (network: string) => {
  const collection = env.NEXT_PUBLIC_COLLECTION_ADDRESS || ODDS_WIZARD_COSMOS;
  const common = {
    collection_address: collection,
    // Kept for compatibility; Stargaze GraphQL is no longer used
    graphql_url: '',
    rpc_url: env.RPC_URL || 'https://cosmos-rpc.publicnode.com:443',
    base_url: env.NEXT_PUBLIC_BASE_URL || 'https://oddsgarden.artnesh.com',
    price_type: {
      WZRD: collection
    },
    owners: owners(),
    mnemonic_reward_wallet: env.REWARD_WALLET_MNEMONIC || ''
  };
  switch (network) {
    case 'testnet':
      return { ...common, ranking_reward: env.NEXT_PUBLIC_RANKING_RWARD_TESTNET || 100 };
    case 'mainnet':
    default:
      return { ...common, ranking_reward: env.NEXT_PUBLIC_RANKING_RWARD_MAINNET || 100 };
  }
};

const getConfig = () => {
  return config(env.NEXT_PUBLIC_NETWORK || 'mainnet');
};

export default getConfig;
