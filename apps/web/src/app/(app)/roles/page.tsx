import type { Metadata } from 'next';
import { RolesView } from './roles-view';

export const metadata: Metadata = { title: 'Roles' };

export default function RolesPage() {
  return <RolesView />;
}
