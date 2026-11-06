import GlossaryPage from './GlossaryClient';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GlossaryPage id={id} />;
}
