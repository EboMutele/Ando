/* eslint-disable @next/next/no-img-element -- media is served from our own API route */
export function PetAvatar({ pet, size = 48 }: { pet: { name: string; species: string; photoUrl: string | null }; size?: number }) {
  if (pet.photoUrl) {
    return <img src={pet.photoUrl} alt={pet.name} width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-surface-2 font-semibold text-ink-2"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-label={pet.name}
    >
      {pet.name[0]?.toUpperCase()}
    </span>
  );
}
