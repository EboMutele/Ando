import { NextResponse } from 'next/server';
import * as repo from '@/lib/db/repo';
import { renderCard } from '@/lib/report/card';
import { computeTrend } from '@/lib/trend';

export const runtime = 'nodejs';

/** Shareable 4:5 PNG summarising the trend. */
export async function GET(_: Request, { params }: { params: Promise<{ petId: string }> }) {
  const { petId } = await params;
  const pet = repo.getPet(petId);
  if (!pet) return NextResponse.json({ error: 'Pet not found' }, { status: 404 });
  const done = repo.listChecks(pet.id).filter((c) => c.status === 'done');
  const png = await renderCard(pet, computeTrend(pet.species, done), done.at(-1) ?? null);
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
}
