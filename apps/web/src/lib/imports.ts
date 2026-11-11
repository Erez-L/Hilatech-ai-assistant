import {
  IMPORT_FIELDS,
  validateMapping,
  type DuplicateStrategy,
  type ImportEntity,
  type ImportJob,
  type ImportMapping,
  type ImportUploadResult,
  type ImportValidation,
} from '@hilatech/contracts';
import { msg, type Msg } from '@/i18n/msg';

export type WizardStep = 'upload' | 'mapping' | 'review' | 'progress' | 'result';
export const WIZARD_STEPS: readonly WizardStep[] = [
  'upload',
  'mapping',
  'review',
  'progress',
  'result',
];

export const IMPORT_ENTITY_LABELS: Record<ImportEntity, Msg> = {
  contacts: msg('imports.entity.contacts'),
  leads: msg('imports.entity.leads'),
  companies: msg('imports.entity.companies'),
  deals: msg('imports.entity.deals'),
};

export const IMPORT_ENTITIES: readonly ImportEntity[] = ['contacts', 'leads', 'companies', 'deals'];

export interface WizardState {
  step: WizardStep;
  entity: ImportEntity;
  upload: ImportUploadResult | null;
  mapping: ImportMapping;
  duplicateStrategy: DuplicateStrategy;
  validation: ImportValidation | null;
  /** True when mapping / strategy changed after the last dry run. */
  stale: boolean;
  job: ImportJob | null;
}

export type WizardAction =
  | { type: 'entity'; entity: ImportEntity }
  | { type: 'uploaded'; upload: ImportUploadResult }
  | { type: 'map'; field: string; column: number | null }
  | { type: 'resetMapping' }
  | { type: 'strategy'; strategy: DuplicateStrategy }
  | { type: 'validated'; job: ImportJob }
  | { type: 'back' }
  | { type: 'review' }
  | { type: 'started'; job: ImportJob }
  | { type: 'progress'; job: ImportJob }
  | { type: 'restart' };

export function initialWizardState(entity: ImportEntity = 'contacts'): WizardState {
  return {
    step: 'upload',
    entity,
    upload: null,
    mapping: {},
    duplicateStrategy: 'skip',
    validation: null,
    stale: true,
    job: null,
  };
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
export const isTerminalImport = (status: string) => TERMINAL.has(status);

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'entity':
      return state.step === 'upload' ? { ...state, entity: action.entity } : state;
    case 'uploaded':
      return {
        ...state,
        step: 'mapping',
        upload: action.upload,
        entity: action.upload.entity,
        mapping: { ...action.upload.suggestedMapping },
        validation: null,
        stale: true,
        job: action.upload,
      };
    case 'map': {
      const mapping = { ...state.mapping, [action.field]: action.column };
      // A column feeds at most one field: taking it elsewhere unmaps the previous owner.
      if (action.column !== null) {
        for (const [key, col] of Object.entries(mapping)) {
          if (key !== action.field && col === action.column) mapping[key] = null;
        }
      }
      return { ...state, mapping, stale: true };
    }
    case 'resetMapping':
      return state.upload
        ? { ...state, mapping: { ...state.upload.suggestedMapping }, stale: true }
        : state;
    case 'strategy':
      return { ...state, duplicateStrategy: action.strategy, stale: true };
    case 'validated':
      return {
        ...state,
        step: 'review',
        validation: action.job.validation,
        stale: false,
        job: action.job,
      };
    case 'review':
      return { ...state, step: 'review' };
    case 'back':
      if (state.step === 'review') return { ...state, step: 'mapping' };
      if (state.step === 'mapping')
        return { ...state, step: 'upload', upload: null, validation: null, job: null };
      return state;
    case 'started':
      return { ...state, step: 'progress', job: action.job };
    case 'progress':
      return {
        ...state,
        job: action.job,
        step: isTerminalImport(action.job.status) ? 'result' : 'progress',
      };
    case 'restart':
      return initialWizardState(state.entity);
  }
}

/** Mapping problems keyed to messages the UI can translate (required fields). */
export function missingRequiredFields(
  entity: ImportEntity,
  mapping: ImportMapping,
  columnCount: number,
): string[] {
  const problems = validateMapping(entity, mapping, columnCount);
  if (problems.length === 0) return [];
  // Report the field keys that are required but unmapped (the UI renders their labels).
  const mapped = (key: string) => mapping[key] !== undefined && mapping[key] !== null;
  if (entity === 'contacts') return mapped('firstName') || mapped('fullName') ? [] : ['firstName'];
  return IMPORT_FIELDS[entity].filter((f) => f.required && !mapped(f.key)).map((f) => f.key);
}

export function canValidate(state: WizardState): boolean {
  if (!state.upload) return false;
  return validateMapping(state.entity, state.mapping, state.upload.headers.length).length === 0;
}

export function mappedColumnCount(mapping: ImportMapping): number {
  return Object.values(mapping).filter((v) => v !== null && v !== undefined).length;
}
