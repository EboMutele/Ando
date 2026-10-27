import { notFound } from 'next/navigation';
import * as repo from '@/lib/db/repo';
import { presentCheck, presentPet } from '@/lib/present';
import { CheckResult } from '@/components/CheckResult';

export const dynamic = 'force-dynamic';

export default async function CheckPage({ params }: { params: Promise<{ checkId: string }> }) {
  const { checkId } = await params;
  const check = repo.getCheck(checkId);
  const pet = check && repo.getPet(check.petId);
  if (!check || !pet) notFound();
  return <CheckResult initial={presentCheck(check, pet)} pet={presentPet(pet)} />;
}
