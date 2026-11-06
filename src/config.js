// Bounty Payout contract on GenLayer Studionet.
// Override with VITE_CONTRACT_ADDRESS to point the app at your own deployment.
// The default is the reference deployment recorded in deployments/studionet.json.
export const DEFAULT_CONTRACT = "0xFb2372a7325F63Bb4f0a3330C075e9F58Fe7466A";
export const CONTRACT_ADDRESS = ((import.meta.env?.VITE_CONTRACT_ADDRESS ?? "").trim() || DEFAULT_CONTRACT);
export const NETWORK = "studionet";
export const EXPLORER_BASE = "https://explorer-studio.genlayer.com";
export const GEN_DECIMALS = 18;
