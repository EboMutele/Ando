import { NextResponse } from 'next/server';
import * as repo from '@/lib/db/repo';
import { buildVetReport } from '@/lib/report/pdf';
import { computeTrend } from '@/lib/trend';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: Promise<{ petId: string }> }) {
  const { petId } = await params;
  const pet = repo.getPet(petId);
  if (!pet) return NextResponse.json({ error: 'Pet not found' }, { status: 404 });
  const checks = repo.listChecks(pet.id);
  const trend = computeTrend(pet.species, checks.filter((c) => c.status === 'done'));
  const pdf = await buildVetReport(pet, checks, trend, repo.openAlerts(pet.id));
  const name = `ando-${pet.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' },
  });
}
