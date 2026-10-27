import { NextResponse } from 'next/server';
import * as repo from '@/lib/db/repo';
import { presentCheck, presentPet } from '@/lib/present';
import { computeTrend } from '@/lib/trend';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: Promise<{ petId: string }> }) {
  const { petId } = await params;
  const pet = repo.getPet(petId);
  if (!pet) return NextResponse.json({ error: 'Pet not found' }, { status: 404 });
  const checks = repo.listChecks(pet.id);
  return NextResponse.json({
    pet: presentPet(pet),
    checks: checks.map((c) => presentCheck(c, pet)),
    trend: computeTrend(pet.species, checks.filter((c) => c.status === 'done')),
    alerts: repo.openAlerts(pet.id),
  });
}
