import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { z } from 'zod';
import * as repo from '@/lib/db/repo';
import { presentPet } from '@/lib/present';
import * as storage from '@/lib/storage';

export const runtime = 'nodejs';

const PetForm = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40),
  species: z.enum(['cat', 'dog'], { message: 'Choose cat or dog' }),
  ageYears: z.coerce.number().int().min(0).max(30),
  ageMonths: z.coerce.number().int().min(0).max(11).default(0),
});

export async function GET() {
  return NextResponse.json(repo.listPets().map(presentPet));
}

export async function POST(request: Request) {
  const form = await request.formData();
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
  const parsed = PetForm.safeParse(fields);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid pet' }, { status: 400 });
  }

  let photo: Buffer | null = null;
  const file = form.get('photo');
  if (file instanceof File && file.size > 0) {
    if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: 'Photo must be under 15 MB' }, { status: 413 });
    try {
      photo = await sharp(Buffer.from(await file.arrayBuffer()))
        .rotate()
        .resize(512, 512, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch {
      return NextResponse.json({ error: "That photo couldn't be read. Try a JPEG or PNG." }, { status: 400 });
    }
  }

  const { name, species, ageYears, ageMonths } = parsed.data;
  const pet = repo.createPet({ name, species, ageMonths: ageYears * 12 + ageMonths });
  if (photo) {
    pet.photoPath = await storage.put(`pets/${pet.id}/photo.jpg`, photo);
    repo.setPetPhoto(pet.id, pet.photoPath);
  }
  return NextResponse.json(presentPet(pet), { status: 201 });
}
