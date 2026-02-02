/* eslint-disable @typescript-eslint/no-explicit-any */
import { create, IPFSHTTPClient } from 'ipfs-http-client';

export interface SharedCircuit {
  cid: string;
  code: string;
  title: string;
  description: string;
  author: string;
  timestamp: number;
  tags: string[];
  bytecode?: Uint8Array;
  abi?: any;
}

export class IPFSService {
  private client: IPFSHTTPClient | null = null;
  private readonly pinataApiKey = process.env.NEXT_PUBLIC_PINATA_API_KEY;
  private readonly pinataSecretKey = process.env.NEXT_PUBLIC_PINATA_SECRET_KEY;

  constructor() {
    this.initializeClient();
  }

  private initializeClient() {
    try {
      // Try Pinata first (if API keys are available)
      if (this.pinataApiKey && this.pinataSecretKey) {
        this.client = create({
          host: 'api.pinata.cloud',
          port: 443,
          protocol: 'https',
          headers: {
            pinata_api_key: this.pinataApiKey,
            pinata_secret_api_key: this.pinataSecretKey,
          },
        });
      } else {
        // Fallback to Infura IPFS gateway
        const projectId = process.env.NEXT_PUBLIC_INFURA_PROJECT_ID;
        const projectSecret = process.env.NEXT_PUBLIC_INFURA_PROJECT_SECRET;

        if (projectId && projectSecret) {
          const auth = 'Basic ' + Buffer.from(projectId + ':' + projectSecret).toString('base64');
          this.client = create({
            host: 'ipfs.infura.io',
            port: 5001,
            protocol: 'https',
            headers: {
              authorization: auth,
            },
          });
        } else {
          // Use public IPFS gateway as last resort
          this.client = create({
            host: 'ipfs.io',
            port: 443,
            protocol: 'https',
          });
        }
      }
    } catch (error) {
      console.error('Failed to initialize IPFS client:', error);
    }
  }

  async upload(circuit: Omit<SharedCircuit, 'cid'>): Promise<{ cid: string; url: string }> {
    if (!this.client) {
      throw new Error('IPFS client not initialized');
    }

    try {
      // Convert bytecode to base64 if present
      const circuitData = {
        ...circuit,
        bytecode: circuit.bytecode ? Array.from(circuit.bytecode) : undefined,
      };

      const data = JSON.stringify(circuitData);
      const blob = new Blob([data], { type: 'application/json' });

      // Upload to IPFS
      const result = await this.client.add(blob);
      const cid = result.path;

      // Pin the content (if using Pinata)
      if (this.pinataApiKey) {
        await this.pin(cid, circuit.title);
      }

      return {
        cid,
        url: this.getGatewayUrl(cid),
      };
    } catch (error: any) {
      console.error('IPFS upload error:', error);
      throw new Error(`Failed to upload to IPFS: ${error.message}`);
    }
  }

  async retrieve(cid: string): Promise<SharedCircuit> {
    if (!this.client) {
      throw new Error('IPFS client not initialized');
    }

    try {
      const chunks: Uint8Array[] = [];

      for await (const chunk of this.client.cat(cid)) {
        chunks.push(chunk);
      }

      const data = new TextDecoder().decode(Buffer.concat(chunks));
      const circuit = JSON.parse(data);

      // Convert bytecode back to Uint8Array if present
      if (circuit.bytecode && Array.isArray(circuit.bytecode)) {
        circuit.bytecode = new Uint8Array(circuit.bytecode);
      }

      return { ...circuit, cid };
    } catch (error: any) {
      console.error('IPFS retrieve error:', error);
      throw new Error(`Failed to retrieve from IPFS: ${error.message}`);
    }
  }

  private async pin(cid: string, name: string): Promise<void> {
    if (!this.pinataApiKey || !this.pinataSecretKey) {
      return;
    }

    try {
      const response = await fetch('https://api.pinata.cloud/pinning/pinByHash', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          pinata_api_key: this.pinataApiKey,
          pinata_secret_api_key: this.pinataSecretKey,
        },
        body: JSON.stringify({
          hashToPin: cid,
          pinataMetadata: {
            name,
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to pin content');
      }
    } catch (error) {
      console.error('Pinata pinning error:', error);
      // Don't throw - pinning is optional
    }
  }

  getGatewayUrl(cid: string): string {
    // Use IPFS gateway
    if (this.pinataApiKey) {
      return `https://gateway.pinata.cloud/ipfs/${cid}`;
    }
    return `https://ipfs.io/ipfs/${cid}`;
  }

  async listPins(): Promise<string[]> {
    if (!this.pinataApiKey || !this.pinataSecretKey) {
      return [];
    }

    try {
      const response = await fetch('https://api.pinata.cloud/data/pinList', {
        headers: {
          pinata_api_key: this.pinataApiKey,
          pinata_secret_api_key: this.pinataSecretKey,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to list pins');
      }

      const data = await response.json();
      return data.rows.map((row: any) => row.ipfs_pin_hash);
    } catch (error) {
      console.error('List pins error:', error);
      return [];
    }
  }
}

// Alternative: Web3.Storage implementation
export class Web3StorageService {
  private readonly token = process.env.NEXT_PUBLIC_WEB3_STORAGE_TOKEN;

  async upload(circuit: Omit<SharedCircuit, 'cid'>): Promise<{ cid: string; url: string }> {
    if (!this.token) {
      throw new Error('Web3.Storage token not configured');
    }

    try {
      const circuitData = {
        ...circuit,
        bytecode: circuit.bytecode ? Array.from(circuit.bytecode) : undefined,
      };

      const blob = new Blob([JSON.stringify(circuitData)], { type: 'application/json' });
      const file = new File([blob], 'circuit.json', { type: 'application/json' });

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('https://api.web3.storage/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      const cid = data.cid;

      return {
        cid,
        url: `https://w3s.link/ipfs/${cid}`,
      };
    } catch (error: any) {
      console.error('Web3.Storage upload error:', error);
      throw new Error(`Failed to upload: ${error.message}`);
    }
  }

  async retrieve(cid: string): Promise<SharedCircuit> {
    try {
      const response = await fetch(`https://w3s.link/ipfs/${cid}`);

      if (!response.ok) {
        throw new Error('Failed to retrieve content');
      }

      const circuit = await response.json();

      // Convert bytecode back to Uint8Array
      if (circuit.bytecode && Array.isArray(circuit.bytecode)) {
        circuit.bytecode = new Uint8Array(circuit.bytecode);
      }

      return { ...circuit, cid };
    } catch (error: any) {
      console.error('Web3.Storage retrieve error:', error);
      throw new Error(`Failed to retrieve: ${error.message}`);
    }
  }
}

// Export a singleton instance
export const ipfsService = new IPFSService();
export const web3Storage = new Web3StorageService();

// Factory function to get the appropriate storage service
export function getStorageService(): IPFSService | Web3StorageService {
  const useWeb3Storage = process.env.NEXT_PUBLIC_USE_WEB3_STORAGE === 'true';
  return useWeb3Storage ? web3Storage : ipfsService;
}

// Gallery service for managing shared circuits
export class GalleryService {
  private readonly storageKey = 'zk-playground-gallery';

  async addCircuit(circuit: SharedCircuit): Promise<void> {
    try {
      const circuits = await this.getCircuits();
      circuits.unshift(circuit);

      // Keep only the last 100 circuits in local storage
      const limited = circuits.slice(0, 100);

      localStorage.setItem(this.storageKey, JSON.stringify(limited));
    } catch (error) {
      console.error('Failed to add circuit to gallery:', error);
    }
  }

  async getCircuits(): Promise<SharedCircuit[]> {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Failed to get circuits from gallery:', error);
      return [];
    }
  }

  async removeCircuit(cid: string): Promise<void> {
    try {
      const circuits = await this.getCircuits();
      const filtered = circuits.filter((c) => c.cid !== cid);
      localStorage.setItem(this.storageKey, JSON.stringify(filtered));
    } catch (error) {
      console.error('Failed to remove circuit from gallery:', error);
    }
  }

  async clearGallery(): Promise<void> {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.error('Failed to clear gallery:', error);
    }
  }
}

export const galleryService = new GalleryService();