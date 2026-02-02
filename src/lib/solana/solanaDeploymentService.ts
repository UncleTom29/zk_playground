/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  Keypair,
  TransactionInstruction,
} from '@solana/web3.js';
import { web3 } from '@coral-xyz/anchor';
import type { DeploymentNetwork } from '@/stores/deploymentStore';

export interface SolanaDeploymentConfig {
  network: DeploymentNetwork;
  bytecode: Uint8Array;
  verificationKey: Uint8Array;
  circuitName: string;
}

export interface DeploymentProgress {
  progress: number;
  message: string;
}

export class SolanaDeploymentService {
  private connection: Connection;
  private network: DeploymentNetwork;

  constructor(network: DeploymentNetwork = 'devnet') {
    this.network = network;
    this.connection = this.getConnection(network);
  }

  private getConnection(network: DeploymentNetwork): Connection {
    const endpoints = {
      devnet: process.env.NEXT_PUBLIC_SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com',
      testnet: process.env.NEXT_PUBLIC_SOLANA_RPC_TESTNET || 'https://api.testnet.solana.com',
      'mainnet-beta':
        process.env.NEXT_PUBLIC_SOLANA_RPC_MAINNET || 'https://api.mainnet-beta.solana.com',
    };

    return new Connection(endpoints[network], 'confirmed');
  }

  async deploy(
    config: SolanaDeploymentConfig,
    wallet: any,
    signTransaction: (tx: Transaction) => Promise<Transaction>,
    onProgress?: (progress: DeploymentProgress) => void
  ): Promise<{
    programId: string;
    transactionSignature: string;
    cost: number;
  }> {
    try {
      onProgress?.({ progress: 10, message: 'Preparing deployment...' });

      // Generate a new program keypair
      const programKeypair = Keypair.generate();
      const programId = programKeypair.publicKey;

      onProgress?.({ progress: 20, message: 'Creating program account...' });

      // Calculate the size needed for the program
      const programDataSize = config.bytecode.length + config.verificationKey.length + 1024;

      // Calculate rent exemption
      const rentExemption = await this.connection.getMinimumBalanceForRentExemption(
        programDataSize
      );

      onProgress?.({ progress: 30, message: 'Calculating deployment cost...' });

      // Create program account transaction
      const createAccountInstruction = SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: programId,
        lamports: rentExemption,
        space: programDataSize,
        programId: new PublicKey('BPFLoader2111111111111111111111111111111111'),
      });

      onProgress?.({ progress: 40, message: 'Building transaction...' });

      const transaction = new Transaction().add(createAccountInstruction);

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet.publicKey;

      onProgress?.({ progress: 50, message: 'Signing transaction...' });

      // Sign with program keypair
      transaction.partialSign(programKeypair);

      // Sign with wallet
      const signedTransaction = await signTransaction(transaction);

      onProgress?.({ progress: 60, message: 'Sending transaction...' });

      // Send transaction
      const signature = await this.connection.sendRawTransaction(signedTransaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      onProgress?.({ progress: 70, message: 'Confirming transaction...' });

      // Confirm transaction
      await this.connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        'confirmed'
      );

      onProgress?.({ progress: 80, message: 'Writing program data...' });

      // Write program data (bytecode + verification key)
      await this.writeProgramData(
        programId,
        config.bytecode,
        config.verificationKey,
        wallet,
        signTransaction,
        onProgress
      );

      onProgress?.({ progress: 100, message: 'Deployment complete!' });

      // Calculate cost in SOL
      const cost = rentExemption / web3.LAMPORTS_PER_SOL;

      return {
        programId: programId.toString(),
        transactionSignature: signature,
        cost,
      };
    } catch (error: any) {
      console.error('Deployment error:', error);
      throw new Error(`Deployment failed: ${error.message}`);
    }
  }

  private async writeProgramData(
    programId: PublicKey,
    bytecode: Uint8Array,
    verificationKey: Uint8Array,
    wallet: any,
    signTransaction: (tx: Transaction) => Promise<Transaction>,
    onProgress?: (progress: DeploymentProgress) => void
  ): Promise<void> {
    try {
      // Combine bytecode and verification key
      const programData = new Uint8Array(bytecode.length + verificationKey.length);
      programData.set(bytecode, 0);
      programData.set(verificationKey, bytecode.length);

      // Split data into chunks (max 1000 bytes per transaction)
      const chunkSize = 1000;
      const chunks = [];

      for (let i = 0; i < programData.length; i += chunkSize) {
        chunks.push(programData.slice(i, i + chunkSize));
      }

      // Write each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const offset = i * chunkSize;

        const progress = 80 + (i / chunks.length) * 15;
        onProgress?.({
          progress,
          message: `Writing program data (${i + 1}/${chunks.length})...`,
        });

        // Create write instruction
        const writeInstruction = this.createWriteInstruction(programId, offset, chunk);

        const transaction = new Transaction().add(writeInstruction);

        const { blockhash } = await this.connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = wallet.publicKey;

        const signedTx = await signTransaction(transaction);
        const signature = await this.connection.sendRawTransaction(signedTx.serialize());

        await this.connection.confirmTransaction(signature, 'confirmed');
      }

      onProgress?.({ progress: 95, message: 'Finalizing program...' });
    } catch (error: any) {
      throw new Error(`Failed to write program data: ${error.message}`);
    }
  }

  private createWriteInstruction(
    programId: PublicKey,
    offset: number,
    data: Uint8Array
  ): TransactionInstruction {
    // Create instruction data
    const instructionData = Buffer.alloc(4 + data.length);
    instructionData.writeUInt32LE(offset, 0);
    instructionData.set(data, 4);

    return new TransactionInstruction({
      keys: [
        { pubkey: programId, isSigner: false, isWritable: true },
      ],
      programId: new PublicKey('BPFLoader2111111111111111111111111111111111'),
      data: instructionData,
    });
  }

  async verifyOnChain(
    programId: string,
    proof: Uint8Array,
    publicInputs: string[],
    wallet: any,
    signTransaction: (tx: Transaction) => Promise<Transaction>,
    onProgress?: (progress: DeploymentProgress) => void
  ): Promise<{
    isValid: boolean;
    transactionSignature: string;
  }> {
    try {
      onProgress?.({ progress: 10, message: 'Preparing verification...' });

      const programPubkey = new PublicKey(programId);

      onProgress?.({ progress: 30, message: 'Building verification transaction...' });

      // Create verification instruction
      const instructionData = this.encodeVerificationData(proof, publicInputs);

      const verifyInstruction = new TransactionInstruction({
        keys: [
          { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        ],
        programId: programPubkey,
        data: instructionData,
      });

      const transaction = new Transaction().add(verifyInstruction);

      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet.publicKey;

      onProgress?.({ progress: 50, message: 'Signing transaction...' });

      const signedTransaction = await signTransaction(transaction);

      onProgress?.({ progress: 70, message: 'Submitting to Solana...' });

      const signature = await this.connection.sendRawTransaction(signedTransaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      onProgress?.({ progress: 90, message: 'Confirming verification...' });

      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        'confirmed'
      );

      onProgress?.({ progress: 100, message: 'Verification complete!' });

      return {
        isValid: !confirmation.value.err,
        transactionSignature: signature,
      };
    } catch (error: any) {
      console.error('On-chain verification error:', error);
      throw new Error(`On-chain verification failed: ${error.message}`);
    }
  }

  private encodeVerificationData(proof: Uint8Array, publicInputs: string[]): Buffer {
    // Encode proof and public inputs for on-chain verification
    const publicInputsData = publicInputs.map((input) => {
      // Convert hex string to bytes
      const hex = input.replace('0x', '');
      return Buffer.from(hex, 'hex');
    });

    const totalLength = proof.length + publicInputsData.reduce((sum, buf) => sum + buf.length, 0);
    const buffer = Buffer.alloc(totalLength + 4);

    // Write proof length
    buffer.writeUInt32LE(proof.length, 0);

    // Write proof
    buffer.set(proof, 4);

    // Write public inputs
    let offset = 4 + proof.length;
    for (const inputData of publicInputsData) {
      buffer.set(inputData, offset);
      offset += inputData.length;
    }

    return buffer;
  }

  async estimateCost(bytecodeSize: number): Promise<number> {
    try {
      const rentExemption = await this.connection.getMinimumBalanceForRentExemption(bytecodeSize);
      return rentExemption / web3.LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Cost estimation error:', error);
      return 0;
    }
  }

  async getBalance(publicKey: string): Promise<number> {
    try {
      const balance = await this.connection.getBalance(new PublicKey(publicKey));
      return balance / web3.LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Get balance error:', error);
      return 0;
    }
  }

  async airdrop(publicKey: string, amount: number = 1): Promise<string> {
    try {
      if (this.network !== 'devnet') {
        throw new Error('Airdrop only available on devnet');
      }

      const signature = await this.connection.requestAirdrop(
        new PublicKey(publicKey),
        amount * web3.LAMPORTS_PER_SOL
      );

      await this.connection.confirmTransaction(signature, 'confirmed');

      return signature;
    } catch (error: any) {
      console.error('Airdrop error:', error);
      throw new Error(`Airdrop failed: ${error.message}`);
    }
  }

  setNetwork(network: DeploymentNetwork): void {
    this.network = network;
    this.connection = this.getConnection(network);
  }
}

export const solanaDeploymentService = new SolanaDeploymentService();