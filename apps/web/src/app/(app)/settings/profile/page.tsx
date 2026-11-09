import type { Metadata } from 'next';
import { ProfileSettingsView } from './profile-settings-view';

export const metadata: Metadata = { title: 'Your profile' };

export default function ProfileSettingsPage() {
  return <ProfileSettingsView />;
}
