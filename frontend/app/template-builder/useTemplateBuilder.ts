'use client';

import { useReducer, useCallback } from 'react';
import {
  ActionBlock,
  ActionDefinition,
  ContractAbi,
  AbiFunction,
  AbiParseResult,
  FlowTemplate,
} from './types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface TemplateBuilderState {
  blocks: ActionBlock[];
  templateName: string;
  importedAbis: ContractAbi[];
  errors: Record<string, string>; // instanceId → error message
}

const initialState: TemplateBuilderState = {
  blocks: [],
  templateName: '',
  importedAbis: [],
  errors: {},
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action =
  | { type: 'ADD_BLOCK'; block: ActionBlock }
  | { type: 'REMOVE_BLOCK'; instanceId: string }
  | { type: 'REORDER_BLOCKS'; fromIndex: number; toIndex: number }
  | { type: 'UPDATE_BLOCK_ARG'; instanceId: string; argName: string; value: string }
  | { type: 'UPDATE_BLOCK_CONTRACT'; instanceId: string; contractAddress: string }
  | { type: 'SET_TEMPLATE_NAME'; name: string }
  | { type: 'IMPORT_ABI'; abi: ContractAbi }
  | { type: 'SET_ERROR'; instanceId: string; error: string }
  | { type: 'CLEAR_ERROR'; instanceId: string }
  | { type: 'RESET' };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer(state: TemplateBuilderState, action: Action): TemplateBuilderState {
  switch (action.type) {
    case 'ADD_BLOCK':
      return { ...state, blocks: [...state.blocks, action.block] };

    case 'REMOVE_BLOCK': {
      const { [action.instanceId]: _, ...rest } = state.errors;
      return {
        ...state,
        blocks: state.blocks.filter((b) => b.instanceId !== action.instanceId),
        errors: rest,
      };
    }

    case 'REORDER_BLOCKS': {
      const blocks = [...state.blocks];
      const [moved] = blocks.splice(action.fromIndex, 1);
      blocks.splice(action.toIndex, 0, moved);
      return { ...state, blocks };
    }

    case 'UPDATE_BLOCK_ARG': {
      const blocks = state.blocks.map((b) => {
        if (b.instanceId !== action.instanceId) return b;
        const args = { ...b.args, [action.argName]: action.value };
        const isConfigured = b.inputs
          .filter((p) => !p.optional)
          .every((p) => args[p.name]?.trim());
        return { ...b, args, isConfigured };
      });
      return { ...state, blocks };
    }

    case 'UPDATE_BLOCK_CONTRACT': {
      const blocks = state.blocks.map((b) =>
        b.instanceId === action.instanceId
          ? { ...b, contractAddress: action.contractAddress }
          : b,
      );
      return { ...state, blocks };
    }

    case 'SET_TEMPLATE_NAME':
      return { ...state, templateName: action.name };

    case 'IMPORT_ABI': {
      // Replace existing abi for same address, or append
      const existing = state.importedAbis.findIndex(
        (a) => a.contractAddress === action.abi.contractAddress,
      );
      const importedAbis =
        existing >= 0
          ? state.importedAbis.map((a, i) => (i === existing ? action.abi : a))
          : [...state.importedAbis, action.abi];
      return { ...state, importedAbis };
    }

    case 'SET_ERROR':
      return { ...state, errors: { ...state.errors, [action.instanceId]: action.error } };

    case 'CLEAR_ERROR': {
      const { [action.instanceId]: _, ...rest } = state.errors;
      return { ...state, errors: rest };
    }

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// ABI parser — parses a JSON string that is either a ContractAbi or
// an array of AbiFunction[] (bare function list).
// ---------------------------------------------------------------------------

export function parseAbi(
  raw: string,
  contractAddress: string,
  label?: string,
): AbiParseResult {
  if (!contractAddress.startsWith('C')) {
    return { success: false, error: 'Contract address must start with "C"' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { success: false, error: 'Invalid JSON' };
  }

  // Accept bare array of functions
  if (Array.isArray(parsed)) {
    const fns = parsed as AbiFunction[];
    if (!fns.every((f) => typeof f.name === 'string' && Array.isArray(f.inputs))) {
      return { success: false, error: 'Array items must have name and inputs fields' };
    }
    return { success: true, abi: { contractAddress, label, functions: fns } };
  }

  // Accept ContractAbi object
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'functions' in parsed &&
    Array.isArray((parsed as ContractAbi).functions)
  ) {
    const obj = parsed as ContractAbi;
    return {
      success: true,
      abi: { contractAddress, label, functions: obj.functions },
    };
  }

  return {
    success: false,
    error: 'Expected an array of functions or an object with a "functions" key',
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

let instanceCounter = 0;

function makeInstanceId(): string {
  return `block-${Date.now()}-${++instanceCounter}`;
}

export function useTemplateBuilder() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const addBlock = useCallback((def: ActionDefinition) => {
    const block: ActionBlock = {
      instanceId: makeInstanceId(),
      definitionId: def.id,
      label: def.label,
      category: def.category,
      icon: def.icon,
      contractAddress: def.defaultContractAddress ?? '',
      functionName: def.functionName,
      inputs: def.inputs,
      args: {},
      isConfigured: def.inputs.filter((p) => !p.optional).length === 0,
    };
    dispatch({ type: 'ADD_BLOCK', block });
  }, []);

  const removeBlock = useCallback((instanceId: string) => {
    dispatch({ type: 'REMOVE_BLOCK', instanceId });
  }, []);

  const reorderBlocks = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    dispatch({ type: 'REORDER_BLOCKS', fromIndex, toIndex });
  }, []);

  const updateArg = useCallback(
    (instanceId: string, argName: string, value: string) => {
      dispatch({ type: 'UPDATE_BLOCK_ARG', instanceId, argName, value });
    },
    [],
  );

  const updateContractAddress = useCallback(
    (instanceId: string, contractAddress: string) => {
      dispatch({ type: 'UPDATE_BLOCK_CONTRACT', instanceId, contractAddress });
    },
    [],
  );

  const setTemplateName = useCallback((name: string) => {
    dispatch({ type: 'SET_TEMPLATE_NAME', name });
  }, []);

  const importAbi = useCallback(
    (raw: string, contractAddress: string, label?: string): AbiParseResult => {
      const result = parseAbi(raw, contractAddress, label);
      if (result.success && result.abi) {
        dispatch({ type: 'IMPORT_ABI', abi: result.abi });
      }
      return result;
    },
    [],
  );

  const buildTemplate = useCallback((): FlowTemplate => {
    return {
      id: `template-${Date.now()}`,
      name: state.templateName || 'Untitled Template',
      blocks: state.blocks,
      createdAt: new Date(),
    };
  }, [state.templateName, state.blocks]);

  const isValid =
    state.templateName.trim().length > 0 &&
    state.blocks.length > 0 &&
    state.blocks.every((b) => b.isConfigured);

  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  return {
    blocks: state.blocks,
    templateName: state.templateName,
    importedAbis: state.importedAbis,
    errors: state.errors,
    isValid,
    addBlock,
    removeBlock,
    reorderBlocks,
    updateArg,
    updateContractAddress,
    setTemplateName,
    importAbi,
    buildTemplate,
    reset,
  };
}
