import { solanaDeploymentService, type SolanaDeploymentConfig, type DeploymentProgress } from './solanaDeploymentService';
import type { PublicKey, Transaction } from '@solana/web3.js';
import type { DeploymentNetwork } from '@/stores/deploymentStore';

export interface SunspotVerifierConfig {
  verificationKey: Uint8Array;
  network: DeploymentNetwork;
  circuitName: string;
}

export interface SunspotDeploymentResult {
  programId: string;
  transactionSignature: string;
  network: DeploymentNetwork;
  cost: number;
}

export interface SunspotVerificationResult {
  isValid: boolean;
  transactionSignature: string;
}

export class SunspotService {
  constructor(private network: DeploymentNetwork) {
    solanaDeploymentService.setNetwork(network);
  }

  async deployVerifier(
    config: SunspotVerifierConfig,
    wallet: PublicKey,
    signTransaction: (tx: Transaction) => Promise<Transaction>,
    onProgress?: (progress: number, message: string) => void
  ): Promise<SunspotDeploymentResult> {
    const deploymentConfig: SolanaDeploymentConfig = {
      network: config.network,
      bytecode: new Uint8Array(0), // Sunspot handles bytecode generation
      verificationKey: config.verificationKey,
      circuitName: config.circuitName,
    };

    const progressCallback = onProgress
      ? (progress: DeploymentProgress) => onProgress(progress.progress, progress.message)
      : undefined;

    const result = await solanaDeploymentService.deploy(
      deploymentConfig,
      { publicKey: wallet },
      signTransaction,
      progressCallback
    );

    return {
      ...result,
      network: config.network,
    };
  }

  async verifyProofOnChain(
    config: {
      programId: string;
      proof: Uint8Array;
      publicInputs: string[];
      network: DeploymentNetwork;
    },
    wallet: PublicKey,
    signTransaction: (tx: Transaction) => Promise<Transaction>,
    onProgress?: (progress: number, message: string) => void
  ): Promise<SunspotVerificationResult> {
    const progressCallback = onProgress
      ? (progress: DeploymentProgress) => onProgress(progress.progress, progress.message)
      : undefined;

    const result = await solanaDeploymentService.verifyOnChain(
      config.programId,
      config.proof,
      config.publicInputs,
      { publicKey: wallet },
      signTransaction,
      progressCallback
    );

    return result;
  }

  async estimateDeploymentCost(verificationKeySize: number): Promise<number> {
    // Estimate cost based on verification key size
    // Add some overhead for account data
    const estimatedSize = verificationKeySize + 2048;
    return await solanaDeploymentService.estimateCost(estimatedSize);
  }

  async requestAirdrop(wallet: PublicKey, amount: number = 1): Promise<string> {
    return await solanaDeploymentService.airdrop(wallet.toString(), amount);
  }

  async getBalance(wallet: PublicKey): Promise<number> {
    return await solanaDeploymentService.getBalance(wallet.toString());
  }
}

// Factory function to get service instance
export function getSunspotService(network: DeploymentNetwork): SunspotService {
  return new SunspotService(network);
};