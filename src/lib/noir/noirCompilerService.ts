import { compile, createFileManager } from '@noir-lang/noir_wasm';
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';
import { Noir } from '@noir-lang/noir_js';
import type { CompiledCircuit, InputMap } from '@noir-lang/noir_js';

export interface NoirCompilerResult {
  program: CompiledCircuit;
  backend: BarretenbergBackend;
  noir: Noir;
}

export class NoirCompilerService {
  private static instance: NoirCompilerService;
  private compiledPrograms: Map<string, NoirCompilerResult> = new Map();

  private constructor() {}

  static getInstance(): NoirCompilerService {
    if (!NoirCompilerService.instance) {
      NoirCompilerService.instance = new NoirCompilerService();
    }
    return NoirCompilerService.instance;
  }

  async compile(code: string, projectName: string = 'circuit'): Promise<NoirCompilerResult> {
    try {
      // Create in-memory file manager (browser-safe)
      const fm = createFileManager('/');

      // Write the main Noir file and minimal Nargo.toml
      await fm.writeFile('src/main.nr', new TextEncoder().encode(code));
      await fm.writeFile(
        'Nargo.toml',
        new TextEncoder().encode(`[package]
name = "${projectName}"
type = "bin"
authors = [""]
compiler_version = ">=0.23.0"

[dependencies]`)
      );

      // Compile the project
      const compiled = await compile(fm);

      if ('error' in compiled) {
        throw new Error(compiled.error);
      }

      const program = compiled as CompiledCircuit;

      // Initialize backend and Noir instance
      const backend = new BarretenbergBackend(program);
      const noir = new Noir(program, backend);

      const result: NoirCompilerResult = { program, backend, noir };

      // Cache by code hash (you could improve with a better key if needed)
      this.compiledPrograms.set(code, result);

      return result;
    } catch (error) {
      console.error('Noir compilation failed:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async generateProof(
    noir: Noir,
    backend: BarretenbergBackend,
    inputs: InputMap
  ): Promise<{
    proof: Uint8Array;
    publicInputs: Uint8Array;
  }> {
    try {
      // Execute circuit to generate witness
      const witness = await noir.execute(inputs);

      // Generate the actual proof using the backend
      const proofData = await backend.generateProof(witness);

      return {
        proof: new Uint8Array(proofData.proof),
        publicInputs: new Uint8Array(proofData.publicInputs),
      };
    } catch (error) {
      console.error('Proof generation failed:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async verifyProof(
    backend: BarretenbergBackend,
    proof: Uint8Array,
    publicInputs: Uint8Array
  ): Promise<boolean> {
    try {
      // Modern verification flow (adjust if your backend version uses verifyFromCs or similar)
      const isValid = await backend.verifyProof({
        proof: Array.from(proof),
        publicInputs: Array.from(publicInputs),
      });
      return isValid;
    } catch (error) {
      console.error('Proof verification failed:', error);
      return false;
    }
  }

  async getVerificationKey(backend: BarretenbergBackend): Promise<Uint8Array> {
    try {
      // Note: In recent Barretenberg versions, vk is often available after compilation/proving
      // If this method doesn't exist, extract vk from the program or use backend-specific API
      // @ts-expect-error - getVerificationKey may be internal or version-specific
      const vk = await backend.getVerificationKey?.();
      if (!vk) {
        throw new Error('Verification key not available from backend');
      }
      return new Uint8Array(vk);
    } catch (error) {
      console.error('Failed to get verification key:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  clearCache(): void {
    this.compiledPrograms.clear();
  }

  getCached(code: string): NoirCompilerResult | undefined {
    return this.compiledPrograms.get(code);
  }
}

export const noirCompiler = NoirCompilerService.getInstance();