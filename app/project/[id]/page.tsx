import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import ProjectClient from './ProjectClient';

// cacheComponents ต้องใช้ pattern นี้: อ่าน dynamic params ใน server component ที่อยู่ใต้ <Suspense> แล้วส่ง string ลงให้ client component
export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-bg text-fg flex items-center justify-center text-muted text-sm">
          <Loader2 className="animate-spin w-5 h-5 mr-2" /> กำลังโหลด...
        </div>
      }
    >
      <ProjectLoader params={params} />
    </Suspense>
  );
}

async function ProjectLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) throw new Error('missing project id');
  return <ProjectClient id={id} />;
}
