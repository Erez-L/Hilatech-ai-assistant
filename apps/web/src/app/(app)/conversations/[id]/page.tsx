import { redirect } from 'next/navigation';

/** Deep links (`/conversations/:id`, e.g. from notifications) open the inbox with that thread selected. */
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/conversations?c=${encodeURIComponent(id)}`);
}
