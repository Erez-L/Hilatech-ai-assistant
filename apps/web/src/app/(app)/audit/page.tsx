import type { Metadata } from 'next';
import { AuditView } from './audit-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.auditLog') };
}

export default function AuditPage() {
  return <AuditView />;
}
