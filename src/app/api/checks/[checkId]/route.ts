import { NextResponse } from 'next/server';
import * as repo from '@/lib/db/repo';
import { presentCheck } from '@/lib/present';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: Promise<{ checkId: string }> }) {
  const { checkId } = await params;
  const check = repo.getCheck(checkId);
  const pet = check && repo.getPet(check.petId);
  if (!check || !pet) return NextResponse.json({ error: 'Check not found' }, { status: 404 });
  return NextResponse.json(presentCheck(check, pet), { headers: { 'cache-control': 'no-store' } });
}
