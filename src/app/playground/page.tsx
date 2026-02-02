'use client';

import { useCallback, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import Toolbar from '@/components/layout/Toolbar';
import StatusBar from '@/components/layout/StatusBar';
import Sidebar from '@/components/layout/Sidebar';
import OutputPanel from '@/components/layout/OutputPanel';
import { DeploymentWizard, OnChainVerifier } from '@/components/deployment';
import { ShareDialog } from '@/components/sharing';
import { useEditorStore } from '@/stores/editorStore';
import { useCompilerStore } from '@/stores/compilerStore';
import { useProverStore } from '@/stores/proverStore';
import type { CompilerError } from '@/components/editor/NoirEditor';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { WifiOff } from 'lucide-react';
import { noirCompiler } from '@/lib/noir/noirCompilerService';
import { useAppInitialization, AppLoadingScreen } from '@/lib/solana/useAppInitialization';
import type { InputMap } from '@noir-lang/noir_js';

const NoirEditor = dynamic(() => import('@/components/editor/NoirEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="text-sm font-medium text-muted-foreground">
          Loading Monaco Editor...
        </span>
      </div>
    </div>
  ),
});

export default function PlaygroundPage() {
  const initStatus = useAppInitialization();
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [deploymentOpen, setDeploymentOpen] = useState(false);
  const [verifierOpen, setVerifierOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [compiledResult, setCompiledResult] = useState<any>(null);

  const { code, setCode, theme, sidebarOpen } = useEditorStore();
  const {
    errors,
    startCompile,
    finishCompile,
    failCompile,
    compileResult,
    isCompiling,
  } = useCompilerStore();
  const {
    inputs,
    startProving,
    finishProving,
    failProving,
    startVerification,
    finishVerification,
  } = useProverStore();

  // Show loading screen while initializing
  if (!initStatus.isReady) {
    return <AppLoadingScreen progress={initStatus.progress} error={initStatus.error} />;
  }

  // Monitor network status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Real Noir compilation using the compiler service
  const handleCompile = useCallback(async () => {
    if (isCompiling) return;
    startCompile();

    try {
      const startTime = performance.now();

      // Compile using the Noir compiler service
      const result = await noirCompiler.compile(code, 'main');
      
      const compileTime = performance.now() - startTime;

      // Store the compiled result for proof generation
      setCompiledResult(result);

      // Extract ABI and bytecode
      const program = result.program;
      const bytecode = new Uint8Array(program.bytecode);
      const abi = program.abi;

      const compileResultData = {
        bytecode,
        abi: {
          parameters: abi.parameters.map((p: any) => ({
            name: p.name,
            type: p.type,
            visibility: p.visibility,
          })),
          param_witnesses: abi.param_witnesses || {},
          return_type: abi.return_type || null,
          return_witnesses: abi.return_witnesses || [],
          error_types: abi.error_types || {},
        },
        compileTime: Math.round(compileTime),
        warnings: [],
      };

      finishCompile(compileResultData);
    } catch (error: any) {
      console.error('Compilation error:', error);

      const compileErrors: CompilerError[] = [];
      
      if (error.message) {
        const locationMatch = error.message.match(/at line (\d+), column (\d+)/);
        const line = locationMatch ? parseInt(locationMatch[1]) : 1;
        const column = locationMatch ? parseInt(locationMatch[2]) : 1;

        compileErrors.push({
          line,
          column,
          message: error.message,
          severity: 'error',
        });
      } else {
        compileErrors.push({
          line: 1,
          column: 1,
          message: 'Compilation failed. Please check your circuit syntax.',
          severity: 'error',
        });
      }

      failCompile(compileErrors);
      setCompiledResult(null);
    }
  }, [code, isCompiling, startCompile, finishCompile, failCompile]);

  // Real proof generation with Barretenberg using compiler service
  const handleProve = useCallback(async () => {
    if (!compileResult || !compiledResult) {
      return;
    }

    startProving();

    try {
      const startTime = performance.now();

      // Convert inputs to InputMap format
      const witnessInputs: InputMap = inputs as InputMap;

      // Generate proof using the compiler service
      const { proof, publicInputs: publicInputsBytes } = await noirCompiler.generateProof(
        compiledResult.noir,
        witnessInputs
      );

      const provingTime = performance.now() - startTime;

      // Extract public inputs from witness
      const publicInputs: string[] = [];
      compileResult.abi.parameters.forEach((param) => {
        if (param.visibility === 'public' && witnessInputs[param.name] !== undefined) {
          const value = witnessInputs[param.name];
          if (typeof value === 'string') {
            publicInputs.push(value);
          } else {
            publicInputs.push(`0x${value.toString(16)}`);
          }
        }
      });

      // Get verification key
      const verificationKey = await noirCompiler.getVerificationKey(compiledResult.backend);

      const result = {
        proof,
        publicInputs,
        verificationKey,
        provingTime: Math.round(provingTime),
        proofSize: proof.length,
      };

      finishProving(result);
    } catch (error: any) {
      console.error('Proving error:', error);
      failProving(error.message || 'Proof generation failed');
    }
  }, [compileResult, compiledResult, inputs, startProving, finishProving, failProving]);

  // Real verification with Barretenberg using compiler service
  const handleVerify = useCallback(async () => {
    if (!compiledResult) {
      return;
    }

    startVerification();

    try {
      const startTime = performance.now();

      // Get proof result from prover store
      const proofData = useProverStore.getState().proofResult;
      if (!proofData) {
        throw new Error('No proof to verify');
      }

      // Verify the proof using the compiler service
      const isValid = await noirCompiler.verifyProof(
        compiledResult.noir,
        proofData.proof,
        proofData.verificationKey
      );

      const verificationTime = performance.now() - startTime;

      finishVerification({
        isValid,
        verificationTime: Math.round(verificationTime),
      });
    } catch (error) {
      console.error('Verification error:', error);
      finishVerification({
        isValid: false,
        verificationTime: 0,
      });
    }
  }, [compiledResult, startVerification, finishVerification]);

  const handleDeploy = useCallback(() => {
    setDeploymentOpen(true);
  }, []);

  const handleVerifyOnChain = useCallback(() => {
    setVerifierOpen(true);
  }, []);

  const handleShare = useCallback(() => {
    setShareOpen(true);
  }, []);

  const handleSelectTemplate = useCallback(
    (template: { name: string; code: string }) => {
      setCode(template.code);
    },
    [setCode]
  );

  return (
    <div className="flex h-screen flex-col bg-background">
      {!isOnline && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <WifiOff className="h-4 w-4" />
          <AlertDescription>
            You are offline. Some features may be limited.
          </AlertDescription>
        </Alert>
      )}

      <Toolbar
        onCompile={handleCompile}
        onProve={handleProve}
        onVerify={handleVerify}
        onDeploy={handleDeploy}
        onShare={handleShare}
      />

      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && <Sidebar onSelectTemplate={handleSelectTemplate} />}

        <div className="flex-1">
          <Allotment vertical>
            <Allotment.Pane minSize={200}>
              <NoirEditor
                code={code}
                onChange={setCode}
                theme={theme === 'light' ? 'light' : 'dark'}
                errors={errors}
                onCompile={handleCompile}
                onProve={handleProve}
              />
            </Allotment.Pane>

            <Allotment.Pane minSize={100} preferredSize={250}>
              <OutputPanel />
            </Allotment.Pane>
          </Allotment>
        </div>
      </div>

      <StatusBar cursorPosition={cursorPosition} />

      <DeploymentWizard
        open={deploymentOpen}
        onOpenChange={setDeploymentOpen}
      />

      <OnChainVerifier
        open={verifierOpen}
        onOpenChange={setVerifierOpen}
      />

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  );
}