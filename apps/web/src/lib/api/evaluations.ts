import type {
  CreateEvaluationCaseRequest,
  CreateEvaluationDatasetRequest,
  EvaluationCase,
  EvaluationDataset,
  EvaluationDatasetDetail,
  EvaluationRun,
  EvaluationRunDetail,
  UpdateEvaluationCaseRequest,
} from '@hilatech/contracts';
import { api } from './client';

const enc = encodeURIComponent;

export const evaluationsApi = {
  datasets: () => api.get<EvaluationDataset[]>('/evaluations/datasets'),
  dataset: (id: string) => api.get<EvaluationDatasetDetail>(`/evaluations/datasets/${enc(id)}`),
  createDataset: (body: CreateEvaluationDatasetRequest) =>
    api.post<EvaluationDataset>('/evaluations/datasets', body),
  deleteDataset: (id: string) => api.delete<void>(`/evaluations/datasets/${enc(id)}`),
  addCase: (datasetId: string, body: CreateEvaluationCaseRequest) =>
    api.post<EvaluationCase>(`/evaluations/datasets/${enc(datasetId)}/cases`, body),
  updateCase: (datasetId: string, caseId: string, body: UpdateEvaluationCaseRequest) =>
    api.patch<EvaluationCase>(`/evaluations/datasets/${enc(datasetId)}/cases/${enc(caseId)}`, body),
  deleteCase: (datasetId: string, caseId: string) =>
    api.delete<void>(`/evaluations/datasets/${enc(datasetId)}/cases/${enc(caseId)}`),
  startRun: (datasetId: string, agentId: string) =>
    api.post<EvaluationRun>(`/evaluations/datasets/${enc(datasetId)}/runs`, { agentId }),
  runs: (datasetId: string) =>
    api.list<EvaluationRun>('/evaluations/runs', { datasetId, page: 1, pageSize: 50 }),
  run: (id: string) => api.get<EvaluationRunDetail>(`/evaluations/runs/${enc(id)}`),
  cancelRun: (id: string) => api.post<EvaluationRun>(`/evaluations/runs/${enc(id)}/cancel`),
};
