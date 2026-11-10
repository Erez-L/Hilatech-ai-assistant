import type { Metadata } from 'next';
import { NewWorkflowView } from './new-workflow-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.newWorkflow') };
}

export default function NewWorkflowPage() {
  return <NewWorkflowView />;
}
