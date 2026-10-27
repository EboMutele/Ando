import { NextResponse } from 'next/server';
import * as repo from '@/lib/db/repo';

export const runtime = 'nodejs';

/** Dismisses an alert. A later check that is still raised opens a new one. */
export async function DELETE(_: Request, { params }: { params: Promise<{ petId: string; alertId: string }> }) {
  const { petId, alertId } = await params;
  repo.dismissAlert(petId, Number(alertId));
  return new NextResponse(null, { status: 204 });
}
