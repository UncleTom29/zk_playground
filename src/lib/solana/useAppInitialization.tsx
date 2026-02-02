import { useEffect, useState } from 'react';
import { default as initNoirWasm } from '@noir-lang/noir_wasm';
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';

interface InitStatus {
  isLoading: boolean;
  isReady: boolean;
  error: string | null;
  progress: number;
}

export function useAppInitialization() {
  const [status, setStatus] = useState<InitStatus>({
    isLoading: true,
    isReady: false,
    error: null,
    progress: 0,
  });

  useEffect(() => {
    let mounted = true;

    async function initialize() {
      try {
        setStatus((prev) => ({ ...prev, progress: 10, isLoading: true }));

        // Initialize Noir WASM
        await initNoirWasm();

        if (!mounted) return;
        setStatus((prev) => ({ ...prev, progress: 40 }));

        // Initialize Barretenberg (this loads the WASM backend)
        // We do a dummy initialization to preload the backend
        try {
          const dummyCircuit = {
            bytecode: new Uint8Array([]),
            abi: {
              parameters: [],
              param_witnesses: {},
              return_type: null,
              return_witnesses: [],
            },
          };
          
          // This will trigger the backend WASM to load
          const backend = new BarretenbergBackend(dummyCircuit as any);
          
          if (!mounted) return;
          setStatus((prev) => ({ ...prev, progress: 70 }));
          
          // Cleanup
          await backend.destroy();
        } catch (e) {
          // Expected to fail with dummy circuit, but WASM is now loaded
          console.log('Backend preload complete');
        }

        if (!mounted) return;
        setStatus((prev) => ({ ...prev, progress: 90 }));

        // Small delay to ensure everything is ready
        await new Promise((resolve) => setTimeout(resolve, 100));

        if (!mounted) return;
        setStatus({
          isLoading: false,
          isReady: true,
          error: null,
          progress: 100,
        });
      } catch (error: any) {
        console.error('Initialization error:', error);
        if (!mounted) return;
        setStatus({
          isLoading: false,
          isReady: false,
          error: error.message || 'Failed to initialize',
          progress: 0,
        });
      }
    }

    initialize();

    return () => {
      mounted = false;
    };
  }, []);

  return status;
}

// Loading screen component
export function AppLoadingScreen({ progress, error }: { progress: number; error: string | null }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-4 p-8">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-2xl flex">
            ZK
          </div>
          <h1 className="text-2xl font-bold">ZK-Playground</h1>
        </div>

        {error ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
              <p className="text-sm text-destructive">{error}</p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-center text-sm text-muted-foreground">
              {progress < 40 && 'Loading Noir compiler...'}
              {progress >= 40 && progress < 70 && 'Initializing proof system...'}
              {progress >= 70 && progress < 100 && 'Almost ready...'}
              {progress === 100 && 'Ready!'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}