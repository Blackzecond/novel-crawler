import GlossaryPage from './GlossaryClient';

export const instant = false;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GlossaryPage id={id} />;
}
